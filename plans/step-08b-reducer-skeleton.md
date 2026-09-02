# Step 8B: Reducer Skeleton, Metadata, and View Projection

## Status

Planned; depends on Step 8A.

## Objective

Create private reducer state, reduce battle metadata, and project a
deterministic blank or metadata-only `PlayerBattleView`.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official battle metadata reducer](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Add private battle, side, Pokemon, and field state containers.
- Reduce `player`, `teamsize`, `gametype`, `gen`, `tier`, `poke`,
  `clearpoke`, `teampreview`, `start`, `turn`, `win`, and `tie`.
- Require Generation 9 singles with p1/p2.
- Normalize visible tier text into `formatId` without a Dex.
- Add deterministic view projection.
- Prepare memoized projection for direct Transform references.

## Non-Goals

- Full identity reconciliation.
- Private request field synchronization.
- Active switching.
- Pokemon, side-condition, or field-effect commands.

## Exit Criteria

- Unsupported generations and game types fail explicitly.
- Metadata reduction is independent of chunks and `seq`.
- No mutable reducer object escapes in a view.
- Projection detects recursive reference errors rather than looping.

