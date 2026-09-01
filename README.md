# Pokemon Showdown Bot

Initial project placeholder.

See [PLAN.md](PLAN.md) for the high-level roadmap,
[plans/step-01-project-scaffold.md](plans/step-01-project-scaffold.md) for the scaffolding step,
[plans/step-02-pin-showdown.md](plans/step-02-pin-showdown.md) for the dependency pin,
[plans/step-03-seeded-battle.md](plans/step-03-seeded-battle.md) for the seeded battle runner, and
[plans/step-04-protocol-fixtures.md](plans/step-04-protocol-fixtures.md) for protocol fixture capture.

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

All imports of `pokemon-showdown` are kept behind `simulator/src/showdown.ts`,
including the one internal package path this project uses
(`pokemon-showdown/dist/sim/tools/random-player-ai`, declared minimally in
`simulator/src/showdown-internal.d.ts`). The dependency runs entirely
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
decisions) in `simulator/src/seed.ts`, which is pure and has no
`pokemon-showdown` dependency. Nothing in the runner uses `Math.random()`,
`Date.now()`, or any other non-deterministic source.

Showdown's own `RandomPlayerAI` drives both sides. It is temporary smoke-test
and fixture infrastructure only, and must not become production agent
infrastructure.

`npm run verify:scripted-error` checks the opposite path: a scripted side that
sends an illegal choice receives an `|error|` line and no further request, and
the battle lifecycle must reject with a diagnostic naming the side, Showdown's
error text, and the offending choice instead of hanging.

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
npm run fixtures:verify

.venv/bin/python -m pytest
```
