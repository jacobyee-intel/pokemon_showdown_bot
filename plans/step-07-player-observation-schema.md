# Step 7: Define the Player Battle View Contract

## Objective

Define TypeScript contracts for `PlayerBattleView`, the public immutable,
model-independent snapshot of one player's directly observed battle facts.

Step 7 is a types-only step. It defines the vocabulary that Step 8 will
populate, but it does not parse protocol, maintain reducer state, replay
goldens into views, derive actions, serialize JSONL, or encode tensors.

```text
Step 6: classify requests and allocate decision IDs (complete)
Step 7: define PlayerBattleView v1 TypeScript contracts
Step 8: reduce one player's public protocol + private requests into views
Step 9: derive ActionSet, legal mask, and commands from the current request
Step 10: coordinate session, translators, action adapter, and agents
Step 12: serialize stable semantic contracts over JSONL
Step 14: add static Dex/model features and encode tensors
Step 22: add derived mechanics and belief features
```

The central design rule is that `PlayerBattleView` is a perspective-safe
record of observations, not a mechanics engine or enrichment layer.

Where player protocol describes a state transition rather than emitting a
separate line for every cleared or transferred fact, Step 8 follows the
official Pokemon Showdown client's protocol-reduction semantics. This governs
ownership and transitions such as switch clearing, Baton Pass and Shed Tail
transfer, Illusion replacement, ability restoration, forme and Transform
state, and layered conditions. It does not import the client's UI state, Dex
enrichment, PP estimates, calculated durations, or mechanics-derived values.

## Naming and Boundary

`PlayerBattleView` is the sole public snapshot name: it is perspective-bound,
semantic battle data, and an immutable projection rather than authoritative
simulator state, mutable reducer state, or a model-ready vector.

The future contract belongs under `simulator/src/view/`, not
`simulator/src/observation/`. Reserve reducer-oriented names for private Step 8
implementation details.

The view is a complete replacement value. It is never an event stream, patch,
request wrapper, legal-action object, tensor, or omniscient state with fields
removed.

## Scope

- readonly TypeScript interfaces and discriminated unions;
- explicit known/unknown/known-absence semantics;
- one-player identity, reference, and deterministic ordering conventions;
- documentation of the direct source for every field;
- a small compile-time contract fixture checked by existing TypeScript tools.

- protocol parsing or reduction;
- mutable battle tracking, identity reconciliation, or snapshot timing;
- request classification or decision ID allocation, which Step 6 completed;
- action candidates, legal masks, target selection, or raw commands;
- coordinator, agent, reward, terminal, or rollout behavior;
- JSONL envelopes or machine-readable schemas;
- static Dex lookup, vocabularies, scaling, padding, or tensors;
- damage, effectiveness, inferred speed, KO probability, hazards analysis,
  opponent-set inference, beliefs, or any other mechanics-derived feature;
- runtime invariant frameworks, new dependencies, packages, or tooling.

Step 7 must not claim to verify golden-to-view parsing. Step 8 owns that work.

## Observed-Facts Policy

Every semantic value in a view must be established by either:

1. a public protocol fact delivered on that player's stream; or
2. that player's private `|request|` payload.

The translator must never read the opposing private request, debug-only
omniscient output, authoritative simulator objects, or static Dex data.

Own facts are not automatically known. An own Pokémon's species, HP, moves,
stats, item, ability, or Tera type remains unknown or absent until that
player's request or public protocol establishes it. Opponent Pokémon and set
facts remain unknown or unlisted until revealed on the player's stream.

### Parsing is not mechanics inference

Protocol-defined syntax and defaults may be decoded directly:

- normalize protocol identifiers with Showdown's ID rules;
- parse explicitly encoded integers, HP fractions, percentages, and levels;
- recognize an explicitly encoded `fnt`;
- decode an omitted level or gender only where Showdown's protocol itself
  defines that omission as a specific default.

These operations recover the fact encoded by the message. They do not predict
or calculate gameplay.

The following are not parsing and are forbidden in Steps 7 and 8:

- looking up a species' base types or stats;
- looking up move type, power, accuracy, or priority;
- calculating damage, effectiveness, speed order, KO chance, or hazards;
- inferring a hidden item, move, ability, Tera type, or opponent set;
- inferring action legality from battle state rather than the request;
- deriving `fainted` from HP, HP from `fainted`, or one field from another.

## Future Files

Step 7 implementation should add only contracts and a focused type fixture:

```text
simulator/src/view/
├── player-battle-view.ts
└── player-battle-view.typecheck.ts
```

The contract imports only foundational types such as `BattleSide`, never
Showdown, translators, requests, actions, goldens, schemas, Python, model code,
or a Dex. The fixture uses `satisfies PlayerBattleView`, exhaustiveness
examples, and a few `@ts-expect-error` checks. No package, dependency, or
script change should be necessary.

## Compact TypeScript Sketch

Names may be refined for repository conventions, but the implementation should
remain comparably small and fact-oriented.

```typescript
import type {BattleSide} from "../core/simulator-messages.js";

export type Knowledge<T> =
  | {readonly kind: "known"; readonly value: T}
  | {readonly kind: "unknown"};

export type PokemonViewId = string;
export type NormalizedId = string;
export type SpeciesId = NormalizedId;
export type MoveId = NormalizedId;
export type ItemId = NormalizedId;
export type AbilityId = NormalizedId;
export type TypeId = NormalizedId;
export type EffectId = NormalizedId;
export type StatId =
  | "atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion";
export type MajorStatus = "brn" | "frz" | "par" | "psn" | "slp" | "tox";
export type Gender = "M" | "F" | "N";

export interface PlayerBattleView {
  readonly schemaVersion: 1;
  readonly battleId: string;
  readonly player: BattleSide;
  readonly battle: BattleView;
  readonly ownSide: SideView;
  readonly opponentSide: SideView;
  readonly field: FieldView;
}

export interface BattleView {
  readonly formatId: Knowledge<NormalizedId>;
  readonly turn: Knowledge<number>;
  readonly phase: Knowledge<"team-preview" | "battle" | "ended">;
}

export interface SideView {
  readonly side: BattleSide;
  readonly name: Knowledge<string>;
  readonly teamSize: Knowledge<number>;
  readonly pokemon: readonly PokemonView[];
  readonly active: readonly ActiveSlotView[];
  readonly conditions: readonly SideConditionView[];
}

export interface PokemonView {
  readonly id: PokemonViewId;
  readonly side: BattleSide;
  readonly teamPosition: Knowledge<number>;
  readonly revealOrder: number;
  readonly nickname: Knowledge<string>;
  readonly species: Knowledge<SpeciesId>;
  readonly level: Knowledge<number>;
  readonly gender: Knowledge<Gender>;
  readonly hp: HpView;
  readonly fainted: Knowledge<boolean>;
  readonly status: Knowledge<MajorStatus | null>;
  readonly stats: Knowledge<ObservedStats>;
  readonly statsOverride: Knowledge<ObservedStats | null>;
  readonly moves: readonly MoveView[];
  readonly movesComplete: Knowledge<boolean>;
  readonly movesOverride: Knowledge<readonly MoveView[] | null>;
  readonly item: Knowledge<ItemId | null>;
  readonly ability: AbilityView;
  readonly formeOverride: Knowledge<SpeciesId | null>;
  readonly transformedInto: Knowledge<PokemonView | null>;
  readonly typeOverride: Knowledge<readonly TypeId[] | null>;
  readonly tera: TeraView;
  readonly boosts: readonly BoostView[];
  readonly effects: readonly EffectView[];
}

export type HpView =
  | {readonly kind: "exact"; readonly current: number; readonly max: number}
  | {readonly kind: "percent"; readonly percent: number}
  | {readonly kind: "unknown"};

export interface ObservedStats {
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface MoveView {
  readonly id: MoveId;
  readonly pp: Knowledge<{readonly current: number; readonly max: number}>;
}

export interface AbilityView {
  readonly base: Knowledge<AbilityId | null>;
  readonly current: Knowledge<AbilityId | null>;
}

export interface TeraView {
  readonly state: Knowledge<"not-terastallized" | "terastallized">;
  readonly type: Knowledge<TypeId>;
}

export interface ActiveSlotView {
  readonly slot: number;
  readonly pokemonId: PokemonViewId;
}

export interface BoostView {
  readonly stat: StatId;
  readonly stages: number;
}

export interface EffectView {
  readonly id: EffectId;
  readonly arguments: readonly string[];
}

export interface SideConditionView {
  readonly id: EffectId;
  readonly layers: Knowledge<number>;
}

export interface FieldView {
  readonly weather: Knowledge<EffectId | null>;
  readonly terrain: Knowledge<EffectId | null>;
  readonly effects: readonly EffectView[];
}
```

This sketch has no base-type field. `statsOverride`, `movesOverride`,
`formeOverride`, `transformedInto`, and `typeOverride` record only explicitly
announced temporary state or its clear; they never trigger a species, forme,
move, stat, or type lookup. Normal `stats` and `moves` remain available while
an override is active. Tera facts are retained only when directly established.

Ability `base` and `current` preserve distinct stated values. `current:
known(null)` does not mean “suppressed.” Generic effect IDs preserve explicit
announcements without calculating whether an ability is operational.

Effect duration is omitted because common durations depend on hidden facts.
`EffectView.arguments` preserves only arguments explicitly carried by the
player-visible protocol, in protocol order. Values are normalized only where
the protocol defines them as identifiers; the view does not add calculated
durations, inferred sources, or other derived effect state.

## Direct-Source Semantics

| Field | Permitted source and meaning |
|---|---|
| `battleId`, `player`, side identities | Translator/session construction context for this one player channel. |
| `formatId` | Explicit player-visible initialization or protocol metadata; otherwise unknown. |
| `turn` | Most recent explicit turn number; never incremented speculatively. |
| `phase` | Explicit request/start/end protocol semantics, not a mechanics prediction. |
| side `name`, `teamSize` | That player's request or public player/teamsize facts. |
| `pokemon` membership | Own entries from that player's request; opponent entries only after public appearance/reveal. |
| `teamPosition` | Explicit own request order when available; not guessed for the opponent. |
| `revealOrder` | Translator-assigned one-based order of first visible identity creation. |
| nickname/species/level/gender | Explicit request or protocol details, including only protocol-defined omission defaults. `species` retains the latest permanently announced identity. |
| `hp` | Exact private request fraction or public exact/percent encoding; never converted between forms without explicit data. |
| `fainted` | Explicit `fnt`/request fact or explicit later restoration fact; never derived from HP. |
| `status` | Explicit status/clear fact; unknown is distinct from known no status. |
| stats and stats override | `stats` retains the exact normal non-HP stat block established by that player's private request. `statsOverride` records an exact temporary Transform stat block only when the same-player request establishes it; never species base stats or calculated stats. |
| moves/PP, completeness, and moves override | `moves` retains normal move IDs and PP explicitly present in the own request, or publicly revealed move IDs. `movesComplete` is known true only when a same-player request establishes the full normal moveset; a public reveal normally leaves completeness unknown. `movesOverride` records the current temporary Transform moves established by same-player requests or official client-compatible reduction from already visible target facts. Opponent PP is normally unknown. |
| item | Explicit private request value or public item gain/loss/reveal event. |
| ability base/current | Explicit request or public ability/change facts only. |
| forme/Transform overrides | Explicit public forme-change, Transform, or clear transitions using official client-compatible protocol reduction. They do not replace permanent `species` identity or copy hidden target facts. |
| `typeOverride` | Explicit dynamic type-change/clear announcement only; never species-derived types. |
| Tera state/type | Explicit private request fields or public Terastallization facts. |
| active slot reference | Explicit switch/drag/replace/start-of-slot facts. |
| Pokémon boosts and effects | Explicit start/change/end protocol facts, including explicit effect arguments, and protocol-defined transition semantics only. They follow the targeted Pokémon identity, are cleared on an ordinary switch, and are transferred only when official client-compatible protocol reduction requires it. |
| conditions/field | Explicit start/change/end protocol facts, protocol-defined initial defaults, and official client-compatible layered-condition transitions only. Never retain the client's calculated duration ranges. |

A present complete field in a same-player request authoritatively replaces the
corresponding own-side fact. Schema-defined empty values and omitted
sub-tokens inside that present field establish absence where Showdown defines
that meaning: for example, a present `condition` without a status token
establishes no major status, and an empty item establishes no item. By
contrast, a field or section not supplied for that request type provides no
new evidence and does not erase a previously established fact. Step 8 applies
these field-specific refresh rules rather than treating every omission alike.

## Known, Unknown, Null, and Unlisted

- `Knowledge<T>` means whether this player has received evidence for a fact.
- `{kind: "unknown"}` means no such evidence has established the current value.
- `{kind: "known", value: null}` means an explicit fact established absence.
- Empty `pokemon` and incomplete `moves` arrays mean no members have been
  observed, not that the authoritative collection is empty. `teamSize` and
  `movesComplete` separately express available completeness knowledge.
- Boosts, Pokémon effects, side conditions, and field effects are complete
  current-state collections once battle state is established; an empty array
  means none are currently present.
- `active` contains one entry for every occupied established slot. It is empty
  when no slot is occupied, including before battle placement at Team Preview.
- Unknown opponent team members are not placeholder rows.
- A public percentage remains percentage knowledge; do not fabricate exact HP.
- A revealed move is listed even when its PP is unknown.
- Own-side fields may be unknown before the relevant private request.

Knowledge is perspective-local. A fact known to p1 may remain unknown to p2.

## Identity and Ordering

`PokemonViewId` is opaque and scoped to `(battleId, player, represented side)`;
consumers must not derive it from nickname or species.

- An ID follows the same established individual through switches, formes,
  status changes, and Tera.
- Step 8 owns Illusion reconciliation and may use private aliases internally.
- On an explicit Illusion `replace`, the active slot changes to the actual
  revealed Pokémon identity and visible active state moves to that identity.
  An apparent entry remains when independent evidence established it as a real
  team member; an appearance-only entry may be retired from later snapshots.
- IDs and `revealOrder` never change for surviving entries. Retiring an
  appearance-only entry may leave a reveal-order gap; remaining entries are
  never renumbered.
- Active slots reference side-local Pokémon IDs only.
- Boosts and volatile effects belong to the referenced Pokémon rather than the
  slot. Step 8 clears or transfers them using official client-compatible
  switch reduction.
- Temporary forme, Transform, type, boost, and volatile state follows the same
  identity and is cleared or transferred only by official client-compatible
  protocol transitions.
- A fainted active occupant remains referenced in its active slot until an
  explicit replacement, switch, or drag changes that slot.
- The view must not clear a slot because HP or `fainted` suggests it should.
- Forced-switch and revival choices come from the exact request in Step 9.

Deterministic order:

- each side's `pokemon`: ascending `revealOrder`;
- `active`: ascending one-based slot;
- own moves: request order when established;
- opponent moves: first-reveal order;
- boosts: fixed `StatId` order;
- conditions and effects: ascending normalized ID.

Move order is semantic/request or reveal order. It is not aligned with action
indices. Step 9 separately creates candidate slot identity, move/target IDs,
the fixed 14-entry action list, legal mask, and raw command mapping.

## Minimal Local Validity Rules

Keep only representation-local validity:

- non-empty `battleId`, Pokémon IDs, and normalized IDs;
- finite integers where integer fields are required;
- exact HP has `max > 0` and `0 <= current <= max`;
- percent HP is finite and in `0..100`;
- known stats and PP are nonnegative, with `current <= max`;
- known level is in `1..100`;
- boost stages are integers in `-6..6`;
- positions, reveal orders, and slots are positive and unique in scope;
- active-slot references resolve to exactly one Pokémon on the same represented
  side;
- each Pokémon's `side` equals its containing `SideView.side`; own/opponent
  relation is derived by comparing it with `PlayerBattleView.player`;
- a known Transform target is the same `PokemonView` object present in one of
  the view's two side collections;
- no duplicate Pokémon, move, boost-stat, condition, effect ID, or active-slot
  entries within their collection;
- collections follow the documented deterministic order.

Do not add gameplay cross-field invariants. In particular, do not require:

- `fainted` if and only if HP is zero;
- a fainted Pokémon to leave its active slot;
- Tera state to imply any species or base type;
- ability nullability to imply suppression;
- species to imply types, stats, moves, or any other Dex fact.

Step 7 should prefer clear examples over runtime validation machinery. A tiny
local assertion may be added later only if construction bugs demonstrate a
need; it is not part of this types-only step.

## Types-Only Verification

1. a valid view with partially known own facts;
2. a valid opponent reveal with percent HP and unknown set details;
3. distinct unknown and known-null examples;
4. a fainted Pokémon still referenced by an active slot;
5. move order that is clearly unrelated to the 14 action indices;
6. a few `@ts-expect-error` examples for invalid union values or attempts to
   put a request/legal mask on `PlayerBattleView`.

Use exhaustive switches for `Knowledge` and `HpView`. Do not add broad runtime
tests, parse protocol, replay goldens, or claim that the type fixture verifies
Step 8 behavior.

```bash
npm run typecheck
npm run build
npm run verify:translator
```

The translator check protects completed Step 6 behavior only.

## Implementation Order

1. Add `simulator/src/view/player-battle-view.ts`.
2. Define the compact readonly contracts and direct-source documentation.
3. Add the compile-time fixture beside the contract.
4. Compile valid, unknown, known-null, and perspective-safe examples.
5. Add only a few high-value negative type examples.
6. Run existing typecheck, build, and Step 6 translator verification.
7. Review imports and confirm no parser, reducer, action, Dex, model, schema,
   package, golden, or unrelated code changed.

## Acceptance Criteria

Step 7 is complete when:

1. `PlayerBattleView` is the public immutable one-player snapshot contract.
2. Its future source lives under `simulator/src/view/`.
3. The contract records only public protocol and same-player request facts.
4. Unknown, known absence, exact HP, and percent HP remain distinct.
5. Own information is not presumed known and opponent hidden facts are absent
   or unknown until revealed.
6. No static types/stats, move mechanics, damage, effectiveness, speed, KO,
   legality, set inference, beliefs, or derived cross-field facts appear.
7. Base/current ability values and generic effects preserve explicit facts
   without calculating ability operation or suppression.
8. Stable side-local IDs, references, and ordering are documented.
9. Fainted active occupants persist until explicit slot replacement.
10. Requests, action candidates, masks, and commands are outside the view.
11. Type fixtures compile with existing tooling without parsing goldens.
12. No runtime framework, dependency, package, schema, transport, model,
    parser, reducer, action implementation, or golden is added.

## Handoffs

### Step 8: `PlayerBattleTranslator`

Evolve the completed Step 6 translator into one public stateful object per
player. Each chunk is processed once; every line is handled once and in order.
Internal request parser, protocol reducer, and view builder modules are allowed,
but callers interact with only one `PlayerBattleTranslator`.

It records only directly observed public protocol and same-player private
request facts, maintains private reducer bookkeeping, and emits complete
replacement `PlayerBattleView` values at decisions and waits. It never performs
Dex enrichment, mechanics calculations, action inference, or omniscient
subtraction.

### Step 9: `ActionSet` and action adapter

From the exact current request, derive a fixed 14-entry `ActionSet`/candidate
list, legal mask, and raw command mapping. Candidate identity, candidate slot,
move IDs, target IDs, Tera variants, forced-switch choices, and revival choices
belong to this output, not `PlayerBattleView`. Enforce live decision identity
and reject masked, stale, wrong-player, wrong-battle, or out-of-range actions.

### Step 10: coordinator

Own the battle session, one isolated translator per player, the action adapter,
and the agents. Join each emitted view with the exact request-derived
`ActionSet` and legal mask without leaking one player's private data to the
other.

### Step 12: stable JSONL contracts

Serialize stable semantic view, action, terminal, and error contracts with
independent wire versions and machine-readable schemas. Transport must not
redefine the TypeScript semantics.

### Step 14: static augmentation and model encoding

Consume `PlayerBattleView` plus `ActionSet`/legal mask. Add static Dex facts
such as base species types/stats and move type/power/accuracy/priority, then
apply vocab IDs, scaling, padding, and tensor layouts. Do not stub this work in
Steps 7 or 8.

### Step 22: derived mechanics augmentation

Add separately evaluated derived features such as damage ranges, KO
probabilities, speed estimates, hazard consequences, set filtering, and
beliefs. These are not view or translator responsibilities.
