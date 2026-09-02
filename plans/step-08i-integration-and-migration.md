# Step 8I: Golden Replay, Migration, and Integration Hardening

## Status

Planned; depends on Steps 8A-8H.

## Objective

Complete Step 8 by replaying all player goldens, hardening perspective and
chunking guarantees, and replacing the Step 6 request-only public translator.

See [`../step8megaplan.md`](../step8megaplan.md) for the complete design and
acceptance criteria.

## Planned Scope

- Replay every p1 and p2 golden independently.
- Add expected views at meaningful request boundaries.
- Verify malformed protocol, routing, perspective, and import boundaries.
- Verify whole-stream, one-line, and irregular chunk equivalence.
- Migrate callers and verification to `PlayerBattleTranslator`.
- Remove `PlayerProtocolTranslator` and obsolete request-only event names.
- Finalize `npm run verify:battle-translator`.
- Update directly related architecture documentation.

## Non-Goals

- Omniscient replay into a player translator.
- Action sets, masks, or command mapping.
- Coordinator, transport, schema, model, or training work.
- New test frameworks or dependencies.

## Exit Criteria

- One public per-player translator remains.
- Every decision, wait, and terminal-view event carries a complete view.
- Existing Step 6 behavior remains covered.
- No omniscient or opposing request data can enter a player view.
- All Step 8 acceptance criteria and validation commands pass.
