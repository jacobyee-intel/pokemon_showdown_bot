/**
 * Protocol line helpers shared by the battle lifecycle (Step 3) and the
 * golden recorder (Step 4).
 *
 * Showdown batches protocol lines into stream chunks in ways that are not
 * guaranteed to be stable, and it emits wall-clock timestamps. Both steps need
 * the exact same splitting and normalization so that byte comparison is
 * meaningful, so the logic lives in one place instead of being duplicated.
 */

const TIMESTAMP_LINE = /^\|t:\|\d+$/;

/**
 * Rewrites `|t:|<epoch-seconds>` to `|t:|0`. The line is preserved rather than
 * dropped so line indices stay stable. All other lines are returned unchanged.
 */
export function normalizeProtocolLine(line: string): string {
  return TIMESTAMP_LINE.test(line) ? "|t:|0" : line;
}

/**
 * Splits a raw stream chunk into protocol lines, dropping the empty segments
 * that chunk splitting produces (for example a trailing empty string after a
 * final `\n`). These carry no protocol information and would otherwise make
 * downstream output depend on incidental chunk boundaries.
 */
export function splitProtocolChunk(chunk: string): string[] {
  return chunk.split("\n").filter((line) => line.length > 0);
}

/** Splits a chunk into lines and normalizes each one. */
export function normalizeProtocolChunk(chunk: string): string[] {
  return splitProtocolChunk(chunk).map(normalizeProtocolLine);
}
