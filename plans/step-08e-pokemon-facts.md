# Step 8E: Pokemon Fact Commands

## Status

Planned; depends on Steps 8A-8D.

## Objective

Reduce directly observed Pokemon facts while excluding mechanics-derived
knowledge.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official major and minor Pokemon command reducers](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Health changes, healing, dual-target HP setting, and major statuses.
- Public move revelation without opponent PP inference.
- Item reveal, removal, and fully explicit transfer.
- Base/current ability changes and explicit suppression.
- Tera state/type and explicit dynamic type changes.
- Permanent detail changes without species-derived enrichment.

## Non-Goals

- Boosts and generic effect lifecycle.
- Side or field conditions.
- Opponent PP estimates.
- Species, move, item, or ability Dex lookup.

## Exit Criteria

- Opponent exact HP is never recovered from hidden data.
- No PP, type, ability, or duration calculation occurs.
- Ability suppression is explicit rather than mechanics-derived.
- Permanent item, status, and Tera facts survive ordinary switching.

