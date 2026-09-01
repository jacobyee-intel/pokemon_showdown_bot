/**
 * Pure derivation of a battle's sub-seeds from a single master seed.
 *
 * This module has no dependency on `pokemon-showdown`: it produces raw
 * four-integer seed tuples, which `showdown.ts` converts into Showdown
 * `PRNGSeed` strings via `toShowdownSeed`.
 *
 * Derivation method (fixed and documented):
 *   1. Hash `"<label>:<masterSeed>"` with FNV-1a (32-bit) to obtain a state.
 *   2. Advance that state with SplitMix32 four times.
 *   3. Take the top 16 bits of each output as one word of a Gen 5 style
 *      `[number, number, number, number]` 64-bit seed.
 *
 * The derivation is pure: it reads no wall-clock time, no environment, and no
 * process state, and never calls `Math.random()`. The same master seed yields
 * the same five sub-seeds on every run and on every machine.
 */

/** A Gen 5 style 64-bit seed expressed as four 16-bit words, high to low. */
export type SeedWords = readonly [number, number, number, number];

/** The five independent sub-seeds derived from one master seed. */
export interface BattleSeeds {
  /** Battle mechanics seed, passed as `seed` in the `>start` spec. */
  battle: SeedWords;
  /** Player 1 team-generation seed, passed as `seed` in the `p1` spec. */
  p1Team: SeedWords;
  /** Player 2 team-generation seed, passed as `seed` in the `p2` spec. */
  p2Team: SeedWords;
  /** Player 1 agent-decision seed. */
  p1Agent: SeedWords;
  /** Player 2 agent-decision seed. */
  p2Agent: SeedWords;
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

function splitMix32(state: number): { state: number; value: number } {
  let next = (state + 0x9e3779b9) >>> 0;
  let value = next;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  return { state: next, value };
}

function deriveSeedWords(masterSeed: number, label: string): SeedWords {
  let state = fnv1a32(`${label}:${masterSeed}`);
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const step = splitMix32(state);
    state = step.state;
    words.push(step.value >>> 16);
  }
  return [words[0]!, words[1]!, words[2]!, words[3]!] as const;
}

/** Throws synchronously if the master seed cannot produce a stable battle. */
export function assertValidMasterSeed(masterSeed: number): void {
  if (!Number.isSafeInteger(masterSeed) || masterSeed < 0) {
    throw new Error(
      `invalid master seed: expected a non-negative safe integer, got ${String(masterSeed)}`
    );
  }
}

/** Derives the five independent sub-seeds for one battle. */
export function deriveBattleSeeds(masterSeed: number): BattleSeeds {
  assertValidMasterSeed(masterSeed);
  return {
    battle: deriveSeedWords(masterSeed, "battle"),
    p1Team: deriveSeedWords(masterSeed, "p1-team"),
    p2Team: deriveSeedWords(masterSeed, "p2-team"),
    p1Agent: deriveSeedWords(masterSeed, "p1-agent"),
    p2Agent: deriveSeedWords(masterSeed, "p2-agent"),
  };
}
