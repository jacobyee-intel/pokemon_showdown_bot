# TypeScript Simulator

This package wraps Pokemon Showdown as a deterministic, in-process battle
engine and translates each player's private request stream. Its production
boundaries are deliberately small:

```text
raw Showdown choices in
        |
ShowdownBattleSession
        | raw p1/p2 protocol
        v
per-player translators
        |
decision/wait events out
```

The simulator does not build model observations, calculate legal action
indices, choose moves, assign rewards, or communicate with Python. Those
belong to layers above this package.

## Structure

```text
simulator/src/
├── core/
│   ├── battle-session.ts
│   ├── debug-omniscient-observer.ts
│   ├── protocol.ts
│   ├── showdown-internal.d.ts
│   ├── showdown.ts
│   └── simulator-messages.ts
├── drivers/
│   ├── battle-lifecycle.ts
│   ├── random-player-driver.ts
│   ├── run-seeded-battle.ts
│   ├── scripted-player.ts
│   └── seed.ts
├── goldens/
│   ├── capture-goldens.ts
│   ├── golden-cases.ts
│   ├── golden-paths.ts
│   ├── golden-recorder.ts
│   └── verify-goldens.ts
├── translator/
│   ├── player-protocol-translator.ts
│   ├── request-parser.ts
│   └── translator-messages.ts
├── view/
│   ├── player-battle-view.ts
│   └── player-battle-view.typecheck.ts
├── verification/
│   ├── verify-battle-session.ts
│   ├── verify-player-protocol-translator.ts
│   ├── verify-scripted-error.ts
│   ├── verify-seeded-battle.ts
│   └── verify-showdown.ts
└── main.ts
```

### `core/`

- `battle-session.ts` owns one Showdown battle. It accepts `start`, `choose`,
  and `close` operations and exposes one asynchronous output stream.
- `simulator-messages.ts` defines the raw `chunk`, `error`, and `terminal`
  outputs. It has no Showdown dependency, allowing the translator to depend on
  these contracts alone.
- `showdown.ts` is the only direct integration boundary for the
  `pokemon-showdown` package.
- `showdown-internal.d.ts` supplies the minimal missing type declaration for
  Showdown's temporary random test agent.
- `protocol.ts` splits raw protocol chunks and contains deterministic
  timestamp normalization used by tests and goldens.
- `debug-omniscient-observer.ts` provides the explicit debug-only route for
  omniscient protocol.

### `drivers/`

- `battle-lifecycle.ts` connects a session to two temporary player drivers and
  manages their shutdown and errors.
- `random-player-driver.ts` adapts Showdown's `RandomPlayerAI` for smoke tests.
- `scripted-player.ts` sends fixed choices for targeted golden scenarios.
- `seed.ts` deterministically derives separate battle, team, and agent seeds.
- `run-seeded-battle.ts` is the convenient complete-battle wrapper used by
  verification.

Drivers are consumers of the raw session interface. They are not part of the
core simulator and will not be used by the eventual neural agent.

### `goldens/`

- `golden-cases.ts` defines the deterministic golden scenarios.
- `golden-recorder.ts` records player and explicit debug-observer output.
- `golden-paths.ts` separates committed goldens from temporary regenerated
  output.
- `capture-goldens.ts` intentionally rewrites the committed golden tree.
- `verify-goldens.ts` regenerates goldens into ignored storage and compares
  them byte-for-byte.

The generated golden data is stored in the repository's top-level
[`goldens/`](../goldens/) directory.

### `translator/`

- `player-protocol-translator.ts` binds translation to one battle and player,
  validates chunk routing, and allocates local decision IDs.
- `request-parser.ts` validates and classifies exact `|request|` lines without
  interpreting unrelated request fields.
- `translator-messages.ts` defines preserved JSON payloads, decision/wait
  events, request kinds, and typed fail-closed errors.

Production translator code depends only on `core/simulator-messages.ts` and
sibling translator modules. It never imports Showdown, sessions, drivers,
goldens, verification code, or the debug omniscient observer.

### `verification/`

These are dependency-free executable checks rather than a separate test
framework:

- `verify-showdown.ts` checks the pinned package and Gen 9 Random Battle format.
- `verify-seeded-battle.ts` checks complete same-seed reproducibility.
- `verify-scripted-error.ts` checks actionable rejection of illegal scripts.
- `verify-battle-session.ts` checks session state, ordering, closure, errors,
  and visibility isolation.
- `verify-player-protocol-translator.ts` checks parsing, classification,
  decision identity, rechunking independence, perspective rejection, and
  separate replay of every player golden.

### `view/`

- `player-battle-view.ts` defines the readonly, model-independent
  `PlayerBattleView` v1 contract and its perspective-local knowledge types.
- `player-battle-view.typecheck.ts` contains compile-time examples and focused
  negative checks. It does not parse or reduce protocol.

## Raw Session API

```typescript
const session = new ShowdownBattleSession({battleId: "battle-1"});

const outputDone = (async () => {
  for await (const output of session.outputs()) {
    if (output.kind === "chunk") {
      // Forward output.lines to the translator for output.player.
    } else if (output.kind === "error") {
      // Handle an input or simulator diagnostic.
    } else {
      // Exactly one terminal output is emitted, and it is always last.
    }
  }
})();

session.start({
  formatId: "gen9randombattle",
  seed: battleSeed,
  p1: {name: "p1", teamSeed: p1TeamSeed},
  p2: {name: "p2", teamSeed: p2TeamSeed},
});

// A controller responds as each player's request arrives:
session.choose(player, translatedShowdownChoice);

await outputDone;
session.close();
```

`choose` accepts raw Showdown syntax. It does not parse requests or determine
whether a choice is legal. A rejected choice returns through that player's raw
protocol as an `|error|` line.

The output variants are:

```text
chunk    { battleId, seq, player: "p1" | "p2", lines }
error    { battleId, seq, code, message, player? }
terminal { battleId, seq, status, winner }
```

Each battle has one gapless output sequence. Chunk boundaries are incidental;
only line ordering within each player channel is a stable contract.

## Player Translator API

```typescript
const translator = new PlayerProtocolTranslator({
  battleId: "battle-1",
  player: "p1",
});

const events = translator.accept(chunkOutput);
```

The translator recognizes only lines beginning exactly with `|request|`.
Non-wait requests emit decisions classified as `team-preview`, `move`,
`forced-switch`, or `revival-blessing`; wait requests emit wait events without
a decision ID. Every valid non-wait occurrence, including an `update: true`
re-emission, receives a fresh ID. Parsed request JSON is preserved, while
simulator sequence values and chunk boundaries do not appear in events.

## Visibility Boundary

Normal output can carry only `p1` or `p2` protocol:

```typescript
interface ChunkOutput {
  player: "p1" | "p2";
  lines: readonly string[];
}
```

There is intentionally no omniscient output variant. A caller that needs
omniscient protocol for golden provenance or debugging must explicitly attach
a `DebugOmniscientObserver`. Translators and agents must never receive that
observer.

## Commands

From the repository root:

```bash
npm run typecheck
npm run build
npm run verify:showdown
npm run verify:seeded-battle
npm run verify:scripted-error
npm run verify:battle-session
npm run verify:translator
npm run goldens:verify
```

Use `npm run goldens:capture` only when intentionally updating committed
goldens, such as after an approved Pokemon Showdown version change.

## Next Layer

Step 7 defines the stable, model-independent `PlayerBattleView` contract under
`src/view/`. It contains only facts directly established by one player's public
protocol or private request. Step 8 evolves the request-focused translator into
one public, stateful
`PlayerBattleTranslator` per side. That object processes every line once while
keeping request parsing, protocol reduction, and view building as
focused internal modules:

```text
p1 ChunkOutput
  -> p1 PlayerBattleTranslator
       -> request parser
       -> protocol reducer
       -> view builder
  -> p1 PlayerBattleView

exact current request -> Step 9 action adapter -> ActionSet + legal mask
agent action -> Step 9 action adapter -> raw choice -> session.choose(...)

PlayerBattleView + ActionSet/legal mask
  -> later JSONL transport
  -> later static Dex augmentation + Python encoder
  -> model tensors
```

Candidate slot identity, move/target IDs, and the legal mask are Step 9
decision metadata, not fields of `PlayerBattleView`; view move order does not
align with action indices. Static base types/stats, move mechanics, model token
IDs, scaling, padding, and tensors are Step 14 concerns. Damage, KO, speed,
hazard, and belief calculations are Step 22 concerns. Each battle translator
consumes exactly one player channel, performs no mechanics enrichment, and
must never reconstruct a player view by taking omniscient state and removing
fields.
