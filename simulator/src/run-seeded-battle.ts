/**
 * Step 3's seeded-battle runner.
 *
 * A thin wrapper over the shared lifecycle in `battle-lifecycle.ts`: it derives
 * two `RandomPlayerAI` player specs from a single master seed and runs one
 * `gen9randombattle` entirely in memory. It contains no fixture-file logic and
 * performs no file I/O.
 *
 * `RandomPlayerAI` is temporary smoke-test infrastructure. It must not be
 * reused once the real action adapter and agent loop exist.
 */
import { runBattleLifecycle, type BattleWinner } from "./battle-lifecycle";
import { deriveBattleSeeds } from "./seed";
import { toShowdownSeed } from "./showdown";

export const SEEDED_BATTLE_FORMAT_ID = "gen9randombattle";

export interface SeededBattleResult {
  masterSeed: number;
  winner: BattleWinner;
  /** Number of `|turn|<n>` markers observed in the omniscient log. */
  turns: number;
  /** Timestamp-normalized omniscient protocol lines. */
  omniscientLog: string[];
}

/**
 * Runs one fully deterministic `gen9randombattle`.
 *
 * Throws synchronously on an invalid master seed (before any battle work
 * starts), and rejects — rather than returning a partial result — if a player
 * errors or the battle ends without a terminal `|win|`/`|tie|` line.
 *
 * This is deliberately not an `async` function: an `async` function would
 * convert the seed-validation error into a rejected promise instead of the
 * synchronous throw the runner contract requires.
 */
export function runSeededBattle(masterSeed: number): Promise<SeededBattleResult> {
  const seeds = deriveBattleSeeds(masterSeed);

  return runBattleLifecycle({
    formatId: SEEDED_BATTLE_FORMAT_ID,
    startSeed: toShowdownSeed(seeds.battle),
    p1: {
      kind: "random",
      name: "p1",
      teamSeed: toShowdownSeed(seeds.p1Team),
      agentSeed: toShowdownSeed(seeds.p1Agent),
    },
    p2: {
      kind: "random",
      name: "p2",
      teamSeed: toShowdownSeed(seeds.p2Team),
      agentSeed: toShowdownSeed(seeds.p2Agent),
    },
  }).then((result) => ({
    masterSeed,
    winner: result.winner,
    turns: result.turns,
    omniscientLog: result.omniscientLog,
  }));
}
