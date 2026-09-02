# TypeScript Simulator

This package wraps Pokemon Showdown as a deterministic, in-process battle
engine. Its production boundary is deliberately small:

```text
raw Showdown choices in
        |
ShowdownBattleSession
        |
raw p1/p2 protocol out
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
├── fixtures/
│   ├── capture-fixtures.ts
│   ├── fixture-cases.ts
│   ├── fixture-paths.ts
│   ├── fixture-recorder.ts
│   └── verify-fixtures.ts
├── verification/
│   ├── verify-battle-session.ts
│   ├── verify-scripted-error.ts
│   ├── verify-seeded-battle.ts
│   └── verify-showdown.ts
└── main.ts
```

### `core/`

- `battle-session.ts` owns one Showdown battle. It accepts `start`, `choose`,
  and `close` operations and exposes one asynchronous output stream.
- `simulator-messages.ts` defines the raw `chunk`, `error`, and `terminal`
  outputs. It has no Showdown dependency, allowing the future translator to
  depend on these contracts alone.
- `showdown.ts` is the only direct integration boundary for the
  `pokemon-showdown` package.
- `showdown-internal.d.ts` supplies the minimal missing type declaration for
  Showdown's temporary random test agent.
- `protocol.ts` splits raw protocol chunks and contains deterministic
  timestamp normalization used by tests and fixtures.
- `debug-omniscient-observer.ts` provides the explicit debug-only route for
  omniscient protocol.

### `drivers/`

- `battle-lifecycle.ts` connects a session to two temporary player drivers and
  manages their shutdown and errors.
- `random-player-driver.ts` adapts Showdown's `RandomPlayerAI` for smoke tests.
- `scripted-player.ts` sends fixed choices for targeted fixture scenarios.
- `seed.ts` deterministically derives separate battle, team, and agent seeds.
- `run-seeded-battle.ts` is the convenient complete-battle wrapper used by
  verification.

Drivers are consumers of the raw session interface. They are not part of the
core simulator and will not be used by the eventual neural agent.

### `fixtures/`

- `fixture-cases.ts` defines the deterministic fixture scenarios.
- `fixture-recorder.ts` records player and explicit debug-observer output.
- `fixture-paths.ts` separates committed fixtures from temporary regenerated
  output.
- `capture-fixtures.ts` intentionally rewrites the committed fixture tree.
- `verify-fixtures.ts` regenerates fixtures into ignored storage and compares
  them byte-for-byte.

The generated fixture data is stored in the repository's top-level
[`fixtures/`](../fixtures/) directory.

### `verification/`

These are dependency-free executable checks rather than a separate test
framework:

- `verify-showdown.ts` checks the pinned package and Gen 9 Random Battle format.
- `verify-seeded-battle.ts` checks complete same-seed reproducibility.
- `verify-scripted-error.ts` checks actionable rejection of illegal scripts.
- `verify-battle-session.ts` checks session state, ordering, closure, errors,
  and visibility isolation.

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

## Visibility Boundary

Normal output can carry only `p1` or `p2` protocol:

```typescript
interface ChunkOutput {
  player: "p1" | "p2";
  lines: readonly string[];
}
```

There is intentionally no omniscient output variant. A caller that needs
omniscient protocol for fixture provenance or debugging must explicitly attach
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
npm run fixtures:verify
```

Use `npm run fixtures:capture` only when intentionally updating committed
fixtures, such as after an approved Pokemon Showdown version change.

## Next Layer

The next component is a per-player translator:

```text
p1 ChunkOutput
  -> p1 protocol translator
  -> complete p1-visible observation
  -> legal action candidates
  -> raw Showdown choice
  -> session.choose("p1", choice)
```

Each translator consumes exactly one player channel. It must never reconstruct
a player view by taking omniscient state and removing fields.
