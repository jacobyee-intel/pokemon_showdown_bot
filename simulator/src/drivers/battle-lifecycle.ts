/**
 * The battle lifecycle harness.
 *
 * There is exactly one lifecycle implementation and it is
 * `ShowdownBattleSession` (`battle-session.ts`). This module is a thin harness
 * over it: it maps player specs onto one `StartSpec`, owns the single
 * `for await` over `session.outputs()`, fans each side's raw chunks out to that
 * side's temporary driver through a private queue, and reassembles the Step 3
 * result. It never starts a server, opens a network port, calls `process.exit`,
 * or writes files.
 *
 * Omniscient protocol reaches a caller only through `onDebugLines`, which is
 * wrapped into the session's explicit `debug` observer. The normal `onLines`
 * callback takes a `BattleSide`, so it is structurally incapable of carrying
 * omniscient data.
 */
import {
  ShowdownBattleSession,
  type PlayerStartSpec,
  type StartSpec,
} from "../core/battle-session";
import {
  createRecordingOmniscientObserver,
  type DebugOmniscientObserver,
} from "../core/debug-omniscient-observer";
import { normalizeProtocolLine } from "../core/protocol";
import { runRandomPlayer } from "./random-player-driver";
import { runScriptedPlayer } from "./scripted-player";
import {
  SimulatorLifecycleError,
  type BattleSide,
  type BattleWinner,
  type ChunkOutput,
  type ErrorOutput,
  type SimulatorThrowCode,
  type TerminalOutput,
} from "../core/simulator-messages";
import type { ShowdownPRNGSeed, ShowdownPokemonSet } from "../core/showdown";

// `simulator-messages.ts` is the single source of truth for both; nothing else
// in the project redeclares them.
export type { BattleSide, BattleWinner };

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
   * invalid because `RandomPlayerAI` treats it as the default `1`. Validated
   * by `random-player-driver.ts`, which owns that temporary driver's rules.
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
  /** Carried on every session output. Defaults to `"battle"`. */
  battleId?: string;
  /** Observes every raw protocol line delivered to `p1` and `p2`. */
  onLines?: (player: BattleSide, lines: readonly string[]) => void;
  /**
   * DEBUG-ONLY: observes raw omniscient protocol lines. Supplying it is the
   * only way omniscient data can reach a caller.
   */
  onDebugLines?: (lines: readonly string[]) => void;
}

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
 * A private, single-consumer FIFO of one side's chunks.
 *
 * These queues are separate objects from `session.outputs()`: cancelling a
 * queue iterator tears down exactly one driver and never touches the session.
 */
class ChunkQueue implements AsyncIterable<ChunkOutput> {
  private readonly items: ChunkOutput[] = [];
  private closed = false;
  private waiters: (() => void)[] = [];

  push(item: ChunkOutput): void {
    this.items.push(item);
    this.wake();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<ChunkOutput> {
    let cancelled = false;
    return {
      next: async (): Promise<IteratorResult<ChunkOutput>> => {
        for (;;) {
          if (cancelled) return { value: undefined, done: true };
          const value = this.items.shift();
          if (value !== undefined) return { value, done: false };
          if (this.closed) return { value: undefined, done: true };
          await this.wait();
        }
      },
      // Cancellation must unblock a pending `next()`, or a driver that
      // cancels its input while waiting would stay pending forever.
      return: async (): Promise<IteratorResult<ChunkOutput>> => {
        cancelled = true;
        this.wake();
        return { value: undefined, done: true };
      },
    };
  }
}

function toPlayerStartSpec(spec: PlayerLifecycleSpec): PlayerStartSpec {
  if (spec.kind === "random") {
    return { name: spec.name, teamSeed: spec.teamSeed };
  }
  return { name: spec.name, team: spec.team };
}

function startDriver(
  side: BattleSide,
  spec: PlayerLifecycleSpec,
  chunks: AsyncIterable<ChunkOutput>,
  submitChoice: (choice: string) => void
): Promise<void> {
  if (spec.kind === "random") {
    return runRandomPlayer(
      chunks,
      submitChoice,
      spec.move === undefined
        ? { agentSeed: spec.agentSeed }
        : { agentSeed: spec.agentSeed, move: spec.move }
    );
  }
  return runScriptedPlayer(chunks, submitChoice, {
    side,
    choices: spec.choices,
    allowUnansweredRequests: spec.allowUnansweredRequests,
  });
}

/**
 * Counts turn markers and asserts the omniscient log carries exactly one
 * terminal line. Winner-name mapping lives in the session.
 */
function parseTerminal(omniscientLog: readonly string[]): { turns: number } {
  let turns = 0;
  let terminalCount = 0;
  for (const line of omniscientLog) {
    if (line.startsWith("|turn|")) {
      turns++;
      continue;
    }
    // The tie terminal line is exactly `|tie`; a win is `|win|<name>`.
    if (line === "|tie" || line.startsWith("|win|")) terminalCount++;
  }
  if (terminalCount !== 1) {
    throw new Error(`expected exactly one terminal line, found ${terminalCount}`);
  }
  return { turns };
}

function describeErrorOutput(output: ErrorOutput): string {
  const side = output.player === undefined ? "" : ` for ${output.player}`;
  return `simulator reported ${output.code}${side}: ${output.message}`;
}

/**
 * The one lifecycle code that means "this session no longer accepts input"
 * (input after the battle ended, and input after close). It is the only code
 * a late driver choice may be forgiven for.
 */
const INPUT_AFTER_CLOSE_CODE: SimulatorThrowCode = "input-after-end";

/** Runs one complete battle in memory and returns its parsed result. */
export async function runBattleLifecycle(
  options: BattleLifecycleOptions
): Promise<BattleLifecycleResult> {
  const {
    formatId,
    startSeed,
    p1,
    p2,
    postStartCommands = [],
    battleId = "battle",
    onLines,
    onDebugLines,
  } = options;

  // The harness always records omniscient lines: Step 3 owes its callers an
  // `omniscientLog`. `onDebugLines` is fanned out from the same observer.
  const recorder = createRecordingOmniscientObserver();
  const omniscientObserver: DebugOmniscientObserver = {
    onOmniscientLines(lines: readonly string[]): void {
      recorder.onOmniscientLines(lines);
      onDebugLines?.(lines);
    },
  };

  const session = new ShowdownBattleSession({ battleId, debug: { omniscientObserver } });

  let terminal: TerminalOutput | null = null;
  let firstErrorOutput: ErrorOutput | null = null;
  const driverErrors: { p1: unknown; p2: unknown } = { p1: null, p2: null };
  const driverFailed: Record<BattleSide, boolean> = { p1: false, p2: false };

  const submitChoiceFor =
    (player: BattleSide) =>
    (choice: string): void => {
      try {
        session.choose(player, choice);
      } catch (error) {
        // The benign race: a driver computed a response for a request the
        // dispatch loop forwarded before the session stopped accepting input.
        // The session's own state is the authority — the harness's view of the
        // battle lags it, because the terminal message is only observed once
        // the dispatch loop has drained every chunk queued ahead of it, and a
        // driver answering one of those older requests must not spuriously
        // fail. Swallowed only for the one lifecycle code that means exactly
        // "the session is no longer accepting choices"; every other code —
        // including `outputs-already-consumed` — and every emitted error, such
        // as `invalid-choice-syntax`, still propagates.
        if (
          error instanceof SimulatorLifecycleError &&
          error.code === INPUT_AFTER_CLOSE_CODE &&
          session.state !== "running"
        ) {
          return;
        }
        throw error;
      }
    };

  const queues: Record<BattleSide, ChunkQueue> = { p1: new ChunkQueue(), p2: new ChunkQueue() };

  const p1Done = startDriver("p1", p1, queues.p1, submitChoiceFor("p1"));
  const p2Done = startDriver("p2", p2, queues.p2, submitChoiceFor("p2"));

  // Attached at creation, not at await time: a driver that throws stops
  // consuming its queue and stops answering requests, so the battle would
  // otherwise wait forever. Closing forces EOF, EOF produces the terminal, the
  // terminal closes both queues, and everything else then finishes. Attaching
  // here also keeps a late sibling rejection from surfacing as unhandled.
  const recordDriverFailure = (side: BattleSide) => (error: unknown) => {
    if (!driverFailed[side]) {
      driverFailed[side] = true;
      driverErrors[side] = error;
    }
    session.close();
  };
  void p1Done.catch(recordDriverFailure("p1"));
  void p2Done.catch(recordDriverFailure("p2"));

  const startSpec: StartSpec = {
    formatId,
    seed: startSeed,
    p1: toPlayerStartSpec(p1),
    p2: toPlayerStartSpec(p2),
    postStartCommands,
  };

  try {
    // Synchronous, and the output queue buffers from construction, so no chunk
    // produced by `start` can be missed by the dispatch loop entered next. An
    // `invalid-start` surfaces as an `ErrorOutput` like any other input error.
    session.start(startSpec);

    const dispatchDone = (async (): Promise<void> => {
      try {
        for await (const output of session.outputs()) {
          if (output.kind === "chunk") {
            onLines?.(output.player, output.lines);
            queues[output.player].push(output);
            continue;
          }
          if (output.kind === "error") {
            // Harness policy, not session policy: the session itself does not
            // change state on an input-caused error. Keep draining to the
            // terminal so the remaining protocol still reaches the drivers and
            // any recorder.
            if (firstErrorOutput === null) firstErrorOutput = output;
            session.close();
            continue;
          }
          // A terminal value is never pushed into a driver queue: drivers see
          // chunks and then EOF.
          terminal = output;
        }
      } finally {
        // Every exit path, so a dispatch-loop rejection can never leave both
        // drivers unsettled and the aggregate wait blocked forever.
        queues.p1.close();
        queues.p2.close();
      }
    })();

    // `allSettled` rather than `all`, so a second rejection arriving after the
    // first cannot escape unhandled.
    await Promise.allSettled([p1Done, p2Done, dispatchDone]);

    // Deterministic rethrow order.
    if (driverFailed.p1) throw driverErrors.p1;
    if (driverFailed.p2) throw driverErrors.p2;
    await dispatchDone;
    if (firstErrorOutput !== null) throw new Error(describeErrorOutput(firstErrorOutput));
    if (terminal === null) {
      throw new Error("battle produced no terminal message");
    }
    const finalTerminal: TerminalOutput = terminal;
    if (finalTerminal.status !== "ended" || finalTerminal.winner === null) {
      throw new Error(
        `battle did not reach a normal terminal: status "${finalTerminal.status}"`
      );
    }

    const omniscientLog = recorder.lines.map(normalizeProtocolLine);
    const { turns } = parseTerminal(omniscientLog);
    return { winner: finalTerminal.winner, turns, omniscientLog };
  } finally {
    // Idempotent, so this is safe whether the dispatch loop, a driver rejection
    // handler, or nothing at all closed the session first.
    session.close();
    queues.p1.close();
    queues.p2.close();
  }
}
