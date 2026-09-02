/**
 * Integration boundary for the `pokemon-showdown` package.
 *
 * All application imports of `pokemon-showdown` (including its package
 * metadata) must go through this module. No other project file should
 * import `pokemon-showdown` or any of its internal paths directly.
 */
import { BattleStream, Dex, getPlayerStreams, PRNG, Streams, Teams } from "pokemon-showdown";
import showdownPackageJson from "pokemon-showdown/package.json";
// DELIBERATE, TEMPORARY EXCEPTION: `RandomPlayerAI` is not re-exported from the
// public `pokemon-showdown` entry point, so it is reached through an internal
// package path. This module is the only place in the project allowed to import
// it, and it exists solely to support the Step 3/4 smoke-test runner and
// fixture capture. `RandomPlayerAI` must not become production agent
// infrastructure, and this exception must not be widened to other internal
// paths without an equally explicit justification. The published internal
// module ships no declaration file; see `showdown-internal.d.ts` for the
// minimal ambient surface used here.
import { RandomPlayerAI } from "pokemon-showdown/dist/sim/tools/random-player-ai";

/** The exact `pokemon-showdown` version this project is pinned to. */
export const EXPECTED_SHOWDOWN_VERSION = "0.11.11";

export type ShowdownFormat = ReturnType<typeof Dex.formats.get>;
export type ShowdownRuleTable = ReturnType<typeof Dex.formats.getRuleTable>;

/**
 * Reads the installed `pokemon-showdown` package version from its own
 * package metadata, rather than from the local `package.json`/lockfile.
 */
export function getInstalledShowdownVersion(): string {
  return showdownPackageJson.version;
}

/** Resolves the Generation 9 Random Battle format through Pokemon Showdown's public Dex API. */
export function getGen9RandomBattleFormat(): ShowdownFormat {
  return Dex.formats.get("gen9randombattle");
}

/**
 * Returns the generation associated with a format using the format-specific
 * Dex. Do not use `format.gen` for this check: it is `0` for
 * `gen9randombattle` in the pinned release.
 */
export function getFormatGeneration(format: ShowdownFormat): number {
  return Dex.forFormat(format).gen;
}

/** Resolves the rule table for a format, throwing if the ruleset is invalid. */
export function resolveRuleTable(format: ShowdownFormat): ShowdownRuleTable {
  const formatDex = Dex.forFormat(format);
  return formatDex.formats.getRuleTable(format);
}

/* -------------------------------------------------------------------------
 * Battle-stream surface (Step 3) and scripted-team surface (Step 4).
 * ---------------------------------------------------------------------- */

/** Showdown's `PRNGSeed`, obtained without importing an internal type path. */
export type ShowdownPRNGSeed = ReturnType<typeof PRNG.generateSeed>;

/**
 * A single team member for a fully authored (`gen9customgame`) team.
 *
 * Derived from the public `Teams.pack` parameter rather than the ambient
 * `PokemonSet` global. `Teams.pack` accepts `PokemonSet[] | null`, so the
 * array element type is taken through `NonNullable`.
 */
export type ShowdownPokemonSet = NonNullable<Parameters<typeof Teams.pack>[0]>[number];

/** The full set of per-perspective streams produced by `getPlayerStreams`. */
export type ShowdownPlayerStreams = ReturnType<typeof getPlayerStreams>;

/** One readable/writable perspective stream (`omniscient`, `p1`, or `p2`). */
export type ShowdownPlayerStream = ShowdownPlayerStreams["p1"];

/** Options accepted by `createRandomPlayerAI`. */
export interface RandomPlayerAIOptions {
  /**
   * Probability of choosing a move rather than a switch when both are legal.
   * Must be strictly between 0 and 1 to force voluntary switches:
   * `RandomPlayerAI` treats `0` as the default `1`.
   */
  move?: number;
}

/** The four-integer Gen 5 seed shape accepted by `PRNG.convertSeed`. */
export type Gen5SeedWords = readonly [number, number, number, number];

/** Creates an in-process battle stream. No server and no network port. */
export function createBattleStream(): BattleStream {
  return new BattleStream();
}

/** Splits a battle stream into omniscient/spectator/p1..p4 perspectives. */
export function getShowdownPlayerStreams(stream: BattleStream): ShowdownPlayerStreams {
  return getPlayerStreams(stream);
}

/**
 * Converts a pure four-integer seed tuple into Showdown's `PRNGSeed` string.
 * Keeps `seed.ts` free of any `pokemon-showdown` dependency.
 */
export function toShowdownSeed(words: Gen5SeedWords): ShowdownPRNGSeed {
  return PRNG.convertSeed([words[0], words[1], words[2], words[3]]);
}

/** Packs an authored team into Showdown's packed-team format. */
export function packShowdownTeam(team: ShowdownPokemonSet[]): string {
  return Teams.pack(team);
}

/**
 * Creates a standalone read/write object stream used as a bridge to a foreign
 * player implementation (`RandomPlayerAI`), which insists on owning a stream.
 *
 * The bridge is not a battle stream: chunks are pushed into it by a driver and
 * everything the player writes to it is handed to `onWrite`, which submits the
 * raw choice through the session. It exists so no code outside
 * `battle-session.ts` ever holds a real `getPlayerStreams` stream.
 */
export function createPlayerBridgeStream(
  onWrite: (text: string) => void
): Streams.ObjectReadWriteStream<string> {
  return new Streams.ObjectReadWriteStream<string>({
    write(text: string): void {
      onWrite(text);
    },
  });
}

/**
 * Constructs Showdown's own `RandomPlayerAI`, seeded deterministically.
 * Temporary smoke-test/fixture infrastructure only (see the import comment).
 */
export function createRandomPlayerAI(
  playerStream: ShowdownPlayerStream,
  seed: ShowdownPRNGSeed,
  options: RandomPlayerAIOptions = {}
): RandomPlayerAI {
  return new RandomPlayerAI(playerStream, { seed, ...options });
}
