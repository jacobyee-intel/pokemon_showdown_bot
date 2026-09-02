# Protocol Goldens

Real, perspective-specific request/protocol captures from the pinned
`pokemon-showdown@0.11.11` simulator. Every file here was produced by running
the actual simulator through the shared battle lifecycle
(`simulator/src/drivers/battle-lifecycle.ts`). Nothing in this directory is
hand-written, hand-edited, or manually simplified.

These are cross-language test contracts for later TypeScript and Python work,
not generated training artifacts, which is why they are version-controlled here
as a sibling of `schemas/` rather than under the gitignored `artifacts/`.

The current `PlayerProtocolTranslator` verification replays every `p1.jsonl`
and `p2.jsonl` independently. It uses the player streams to validate request
parsing, classification, wait handling, decision identities, and independence
from chunk boundaries. Translator code never reads `omniscient.jsonl`.

## Perspective Isolation Rule

**This is the rule consumers of this directory must follow.**

- Any future agent, action adapter, or state tracker must be built and tested
  using only `p1.jsonl` (from `p1`'s own perspective) **or** only `p2.jsonl`
  (from `p2`'s own perspective) — never both, and never `omniscient.jsonl`.
- `omniscient.jsonl` exists only for golden provenance, debugging, and
  terminal-result parsing. It must never be read by anything that represents
  what a real player-side agent knows.
- Tests that need to assert facts about the "true" battle state for grading or
  comparison purposes may read `omniscient.jsonl`, but any code under test that
  plays a side of the battle must not.

`p1.jsonl` and `p2.jsonl` contain exactly what `getPlayerStreams` routes to that
side: its own redacted public log lines plus its own private `|request|` lines.
`omniscient.jsonl` contains the unredacted public log (channel `-1`) and never
contains any side's `|request|` line.

## File Format

Each case directory contains four files:

| File | Contents |
|---|---|
| `meta.json` | Everything needed to replay the case exactly, and nothing machine-specific. |
| `p1.jsonl` | Every protocol line `p1` received, in order. |
| `p2.jsonl` | Every protocol line `p2` received, in order. |
| `omniscient.jsonl` | Every protocol line the omniscient stream received, in order. |

`.jsonl` files have exactly one JSON-encoded string per line
(`JSON.stringify(rawProtocolLine)`). This preserves the exact original text of
every protocol line — including a `|request|<json>` line's full, un-reparsed
JSON payload — with no re-serialization of the inner request JSON (no key
reordering, no re-indentation). Sequence is preserved by line order; no explicit
sequence numbers are embedded.

Normalization applied before serialization:

- `|t:|<epoch-seconds>` is rewritten to `|t:|0`. The line is preserved rather
  than dropped so line indices stay stable.
- Empty segments produced by chunk splitting are dropped.
- Files are UTF-8, use `\n` line endings only, and end with a single trailing
  newline.

`meta.json` never contains wall-clock timestamps, hostnames, absolute paths, or
process IDs, and its keys are written in a fixed order, so it is byte-identical
across machines and across regenerations of the same case.

## Cases

| Case | Format | Category | Notes |
|---|---|---|---|
| `gen9randombattle/ordinary-battle` | gen9randombattle | natural-random-search | One complete default-agent battle demonstrating ordinary moves, forced switch, wait, faint, and win. `meta.json`'s `demonstrates` records where each event occurs instead of duplicating the logs across five directories. |
| `gen9randombattle/voluntary-switch` | gen9randombattle | natural-random-search | Both sides use `move: 0.5`, so at least one non-`forceSwitch` request results in a chosen switch. |
| `gen9customgame/tera` | gen9customgame | custom-scripted | Authored teams with explicit Tera types; a scripted player sends `move 1 terastallize`. `RandomPlayerAI` cannot Terastallize in Gen 9 because its change-form gate ignores `canTerastallize`, so this case must be scripted. |
| `gen9customgame/struggle` | gen9customgame | custom-scripted | A recorded `>editbattle pp ...` command sets the only move to 1 PP; scripted choices exhaust it and execute Struggle. |
| `gen9customgame/revival-blessing` | gen9customgame | custom-scripted | A fast, frail teammate faints, then a scripted Revival Blessing produces the revival-switch request. |
| `gen9customgame/forced-tie-terminal` | gen9customgame | forced-terminal | A recorded `>forcetie` command ends the battle solely to exercise `\|tie` terminal-line parsing. **Not** a natural simultaneous-KO tie; see the `note` field in its `meta.json`. |

A natural simultaneous-KO tie is explicitly out of scope. If later steps need
true double-faint tie semantics, that must be revisited explicitly rather than
assumed to be covered by `forced-tie-terminal`.

## Regenerating

```bash
npm run goldens:verify   # routine: regenerate into artifacts/ and byte-compare
npm run goldens:capture  # deliberate: rewrite this directory from the manifest
```

`simulator/src/goldens/golden-cases.ts` is the frozen, single source of truth for every
case. `capture-goldens.ts` is the only program allowed to write here, and is
run only when adding a new case or intentionally changing an existing one (for
example after an approved Pokemon Showdown version upgrade).

Run `npm run verify:translator` to replay these goldens through the per-player
request translator without starting a battle.
