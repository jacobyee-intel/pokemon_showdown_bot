# Step 8A: Protocol, Details, and Health Parsers

## Status

Planned.

## Objective

Build the pure parsing foundation for `PlayerBattleTranslator` without adding
mutable battle reduction.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete Step 8
boundary and dependency order.

## Pinned Reference

- [Official line parser](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle-text-parser.ts)
- [Official details and health parsing](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Parse positional and trailing keyword arguments.
- Preserve empty positional arguments and intact request JSON.
- Parse protocol identities and details syntax without a Dex.
- Parse exact, percentage, unknown, status, and `fnt` health forms.
- Add Showdown ID normalization without Dex lookup.
- Create the explicit `reduce`/`ignore`/`reject` command inventory.
- Add the modular verification runner and parser cases.

## Non-Goals

- Mutable battle state.
- Pokemon identity reconciliation.
- Request synchronization.
- View emission.
- Any Dex or mechanics calculation.

## Exit Criteria

- Parser behavior matches the pinned client grammar within the declared scope.
- Every command in existing p1/p2 goldens has an explicit disposition.
- Malformed supported syntax and unknown commands fail with line context.
- Exact and percentage HP remain distinct.

