# Pokemon Showdown Bot

A deterministic, perspective-safe foundation for a Generation 9 Pokemon
Showdown self-play reinforcement-learning bot. The current implementation runs
seeded battles in process, exposes a raw per-player simulator interface,
captures reproducible protocol goldens, and translates private player requests
into typed decision and wait events. It also defines the immutable,
perspective-local `PlayerBattleView` v1 contract.

The model, training loop, `PlayerBattleView` reducer, 14-action adapter, battle
coordinator, and Node-to-Python transport are not implemented yet.

See [MEGAPLAN.md](MEGAPLAN.md) for the high-level roadmap,
[plans/step-01-project-scaffold.md](plans/step-01-project-scaffold.md) for the scaffolding step,
[plans/step-02-pin-showdown.md](plans/step-02-pin-showdown.md) for the dependency pin,
[plans/step-03-seeded-battle.md](plans/step-03-seeded-battle.md) for the seeded battle runner,
[plans/step-04-protocol-goldens.md](plans/step-04-protocol-goldens.md) for protocol golden capture, and
[plans/step-05-raw-simulator-interface.md](plans/step-05-raw-simulator-interface.md) for the raw simulator interface, and
[plans/step-06-player-protocol-translator.md](plans/step-06-player-protocol-translator.md) for the per-player protocol translator, and
[plans/step-07-player-observation-schema.md](plans/step-07-player-observation-schema.md) for the player battle view contract.

## Current Architecture

```text
Pokemon Showdown
  -> ShowdownBattleSession
       -> p1 ChunkOutput -> p1 PlayerProtocolTranslator -> decision/wait events
       -> p2 ChunkOutput -> p2 PlayerProtocolTranslator -> decision/wait events
       -> debug-only omniscient observer
```

The normal player path never receives omniscient protocol. The translator is a
one-way, in-process TypeScript API: it classifies requests but does not choose
actions or submit commands back to the simulator.

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
and golden infrastructure only, and must not become production agent
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
├── goldens/        # Golden definitions, capture, paths, and verification
├── translator/     # Per-player request parsing and decision/wait events
├── view/           # Perspective-local PlayerBattleView contracts
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
nothing, so the translator depends on them without pulling in the simulator.
The session never parses `|request|` payloads, tracks no battle
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

## Player Protocol Translator

`PlayerProtocolTranslator` is permanently bound to one battle ID and one side.
It accepts only that side's `ChunkOutput`, ignores ordinary protocol lines, and
classifies valid `|request|` payloads as Team Preview, move, forced switch,
Revival Blessing, or wait events. Decision IDs are local and monotonic; wait
events allocate no ID. Parsed payloads are preserved for later observation and
action layers.

The production translator imports only the raw simulator message contracts and
its sibling translator modules. Golden replay remains verification-only and
opens one `p1.jsonl` or `p2.jsonl` at a time; omniscient files are rejected.

```bash
npm run verify:translator
```

The translator output is currently an internal TypeScript contract:

```text
decision { battleId, player, decisionId, requestKind, payload }
wait     { battleId, player, payload }
```

The model-independent, immutable `PlayerBattleView` TypeScript contract now
lives under `simulator/src/view/`. It records only facts directly established
by one player's public protocol or private request; it does not contain static
Dex enrichment, mechanics calculations, inferred facts, requests, or actions.

Step 8 then evolves the request-focused translator into one stateful
`PlayerBattleTranslator` per player. Each chunk and line is processed once in
order, and complete replacement views are emitted at decisions and waits.
Step 9 derives a fixed 14-entry `ActionSet`, legal mask, and raw command mapping
from the exact current request. Candidate slots and move/target IDs remain
outside the view; view move order is not action-index order.

Step 10 coordinates the session, translators, action adapter, and agents.
Step 12 serializes stable semantic contracts over JSONL. Step 14 joins static
Dex facts such as base species types/stats and move
type/power/accuracy/priority, then applies vocab IDs, scaling, padding, and
tensor encoding. Derived damage, KO, speed, hazard, and belief augmentation is
deferred to Step 22.

## Protocol Goldens

`goldens/` holds real, perspective-specific request/protocol captures produced
by the pinned simulator. See [goldens/README.md](goldens/README.md) for the
file format and the p1/p2/omniscient perspective isolation rule that all later
consumers must follow.

```bash
npm run goldens:verify   # routine: regenerate into artifacts/ and byte-compare
npm run goldens:capture  # deliberate: rewrite goldens/ from the frozen manifest
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
npm run verify:translator
npm run goldens:verify

.venv/bin/python -m pytest
```
