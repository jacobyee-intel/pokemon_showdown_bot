# Step 4: Capture Protocol Fixtures

## Objective

Capture real, perspective-specific request/protocol fixtures from the pinned
`pokemon-showdown@0.11.11` simulator, for use by later schema, action-adapter,
and state-tracker tests. Fixtures must be produced only by running the actual
simulator through Step 3's lifecycle; none may be hand-written, hand-edited,
or manually simplified. This step only captures and verifies fixtures. It
does not define the observation schema, the 14-action adapter, or the
perspective-safe state tracker.

## Reuse of Step 3

This step must not create a second, parallel implementation of the
`BattleStream`/`getPlayerStreams` lifecycle. Refactor Step 3's runner so both
steps share one lifecycle core:

- Extract the lifecycle body of `runSeededBattle` (construct `BattleStream`,
  obtain `{ omniscient, p1, p2 }`, start both players, write the `>start`
  /`>player` block, await completion) into a lower-level function, for
  example `runBattleLifecycle(options: BattleLifecycleOptions):
  Promise<BattleLifecycleResult>` in `simulator/src/drivers/battle-lifecycle.ts`.
- `run-seeded-battle.ts`'s `runSeededBattle` becomes a thin wrapper that
  derives its two `RandomPlayerAI` player specs from the master seed (as
  already specified in Step 3) and calls `runBattleLifecycle`, preserving its
  existing exported signature, `SeededBattleResult` type, and error-handling
  behavior unchanged.
- `BattleLifecycleOptions` must support:
  - `formatId: string` (`"gen9randombattle"` for natural random-battle
    capture, `"gen9customgame"` for fully authored custom scenarios).
  - `startSeed: ShowdownPRNGSeed` for the battle-mechanics seed. It is
    mandatory for every case, including forced terminal cases.
  - A player spec per side, either:
    - `{ kind: "random"; name; teamSeed; agentSeed; move? }` — uses
      Showdown's random team generator and a `RandomPlayerAI` tuned by the
      optional `move` probability. For a voluntary-switch case, use a value
      strictly between `0` and `1`, such as `0.5`; `move: 0` is invalid
      because `RandomPlayerAI` treats it as the default `1.0`.
    - `{ kind: "scripted"; name; team: PokemonSet[]; choices: string[] }` —
      supplies a fully authored team and a fixed, ordered list of raw choice
      strings, one per non-`wait` request the side receives (see "Scripted
      Player" below).
  - An optional `onChunk?: (stream: "p1" | "p2" | "omniscient", chunk: string)
    => void` observer invoked for every raw chunk pushed to each of the three
    streams, in addition to whatever internal buffering the lifecycle already
    does for its own result parsing.
  - `postStartCommands?: string[]` containing raw omniscient commands written
    immediately after the `>start`/`>player` block. Record these commands in
    fixture provenance. This supports controlled commands such as
    `>forcetie` and `>editbattle pp ...`.
- `showdown.ts` gains only what this shared lifecycle and the scripted player
  need beyond Step 3's additions. Derive the custom-team element type from
  the public `Teams.pack` signature, for example
  `Parameters<typeof Teams.pack>[0][number]`, and export it as
  `ShowdownPokemonSet`; do not import the ambient `PokemonSet` global or add
  another internal-path declaration. Continue routing every
  `pokemon-showdown` import, including internal paths, through `showdown.ts`.

## Scripted Player

Custom scenarios (Struggle, Revival Blessing, the forced tie) must be
deterministic by construction, not discovered by random search. Add a small
`simulator/src/drivers/scripted-player.ts` helper that drives one side of a battle
from a fixed, ordered list of choice strings:

- It reads raw chunks directly from the player's `Streams.ObjectReadWriteStream`
  (the same object `getPlayerStreams` returns), with no dependency on
  `RandomPlayerAI` or `BattlePlayer`.
- For each incoming chunk, it splits on `\n` and inspects each line: a line
  containing `"wait":true` is ignored (no response is required); any other
  line that begins with `|request|` consumes the next entry from the fixed
  choice list and writes it as `>${side} ${choice}\n` back to the stream.
- It does not parse the JSON request into a typed structure and does not
  infer legality; the author of a scripted scenario is fully responsible for
  supplying choices that are legal for the exact team and turn order they
  authored. This keeps the helper simple and avoids anticipating the future
  action adapter's responsibilities.
- If the choice list is exhausted before the battle ends, or a request never
  arrives for a supplied choice, the helper must throw rather than silently
  stall or resend a stale choice.
- `gen9customgame` begins with Team Preview, so each scripted choice list must
  begin with `default` (or an explicit legal team-order command).
- A forced terminal case may explicitly allow an empty/unconsumed choice list
  because its recorded omniscient command ends the battle before a player
  decision is required.

## Fixture Directory Layout

```text
fixtures/
├── README.md
├── gen9randombattle/
│   ├── ordinary-battle/
│   │   ├── meta.json
│   │   ├── p1.jsonl
│   │   ├── p2.jsonl
│   │   └── omniscient.jsonl
│   └── voluntary-switch/      (same four files)
└── gen9customgame/
    ├── tera/                   (same four files)
    ├── struggle/               (same four files)
    ├── revival-blessing/       (same four files)
    └── forced-tie-terminal/    (same four files)
```

`fixtures/` is a new top-level, version-controlled directory, a sibling of
`schemas/`, because these are cross-language test contracts consumed by
future TypeScript and Python work, not a generated training artifact; it must
not live under `artifacts/` and must not be gitignored.

Use one `ordinary-battle` fixture to demonstrate ordinary moves, forced
switches, wait requests, faints, and a win. Record a deterministic list of
named demonstration locations in its metadata rather than duplicating the
same complete logs across five directories. Use separate fixtures only for
voluntary switching, scripted Terastallization, and the targeted rare cases.

## Provenance

Each case's `meta.json` must record everything needed to replay it exactly,
and nothing that varies between machines or runs:

```json
{
  "caseId": "ordinary-battle",
  "category": "natural-random-search",
  "formatId": "gen9randombattle",
  "showdownVersion": "0.11.11",
  "masterSeed": 4,
  "p1": { "kind": "random", "name": "p1", "move": 1.0 },
  "p2": { "kind": "random", "name": "p2", "move": 1.0 },
  "demonstrates": {
    "ordinaryMove": {"turn": 1},
    "forcedSwitch": {"turn": 7},
    "wait": {"turn": 7},
    "faint": {"turn": 7},
    "win": {"turn": 19}
  },
  "search": { "strategy": "increasing-master-seed", "start": 1, "step": 1 }
}
```

For scripted cases, `p1`/`p2` instead record `{ "kind": "scripted", "name",
"team": [...], "choices": [...] }` with the full authored team and full
choice list, and `category` is `"custom-scripted"`. The forced-tie case uses
`category: "forced-terminal"` and its `meta.json` must include a literal note
such as `"note": "Uses >forcetie to terminate the battle for terminal-line
parsing only. This is not a natural simultaneous-KO tie and must not be
treated as a substitute for one if future semantics depend on true
double-faint tie behavior."`.

`meta.json` must never contain wall-clock timestamps, hostnames, absolute
file paths, or process IDs: it must be byte-identical across machines and
across regenerations of the same case.

## Recorder Design

Add `simulator/src/fixtures/fixture-recorder.ts` exporting a function such as
`captureFixture(caseSpec, outputRoot): CapturedFixture` that:

1. Calls the shared `runBattleLifecycle` from `battle-lifecycle.ts` with an
   `onChunk` observer and an explicit output root.
2. In the observer, splits every chunk on `\n`, discards empty trailing
   segments produced by the split, and appends each remaining line to that
   stream's in-memory array (`p1Lines`, `p2Lines`, `omniscientLines`), in the
   order received. Sequence is preserved by array order; no explicit sequence
   numbers are embedded in the file format (see normalization below).
3. After the lifecycle promise resolves (or rejects — a rejected capture must
   propagate the error, matching Step 3's error-propagation rule, never
   writing partial files), serializes each stream's line array to its
   `<stream>.jsonl` file.
4. Writes `meta.json` from the case's static specification (never derived
   from anything observed at runtime other than the documented
   `demonstratesAtTurn` line number, which is filled in once when a case is
   authored and then frozen).

Implement `onChunk` by wrapping each stream's `push` method, or with an
equivalent tee, before starting either player. Never attach a second
`for await` consumer to `p1` or `p2`: these streams are single-consumer, and
a second reader would steal private `|request|` chunks from the player.

## Stable Normalization

To make byte comparison meaningful, every fixture file must be produced the
same way regardless of how Showdown happened to batch protocol lines into
stream chunks:

- Each `.jsonl` file has exactly one JSON-encoded string per line: the line
  is `JSON.stringify(rawProtocolLine) + "\n"`. This preserves the exact
  original text of every protocol line — including a `|request|<json>` line's
  full, un-reparsed JSON payload — inside a valid, escaped JSON string, with
  no re-serialization of the inner request JSON itself (no key reordering, no
  re-indentation).
- Rewrite `|t:|<epoch-seconds>` to `|t:|0` before serialization. Preserve the
  line rather than dropping it so demonstration line indices remain stable.
- Blank lines produced by chunk-splitting (for example a trailing empty
  string after a final `\n`) are dropped before writing; they carry no
  protocol information and would otherwise make the file format depend on
  incidental chunk boundaries.
- Files use `\n` line endings only, UTF-8 encoding, and end with a single
  trailing newline.
- File and directory names are fixed, lowercase, kebab-case identifiers
  matching the case IDs used in `meta.json`; do not derive names from
  timestamps or random identifiers.
- `meta.json` keys are written in a fixed, deterministic order (the recorder
  must not rely on incidental object-key insertion order from spreading
  runtime data structures; construct the object literal in the exact field
  order shown above).

## Deterministic Regeneration and Byte Comparison

```text
simulator/
└── src/
    ├── drivers/
    │   ├── battle-lifecycle.ts # shared runner core (Step 3 extraction)
    │   └── scripted-player.ts  # fixed-choice deterministic player
    └── fixtures/
        ├── fixture-recorder.ts # chunk capture + normalization + file I/O
        ├── fixture-cases.ts    # frozen manifest of all cases below
        ├── capture-fixtures.ts # executable: writes fixtures/** from manifest
        └── verify-fixtures.ts  # executable: regenerate + byte-compare
```

- `fixture-cases.ts` exports the full, frozen list of case specifications
  (the exact content that becomes each `meta.json`, plus enough to rerun the
  case: master seed or scripted team/choices). This is the single source of
  truth; `capture-fixtures.ts` and `verify-fixtures.ts` both read it.
- `capture-fixtures.ts` is the only program allowed to write into `fixtures/`.
  It is run deliberately by a developer only when adding a new case or
  intentionally changing an existing one (for example, after an approved
  Pokemon Showdown version upgrade). It must not run as part of routine
  verification.
- `verify-fixtures.ts` regenerates every case from `fixture-cases.ts` into a
  scratch directory under `artifacts/` (already gitignored per Step 1), then
  byte-compares each regenerated file against the corresponding checked-in
  file under `fixtures/`. On any missing case, missing file, or byte
  mismatch, it prints the case ID and file path and exits nonzero. On success,
  it prints one summary line with the number of cases and files verified.
- Running `verify-fixtures.ts` twice in a row, and running it against a
  freshly captured `fixtures/` tree, must produce identical scratch output
  each time; this is the same double-run determinism discipline as Step 3,
  applied to every case instead of a single battle.
- Both executables set `process.exitCode = 1` at startup and set it to `0`
  only after all awaited work and assertions finish, preventing a stalled
  stream from exiting successfully.

## Perspective Isolation

`p1.jsonl` and `p2.jsonl` contain only what `getPlayerStreams` actually
routes to that side: its own redacted public log lines plus its own private
`|request|` lines. `omniscient.jsonl` contains the unredacted public log
(channel `-1`) and never contains any side's `|request|` line, since
`getPlayerStreams` never routes `sideupdate` data to the omniscient stream.

Add `fixtures/README.md` stating explicitly, for consumers of this directory
in later steps:

- Any future agent, action adapter, or state tracker must be built and
  tested using only `p1.jsonl` (from `p1`'s own perspective) or only
  `p2.jsonl` (from `p2`'s own perspective), never both, and never
  `omniscient.jsonl`.
- `omniscient.jsonl` exists only for fixture provenance, debugging, and
  terminal-result parsing (as already established in Step 3); it must never
  be read by anything that represents what a real player-side agent knows.
- Tests that need to assert facts about the "true" battle state for grading
  or comparison purposes may read `omniscient.jsonl`, but any code under test
  that plays a side of the battle must not.

## Case Matrix

| Case | Format | Category | Notes |
|---|---|---|---|
| `ordinary-battle` | gen9randombattle | natural-random-search | One complete default-agent battle demonstrating ordinary moves, forced switch, wait, faint, and win events. |
| `tera` | gen9customgame | custom-scripted | Authored teams with explicit Tera types; a scripted player sends a legal `move 1 terastallize` choice. `RandomPlayerAI` cannot Terastallize in Gen 9 because its change-form gate ignores `canTerastallize`. |
| `voluntary-switch` | gen9randombattle | natural-random-search | Both sides use a `move` probability below `1.0` so at least one non-`forceSwitch` request results in a chosen switch. |
| `struggle` | gen9customgame | custom-scripted | Authored teams plus a recorded `>editbattle pp ...` command set one move to one PP, then scripted choices exhaust it and execute Struggle. |
| `revival-blessing` | gen9customgame | custom-scripted | Authored team gives one side a fast, low-bulk teammate that faints in one or two scripted turns and a Pokemon with Revival Blessing; scripted choices bring about the faint, then choose Revival Blessing and the resulting revival-switch request. |
| `forced-tie-terminal` | gen9customgame | forced-terminal | Uses a recorded `>forcetie` omniscient command to end the battle, solely to exercise `|tie` terminal-line parsing. Documented in `meta.json` as not a substitute for a natural simultaneous-KO tie. |

A natural simultaneous-KO tie is best-effort and explicitly out of scope for
this step (see below); `forced-tie-terminal` is the only tie fixture this
step guarantees.

## Error Propagation

- `captureFixture` must propagate any lifecycle error (invalid seed,
  rethrown `RandomPlayerAI` error, an exhausted or stalled scripted-choice
  list, an unparsed terminal line) rather than writing partial or placeholder
  fixture files.
- `capture-fixtures.ts` must stop at the first failing case and report which
  case failed, rather than writing some cases and silently skipping others.
- `verify-fixtures.ts` must report every mismatching case and file (not just
  the first) before exiting nonzero, so a regression is fully visible in one
  run.

## Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "fixtures:capture": "npm run build && node simulator/dist/fixtures/capture-fixtures.js",
    "fixtures:verify": "npm run build && node simulator/dist/fixtures/verify-fixtures.js"
  }
}
```

Keep `build`, `typecheck`, `verify:showdown`, and `verify:seeded-battle`
unchanged. `fixtures:verify`, not `fixtures:capture`, is the command run
routinely; `fixtures:capture` is only for deliberately adding or updating a
case.

## Explicitly Out of Scope

- The observation schema, the 14-action adapter, and the perspective-safe
  state tracker; fixtures only supply their future test inputs.
- Any test framework (Jest/Vitest/pytest assertions against fixture
  contents); this step only captures and byte-verifies fixtures, it does not
  write the schema/action/state tests that will consume them.
- Python reading, encoding, or validating any fixture.
- A natural simultaneous-KO tie fixture; only the forced-terminal tie is
  guaranteed. If later steps require true double-faint tie semantics, that
  must be revisited explicitly rather than assumed to be covered here.
- Exhaustive coverage of all Gen 9 mechanics, items, abilities, or formats;
  only the specific cases listed above.
- Multi-battle, free-for-all, or any format other than `gen9randombattle`
  and `gen9customgame`.
- Performance tuning or parallel fixture capture.
- Vendoring or modifying Pokemon Showdown.

## Completion Criteria

1. Every case in the case matrix exists under `fixtures/` with `meta.json`,
   `p1.jsonl`, `p2.jsonl`, and `omniscient.jsonl`.
2. `npm run fixtures:verify` regenerates every case and reports byte-identical
   output against the checked-in `fixtures/` tree, exiting successfully.
3. Running `npm run fixtures:verify` twice in immediate succession produces
   identical pass/fail results and identical regenerated bytes both times.
4. Every request line preserved in `p1.jsonl`/`p2.jsonl` is the simulator's
   original, un-reparsed `|request|<json>` text; none were constructed,
   trimmed, or simplified by hand.
5. Every `p1.jsonl` and `p2.jsonl` fixture that reaches a player decision
   contains at least one original `|request|` line.
6. `fixtures/README.md` states the p1/p2/omniscient isolation rule, and no
   code added in this step reads `omniscient.jsonl` for any purpose other
   than provenance, debugging, or terminal-result parsing.
7. All Showdown imports, including any newly needed internal paths, remain
   confined to `simulator/src/core/showdown.ts`.
8. Step 3's public behavior is unchanged: `npm run verify:seeded-battle`
   still passes, and `runSeededBattle`'s exported signature and
   `SeededBattleResult` type are unchanged after the lifecycle extraction.
9. Existing TypeScript and Python validations (`npm run typecheck`, `npm run
   build`, `npm run verify:showdown`, `.venv/bin/python -m pytest`) continue to
   pass unchanged.
10. `git status --porcelain` shows only this step's new and modified files;
   Step 2's uncommitted pin and Step 3's runner remain otherwise untouched
   apart from the documented, additive lifecycle extraction.
