# Step 8D: Ordinary Active Transitions and Emitted Views

## Status

Planned; depends on Steps 8A-8C.

## Objective

Reduce ordinary active-slot transitions and emit complete replacement views
with decisions, waits, and terminal-view events.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design.

## Pinned Reference

- [Official switch, drag, swap, faint, and replacement dispatch](https://github.com/smogon/pokemon-showdown-client/blob/951cc1580bfbb190bb263b285ad9748894659f10/play.pokemonshowdown.com/src/battle.ts)

## Planned Scope

- Reduce ordinary `switch`, `drag`, `swap`, and `faint`.
- Clear ordinary temporary state without touching permanent facts.
- Reduce `detailschange` and temporary forme changes.
- Build active-slot references.
- Preserve Step 6 decision IDs, request kinds, payloads, and routing errors.
- Emit complete views for decisions, waits, `win`, and `tie`.

## Non-Goals

- Baton Pass or Shed Tail transfer.
- Transform or Illusion replacement.
- Full Pokemon effect reduction.
- Coordinator or action handling.

## Exit Criteria

- Repeated switches reuse stable identities.
- Fainting does not speculatively remove an active occupant.
- Each request snapshots all earlier protocol lines exactly once.
- Output is independent of chunk boundaries and `seq`.

