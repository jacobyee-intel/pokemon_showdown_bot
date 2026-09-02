# Step 3: Run One Seeded Gen 9 Random Battle

## Objective

Prove that one complete `gen9randombattle` can be run entirely in memory, with no
Pokemon Showdown server process, using `BattleStream` and `getPlayerStreams`.
The battle must be fully deterministic from a single master seed. This step is
a smoke test of the pinned simulator's battle lifecycle. It does not define the
observation schema, the 14-action adapter, or the perspective-safe state
tracker; those are later steps.

## Scope Boundary

This step only proves that a battle runs, ends, and is reproducible. It
intentionally uses Pokemon Showdown's own `RandomPlayerAI` to make both
players' ordinary random decisions. `RandomPlayerAI` is temporary smoke-test
infrastructure. It must not be reused once the real action adapter and agent
loop exist, and it must not leak into the eventual training or observation
code paths.

## Seed Derivation

A single master seed (a positive integer) must deterministically derive five
independent Showdown `PRNGSeed` values:

1. Battle mechanics seed (passed as `seed` in the `>start` spec).
2. Player 1 team-generation seed (passed as `seed` in the `p1` player spec).
3. Player 2 team-generation seed (passed as `seed` in the `p2` player spec).
4. Player 1 agent-decision seed.
5. Player 2 agent-decision seed.

Derive all five sub-seeds from the
master seed using a single fixed, documented method, for example seeding a
`PRNG` with the master seed and calling `PRNG.generateSeed()`-equivalent
draws, or hashing the master seed with a fixed per-purpose label
(`"battle"`, `"p1-team"`, `"p2-team"`, `"p1-agent"`, `"p2-agent"`) into a
`Gen5RNGSeed`-shaped four-integer tuple, then using
`PRNG.convertSeed`/`new PRNG(seed)` to produce a `PRNGSeed` string. Whichever
method is chosen:

- It must be pure (no wall-clock time, environment entropy, or process state).
- It must produce the same five sub-seeds for the same master seed on every
  run and on every machine.
- The derivation function must live behind `showdown.ts` if it depends on
  Showdown's `PRNG`/`PRNGSeed` types; a pure integer-hashing derivation with no
  Showdown dependency may live outside `showdown.ts`.

Do not use `Math.random()`, `Date.now()`, or any other non-deterministic
source anywhere in the runner or its seed derivation.

## Integration Boundary

Extend `simulator/src/core/showdown.ts` with the additional exports this step
needs. Do not import `pokemon-showdown` or any of its internal paths from any
other project file.

```typescript
import { BattleStream, getPlayerStreams, PRNG } from "pokemon-showdown";
// RandomPlayerAI is not exported from the package's public entry point; it is
// reached through Showdown's internal tools path, isolated here as the only
// place in the project allowed to import it.
import { RandomPlayerAI } from
  "pokemon-showdown/dist/sim/tools/random-player-ai";

export type ShowdownPRNGSeed = ReturnType<typeof PRNG.generateSeed>;

export function createBattleStream(): BattleStream;
export function getShowdownPlayerStreams(
  stream: BattleStream
): ReturnType<typeof getPlayerStreams>;
export function createRandomPlayerAI(
  playerStream: ReturnType<typeof getPlayerStreams>["p1"],
  seed: ShowdownPRNGSeed
): RandomPlayerAI;
```

Comment inline in `showdown.ts` that the `random-player-ai` import is a
deliberate, temporary exception: it is an internal package path, not the
public `pokemon-showdown` entry point, and it exists only to support the Step
3/4 smoke-test runner. Do not widen this exception to other internal paths
without an equally explicit justification.

The published internal JavaScript module does not include a declaration file.
Add `simulator/src/core/showdown-internal.d.ts` containing only the minimal
`RandomPlayerAI` constructor and `start(): Promise<void>` surface used here.
Do not import Showdown's raw TypeScript source or copy its broader internal
types into the project.

## Lifecycle

The runner must follow this exact sequence, matching Showdown's own
`battle-stream-example.ts` pattern:

1. Construct one `BattleStream` and obtain `{ omniscient, p1, p2 }` (and
   unused `spectator`/`p3`/`p4`) via `getPlayerStreams`.
2. Construct two `RandomPlayerAI` instances, one bound to `streams.p1` and one
   to `streams.p2`, each with its own derived agent seed. Call `.start()` on
   both without awaiting completion yet (they run for the lifetime of the
   battle).
3. Start an async consumer that iterates `for await (const chunk of
   streams.omniscient)` and appends every chunk to an in-memory log. This
   consumer must run concurrently with step 4, not after it.
4. Write a single input block to `streams.omniscient`:
   ```
   >start {"formatid":"gen9randombattle","seed":<battle-seed>}
   >player p1 {"name":"p1","seed":<p1-team-seed>}
   >player p2 {"name":"p2","seed":<p2-team-seed>}
   ```
   Do not supply a `team` field; team generation must come from Showdown's
   own random-team generator for `gen9randombattle`, seeded as shown.
5. Create all three promises before awaiting anything, then use one
   `Promise.all` over `p1.start()`, `p2.start()`, and the omniscient consumer.
   A finished battle ends all three loops once the battle stream signals
   completion. Do not await the readers sequentially.

The runner must not call `process.exit`, start a server, open a network port,
or write files as a side effect of running the battle; file output belongs
only to the golden recorder introduced in Step 4.

## Types and Files

```text
simulator/
└── src/
    ├── core/
    │   ├── showdown.ts             # Pokemon Showdown integration boundary
    │   └── showdown-internal.d.ts  # minimal RandomPlayerAI declaration
    ├── drivers/
    │   ├── seed.ts                 # pure master-seed -> sub-seed derivation
    │   └── run-seeded-battle.ts    # runner: lifecycle + result parsing
    └── verification/
        └── verify-seeded-battle.ts # executable verification program
```

- `seed.ts` exports a single function such as
  `deriveBattleSeeds(masterSeed: number): { battle, p1Team, p2Team, p1Agent,
  p2Agent }` returning the five sub-seeds in the project's chosen seed
  representation (either raw integers to be converted by `showdown.ts`, or
  already-converted `ShowdownPRNGSeed` values if `seed.ts` is itself allowed
  to depend on `showdown.ts`'s exported seed type only, not on
  `pokemon-showdown` directly).
- `run-seeded-battle.ts` exports a function such as
  `runSeededBattle(masterSeed: number): Promise<SeededBattleResult>` plus the
  `SeededBattleResult` type described below. It contains the lifecycle logic
  from the previous section and no golden-file logic.
- `verify-seeded-battle.ts` is a small executable (same style as
  `verify-showdown.ts`) that runs `runSeededBattle` with a fixed literal
  master seed, asserts the result, and prints one success message.

## Result Parsing

Define and export a result type from `run-seeded-battle.ts`:

```typescript
export interface SeededBattleResult {
  masterSeed: number;
  winner: "p1" | "p2" | "tie";
  turns: number;
  omniscientLog: string[]; // normalized protocol lines
}
```

Parse the winner and turn count from the omniscient protocol log, not from
`RandomPlayerAI` internals:

- The battle end is signaled by a `|win|<name>` line (winner is whichever of
  `"p1"`/`"p2"` was used as that player's `name` in its player spec) or a
  `|tie` line (no simultaneous-KO tie is expected from ordinary random
  battles, but the parser must still recognize it rather than treating it as
  an error).
- Turn count is the count of `|turn|<n>` lines observed, or the highest `<n>`
  value seen, whichever the implementation documents; pick one and apply it
  consistently.
- If the log ends without a `|win|` or `|tie` line, this is an error (see
  next section), not a silently accepted result with `winner` left undefined.

## Error Propagation

The runner must not swallow or downgrade failures:

- If `RandomPlayerAI.start()` rejects (for example on `receiveError` with a
  message that does not start with `[Unavailable choice]`, which
  `RandomPlayerAI` deliberately rethrows), the rejection must propagate out of
  `runSeededBattle` as a rejected promise, not be caught and logged.
- If the omniscient stream ends without a terminal `|win|`/`|tie` line, throw
  an explicit `Error` describing the incomplete battle; do not return a
  partial `SeededBattleResult`.
- If `deriveBattleSeeds` receives a non-finite, negative, or non-integer
  master seed, throw synchronously before starting the battle.
- Do not add retry loops, timeouts that silently resolve, or fallback
  non-seeded behavior. A failed battle must fail the process.

## Deterministic Verification

`verify-seeded-battle.ts` must:

1. Run `runSeededBattle` twice with the same fixed literal master seed.
2. Assert that both runs produce an identical `winner`.
3. Assert that both runs produce an identical `turns` count.
4. Normalize every `|t:|<epoch-seconds>` line to `|t:|0`, then assert that
   both normalized `omniscientLog` arrays are byte-for-byte identical. Raw
   protocol logs are not byte-stable because Showdown emits wall-clock
   timestamps.
5. Assert that `omniscientLog` is non-empty and contains at least one
   `|turn|1` (or equivalent first-turn marker) and exactly one terminal
   `|win|`/`|tie` line.
6. Print one success message summarizing the master seed, the winner, and the
   turn count.

This double-run comparison is the only determinism check required in this
step; it does not need to compare against a checked-in golden file (that
begins in Step 4, which persists goldens to disk).

Set `process.exitCode = 1` when the verification executable starts and change
it to `0` only after all awaited work and assertions complete. This ensures a
stalled promise cannot let Node drain its event loop and exit successfully
without reporting completion.

## Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "verify:seeded-battle": "npm run build && node simulator/dist/verification/verify-seeded-battle.js"
  }
}
```

Keep `build`, `typecheck`, and `verify:showdown` unchanged.

## Explicitly Out of Scope

- The 14-action adapter (index-to-command translation, Tera/Revival Blessing
  index mapping, legality derived from the live request).
- The perspective-safe state tracker (public/private information split,
  stable Pokemon identities, boosts/volatiles/side-conditions/field tracking).
- Persisting protocol goldens or request JSON to disk (Step 4).
- Any test framework (Jest/Vitest); continue using small executable
  verification programs.
- Python integration of any kind.
- Non-random agents, heuristics, or human-driven choices.
- Multi-battle formats, `p3`/`p4` sides, or any format other than
  `gen9randombattle`.
- Performance tuning, concurrency across multiple battles, or worker pools.
- Permanently keeping `RandomPlayerAI` as production agent infrastructure.

## Completion Criteria

1. `npm run verify:seeded-battle` runs one full `gen9randombattle` in-process,
   with no server and no network port, and exits successfully.
2. The same master seed produces an identical winner, turn count, and
   timestamp-normalized omniscient protocol log across two runs in the same
   process invocation.
3. All Showdown imports, including the internal `random-player-ai` path,
   remain confined to `simulator/src/core/showdown.ts`.
4. A failing or incomplete battle (unparsed terminal line, rethrown
   `RandomPlayerAI` error, invalid master seed) causes the verification
   program to exit with a nonzero status rather than reporting a partial or
   default result.
5. Existing TypeScript and Python validations (`npm run typecheck`, `npm run
   build`, `npm run verify:showdown`, `.venv/bin/python -m pytest`) continue to
   pass unchanged.
6. `git status --porcelain` shows only the new files/edits from this step;
   Step 2's uncommitted pin (`package.json`, `package-lock.json`,
   `tsconfig.json`, `README.md`, `simulator/src/core/showdown.ts`,
   `simulator/src/verification/verify-showdown.ts`) remains untouched apart from the
   additive exports described above in `showdown.ts`.
