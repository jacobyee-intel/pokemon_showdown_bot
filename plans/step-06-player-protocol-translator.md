# Step 6: Define the Per-Player Protocol Translator

## Objective

Add a small TypeScript translator that consumes Pokemon Showdown protocol for
exactly one player and classifies valid `|request|` lines.

The translator is part of the existing npm/TypeScript project, lives under
`simulator/src/translator/`, and is permanently bound to one `battleId` and
one `BattleSide`. It is one-way and downstream of core:

```text
ShowdownBattleSession
  -> ChunkOutput { battleId, seq, player, lines }
       -> PlayerProtocolTranslator(battleId, player)
            -> decision or wait events
```

Its only input is `ChunkOutput`. It never receives omniscient output or the
opposing player's stream.

Every valid non-wait request emits a decision with a translator-local
`decisionId`. A wait request emits a wait event and no decision. A non-wait
request re-emitted with `update: true` receives a new `decisionId`. The highest
allocated ID is intended to be live, but Step 6 stores no outstanding-decision
state and exposes no getter; Step 9 entirely owns enforcement and stale-ID
rejection.

The parsed JSON object is preserved for later observation and action work.
Translation depends only on the ordered player protocol lines, not chunk
boundaries or `ChunkOutput.seq`.

## Architecture and Scope

Runtime uses one independent translator per side:

```text
p1 stream -> translator(battleId, "p1") -> future p1 agent path
p2 stream -> translator(battleId, "p2") -> future p2 agent path

omniscient stream ----------------------> debug observer only
```

Step 6 includes:

- exact recognition and parsing of `|request|` lines;
- validation of the embedded `side.id`;
- classification of Team Preview, move, forced switch, Revival Blessing, and
  wait requests;
- monotonic decision identity allocation;
- preservation of the parsed request payload;
- compact fail-closed errors;
- focused synthetic verification;
- separate replay of every p1 and p2 golden;
- proof that rechunking and chunk sequence values do not affect output.

The production module may import `ChunkOutput` and `BattleSide` from
`simulator/src/core/simulator-messages.ts` plus sibling translator modules. It
must not import Pokemon Showdown, `ShowdownBattleSession`, drivers, goldens,
verification code, or the omniscient observer.

This remains one project: no workspace, package split, second `package.json`,
new build, test framework, or generic protocol framework.

## Non-Goals

Step 6 does not:

- define the full observation schema;
- extract every request field into domain types;
- implement action masks, the 14-action mapping, or choice serialization;
- determine legal moves, switches, Tera use, team order, or revival targets;
- accept actions, call `session.choose`, or reject stale actions;
- track accumulated battle state or interpret ordinary protocol lines;
- build a coordinator, callbacks, queues, async iterables, or transports;
- add runtime JSONL or Python/model integration;
- combine p1 and p2 streams or reconstruct a view from omniscient data;
- add multi-active action semantics;
- change, recapture, normalize, regenerate, or rename goldens.

## Proposed Files

```text
simulator/src/translator/
├── translator-messages.ts
├── request-parser.ts
└── player-protocol-translator.ts

simulator/src/verification/
└── verify-player-protocol-translator.ts
```

- `translator-messages.ts`: JSON, event, request-kind, and error contracts.
- `request-parser.ts`: pure parsing, structural validation, perspective
  validation, and classification; no file I/O.
- `player-protocol-translator.ts`: immutable binding, chunk routing checks,
  line-order processing, and decision identities.
- `verify-player-protocol-translator.ts`: synthetic checks and player-golden
  replay; filesystem access stays outside production code.

Implementation will also add `verify:translator` to `package.json` and update
the directly related sections of `README.md`, `simulator/README.md`, and
`MEGAPLAN.md`. No other restructuring is planned.

## Compact TypeScript API

```typescript
import type {
  BattleSide,
  ChunkOutput,
} from "../core/simulator-messages.js";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type DecisionRequestKind =
  | "team-preview"
  | "move"
  | "forced-switch"
  | "revival-blessing";

export interface DecisionEvent {
  readonly kind: "decision";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly decisionId: number;
  readonly requestKind: DecisionRequestKind;
  readonly payload: JsonObject;
}

export interface WaitEvent {
  readonly kind: "wait";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly payload: JsonObject;
}

export type PlayerTranslatorEvent = DecisionEvent | WaitEvent;

export interface PlayerProtocolTranslatorOptions {
  readonly battleId: string;
  readonly player: BattleSide;
}

export class PlayerProtocolTranslator {
  constructor(options: PlayerProtocolTranslatorOptions);

  readonly battleId: string;
  readonly player: BattleSide;

  accept(chunk: ChunkOutput): readonly PlayerTranslatorEvent[];
}
```

Contract choices:

- `payload` is the `JSON.parse` result; do not expose duplicate raw JSON.
- Unknown JSON fields remain in `payload`.
- `requestKind` is directly on decision events.
- Wait has no `decisionId`.
- There is no `requestIndex`.
- Source line position is not part of successful public events.
- An internal line counter may exist only for optional error diagnostics.
- Events do not include simulator `seq`, chunk metadata, actions, or transport
  fields.
- TypeScript `readonly` is enough; recursive runtime freezing is unnecessary.

The class needs only immutable binding and a next-decision counter. It stores
no outstanding-decision state and needs no lifecycle methods, public getters,
callbacks, queue, or reset.

## Input and Sequencing

For each `accept(chunk)`:

1. Require `chunk.battleId` to match the bound battle.
2. Require `chunk.player` to match the bound side.
3. Process `chunk.lines` in array order.
4. Ignore lines that do not begin exactly with `|request|`.
5. Parse and classify each request line.
6. Emit one decision or wait event.

Routing checks happen before inspecting lines.

Decision IDs:

- start at `0` per translator;
- advance monotonically only for non-wait requests;
- are local to `(battleId, player)`;
- do not derive from Showdown fields or `ChunkOutput.seq`;
- are allocated for every valid non-wait occurrence, including duplicates and
  `update: true` re-emissions.

`update` is preserved payload metadata, not a discriminator. A re-emitted move
or forced-switch request keeps its classification, receives a new
`decisionId`, and does not otherwise change translator state. The highest
allocated ID is intended to be live, but only Step 9 will enforce that rule,
accept actions, and reject stale IDs.

For a fixed ordered line sequence, concatenated events must be deeply equal
when supplied as one chunk, one line per chunk, irregular chunks, or chunks
split around request lines. Changing synthetic `ChunkOutput.seq` values must
not change output. Protocol line text itself is never split.

## Parsing and Classification

### Common Rules

Recognize a request only with:

```typescript
line.startsWith("|request|")
```

Parse the complete suffix once with `JSON.parse`. Require:

- a non-null object root that is not an array;
- `side` to be a non-null object;
- `side.id` to be `"p1"` or `"p2"` and equal the bound player;
- `side.pokemon` to be an array of non-null objects.

Do not trim, reserialize, search JSON substrings, or validate unrelated Pokemon
fields.

Classify by presence of exactly one top-level discriminator:

```text
teamPreview
active
forceSwitch
wait
```

Unknown additional fields such as `noCancel`, `update`, and
`maxChosenTeamSize` are allowed and preserved.

### Team Preview

Classify as `team-preview` when `teamPreview` is exactly `true`. It creates a
decision. Custom-game goldens demonstrate this form; team-order actions remain
deferred.

### Move

Classify as `move` when `active` is a non-empty array of non-null objects.

Do not require `canTerastallize` or validate move slots, PP, targets, disabled
flags, or switch eligibility. Voluntary switching is an option within a move
request, not a separate request kind. Struggle also remains `move`.

### Forced Switch and Revival Blessing

Require `forceSwitch` to be a non-empty boolean array with at least one
`true`.

Reject an all-false `forceSwitch` array fail-closed as `malformed-request`.
This shape is absent from the current Gen 9 singles goldens.

After that validation:

- classify as `revival-blessing` if any `side.pokemon` entry has
  `reviving === true`;
- otherwise classify as `forced-switch`.

The current goldens use `[true]`; preserve the full array without assigning
multi-active slot semantics or legal targets.

### Wait

Classify as `wait` when `wait` is exactly `true`. Emit only a wait event,
allocate no decision ID, and expect no response. Preserve its payload for later
perspective-state work. Step 6 does not invalidate an earlier action when wait
arrives; Step 9 owns any such invalidation through live-ID enforcement.

## Error Behavior

Use one typed exception with four categories:

```typescript
export type PlayerProtocolTranslatorErrorCode =
  | "invalid-config"
  | "routing-mismatch"
  | "malformed-request"
  | "unsupported-request";

export class PlayerProtocolTranslatorError extends Error {
  readonly code: PlayerProtocolTranslatorErrorCode;
  readonly battleId: string;
  readonly player: BattleSide;
  readonly lineIndex?: number;
}
```

| Code | Condition |
|---|---|
| `invalid-config` | Empty constructor `battleId`. |
| `routing-mismatch` | Outer chunk battle/player or embedded `side.id` differs from the binding. |
| `malformed-request` | Invalid JSON/root/side shape, multiple discriminators, or invalid selected form. |
| `unsupported-request` | No recognized discriminator is present. |

Routing-mismatch diagnostics must distinguish an outer chunk battle/player
mismatch from an embedded `side.id` perspective mismatch. Errors may otherwise
carry concise expected/actual details and an internal source line, but never
the full private payload. They are thrown, not emitted as events.

Any thrown error is terminal for that translator instance; the caller discards
it. Step 6 designs no recovery, reset, or faulted-state API. Ordinary
non-request `|error|` lines remain ignored.

## Golden Verification

### Replay Boundary

For each replay:

1. Select exactly one file named `p1.jsonl` or `p2.jsonl`.
2. Derive the translator side from that basename.
3. Create a fresh translator for that file.
4. Decode each JSONL record only as its outer protocol string.
5. Feed matching synthetic `ChunkOutput` values.
6. Discard the translator before opening another golden.

Reject any other basename, including `omniscient.jsonl`. Never combine p1 and
p2 lines or use omniscient output as an oracle.

Production files do not read goldens. State and review this import boundary;
do not add a production import scanner.

### Representative Assertions

| Golden | Required evidence |
|---|---|
| `gen9customgame/tera/p1.jsonl` | Team Preview and move classify correctly, with Tera metadata present in the preserved move payload. |
| `gen9customgame/struggle/p1.jsonl` | The preserved Struggle request payload classifies as `move`. |
| `gen9customgame/revival-blessing/p1.jsonl` | A payload with `reviving: true` classifies as Revival Blessing, unlike ordinary forced-switch payloads. |
| `gen9customgame/revival-blessing/p2.jsonl` | Wait payloads emit wait events with no decision ID. |
| `gen9randombattle/ordinary-battle/p1.jsonl` | Move, wait, ordinary forced switch, and a large own-team payload parse. |
| `gen9randombattle/voluntary-switch/p1.jsonl` | Voluntary switching adds no request kind. |

Also replay every committed `p1.jsonl` and `p2.jsonl` separately. Require every
request to parse, match the bound perspective, and classify to a supported
kind. For each selected player file, independently count decoded protocol
lines that begin exactly with `|request|` and assert that the emitted event
count equals that count. Do not maintain a fixed per-golden histogram contract.

### Synthetic Assertions

Cover:

- non-request lines;
- all five request kinds and unknown-field preservation;
- malformed JSON, invalid root/side shapes, multiple discriminators, and no
  recognized discriminator, including fail-closed rejection of an all-false
  `forceSwitch` array;
- wrong battle, wrong chunk player, and opposing embedded `side.id`;
- wait between two decisions, yielding decision IDs `0` and `1`;
- an initial decision, then an ordinary `|error|` line followed by the
  re-emitted `|request|` JSON object with `update: true`, proving the error is
  ignored and the request receives a fresh decision ID;
- move and forced-switch `update: true` re-emissions receiving fresh IDs;
- multiple request lines preserving source order;
- all-lines, one-line, irregular, and request-boundary rechunking;
- different synthetic `ChunkOutput.seq` values with identical output;
- rejection of `omniscient.jsonl`.

The committed goldens need not contain `update: true`; the synthetic stream
owns that behavior and is not called a fixture.

Use the existing dependency-free verification style and add:

```json
{
  "scripts": {
    "verify:translator":
      "npm run build && node simulator/dist/verification/verify-player-protocol-translator.js"
  }
}
```

Run the existing typecheck, build, translator verification, Step 5 simulator
regressions, and `npm run goldens:verify`. Do not run golden capture.

## Implementation Sequence

1. Add compact JSON, event, request-kind, and error contracts.
2. Implement the pure parser and the five classification rules.
3. Implement the bound translator, routing checks, and decision IDs.
4. Add focused synthetic checks for classification, errors, wait,
   perspective safety, rechunking, and `update: true`.
5. Add one-side-at-a-time golden replay, representative assertions, and broad
   replay of every player golden.
6. Add `verify:translator`, run existing validation, and update only directly
   related documentation.
7. Review the final diff to ensure no golden or unrelated working-tree change
   was altered.

## Acceptance Criteria

Step 6 is complete when:

1. The module is inside the existing project with no package/workspace split.
2. Each translator is bound to one non-empty battle ID and one side.
3. `ChunkOutput` is its only production input; omniscient and opposing streams
   are excluded.
4. Chunk routing and embedded `side.id` are validated.
5. All five request forms classify according to this plan.
6. Non-wait requests create new local decision IDs; wait does not.
7. `update: true` re-emissions create a new identity; Step 6 stores no
   outstanding identity, and Step 9 enforces which ID is live.
8. Events preserve parsed `JsonObject` payloads but expose no `requestIndex`,
   raw JSON, public line index, or simulator `seq`.
9. Non-request lines produce no events.
10. Output is identical across required rechunkings and chunk sequence values.
11. Errors use the four-category model with no recovery protocol.
12. Verification uses exactly one p1 or p2 golden per translator and rejects
    omniscient input.
13. Representative assertions pass, and broad replay independently proves for
    every player golden that emitted count equals exact `|request|` line count,
    without a permanent histogram table.
14. Production imports obey the stated boundary without scanner tooling.
15. Existing TypeScript, simulator, and golden checks pass.
16. No golden or unrelated working-tree change is modified.

## Deferred Handoffs

- **Step 7 — `PlayerBattleView` contract:** define readonly TypeScript
  contracts under `simulator/src/view/` for facts directly established by one
  player's public protocol or private request. Requests, actions, Dex facts,
  mechanics calculations, serialization, and tensors remain separate.
- **Step 8 — per-player battle translation:** evolve this request-focused
  class into the public `PlayerBattleTranslator`. Behind that one object,
  retain focused request parsing, protocol reduction, and view-building
  modules. Process each chunk and line once in order, recording only directly
  observed facts and emitting complete replacement views at decisions and
  waits without omniscient leakage or mechanics enrichment.
- **Step 9 — action adapter:** derive the 14-action legal mask and command
  mapping plus a fixed `ActionSet`/candidate list from the exact current
  request. Candidate slot identity and move/target IDs stay outside the view.
  Enforce which decision ID is live, apply wait-driven invalidation, and reject
  stale or invalid responses.
- **Step 10 — coordinator:** own the raw session and one battle translator per
  side, combine views with exact request-derived action sets/legal masks,
  invoke agents, and submit validated raw choices.
- **Step 12 — transport:** serialize stable semantic view, action, terminal,
  and error contracts over JSONL with independently versioned schemas.
- **Step 14 — static augmentation and model encoding:** consume
  `PlayerBattleView` plus `ActionSet`/legal mask; add base species types/stats,
  move type/power/accuracy/priority, vocab IDs, scaling, padding, and tensors.
- **Step 22 — derived mechanics augmentation:** add damage ranges, KO
  probabilities, speed estimates, hazards, set filtering, and beliefs.

Future simulator versions or formats may add request forms. Fail with
`unsupported-request` until support is added intentionally.
