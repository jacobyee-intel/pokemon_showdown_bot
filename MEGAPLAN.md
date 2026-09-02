# Pokemon Showdown Bot Megaplan

## Goal

Build a self-play reinforcement-learning bot for current Generation 9 Random Battles using the canonical Pokemon Showdown simulator and a PyTorch policy/value model.

## Architecture

Keep battle mechanics, translation, and decision-making separate:

```text
Pokemon Showdown
  <-> dumb raw simulator
        -> p1 raw protocol -> p1 battle translator -> p1 PlayerBattleView
        -> p2 raw protocol -> p2 battle translator -> p2 PlayerBattleView
        -> debug-only omniscient observer

exact current request
  -> action adapter -> ActionSet + legal 14-action mask -> agent
  -> selected action -> action adapter -> raw Showdown choice

Later: PlayerBattleView + ActionSet/legal mask
  -> static Dex augmentation + Python encoder -> model tensors
```

The raw simulator accepts Showdown commands and emits complete, channel-tagged
player protocol. It does not parse requests, track Pokemon, determine legal
actions, calculate rewards, or know about models. Each stateful battle
translator receives only one player's stream and produces a model-independent,
structured snapshot containing only facts directly established by that
player's public protocol or private request. It is a parser/reducer, not a
mechanics engine or enrichment layer. The action adapter derives candidate
identity, legality, and commands from the exact current private request without
aligning action slots to view move order. Static Dex augmentation and Python
encoding are later representation steps. Omniscient state is never exposed
through the normal simulator, translator, action, or agent interfaces.

## Implementation Order

1. **Scaffold the repository - complete**
   - Add minimal TypeScript and Python tooling and local validations.

2. **Pin Pokemon Showdown - complete**
   - Pin an exact npm release and verify `gen9randombattle`.

3. **Run one seeded Gen 9 Random Battle - complete**
   - Run and reproduce a complete in-memory battle without a server.

4. **Save protocol goldens - complete**
   - Capture deterministic p1, p2, and debug-only omniscient goldens for
     ordinary battles, voluntary switching, Tera, Struggle, Revival Blessing,
     and terminal ties.

5. **Build the dumb raw simulator interface - complete**
   - Define transport-neutral `start`, `choice`, and `close` inputs.
   - Emit channel-tagged p1/p2 chunks plus terminal and error messages.
   - Keep omniscient output behind a separate debug observer.
   - Refactor the seeded runner onto this interface without changing its
     normalized transcript or golden output.
   - Reject invalid lifecycle operations such as choices before start or after
     termination.

6. **Define the translator interface - complete**
   - Consume raw protocol for exactly one player.
   - Classify Team Preview, move, forced switch, Revival Blessing, and wait
     requests while preserving their parsed payloads.
   - Allocate monotonic per-player decision IDs only for non-wait requests.
   - Reject malformed, unsupported, and wrong-perspective input explicitly.
   - Verify chunk/sequence independence and replay each p1/p2 golden
     separately without omniscient input.
   - Keep the interface independent of callbacks, JSONL, Python, and PyTorch.

7. **Define `PlayerBattleView` v1 TypeScript contracts - complete**
   - Put the public immutable, model-independent one-player snapshot contract
     under `simulator/src/view/`.
   - Represent only facts directly established by that player's public
     protocol or private request, with explicit unknown and known-absence
     states.
   - Keep static Dex data, mechanics calculations, inferred facts, requests,
     action candidates, masks, commands, serialization, and tensors outside
     the view.
   - Verify contract examples with existing TypeScript tooling; parsing and
     golden replay remain Step 8 work.

8. **Build the per-player battle translator**
   - Evolve the Step 6 request translator into the single public, stateful
     `PlayerBattleTranslator` for one battle and one side.
   - Process every player protocol line once and in order.
   - Reduce state-changing player protocol with behavior compatible with the
     official Pokemon Showdown client while excluding its UI state, Dex
     enrichment, and mechanics-derived calculations. This includes ordinary
     switches and drags clearing temporary state, Baton Pass transferring
     boosts and permitted volatiles, Shed Tail transferring Substitute only,
     `replace` reconciling Illusion identity while preserving visible active
     state, and protocol-defined updates to abilities, formes, Transform, and
     layered conditions. Treat protocol annotations such as
     `[from] move: Baton Pass` as transition inputs rather than independently
     inferring mechanics.
   - Pin the reference client revision and verify ordinary switch, Baton Pass,
     Shed Tail, drag, and Illusion replacement with focused protocol fixtures.
   - Keep request parsing, protocol reduction, and view building as
     focused internal modules behind that public object.
   - Record only explicit facts from public events and that player's private
     requests; do no Dex lookup, mechanics calculation, or enrichment.
   - Maintain stable perspective-local Pokemon identities.
   - Emit a complete replacement `PlayerBattleView` at each decision and wait,
     with wait requesting no action.
   - Never reconstruct player state by subtracting fields from omniscient
     state.

9. **Implement the 14-action adapter**
   - Map indices 0-3 to move slots 1-4.
   - Map indices 4-7 to the same moves with Terastallization.
   - Map indices 8-13 to switch or Revival Blessing targets.
   - Derive a fixed 14-entry `ActionSet`/candidate list, legal mask, and raw
     command mapping exclusively from the exact current `|request|` payload.
   - Keep candidate slot identity, move/target IDs, legality, and command
     mapping separate from `PlayerBattleView`; view move order does not align
     with action indices.
   - Reject masked, stale, out-of-range, wrong-player, and wrong-battle
     responses.
   - Translate valid indices into raw Showdown commands.

10. **Build the battle coordinator**
    - Own one raw battle session and one isolated `PlayerBattleTranslator` per
      side.
    - Coordinate the session, translators, action adapter, and agents.
    - Combine each decision view with the exact request-derived `ActionSet` and
      legal mask, then send that decision input to the correct agent.
    - Submit translated raw commands back to the correct battle session.
    - Support simultaneous decisions without revealing either selected action
      to the opposing agent.
    - Emit terminal outcomes and rewards separately from player observations.

11. **Complete 1,000 masked random battles**
    - Replace temporary Showdown `RandomPlayerAI` use in the main validation
      path with an agent that samples only from the 14-action legal mask.
    - Require zero invalid choices, stale responses, crashes, hangs, and
      hidden-information leaks.
    - Verify fixed-seed reproducibility and test Illusion-sensitive visibility.

12. **Add JSONL transport**
    - Implement JSONL as a transport for the existing simulator and agent
      messages without changing their contracts.
    - Add versioned machine-readable schemas for stable semantic views,
      action sets, legal masks, agent actions, terminals, and transport errors.
    - Run long-lived Node processes and surface malformed, stale, or failed
      messages explicitly.
    - Keep in-process agents available for fast tests and fixed baselines.

13. **Build evaluation infrastructure**
    - Implement fixed random and heuristic opponents.
    - Run paired evaluations by swapping the same generated teams between
      agents.
    - Report win rate, confidence intervals, battle length, decisions per
      second, and battles per second.

14. **Implement static Dex augmentation and Python encoding**
    - Consume `PlayerBattleView` plus `ActionSet` and legal mask.
    - Add static base species types/stats and move
      type/power/accuracy/priority outside the semantic view.
    - Build stable vocabularies for species, moves, items, abilities, types,
      statuses, and effects, including reserved unknown values.
    - Apply vocab IDs, scaling, padding, and tensor layouts without changing
      the Node-side semantic contract.

15. **Implement the initial policy/value model**
    - Use a shared per-Pokemon encoder with team pooling as the first model.
    - Produce 14 candidate scores and one expected-outcome value.
    - Keep capacity small enough for efficient batched inference on an RTX
      3050.

16. **Run complete battles with the untrained model**
    - Verify Node/Python transport, tensor encoding, masked sampling, command
      translation, and terminal handling.
    - Ensure wait requests do not create decisions or rollout transitions.

17. **Implement trajectory collection**
    - Store observations, masks, actions, old log probabilities, value
      estimates, rewards, terminal flags, and policy versions in CPU memory.
    - Train the actor only from decisions generated by the current policy.

18. **Implement and test PPO**
    - Add generalized advantage estimation, clipped policy loss, value loss,
      entropy regularization, checkpointing, and resume support.
    - Begin with terminal rewards: `+1` win, `-1` loss, and `0` draw.

19. **Train against fixed baselines**
    - First beat the random agent, then require statistically significant
      improvement against the heuristic agent.

20. **Add historical-checkpoint self-play**
    - Maintain current, historical, random, and heuristic opponents.
    - Define checkpoint cadence, matchmaking weights, and promotion criteria.
    - Evaluate against a frozen pool to detect forgetting and strategy cycles.

21. **Run model ablations**
    - Compare a flattened MLP, pooled Pokemon encoder, and small Transformer
      under equal environment-decision and wall-clock budgets.

22. **Add derived mechanics augmentation**
    - Add damage ranges, knockout probabilities, speed estimates, hazard
      consequences, Random Battle set filtering, and opponent beliefs one
      feature at a time.
    - Measure every addition through ablation.

23. **Profile and optimize**
    - Batch GPU inference, increase concurrent battles per Node process, and
      scale simulation across CPU cores.
    - Remove unnecessary serialization or protocol work only after profiling.
    - Consider Showdown's direct `Battle` API and remote CPU actors only when
      measured bottlenecks justify them.

## First Trainable-System Boundary

Steps 1-12 produce a tested raw simulator, perspective-safe translator,
fixed action interface, masked agent loop, and Python-ready transport. This is
the stable environment boundary on which model and training work begins.

## Core Dependency Path

```text
raw simulator interface
  -> translator contract
  -> PlayerBattleView contract
  -> per-player battle translator
  -> action adapter
  -> battle coordinator
  -> masked random validation
  -> JSONL transport
  -> Python encoder and policy
  -> trajectory collection and PPO
  -> checkpoint self-play
  -> evaluation and optimization
```
