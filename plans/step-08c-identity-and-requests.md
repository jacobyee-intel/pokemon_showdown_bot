# Step 8C: Identity Registry and Private Request Synchronization

## Status

Planned; depends on Steps 8A-8B.

## Objective

Establish stable perspective-local Pokemon identities and synchronize
authoritative same-player request facts into private reducer state.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official request integration](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/panel-battle.tsx)
- [Official request types](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle-choices.ts)

## Planned Scope

- Assign stable own IDs from authoritative request team positions.
- Assign opponent reveal IDs and maintain active/inactive aliases.
- Reconcile Team Preview identities.
- Refresh exact own HP, status, fainted state, stats, moves, PP, item,
  ability, suppression, and Tera facts.
- Preserve encoded absence versus absent-section semantics.
- Accept nullable active request entries.
- Populate Transform move/stat overrides only from visible/request facts.

## Non-Goals

- Opponent request access.
- Public switch reduction.
- Action legality or command construction.
- Illusion guessing.

## Exit Criteria

- Repeated requests and justified reveals reuse stable identities.
- Duplicate nicknames across sides cannot collide.
- Requests mutate only the bound player's side.
- Complete fields replace prior values while absent sections retain knowledge.

