# Step 8 Megaplan: Build the Per-Player Battle Translator

## Objective

Evolve the Step 6 request-focused `PlayerProtocolTranslator` into one public,
stateful `PlayerBattleTranslator` per player. It consumes exactly one player's
ordered `ChunkOutput` stream, reduces public protocol plus that same player's
private requests, and emits complete replacement `PlayerBattleView` snapshots
at decision and wait boundaries.

```text
ShowdownBattleSession
  -> p1 ChunkOutput -> PlayerBattleTranslator(battleId, "p1")
                         -> p1 decision/wait + PlayerBattleView
  -> p2 ChunkOutput -> PlayerBattleTranslator(battleId, "p2")
                         -> p2 decision/wait + PlayerBattleView

debug-only omniscient output --------------------------> never enters translator
```

Step 8 is a parser and state reducer. It is not a mechanics engine, action
adapter, transport, or model encoder.

## Pinned Implementation Reference

Use the official Pokemon Showdown client as the behavioral reference for
player-protocol ownership and state transitions:

- Moving source for discovery:
  <https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/play.pokemonshowdown.com/src/battle.ts>
- Pinned source for implementation and verification:
  <https://raw.githubusercontent.com/smogon/pokemon-showdown-client/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts>
- Pinned parser:
  <https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle-text-parser.ts>
- Pinned request integration:
  <https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/panel-battle.tsx>
- Pinned request and choice types:
  <https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle-choices.ts>

The reference revision is
`951cc1580bfbb190bb263b285ad9748894659f10`. Updating it requires an
intentional review of reducer differences and corresponding fixture updates.

### What "client-compatible" means

Reproduce deterministic protocol semantics needed by `PlayerBattleView`:

- command and trailing keyword-argument parsing;
- identity and active-slot transitions;
- directly reported health, status, move, item, ability, type, and Tera facts;
- boosts and effect lifecycle;
- side-condition layers;
- weather, terrain, and field effects;
- ordinary switch clearing;
- Baton Pass and Shed Tail transfer;
- Transform, forme, and explicit Illusion replacement.

Do not reproduce:

- UI state, text rendering, animations, or timing;
- Dex lookups beyond protocol-defined ID normalization;
- species-derived types, abilities, stats, forms, or moves;
- move power, type, targeting, priority, or maximum PP calculation;
- Pressure or other opponent PP estimates;
- calculated effect or condition durations;
- damage, grounding, effectiveness, speed, or KO calculations;
- Species Clause, Zoroark, ability, team-count, or Hackmons identity guesses;
- target guesses not explicitly identified by protocol;
- hidden opponent data, simulator objects, or omniscient state.

## Existing Contracts to Preserve

Step 6 already provides:

- permanent `battleId` and `player` binding;
- chunk routing checks;
- request JSON parsing and side validation;
- Team Preview, move, forced-switch, Revival Blessing, and wait
  classification;
- monotonic decision IDs;
- exact request payload preservation;
- line-order and chunk-boundary independence.

Step 7 already provides:

- `PlayerBattleView` v1;
- explicit known, unknown, and known-null values;
- exact, percentage, and unknown HP;
- stable side-local Pokemon IDs;
- direct `PokemonView` Transform references;
- normal moves/stats plus temporary Transform overrides;
- Pokemon-owned boosts and effects;
- side conditions and field state;
- deterministic collection ordering.

Step 8 may fix a Step 6 parser limitation or clarify a Step 7 semantic only
when real protocol input requires it. Any public contract change must be
reviewed explicitly rather than hidden inside reducer implementation.

## Public API

The public runtime object becomes:

```typescript
export interface PlayerBattleTranslatorOptions {
  readonly battleId: string;
  readonly player: BattleSide;
}

export class PlayerBattleTranslator {
  constructor(options: PlayerBattleTranslatorOptions);

  readonly battleId: string;
  readonly player: BattleSide;

  accept(chunk: ChunkOutput): readonly PlayerBattleTranslatorEvent[];
}
```

Decision and wait outputs preserve Step 6 metadata and exact request payloads
while adding the replacement view:

```typescript
export interface PlayerBattleDecisionEvent {
  readonly kind: "decision";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly decisionId: number;
  readonly requestKind: DecisionRequestKind;
  readonly payload: JsonObject;
  readonly view: PlayerBattleView;
}

export interface PlayerBattleWaitEvent {
  readonly kind: "wait";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly payload: JsonObject;
  readonly view: PlayerBattleView;
}

export interface PlayerBattleTerminalViewEvent {
  readonly kind: "terminal-view";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly view: PlayerBattleView;
}

export type PlayerBattleTranslatorEvent =
  | PlayerBattleDecisionEvent
  | PlayerBattleWaitEvent
  | PlayerBattleTerminalViewEvent;
```

There is no action input, legal mask, callback, queue, transport envelope,
reward, terminal reward, model value, or public mutable-state getter.

`win` and `tie` set phase to `ended` and emit one final `terminal-view` event
with no action request. Authoritative terminal outcome and rewards remain the
battle session/coordinator's separate responsibility.

### Migration from Step 6

Build `PlayerBattleTranslator` alongside `PlayerProtocolTranslator` during
Steps 8A-8H so every substep remains usable and `verify:translator` continues
protecting the completed request-only behavior. Reuse the existing request
parser and preserve decision IDs, request kinds, payloads, and routing errors.

In Step 8I, migrate verification and any callers to
`PlayerBattleTranslator`, remove the old public class and obsolete request-only
event names, and leave one public translator API. Do not keep a permanent
compatibility wrapper when there are no external consumers requiring one.

## Internal Architecture

Keep one public object with focused private modules:

```text
simulator/src/translator/
├── player-battle-translator.ts
├── translator-messages.ts
├── request-parser.ts
├── protocol-line-parser.ts
├── protocol-command-disposition.ts
├── view-builder.ts
└── battle-reducer/
    ├── mutable-state.ts
    ├── identity-registry.ts
    ├── details-parser.ts
    ├── health-parser.ts
    ├── metadata-reducer.ts
    ├── pokemon-reducer.ts
    ├── effect-reducer.ts
    ├── side-field-reducer.ts
    ├── switch-transitions.ts
    └── request-synchronizer.ts

simulator/src/verification/battle-translator/
├── run.ts
├── parser-cases.ts
├── request-cases.ts
├── identity-cases.ts
├── pokemon-state-cases.ts
├── effect-cases.ts
├── side-field-cases.ts
├── special-transition-cases.ts
└── golden-replay.ts
```

Names may be consolidated when a module would otherwise be trivial. Do not
collapse the entire reducer into the public class.

Expose the modular verification suite through one
`npm run verify:battle-translator` command. Each implementation substep adds
its focused cases immediately; Step 8I integrates and hardens the suite rather
than adding all verification at the end.

### Dependency direction

```text
core simulator message types
  -> translator parsers and private reducer
       -> Step 7 view types
       -> translator event types
```

Production translator code must not import:

- `pokemon-showdown`;
- `ShowdownBattleSession`;
- drivers;
- goldens or verification modules;
- debug omniscient observer;
- schemas, Python, PyTorch, or model code;
- the official client package or its UI classes.

## Mutable Reducer State

Private state should parallel the semantic ownership of the official client
without exposing its mutable model:

```text
MutableBattleState
├── formatId, generation, gameType, phase, turn
├── ownSide: MutableSideState
├── opponentSide: MutableSideState
└── field

MutableSideState
├── name, teamSize
├── Pokemon identities and aliases
├── occupied active slots
└── side conditions

MutablePokemonState
├── permanent observed identity/details
├── exact or percentage health knowledge
├── major status and fainted knowledge
├── normal stats and moves
├── Transform stats/move overrides and target ID
├── item and base/current ability
├── forme/type overrides and Tera
├── boosts
├── ordinary volatile effects
├── turn effects
└── move effects
```

Internal rules:

- Use mutable maps internally and arrays only in the view projection.
- Give every Pokemon a stable internal ID.
- Keep active aliases separate from identity.
- Keep permanent and temporary facts separate.
- Keep ordinary, turn, and move effects separate even though the public view
  flattens them.
- Track unknown and known absence explicitly; do not use a single empty string
  for both.
- Store parsed keyword arguments internally when transition logic needs them.
- Never expose mutable reducer objects through public events.

## Protocol Line Parsing

Add a pure parser:

```typescript
interface ParsedProtocolLine {
  readonly command: string;
  readonly args: readonly string[];
  readonly keywordArgs: Readonly<Record<string, string>>;
}
```

Match the pinned client grammar where relevant:

1. Preserve empty positional arguments.
2. Keep `|request|` JSON intact.
3. Peel only trailing `[key] value` arguments.
4. Preserve valueless flags consistently.
5. Let a later duplicate keyword replace an earlier duplicate, matching the
   client.
6. Preserve raw values until a field-specific parser normalizes them.
7. Normalize protocol IDs with Showdown ID rules, not Dex lookups.

Malformed supported state-changing commands fail explicitly with the bound
battle, player, and line index. Maintain an explicit allowlist of known
presentation-only commands that are deliberately ignored. Any other unknown
command fails as unsupported protocol rather than risking a stale or partial
view.

`protocol-command-disposition.ts` classifies every recognized command as:

- `reduce`: implemented semantic state transition;
- `ignore`: reviewed presentation-only command;
- `reject`: known state behavior not implemented in the current substep.

Build the inventory from the pinned client dispatch and every command present
in existing p1/p2 goldens. Each implementation substep moves its command group
from `reject` to `reduce`. There is no default best-effort reducer and no
silent fallthrough.

Important keyword arguments include:

- `[from]`;
- `[of]`;
- `[silent]`;
- `[upkeep]`;
- `[already]`;
- `[item]`;
- `[move]`;
- `[number]`;
- `[ability]`;
- `[ability2]`.

`EffectView.arguments` preserves explicit positional effect arguments.
Keyword arguments remain internal unless a specific public field records the
semantic fact they establish.

## Identity and Details

### Protocol identities

Recognize:

```text
p1: Nickname
p2: Nickname
p1a: Nickname
p1b: Nickname
p2a: Nickname
```

Active letters map to one-based `ActiveSlotView.slot` values. Normalize an
active ident to its side-local inactive alias for identity lookup while
retaining the slot alias.

### Stable identity rules

- Own Pokemon reconcile by authoritative request team position first.
- Public own aliases validate and enrich the request-created identity.
- Opponent Pokemon receive monotonic perspective-local IDs at first justified
  identity creation.
- Nickname alone is not globally unique.
- Side, slot continuity, exact ident/details aliases, and explicit protocol
  replacement take precedence over nickname-only matching.
- Never merge identities using species knowledge, team-count guesses, Species
  Clause, or an assumed Illusion user.
- Retired appearance-only IDs are never reused.
- Surviving IDs and reveal orders never change or renumber.

### Details parsing

Parse only protocol syntax:

```text
Species[-Forme][, L<number>][, M|F][, shiny][, tera:<type>]
```

Record species, level, gender, and explicit Tera suffix. Apply only
protocol-defined omission defaults. Do not look up types, abilities, stats, or
canonical formes from species.

## Request Synchronization

Every same-player `|request|` is reduced after all preceding lines and before
its decision or wait view is built.

For `request.side.pokemon`:

- require `side.id` to match the bound player where the local simulator emits
  it;
- treat array order as authoritative one-based own team position;
- reconcile identities by team position;
- apply present complete fields authoritatively;
- parse exact HP, status, and `fnt` from `condition`;
- refresh normal stats and the complete normal move list;
- set `movesComplete` known true;
- refresh item, base/current ability, Tera type/state, and active flag;
- treat schema-defined empty values as known absence;
- retain prior knowledge when an optional field or section is not supplied for
  that request type.

For `request.active`:

- array index maps to active slot;
- permit nullable entries supported by the official request shape;
- synchronize exact `pp` and `maxpp`;
- update normal move PP when not transformed;
- populate `movesOverride` and request-established `statsOverride` while
  transformed;
- do not copy hidden target data to fill missing override fields.

The exact parsed payload remains on the emitted event for Step 9. Reducer code
must not derive action legality, candidates, targets, or commands from it.

## Public Protocol Reduction

### Metadata and lifecycle

| Command | Step 8 mutation |
|---|---|
| `player` | Set the addressed side's explicit name; ignore avatar/rating. |
| `teamsize` | Set explicit team size. |
| `gametype` | Require `singles`; reject unsupported game types explicitly. |
| `gen` | Require Generation 9; reject other generations and do not switch Dexes. |
| `tier` | Normalize visible tier text into `formatId` using ID rules only. |
| `poke` | Create/reconcile a Team Preview identity from explicit details. |
| `clearpoke` | Clear preview-created identities only where protocol requires. |
| `teampreview` | Set phase to Team Preview. |
| `start` | Set phase to battle; do not invent active occupants. |
| `turn` | Assign the explicit integer. |
| `win`, `tie` | Set phase to ended and emit one final non-decision terminal view. |

Generation and game type remain private reducer metadata in v1. Terminal
winner/draw remains a separate session/coordinator output.

### Health and major status

Parse:

- `0` and `0.0`;
- exact `current/max`;
- public `current/100` or bare percentage;
- optional status token;
- explicit `fnt`.

Commands:

| Command | Step 8 mutation |
|---|---|
| `switch`, `drag` health | Replace health/status knowledge with the explicit absolute observation. |
| `-damage` | Apply explicit absolute displayed HP/status. |
| `-heal` | Apply explicit absolute displayed HP/status. |
| `-sethp` | Apply one or both explicit Pokemon/HP pairs. |
| `-status` | Set the stated major status. |
| `-curestatus` | Set major status to known absence. |
| `-cureteam` | Clear status only on represented Pokemon of the addressed side. |
| `faint` | Set fainted known true; preserve active occupancy until an explicit slot change. |

An explicit `fnt` token establishes both zero HP in that observation form and
fainted true. Otherwise, never derive fainted from HP or HP from fainted.
Revival Blessing's explicit heal transition sets fainted false and status to
known absence.

### Moves and PP

- `move` and move-bearing `cant` reveal the displayed move ID.
- Preserve first-reveal order for public moves.
- Keep public PP unknown.
- Never decrement or estimate opponent PP.
- Never calculate maximum PP.
- Own request team moves replace the complete normal list.
- Own active request moves provide exact current/max PP.
- Transform request moves populate temporary overrides.
- Keep Struggle as an explicit transient observation without treating it as a
  complete normal learned moveset.

### Items

- `-item` sets the explicit normalized item.
- `-enditem` sets known item absence.
- Record item transfer only when protocol explicitly identifies item, source,
  and target.
- Ignore client target guesses and ambiguous reveal heuristics.
- Do not retain UI-only previous-item reasons in v1.

### Abilities

- Same-player requests authoritatively establish base/current ability fields.
- `-ability` sets the explicit current ability.
- Establish base ability from public protocol only when the event explicitly
  represents a base reveal; do not infer it from species.
- `-endability` retains the explicitly named underlying identity and sets
  `suppressed` known true instead of storing the client's string sentinel.
- Explicit suppression start/end effects update `suppressed`; never derive it
  from the presence of Neutralizing Gas or other mechanics.
- Ordinary switch clearing restores current from a known base; if base is
  unknown, current becomes unknown, and explicitly clears temporary
  suppression.
- Never calculate whether an ability is operational under Neutralizing Gas,
  Gastro Acid, or other mechanics.

### Tera and dynamic types

- `-terastallize` sets explicit Tera state/type and persists across switching.
- It clears an explicit added-type override where the pinned client does.
- `-start ... typechange` and `typeadd` store only stated types.
- `-end` clears the corresponding explicit type override.
- Reflect Type may copy only already known explicit type state; never fall
  back to species types from a Dex.
- `detailschange` updates permanent details without deriving a new ability.

### Boosts

Implement:

- `-boost`;
- `-unboost`;
- `-setboost`;
- `-swapboost`;
- `-copyboost`;
- `-clearpositiveboost`;
- `-clearnegativeboost`;
- `-clearboost`;
- `-clearallboost`;
- `-invertboost`.

Clamp mutations to `[-6, 6]`, omit zero stages from the view, and use fixed
`StatId` ordering. Missing copy/swap stat lists default to all seven boost
stats. `-clearallboost` affects represented active occupants only.

### Pokemon effects

Maintain three private maps:

- ordinary volatiles;
- turn effects, cleared by `upkeep`;
- move effects, cleared by the next `move` or `cant`.

Reduce:

- `-start`;
- `-end`;
- `-singleturn`;
- `-singlemove`;
- semantic state changes from selected `-activate` forms.

Special protocol transitions:

- a higher `stockpileN` replaces the prior numbered variant;
- a new `perishN` replaces the prior count;
- ending Stockpile removes all numbered variants;
- ending Protosynthesis or Quark Drive removes stat-specific variants;
- type changes use dedicated type fields instead of duplicate generic effects;
- Future Sight and Doom Desire use side-condition state;
- an ordinary `-activate` is instantaneous and leaves no persistent effect.

Flatten the three maps into one deterministically sorted `PokemonView.effects`
array only when building a snapshot. Preserve explicit positional arguments in
protocol order.

### Side conditions

- `-sidestart` creates a condition at layer 1.
- Duplicate Spikes and Toxic Spikes increment layers according to pinned
  client protocol reduction.
- Duplicate non-layered conditions remain one condition.
- `-sideend` removes the condition.
- `-swapsideconditions` swaps only the pinned client's Court Change-eligible
  set, not every condition.
- Never calculate, decrement, or expose duration ranges.

### Weather and field effects

- `-weather X` sets normalized weather.
- `-weather none` sets known absence.
- `-weather ... [upkeep]` does not change semantic identity.
- `-fieldstart` for a terrain replaces any current terrain.
- Other `-fieldstart` commands add or update a generic field effect.
- `-fieldend` clears the matching terrain or generic effect.
- Never calculate or decrement durations.

## Active and Special Transitions

### Ordinary switch

Clear outgoing and incoming temporary state:

- boosts;
- ordinary, turn, and move effects;
- forme override;
- Transform target, stats override, and moves override;
- dynamic type overrides;
- temporary current ability.

Restore current ability from known base ability. Retain permanent identity,
normal moves/stats, item, major status, and Tera state/type.

Then update the active slot to the incoming stable identity and apply the
explicit incoming health/details observation.

### Teleport

Treat as an ordinary semantic switch. The client suppresses only presentation;
it does not transfer temporary state.

### Drag

Clear outgoing and incoming temporary state with no transfer, then replace the
slot occupant.

### Baton Pass

Require an explicit `[from] move: Baton Pass` or equivalent normalized
annotation. Do not infer transfer from the previously selected move.

Transfer:

- boost stages;
- only volatiles permitted by the pinned client transition policy.

Never transfer:

- Transform relation or overrides;
- temporary forme state;
- explicitly blocked volatile IDs from the pinned client filter.

Store the filter as a small named protocol-transition policy with direct
fixtures and a citation to the pinned client lines 474-499.

### Shed Tail

Require an explicit Shed Tail transition annotation. Clear ordinary temporary
state and transfer only Substitute. Do not transfer boosts or unrelated
effects.

### Transform

On explicit `-transform`:

- resolve the visible target identity;
- set a private target ID;
- copy only target boosts and other facts the protocol/client transition makes
  directly visible;
- do not copy hidden moves, stats, types, items, or abilities;
- let the same-player request establish exact stats/move overrides;
- clear Transform and its overrides on ordinary switch.

The Step 7 public contract deliberately uses a direct `PokemonView` reference.
The view builder must ensure `transformedInto.value` is the same immutable
target object present in one side's Pokemon array. It must not embed a separate
state with additional knowledge.

### Permanent and temporary forme changes

- `detailschange` updates permanent observed species/details.
- `-formechange` updates only the temporary `formeOverride`.
- Explicit end/switch semantics clear the temporary override.
- Never use species data to change types, stats, moves, or abilities.

### Illusion `replace`

Use explicit replacement and active-slot continuity only:

1. Resolve or create the actual revealed identity.
2. Move visible active HP, status, Tera, boosts, and effects to it.
3. Point the active slot to the actual identity.
4. Preserve an apparent identity independently established as a real team
   member.
5. Retire an appearance-only synthetic identity when justified by the explicit
   replacement.
6. Never reuse its ID or renumber surviving reveal orders.

Do not implement the client's Zoroark/Zorua recognition, ability checks,
Species Clause duplicate inference, team-count guessing, or arbitrary
Hackmons fallback.

## View Construction

Build a fresh replacement `PlayerBattleView` only when a valid request emits a
decision or wait event.

Projection rules:

- no mutable maps or reducer objects escape;
- own and opponent knowledge remain separate;
- no unknown opponent placeholders;
- direct Transform references point to the same projected target object;
- Pokemon sort by surviving `revealOrder`;
- active slots sort by one-based slot;
- own normal moves retain request order;
- opponent normal moves retain first-reveal order;
- boosts use fixed stat order;
- effects, side conditions, and field effects sort by normalized ID;
- complete-state collections emit empty arrays for known none;
- incomplete reveal collections emit only observed members;
- all active references resolve within their represented side.

Because `transformedInto` is recursive, use a memoized graph projection rather
than recursively cloning target Pokemon. Valid target Gen 9 protocol must not
produce an unsupported Transform cycle; detect and reject a malformed cycle
explicitly rather than recursing indefinitely.

TypeScript `readonly` is the public immutability contract. Step 8 does not add
a recursive runtime-freezing dependency.

## Incremental Implementation Plan

Each substep must leave the repository compiling and preserve all completed
Step 6 behavior.

### Step 8A: Protocol, details, and health parsers

Implement:

- protocol line and keyword parsing;
- details and health parsers;
- Showdown ID normalization without a Dex;
- typed parser errors with line context;
- explicit reduce/ignore/reject command inventory sourced from the pinned
  client and current player goldens;
- initial modular verification runner and
  `npm run verify:battle-translator` command.

Exit checks:

- parser fixtures match pinned client grammar;
- every command in existing p1/p2 goldens has an explicit disposition;
- exact and percentage HP remain distinct;
- malformed supported syntax fails explicitly;
- unknown commands are not silently accepted;
- no Dex or simulator runtime imports enter production translator code.

### Step 8B: Reducer skeleton, metadata, and view projection

Implement:

- private battle, side, Pokemon, and field state containers;
- player, teamsize, gametype, gen, tier, poke, clearpoke, teampreview, start,
  turn, win, and tie;
- Generation 9 singles validation;
- blank and metadata-only deterministic `PlayerBattleView` projection;
- memoized projection support for future direct Transform references.

Exit checks:

- metadata is independent of chunk boundaries and `seq`;
- unsupported generation or game type fails explicitly;
- no mutable reducer object escapes through the view;
- direct-reference projection cannot recurse indefinitely.

### Step 8C: Identity registry and private request synchronization

Implement:

- stable own IDs by authoritative request team position;
- opponent reveal IDs and active/inactive aliases;
- Team Preview reconciliation;
- authoritative own team refresh;
- exact own HP/status/fainted/stats/moves/item/ability/Tera;
- complete move knowledge and exact active PP;
- nullable active entries;
- Transform stats/move overrides;
- request-position and alias consistency checks.

Exit checks:

- repeated own request refreshes reuse identity;
- repeated opponent reveals reuse identity where justified;
- duplicate nicknames across sides do not collide;
- request fields update only the bound player's side;
- encoded absence and absent sections remain distinct;
- no request field reveals opponent-private state.

### Step 8D: Ordinary active transitions and emitted views

Implement:

- ordinary switch and temporary-state clearing;
- drag, swap, and faint;
- detailschange and temporary forme changes;
- active-slot projection;
- decision, wait, and terminal-view events carrying replacement views;
- existing decision ID, request kind, payload, and routing behavior.

Exit checks:

- repeated switch-ins reuse stable identity;
- faint does not speculatively remove active occupancy;
- ordinary switch clears only temporary state;
- each request snapshots every earlier line exactly once;
- all-lines, one-line, and irregular chunking emit equivalent views.

### Step 8E: Pokemon fact commands

Implement:

- health and status commands;
- public move reveal without PP inference;
- item and ability commands;
- type changes;
- Tera transitions and persistence.

Exit checks:

- opponent exact HP is never recovered from hidden data;
- no PP, type, ability, or duration calculation occurs;
- explicit ability suppression is represented without calculating effective
  ability;
- Tera and permanent facts survive ordinary switching.

### Step 8F: Boosts and Pokemon effect lifecycles

Implement:

- all boost commands;
- ordinary volatile start/end;
- turn effects and upkeep clearing;
- move effects and move/cant clearing;
- explicit effect arguments;
- stockpile, perish, and type-effect transitions;
- every `-activate` form classified `reduce` in the reviewed command inventory,
  while explicitly classified presentation-only forms remain ignored.

Exit checks:

- every boost mutation and clear form is covered;
- effect classes clear at the correct protocol boundary;
- effect arguments are preserved without duration or mechanics inference;
- flattened view effects remain deterministic.

### Step 8G: Side and field state

Implement:

- side conditions and explicit layers;
- Court Change's pinned eligible set;
- weather;
- terrain replacement;
- generic field effects.

Exit checks:

- no duration estimates;
- duplicate non-layered conditions do not become layers;
- terrain replacement does not erase unrelated field effects.

### Step 8H: Special switch and identity semantics

Implement:

- Baton Pass filtering and transfer;
- Shed Tail Substitute transfer;
- Teleport ordinary clearing;
- Transform target and override lifecycle;
- explicit Illusion replacement and appearance retirement.

Exit checks:

- focused transitions agree with pinned client behavior inside the declared
  boundary;
- no Illusion or target guessing;
- direct Transform references resolve to the projected target object.

### Step 8I: Golden replay, migration, and integration hardening

Implement:

- migrate callers and verification from `PlayerProtocolTranslator`;
- remove the old request-only public class and obsolete event names;
- separate replay of every p1 and p2 golden;
- expected snapshots at meaningful request boundaries;
- perspective and routing failures;
- malformed supported-command failures;
- import-boundary checks;
- one top-level verification command.

Exit checks:

- no omniscient golden is accepted;
- p1 and p2 outputs differ only according to their actual visible facts;
- re-chunking and changing `ChunkOutput.seq` do not change output;
- existing Step 6 translator behavior remains covered.

## Verification Matrix

At minimum, add focused synthetic fixtures for:

| Area | Required cases |
|---|---|
| Line parsing | Empty positional args, `[from]`, `[of]`, valueless flags, duplicate keywords, request JSON, malformed suffix |
| Metadata | Both players, team size, Team Preview, start, explicit turn, tier normalization, win, tie |
| Identity | Same nickname across sides, active/inactive aliases, repeated switch, preview reconciliation |
| Health | Own exact, opponent percent, `fnt`, damage, heal, two-target sethp, Revival Blessing |
| Status | Every major status, curestatus, cureteam without revealing hidden Pokemon |
| Requests | Authoritative present fields, encoded absence, absent optional section, nullable active slot |
| Moves | Own complete list, active PP, public reveal, cant reveal, Struggle, no opponent PP decrement |
| Items | Reveal, consume/remove, explicit transfer, ambiguous target ignored |
| Abilities | Base/current request, public reveal, replacement, endability, switch restoration |
| Tera/type | Tera persists through switch, typeadd/typechange, explicit clear, no species type lookup |
| Boosts | Add, subtract, set, copy, swap, positive/negative clear, clear one/all, invert, clamp |
| Effects | Volatile start/end, explicit args, turn clear at upkeep, move clear at move/cant, stockpile/perish replacement |
| Side state | Spikes and Toxic Spikes layers, duplicate non-layered condition, sideend, Court Change |
| Field state | Weather set/upkeep/none, terrain replacement, field start/end |
| Ordinary switch | Both Pokemon cleared temporarily, permanent state retained |
| Baton Pass | Boost transfer, permitted effect, blocked effect, Transform/forme not transferred |
| Shed Tail | Substitute only |
| Teleport | Ordinary clearing |
| Drag | No transfer |
| Transform | Direct target reference, visible boost copy, request overrides, no hidden fact copy, switch clear |
| Replace | Visible state moved, active identity corrected, real apparent member retained, appearance-only entry retired |
| Perspective | Wrong side rejected, opposing request unavailable, omniscient input impossible |
| Chunking | Whole stream, one line per chunk, irregular chunks, arbitrary `seq`, identical events |

Use existing player goldens for broad coverage:

- ordinary battle;
- voluntary switching;
- Tera;
- Struggle;
- Revival Blessing;
- forced terminal tie.

Existing goldens do not adequately cover Baton Pass, Shed Tail, drag, explicit
Illusion replacement, Transform, most field effects, or all boost variants.
Use focused synthetic protocol fixtures for those cases. Do not manufacture
new omniscient-derived expected player facts.

## Error Policy

Extend translator errors narrowly:

- `invalid-config`;
- `routing-mismatch`;
- `malformed-request`;
- `unsupported-request`;
- `malformed-protocol`;
- `unsupported-protocol`;
- `invalid-transition`;
- `unresolved-reference`.

Errors include battle ID, bound player, and line index where available.

Fail closed for:

- wrong battle or player route;
- malformed supported state-changing commands;
- protocol commands that are neither implemented nor explicitly allowlisted as
  presentation-only;
- invalid numeric fields;
- impossible required references;
- conflicting own request identity;
- invalid transition order that would corrupt state;
- malformed Transform cycles.

Ignore only through an explicit allowlist:

- chat and presentation-only commands;
- UI-only metadata.

Do not catch broad errors and return a success-shaped partial view.

## Scope Decisions

- The supported format is current Generation 9 Random Battle singles with p1
  and p2 only. Reject other generations and game types explicitly.
- Foundational arrays remain multi-slot-capable for later work, but Step 8 does
  not partially reduce or claim support for doubles, multi, FFA, triples,
  rotation, p3, or p4.
- Requests remain exact payloads for Step 9; Step 8 does not derive actions.
- Terminal outcome and rewards remain outside `PlayerBattleView`.
- Generation and game type remain private metadata in v1.
- Named effect keyword arguments remain private reducer inputs in v1.
- Explicit ability suppression uses `AbilityView.suppressed`; current ability
  nullability never implies suppression.
- The accepted direct Transform object reference remains part of v1; Step 12
  will separately define its wire representation.

## Non-Goals

Step 8 does not:

- choose or validate actions;
- build the fixed 14-action set or legal mask;
- call `session.choose`;
- implement a coordinator or agent;
- serialize JSONL;
- add machine-readable schemas;
- import or query a Dex;
- encode model vocabularies or tensors;
- calculate damage, effectiveness, speed, KO chance, hazards, or beliefs;
- estimate hidden items, abilities, moves, sets, PP, HP, or Tera type;
- infer opponent identities from species or format rules;
- parse omniscient logs into player views;
- add a general Pokemon mechanics framework.

## Validation Commands

Add one focused command:

```bash
npm run verify:battle-translator
```

Continue running:

```bash
npm run typecheck
npm run build
npm run verify:translator
npm run verify:battle-session
npm run goldens:verify
```

The new verification may use existing TypeScript executable-check conventions;
do not add a test framework or dependency.

## Acceptance Criteria

Step 8 is complete when:

1. One public `PlayerBattleTranslator` owns request parsing, public protocol
   reduction, decision IDs, and view construction for one battle/player.
2. Every input line is processed exactly once and in order.
3. Every decision, wait, and terminal-view event carries a complete
   replacement `PlayerBattleView`.
4. Requests snapshot all earlier lines in the same stream.
5. Chunk boundaries and `ChunkOutput.seq` do not affect output.
6. Own private request fields never enter the opponent translator.
7. Omniscient protocol cannot enter the public translator API.
8. Exact and percentage HP remain distinct.
9. Unknown, known absence, and known value remain distinct.
10. Stable Pokemon identity, active references, reveal order, and deterministic
    ordering satisfy the Step 7 contract.
11. Ordinary switches, Teleport, drag, Baton Pass, and Shed Tail match pinned
    client transition semantics within the declared boundary.
12. Transform and explicit Illusion replacement preserve perspective safety
    and never guess hidden facts.
13. Boost, effect, side-condition, weather, terrain, item, ability, type, Tera,
    move, health, and status reducers cover all commands listed in this plan.
14. Opponent PP, exact HP, moves, items, abilities, types, stats, Tera, and
    identity are never inferred.
15. No Dex, simulator runtime, debug observer, golden, transport, schema,
    Python, model, or action dependency enters production translator code.
16. All focused fixtures and separate p1/p2 golden replays pass.
17. Existing Step 6 request classification and decision ID behavior remain
    intact.
18. Visible `win` or `tie` emits exactly one final view with phase `ended` and
    no action request, reward, or authoritative outcome.

## Final Review Checklist

- Compare each implemented transition with the pinned client lines cited here.
- Confirm every copied behavior is protocol reduction, not a Dex/UI/mechanics
  calculation.
- Search production translator imports for forbidden dependencies.
- Confirm no omniscient fixture is opened by the translator verification.
- Confirm no opponent request payload is available to the opposite reducer.
- Confirm malformed supported commands fail with precise context.
- Confirm output ordering is deterministic.
- Confirm all direct Transform references resolve within the same emitted
  view.
- Confirm docs distinguish completed Step 8 behavior from later Steps 9, 10,
  12, 14, and 22.
