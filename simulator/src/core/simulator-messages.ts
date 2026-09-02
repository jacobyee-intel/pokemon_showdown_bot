/**
 * The raw simulator interface's output contracts.
 *
 * Types, string-literal unions, and one error class. This module performs no
 * I/O, holds no state, and deliberately imports nothing — in particular not
 * `showdown.ts` or `pokemon-showdown` — so a translator (Step 6) can depend on
 * it without pulling the simulator in.
 *
 * It is the single source of truth for `BattleSide` and `BattleWinner`.
 *
 * There is deliberately no omniscient output variant: `ChunkOutput.player` is
 * `BattleSide`, which structurally cannot be `"omniscient"`, so no type exists
 * through which omniscient protocol could reach a normal consumer.
 */

export type BattleSide = "p1" | "p2";
export type BattleWinner = BattleSide | "tie";

export interface SimulatorOutputBase {
  /** Caller-supplied battle identity, carried on every output. */
  battleId: string;
  /** Emission order: starts at 0, +1 per message, gapless, one domain. */
  seq: number;
}

export interface ChunkOutput extends SimulatorOutputBase {
  kind: "chunk";
  /** Channel tag. Structurally cannot be `"omniscient"`. */
  player: BattleSide;
  /**
   * Raw protocol lines of one Showdown chunk, in order, empty split segments
   * removed, byte-for-byte as emitted: no timestamp normalization, no
   * `|request|` reparsing, no trimming. Always non-empty — a Showdown chunk
   * that splits to zero protocol lines is suppressed entirely and consumes no
   * `seq`. Which lines land in which chunk is incidental; only per-channel
   * line order is contractual.
   */
  lines: readonly string[];
}

export type TerminalStatus = "ended" | "closed" | "faulted";

export interface TerminalOutput extends SimulatorOutputBase {
  kind: "terminal";
  status: TerminalStatus;
  /** Set only for `"ended"`; `null` for `"closed"` and `"faulted"`. */
  winner: BattleWinner | null;
}

export type SimulatorErrorCode =
  | "invalid-start"
  | "duplicate-start"
  | "choice-before-start"
  | "invalid-choice-syntax"
  | "simulator-fault";

export interface ErrorOutput extends SimulatorOutputBase {
  kind: "error";
  code: SimulatorErrorCode;
  /** Diagnostic only; never used for control flow. */
  message: string;
  /** Present only when the offending operation named a side. */
  player?: BattleSide;
}

export type SimulatorOutput = ChunkOutput | TerminalOutput | ErrorOutput;

export type SimulatorThrowCode = "input-after-end" | "outputs-already-consumed";

/**
 * Thrown — never emitted — for the two input mistakes that cannot be reported
 * through the output channel: input after the session stopped accepting it,
 * and a second attempt to consume the single-use output iterable.
 */
export class SimulatorLifecycleError extends Error {
  readonly code: SimulatorThrowCode;
  readonly battleId: string;

  constructor(code: SimulatorThrowCode, battleId: string, message: string) {
    super(message);
    this.name = "SimulatorLifecycleError";
    this.code = code;
    this.battleId = battleId;
  }
}
