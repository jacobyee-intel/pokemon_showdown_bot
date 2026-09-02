/**
 * `ShowdownBattleSession`: the raw, deliberately dumb simulator interface.
 *
 * This is the only file in the project allowed to construct `BattleStream` or
 * `getPlayerStreams`, and the sole owner of the battle lifecycle. It accepts
 * three typed raw operations (`start`, `choose`, `close`) and emits raw,
 * channel-tagged protocol chunks plus exactly one terminal message and any
 * lifecycle error messages through one single-use `AsyncIterable`.
 *
 * It is a pipe with a state machine, not a game model. It never parses
 * `|request|` payloads, tracks no battle state, derives no legal actions,
 * knows nothing about action indices, rewards, observations, or transports,
 * and never routes omniscient protocol into a normal output. The only protocol
 * line it ever inspects is the terminal `|win|`/`|tie` line on the omniscient
 * channel.
 */
import type { DebugOmniscientObserver } from "./debug-omniscient-observer";
import { splitProtocolChunk } from "./protocol";
import {
  SimulatorLifecycleError,
  type BattleSide,
  type BattleWinner,
  type ChunkOutput,
  type ErrorOutput,
  type SimulatorErrorCode,
  type SimulatorOutput,
  type TerminalOutput,
  type TerminalStatus,
} from "./simulator-messages";
import {
  createBattleStream,
  getShowdownPlayerStreams,
  packShowdownTeam,
  type ShowdownPRNGSeed,
  type ShowdownPlayerStream,
  type ShowdownPlayerStreams,
  type ShowdownPokemonSet,
} from "./showdown";

export type SessionState = "created" | "running" | "closing" | "ended" | "closed";

export interface PlayerStartSpec {
  /** The `name` in the `>player` spec; also the `|win|<name>` key. */
  name: string;
  /** Exactly one of `teamSeed` or `team` must be present. */
  teamSeed?: ShowdownPRNGSeed;
  team?: readonly ShowdownPokemonSet[];
}

export interface StartSpec {
  formatId: string;
  /** Battle-mechanics seed. Mandatory, including for forced-terminal cases. */
  seed: ShowdownPRNGSeed;
  p1: PlayerStartSpec;
  p2: PlayerStartSpec;
  /**
   * Raw omniscient commands written immediately after the `>start`/`>player`
   * block, one `write` each, in order (`>forcetie`, `>editbattle pp ...`).
   * Authoring/debug provenance carried by `start`, not a general command
   * channel: there is deliberately no separate command operation.
   */
  postStartCommands?: readonly string[];
}

export interface ShowdownBattleSessionOptions {
  battleId: string;
  /** Debug-only; normal callers omit this. */
  debug?: { omniscientObserver: DebugOmniscientObserver };
}

/** Maximum length of a sanitized `simulator-fault` diagnostic message. */
const FAULT_MESSAGE_MAX_LENGTH = 200;

/**
 * The fixed diagnostic for a terminal `|win|` line whose name matches neither
 * configured player. It names no line, no name, and no protocol content: the
 * omniscient line that triggered it must not cross into normal output.
 */
const UNRECOGNIZED_WINNER_FAULT_MESSAGE =
  "terminal winner name matched neither configured player name";

/**
 * Reduces an unknown thrown value to a short, content-free diagnostic: the
 * error's `name` plus the first line of its `message`, truncated. Showdown's
 * command-processing errors quote the offending caller-supplied `>`-command,
 * but no chunk content, `|request|` payload, or team data is ever copied here.
 */
function sanitizeFaultMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n", 1)[0] ?? "";
  const text = firstLine.length === 0 ? name : `${name}: ${firstLine}`;
  return text.length > FAULT_MESSAGE_MAX_LENGTH ? text.slice(0, FAULT_MESSAGE_MAX_LENGTH) : text;
}

type ChannelName = "omniscient" | BattleSide;

export class ShowdownBattleSession {
  readonly battleId: string;

  private sessionState: SessionState = "created";
  private readonly debugObserver: DebugOmniscientObserver | null;

  /** Unbounded FIFO, filled from construction so a late `outputs()` loses nothing. */
  private readonly queue: SimulatorOutput[] = [];
  private nextSeq = 0;
  private outputsTaken = false;
  private iterableFinished = false;
  private pendingWaiter: (() => void) | null = null;

  private streams: ShowdownPlayerStreams | null = null;
  private writeEndIssued = false;

  private readonly channelsDone: Record<ChannelName, boolean> = {
    omniscient: false,
    p1: false,
    p2: false,
  };
  private channelsRemaining = 3;

  /** The first reader-loop failure, or the first uninterpretable terminal. */
  private faultMessage: string | null = null;

  private p1Name = "";
  private p2Name = "";
  private winner: BattleWinner | null = null;
  private terminalLineCount = 0;

  constructor(options: ShowdownBattleSessionOptions) {
    this.battleId = options.battleId;
    this.debugObserver = options.debug?.omniscientObserver ?? null;
  }

  get state(): SessionState {
    return this.sessionState;
  }

  start(spec: StartSpec): void {
    if (this.sessionState === "running") {
      this.emitError("duplicate-start", "start was already accepted for this battle");
      return;
    }
    if (this.sessionState !== "created") {
      throw this.lifecycleError(
        "input-after-end",
        `start rejected: session state is "${this.sessionState}"`
      );
    }

    // Validate the entire spec before constructing anything, so a rejected
    // spec can never leave a half-built battle behind.
    const invalid = validateStartSpec(spec);
    if (invalid !== null) {
      this.emitError("invalid-start", invalid);
      return;
    }

    this.p1Name = spec.p1.name;
    this.p2Name = spec.p2.name;

    const battleStream = createBattleStream();
    const streams = getShowdownPlayerStreams(battleStream);
    this.streams = streams;

    // Reader loops start before anything is written, so no chunk can be missed.
    void this.readOmniscient(streams.omniscient);
    void this.readPlayer("p1", streams.p1);
    void this.readPlayer("p2", streams.p2);

    // One single multi-line write: `BattleStream._write` calls
    // `battle.sendUpdates()` once per write, so three writes would fire
    // `sendUpdates` against a partially configured battle.
    const startBlock = [
      `>start ${JSON.stringify({ formatid: spec.formatId, seed: spec.seed })}`,
      `>player p1 ${buildPlayerSpecJson(spec.p1)}`,
      `>player p2 ${buildPlayerSpecJson(spec.p2)}`,
    ].join("\n");
    void streams.omniscient.write(startBlock);
    for (const command of spec.postStartCommands ?? []) {
      void streams.omniscient.write(command);
    }

    this.sessionState = "running";
  }

  choose(player: BattleSide, choice: string): void {
    if (this.sessionState === "created") {
      this.emitError("choice-before-start", "choice submitted before start", player);
      return;
    }
    if (this.sessionState !== "running") {
      throw this.lifecycleError(
        "input-after-end",
        `choice for ${player} rejected: session state is "${this.sessionState}"`
      );
    }

    // The one guard: a command-injection guard, not a legality check. Every
    // line written to a player stream is prefixed with `>p1 `/`>p2 `, so a
    // multi-line choice would inject arbitrary `>`-commands.
    if (choice.length === 0 || choice.includes("\n") || choice.includes("\r") || choice.startsWith(">")) {
      this.emitError(
        "invalid-choice-syntax",
        "choice must be non-empty, contain no newline, and not start with \">\"",
        player
      );
      return;
    }

    const streams = this.streams;
    if (streams === null) return;
    // Written bare: `getPlayerStreams` already prefixes each written line.
    void streams[player].write(choice);
  }

  close(): void {
    switch (this.sessionState) {
      case "created":
        // No streams and no `Battle` exist, so there is nothing to write-end.
        this.emitTerminal("closed", null);
        this.sessionState = "closed";
        this.finishIterable();
        return;
      case "running":
        // Synchronous, before touching Showdown: once `close()` returns, no
        // further input can reach the battle stream.
        this.sessionState = "closing";
        this.issueWriteEnd();
        return;
      case "ended":
        this.issueWriteEnd();
        this.sessionState = "closed";
        return;
      case "closing":
      case "closed":
        return;
    }
  }

  /** Single-use. A second call throws `outputs-already-consumed`. */
  outputs(): AsyncIterable<SimulatorOutput> {
    if (this.outputsTaken) {
      throw this.lifecycleError(
        "outputs-already-consumed",
        "outputs() is single-use: messages are consumed, so a second consumer would receive a partial stream"
      );
    }
    this.outputsTaken = true;

    const iterator: AsyncIterator<SimulatorOutput> = {
      next: async (): Promise<IteratorResult<SimulatorOutput>> => {
        for (;;) {
          const value = this.queue.shift();
          if (value !== undefined) return { value, done: false };
          if (this.iterableFinished) return { value: undefined, done: true };
          await this.waitForOutput();
        }
      },
      // Breaking out of a `for await` closes the session, so an abandoned loop
      // cannot leak a live `Battle`. Only this iterator closes the session.
      return: async (): Promise<IteratorResult<SimulatorOutput>> => {
        this.close();
        return { value: undefined, done: true };
      },
    };

    return { [Symbol.asyncIterator]: () => iterator };
  }

  /* ---------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------ */

  private lifecycleError(
    code: "input-after-end" | "outputs-already-consumed",
    message: string
  ): SimulatorLifecycleError {
    return new SimulatorLifecycleError(code, this.battleId, `[${this.battleId}] ${message}`);
  }

  private waitForOutput(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingWaiter = resolve;
    });
  }

  private signal(): void {
    const waiter = this.pendingWaiter;
    if (waiter !== null) {
      this.pendingWaiter = null;
      waiter();
    }
  }

  private enqueue(output: SimulatorOutput): void {
    this.queue.push(output);
    this.signal();
  }

  private emitChunk(player: BattleSide, lines: readonly string[]): void {
    const output: ChunkOutput = {
      battleId: this.battleId,
      seq: this.nextSeq++,
      kind: "chunk",
      player,
      lines,
    };
    this.enqueue(output);
  }

  private emitError(code: SimulatorErrorCode, message: string, player?: BattleSide): void {
    const output: ErrorOutput = {
      battleId: this.battleId,
      seq: this.nextSeq++,
      kind: "error",
      code,
      message,
      ...(player === undefined ? {} : { player }),
    };
    this.enqueue(output);
  }

  private emitTerminal(status: TerminalStatus, winner: BattleWinner | null): void {
    const output: TerminalOutput = {
      battleId: this.battleId,
      seq: this.nextSeq++,
      kind: "terminal",
      status,
      winner,
    };
    this.enqueue(output);
  }

  private finishIterable(): void {
    this.iterableFinished = true;
    this.signal();
  }

  private issueWriteEnd(): void {
    if (this.writeEndIssued) return;
    const streams = this.streams;
    if (streams === null) return;
    this.writeEndIssued = true;
    // `BattleStream._writeEnd` pushes EOF and destroys the `Battle`, releasing
    // the simulator's memory. Exactly once, from every path reaching `closed`.
    void streams.omniscient.writeEnd();
  }

  private recordFault(message: string): void {
    if (this.faultMessage === null) this.faultMessage = message;
  }

  private async readOmniscient(stream: ShowdownPlayerStream): Promise<void> {
    try {
      for await (const chunk of stream) {
        const lines = splitProtocolChunk(chunk);
        // A chunk that splits to zero lines makes no callback at all,
        // mirroring the suppression rule for `ChunkOutput`.
        if (lines.length === 0) continue;
        for (const line of lines) this.inspectTerminalLine(line);
        // Held in a local, handed to the debug observer inline, then dropped:
        // omniscient lines are never stored on the session, never enqueued,
        // and never copied into an error message.
        this.debugObserver?.onOmniscientLines(lines);
      }
    } catch (error) {
      // The stream is not at EOF and resuming would block forever, so record
      // and stop iterating this channel.
      this.recordFault(sanitizeFaultMessage(error));
    } finally {
      this.markChannelDone("omniscient");
    }
  }

  private async readPlayer(player: BattleSide, stream: ShowdownPlayerStream): Promise<void> {
    try {
      for await (const chunk of stream) {
        const lines = splitProtocolChunk(chunk);
        // Suppressed entirely, consuming no `seq`.
        if (lines.length === 0) continue;
        this.emitChunk(player, lines);
      }
    } catch (error) {
      this.recordFault(sanitizeFaultMessage(error));
    } finally {
      this.markChannelDone(player);
    }
  }

  /** The one sanctioned parse: the terminal line, on the omniscient channel. */
  private inspectTerminalLine(line: string): void {
    if (line === "|tie") {
      this.terminalLineCount++;
      this.winner = "tie";
      return;
    }
    if (!line.startsWith("|win|")) return;
    this.terminalLineCount++;
    const name = line.slice("|win|".length);
    if (name === this.p1Name) {
      this.winner = "p1";
    } else if (name === this.p2Name) {
      this.winner = "p2";
    } else {
      // Deliberately content-free and bounded: the raw omniscient line and the
      // winner name it carries are never copied into an `ErrorOutput`, which
      // is normal output. The line itself remains observable only through the
      // explicit debug observer.
      this.recordFault(UNRECOGNIZED_WINNER_FAULT_MESSAGE);
    }
  }

  private markChannelDone(channel: ChannelName): void {
    if (this.channelsDone[channel]) return;
    this.channelsDone[channel] = true;
    this.channelsRemaining--;
    if (this.channelsRemaining > 0) return;

    const wasClosing = this.sessionState === "closing";
    if (this.faultMessage !== null) {
      this.emitFaultTerminal(this.faultMessage);
      this.sessionState = wasClosing ? "closed" : "ended";
    } else if (wasClosing) {
      this.emitTerminal("closed", null);
      this.sessionState = "closed";
    } else if (this.winner === null || this.terminalLineCount !== 1) {
      this.emitFaultTerminal(
        this.winner === null
          ? "battle ended without a terminal |win| or |tie| line"
          : `expected exactly one terminal line, found ${this.terminalLineCount}`
      );
      this.sessionState = "ended";
    } else {
      this.emitTerminal("ended", this.winner);
      this.sessionState = "ended";
    }
    this.finishIterable();
  }

  private emitFaultTerminal(message: string): void {
    // `simulator-fault` always immediately precedes `terminal{"faulted"}`.
    this.emitError("simulator-fault", message);
    this.emitTerminal("faulted", null);
  }
}

/** Builds the `>player` spec JSON with today's exact key order. */
function buildPlayerSpecJson(spec: PlayerStartSpec): string {
  if (spec.teamSeed !== undefined) {
    // No `team` field: random-format teams come from Showdown's own seeded
    // random-team generator.
    return JSON.stringify({ name: spec.name, seed: spec.teamSeed });
  }
  // `team` is `readonly` so callers cannot mutate it after `start`; copy it
  // into a fresh mutable array here rather than widening `showdown.ts`.
  return JSON.stringify({ name: spec.name, team: packShowdownTeam([...(spec.team ?? [])]) });
}

/** Returns a diagnostic naming the offending field, or `null` when valid. */
function validateStartSpec(spec: StartSpec): string | null {
  if (typeof spec.formatId !== "string" || spec.formatId.length === 0) {
    return "formatId must be a non-empty string";
  }
  if (typeof spec.seed !== "string" || spec.seed.length === 0) {
    return "seed must be a non-empty battle-mechanics seed";
  }
  for (const side of ["p1", "p2"] as const) {
    const player = spec[side];
    if (typeof player.name !== "string" || player.name.length === 0) {
      return `${side}.name must be a non-empty string`;
    }
    const hasSeed = player.teamSeed !== undefined;
    const hasTeam = player.team !== undefined;
    if (hasSeed === hasTeam) {
      return `${side} must specify exactly one of teamSeed or team`;
    }
    if (hasTeam && player.team!.length === 0) {
      return `${side}.team must be non-empty when supplied`;
    }
  }
  for (const command of spec.postStartCommands ?? []) {
    if (!command.startsWith(">")) {
      return `postStartCommands entry must start with ">": ${command}`;
    }
    if (command.includes("\n")) {
      return "postStartCommands entry must not contain a newline";
    }
  }
  return null;
}
