# Step 8F: Boosts and Pokemon Effect Lifecycles

## Status

Planned; depends on Steps 8A-8E.

## Objective

Reduce boost commands and Pokemon effect lifecycles with the same ownership
and clearing classes as the pinned client.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official boosts and Pokemon effects](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Add, subtract, set, copy, swap, clear, and invert boosts.
- Maintain ordinary volatile, turn-effect, and move-effect maps privately.
- Clear turn effects at upkeep and move effects at move/cant boundaries.
- Preserve explicit effect arguments.
- Handle stockpile, perish, type-effect, and reviewed `-activate` transitions.
- Flatten effects deterministically only during view construction.

## Non-Goals

- Effect duration calculation.
- Dex-based effect behavior.
- Side conditions or field effects.
- Baton Pass filtering.

## Exit Criteria

- Every supported boost command has focused coverage.
- Effects clear at the correct protocol boundary.
- Arguments are preserved without inferred state.
- Public effect ordering is deterministic.

