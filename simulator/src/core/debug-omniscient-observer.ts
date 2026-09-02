/**
 * DEBUG-ONLY omniscient sink.
 *
 * The name is deliberately loud: `rg -l omniscient simulator/src` should read
 * as an audit of every file that can see omniscient protocol.
 *
 * Omniscient protocol is never reachable from `SimulatorOutput`. The only way
 * to observe it is to pass an observer explicitly through
 * `ShowdownBattleSession`'s `debug` constructor option. Sanctioned consumers
 * are exactly: `battle-lifecycle.ts` (which owes Step 3 an `omniscientLog`),
 * the golden recorder's `omniscient.jsonl` writer, and
 * `verify-battle-session.ts`.
 */

/** DEBUG-ONLY. Never reachable from `SimulatorOutput`. */
export interface DebugOmniscientObserver {
  /**
   * Receives the raw protocol lines of one omniscient chunk, split with the
   * same semantics as player chunks (`\n` split, empty segments dropped) and
   * otherwise unmodified: no timestamp normalization happens here.
   */
  onOmniscientLines(lines: readonly string[]): void;
}

/** An observer that accumulates raw omniscient lines. Debug/goldens only. */
export interface RecordingOmniscientObserver extends DebugOmniscientObserver {
  readonly lines: readonly string[];
  /** Number of non-empty chunks observed. Zero-line chunks never call back. */
  readonly callCount: number;
}

/** Accumulates raw omniscient lines. Debug, goldens, and provenance only. */
export function createRecordingOmniscientObserver(): RecordingOmniscientObserver {
  const lines: string[] = [];
  let callCount = 0;
  return {
    onOmniscientLines(chunkLines: readonly string[]): void {
      callCount++;
      lines.push(...chunkLines);
    },
    get lines(): readonly string[] {
      return lines;
    },
    get callCount(): number {
      return callCount;
    },
  };
}
