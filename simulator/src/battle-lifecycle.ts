/**
 * The shared in-process battle lifecycle.
 *
 * This is the single implementation of the `BattleStream`/`getPlayerStreams`
 * lifecycle used by both the Step 3 seeded-battle runner and the Step 4
 * fixture recorder. It never starts a server, opens a network port, calls
 * `process.exit`, or writes files.
 */
import {
  createBattleStream,
  createRandomPlayerAI,
  getShowdownPlayerStreams,
  packShowdownTeam,
  type ShowdownPRNGSeed,
  type ShowdownPlayerStream,
  type ShowdownPokemonSet,
} from "./showdown";
import { normalizeProtocolChunk } from "./protocol";
import { runScriptedPlayer } from "./scripted-player";

export type BattleSide = "p1" | "p2";

/** The three streams a fixture observer may see chunks from. */
export type ObservedStream = BattleSide | "omniscient";

export interface RandomPlayerLifecycleSpec {
  kind: "random";
  name: string;
  /** Seed for Showdown's own random-team generator. */
  teamSeed: ShowdownPRNGSeed;
  /** Seed for this side's `RandomPlayerAI` decisions. */
  agentSeed: ShowdownPRNGSeed;
  /**
   * Probability of moving rather than switching when both are legal. Must be
   * strictly between 0 and 1 to make voluntary switches possible: `move: 0` is
   * invalid because `RandomPlayerAI` treats it as the default `1`.
   */
  move?: number;
}

export interface ScriptedPlayerLifecycleSpec {
  kind: "scripted";
  name: string;
  /** A fully authored team (`gen9customgame`). */
  team: ShowdownPokemonSet[];
  /** One raw choice per non-`wait` request, in order. */
  choices: string[];
  /** Only valid for forced-terminal cases; see `runScriptedPlayer`. */
  allowUnansweredRequests?: boolean;
}

export type PlayerLifecycleSpec = RandomPlayerLifecycleSpec | ScriptedPlayerLifecycleSpec;

export interface BattleLifecycleOptions {
  /** `"gen9randombattle"` or `"gen9customgame"`. */
  formatId: string;
  /** Battle-mechanics seed. Mandatory for every case, including forced ones. */
  startSeed: ShowdownPRNGSeed;
  p1: PlayerLifecycleSpec;
  p2: PlayerLifecycleSpec;
  /**
   * Raw omniscient commands written immediately after the `>start`/`>player`
   * block, such as `>forcetie` or `>editbattle pp ...`.
   */
  postStartCommands?: readonly string[];
  /** Observes every raw chunk pushed to `p1`, `p2`, and `omniscient`. */
  onChunk?: (stream: ObservedStream, chunk: string) => void;
}

export type BattleWinner = BattleSide | "tie";

export interface BattleLifecycleResult {
  winner: BattleWinner;
  /**
   * Number of `|turn|<n>` markers observed. A forced terminal command can end
   * a battle before any turn marker is emitted, so this may be `0`.
   */
  turns: number;
  /** Timestamp-normalized omniscient protocol lines, in order. */
  omniscientLog: string[];
}

/**
 * Wraps a stream's `push` so an observer sees every chunk without adding a
 * second consumer. `p1`/`p2` are single-consumer: a second `for await` reader
 * would steal that side's private `|request|` chunks from its player.
 */
function observeStreamPushes(
  stream: ShowdownPlayerStream,
  name: ObservedStream,
  onChunk: (stream: ObservedStream, chunk: string) => void
): void {
  const originalPush = stream.push.bind(stream);
  stream.push = (chunk: string): void => {
    onChunk(name, chunk);
    originalPush(chunk);
  };
}

function buildPlayerSpecJson(spec: PlayerLifecycleSpec): string {
  if (spec.kind === "random") {
    // No `team` field: `gen9randombattle` teams come from Showdown's own
    // seeded random-team generator.
    return JSON.stringify({ name: spec.name, seed: spec.teamSeed });
  }
  return JSON.stringify({ name: spec.name, team: packShowdownTeam(spec.team) });
}

function assertValidPlayerSpec(side: BattleSide, spec: PlayerLifecycleSpec): void {
  if (spec.kind === "random" && spec.move !== undefined && !(spec.move > 0 && spec.move <= 1)) {
    throw new Error(
      `invalid move probability for ${side}: expected a value in (0, 1], got ${spec.move}`
    );
  }
  if (spec.kind === "scripted" && spec.team.length === 0) {
    throw new Error(`scripted player ${side} must supply a non-empty team`);
  }
}

function startPlayer(
  side: BattleSide,
  spec: PlayerLifecycleSpec,
  stream: ShowdownPlayerStream
): Promise<void> {
  if (spec.kind === "random") {
    const options = spec.move === undefined ? {} : { move: spec.move };
    return createRandomPlayerAI(stream, spec.agentSeed, options).start();
  }
  return runScriptedPlayer(stream, {
    side,
    choices: spec.choices,
    allowUnansweredRequests: spec.allowUnansweredRequests,
  });
}

function parseTerminal(
  omniscientLog: readonly string[],
  p1Name: string,
  p2Name: string
): { winner: BattleWinner; turns: number } {
  let winner: BattleWinner | null = null;
  let terminalCount = 0;
  let turns = 0;

  for (const line of omniscientLog) {
    if (line.startsWith("|turn|")) {
      turns++;
      continue;
    }
    // The tie terminal line is exactly `|tie`; a win is `|win|<name>`.
    if (line === "|tie") {
      terminalCount++;
      winner = "tie";
      continue;
    }
    if (line.startsWith("|win|")) {
      terminalCount++;
      const name = line.slice("|win|".length);
      if (name === p1Name) {
        winner = "p1";
      } else if (name === p2Name) {
        winner = "p2";
      } else {
        throw new Error(`unrecognized winner name in terminal line: ${line}`);
      }
    }
  }

  if (winner === null) {
    throw new Error(
      `battle ended without a terminal |win| or |tie| line after ${omniscientLog.length} protocol line(s)`
    );
  }
  if (terminalCount !== 1) {
    throw new Error(`expected exactly one terminal line, found ${terminalCount}`);
  }
  return { winner, turns };
}

/** Runs one complete battle in memory and returns its parsed result. */
export async function runBattleLifecycle(
  options: BattleLifecycleOptions
): Promise<BattleLifecycleResult> {
  const { formatId, startSeed, p1, p2, postStartCommands = [], onChunk } = options;

  // Validate both sides before constructing anything, so a rejected spec can
  // never leave one player's promise running unobserved.
  assertValidPlayerSpec("p1", p1);
  assertValidPlayerSpec("p2", p2);

  const battleStream = createBattleStream();
  const streams = getShowdownPlayerStreams(battleStream);

  if (onChunk) {
    // Wrapped before either player starts, so no chunk can be missed.
    observeStreamPushes(streams.omniscient, "omniscient", onChunk);
    observeStreamPushes(streams.p1, "p1", onChunk);
    observeStreamPushes(streams.p2, "p2", onChunk);
  }

  const p1Done = startPlayer("p1", p1, streams.p1);
  const p2Done = startPlayer("p2", p2, streams.p2);

  const omniscientLog: string[] = [];
  const omniscientDone = (async () => {
    for await (const chunk of streams.omniscient) {
      omniscientLog.push(...normalizeProtocolChunk(chunk));
    }
  })();

  const startBlock = [
    `>start ${JSON.stringify({ formatid: formatId, seed: startSeed })}`,
    `>player p1 ${buildPlayerSpecJson(p1)}`,
    `>player p2 ${buildPlayerSpecJson(p2)}`,
  ].join("\n");
  void streams.omniscient.write(startBlock);
  for (const command of postStartCommands) {
    void streams.omniscient.write(command);
  }

  await Promise.all([p1Done, p2Done, omniscientDone]);

  const { winner, turns } = parseTerminal(omniscientLog, p1.name, p2.name);
  return { winner, turns, omniscientLog };
}
