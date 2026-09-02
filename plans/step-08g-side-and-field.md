# Step 8G: Side Conditions and Field State

## Status

Planned; depends on Steps 8A-8F.

## Objective

Reduce side-wide and field-wide public state without calculating durations.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official side-condition and field reducers](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Add and remove side conditions.
- Track explicit Spikes and Toxic Spikes layers.
- Apply the pinned Court Change condition set.
- Set, maintain, and clear weather.
- Replace terrain without removing unrelated field effects.
- Add and remove generic field effects.

## Non-Goals

- Duration ranges or countdowns.
- Hazard consequence calculation.
- Weather or terrain mechanics.
- Pokemon-owned volatile effects.

## Exit Criteria

- Duplicate non-layered conditions remain single entries.
- No condition expires without an explicit end.
- Weather upkeep does not replace weather identity.
- Terrain and generic field effects remain independently correct.

