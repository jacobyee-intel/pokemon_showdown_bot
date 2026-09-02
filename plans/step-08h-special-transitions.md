# Step 8H: Special Switch and Identity Semantics

## Status

Planned; depends on Steps 8A-8G.

## Objective

Implement the high-risk client-compatible transitions that move temporary
state or correct visible identity.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official switch transfer and replacement behavior](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Baton Pass boost and permitted-volatile transfer.
- Shed Tail Substitute-only transfer.
- Teleport ordinary clearing.
- Transform target references and temporary move/stat overrides.
- Transform and forme clearing on switch.
- Explicit Illusion `replace` and appearance-only identity retirement.

## Non-Goals

- Inferring transfer from a selected move.
- Zoroark, ability, Species Clause, or team-count identity guesses.
- Hidden target fact copying.
- Arbitrary Hackmons fallback.

## Exit Criteria

- Focused transitions match the pinned client within the declared boundary.
- Transfer occurs only from explicit protocol annotations.
- Direct Transform references resolve inside the emitted view.
- Illusion replacement never guesses hidden identities.

