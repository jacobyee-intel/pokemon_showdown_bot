# Pokemon Showdown Bot

Initial project placeholder.

See [MEGAPLAN.md](MEGAPLAN.md) for the high-level roadmap,
[plans/step-01-project-scaffold.md](plans/step-01-project-scaffold.md) for the scaffolding step,
[plans/step-02-pin-showdown.md](plans/step-02-pin-showdown.md) for the dependency pin,
[plans/step-03-seeded-battle.md](plans/step-03-seeded-battle.md) for the seeded battle runner,
[plans/step-04-protocol-fixtures.md](plans/step-04-protocol-fixtures.md) for protocol fixture capture, and
[plans/step-05-raw-simulator-interface.md](plans/step-05-raw-simulator-interface.md) for the raw simulator interface.

## Pokemon Showdown Dependency

This project depends on the published npm package:

```text
npm package:     pokemon-showdown@0.11.11
upstream commit: 739a5e1fee432ad80ff7136d70cca993be358b59
```

The upstream commit is release provenance recorded here and in
[plans/step-02-pin-showdown.md](plans/step-02-pin-showdown.md); it is not
runtime-verifiable metadata (the published package does not include its npm
`gitHead`). At runtime, only the installed package version is verified.

All imports of `pokemon-showdown` are kept behind `simulator/src/core/showdown.ts`,
including the one internal package path this project uses
(`pokemon-showdown/dist/sim/tools/random-player-ai`, declared minimally in
`simulator/src/core/showdown-internal.d.ts`). The dependency runs entirely
in-process as a local library; it does not require running a Pokemon Showdown
server.

Run `npm run verify:showdown` to confirm the installed package version and
that the `gen9randombattle` format resolves correctly.

## Seeded Battles

`npm run verify:seeded-battle` runs one complete `gen9randombattle` twice in
process from a single fixed master seed and asserts that both runs produce an
identical winner, turn count, and timestamp-normalized protocol log.

A single master seed deterministically derives five independent sub-seeds
(battle mechanics, each side's team generation, and each side's agent
decisions) in `simulator/src/drivers/seed.ts`, which is pure and has no
`pokemon-showdown` dependency. Nothing in the runner uses `Math.random()`,
`Date.now()`, or any other non-deterministic source.

Showdown's own `RandomPlayerAI` drives both sides. It is temporary smoke-test
and fixture infrastructure only, and must not become production agent
infrastructure.

`npm run verify:scripted-error` checks the opposite path: a scripted side that
sends an illegal choice receives an `|error|` line and no further request, and
the battle lifecycle must reject with a diagnostic naming the side, Showdown's
error text, and the offending choice instead of hanging.

## Raw Simulator Interface

The TypeScript simulator is grouped by responsibility:

```text
simulator/src/
├── core/           # Raw Showdown session, messages, protocol, debug boundary
├── drivers/        # Temporary random/scripted drivers and lifecycle harness
├── fixtures/       # Fixture definitions, capture, paths, and verification
├── verification/   # Executable simulator checks
└── main.ts         # Future application entry point
```

`ShowdownBattleSession` (`simulator/src/core/battle-session.ts`) is the single,
deliberately dumb interface to one battle, and the only place in the project
that constructs `BattleStream` or `getPlayerStreams`. It accepts three typed
raw operations — `start`, `choose`, and `close` — and emits raw, channel-tagged
protocol through one single-use `AsyncIterable`:

```text
chunk    { battleId, seq, player: "p1" | "p2", lines }
terminal { battleId, seq, status: "ended" | "closed" | "faulted", winner }
error    { battleId, seq, code, message, player? }
```

Those contracts live in `simulator/src/core/simulator-messages.ts`, which imports
nothing, so a later translator can depend on them without pulling in the
simulator. The session never parses `|request|` payloads, tracks no battle
state, derives no legal actions, and knows nothing about rewards, models, or
transports; the only protocol line it inspects is the terminal `|win|`/`|tie`
line. Illegal choices are written through unexamined and Showdown's `|error|`
answer arrives as an ordinary chunk.

Omniscient protocol has no output variant at all: `ChunkOutput.player` is
`"p1" | "p2"`, so no type exists through which it could reach a normal
consumer. It is available only through the explicit debug observer
(`simulator/src/core/debug-omniscient-observer.ts`), passed as the session's `debug`
constructor option and surfaced by the harness as `onDebugLines`.

`simulator/src/drivers/battle-lifecycle.ts` is a thin harness over the session: it owns
the single dispatch loop, fans each side's chunks into that side's temporary
driver queue, and keeps the Step 3 and Step 4 results unchanged.

```bash
npm run verify:battle-session  # lifecycle states, close/EOF, ordering, isolation
```

## Protocol Fixtures

`fixtures/` holds real, perspective-specific request/protocol captures produced
by the pinned simulator. See [fixtures/README.md](fixtures/README.md) for the
file format and the p1/p2/omniscient perspective isolation rule that all later
consumers must follow.

```bash
npm run fixtures:verify   # routine: regenerate into artifacts/ and byte-compare
npm run fixtures:capture  # deliberate: rewrite fixtures/ from the frozen manifest
```

## Local Toolchain Versions

This project was scaffolded and validated with:

- Node.js `v22.14.0`
- npm `10.9.2`
- Python `3.11.9`

The `engines` field in `package.json` and `requires-python` in `pyproject.toml` document these
versions; they are not strictly enforced.

## Installation

```bash
npm install

python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```

## Validation

```bash
npm run typecheck
npm run build
npm run verify:showdown
npm run verify:seeded-battle
npm run verify:scripted-error
npm run verify:battle-session
npm run fixtures:verify

.venv/bin/python -m pytest
```
