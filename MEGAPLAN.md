# Pokemon Showdown Bot Megaplan

## Goal

Build a self-play reinforcement-learning bot for current Generation 9 Random Battles using the canonical Pokemon Showdown simulator and a PyTorch policy/value model.

## Architecture

Keep battle mechanics, translation, and decision-making separate:

```text
Pokemon Showdown
  <-> dumb raw simulator
        -> p1 raw protocol -> p1 translator -> p1 agent
        -> p2 raw protocol -> p2 translator -> p2 agent
        -> debug-only omniscient observer
```

The raw simulator accepts Showdown commands and emits complete, channel-tagged
player protocol. It does not parse requests, track Pokemon, determine legal
actions, calculate rewards, or know about models. Each translator receives
only one player's stream and produces a complete player-observable snapshot.
Omniscient state is never exposed through the normal simulator, translator, or
agent interfaces.

## Implementation Order

1. **Scaffold the repository - complete**
   - Add minimal TypeScript and Python tooling and local validations.

2. **Pin Pokemon Showdown - complete**
   - Pin an exact npm release and verify `gen9randombattle`.

3. **Run one seeded Gen 9 Random Battle - complete**
   - Run and reproduce a complete in-memory battle without a server.

4. **Save protocol fixtures - complete**
   - Capture deterministic p1, p2, and debug-only omniscient fixtures for
     ordinary battles, voluntary switching, Tera, Struggle, Revival Blessing,
     and terminal ties.

5. **Build the dumb raw simulator interface**
   - Define transport-neutral `start`, `choice`, and `close` inputs.
   - Emit channel-tagged p1/p2 chunks plus terminal and error messages.
   - Keep omniscient output behind a separate debug observer.
   - Refactor the seeded runner onto this interface without changing its
     normalized transcript or fixture output.
   - Reject invalid lifecycle operations such as choices before start or after
     termination.

6. **Define the translator interface**
   - Consume raw protocol for exactly one player.
   - Emit structured decisions and optional non-decision state updates.
   - Keep the interface independent of callbacks, JSONL, Python, and PyTorch.
   - Make fixture replay sufficient to test translation without running a
     battle.

7. **Finalize observation schema v1**
   - Define complete own-team information and only publicly revealed opponent
     information.
   - Represent Pokemon, moves, PP, six stats, boosts, status, items, abilities,
     Tera state, side conditions, weather, terrain, and field effects.
   - Represent unavailable knowledge explicitly as unknown.
   - Add machine-readable schemas for raw simulator and decision messages.
   - Leave damage calculations and opponent-set beliefs optional and absent.

8. **Implement the 14-action adapter**
   - Map indices 0-3 to move slots 1-4.
   - Map indices 4-7 to the same moves with Terastallization.
   - Map indices 8-13 to switch or Revival Blessing targets.
   - Derive legality exclusively from the current `|request|` payload.
   - Reject masked, stale, out-of-range, wrong-player, and wrong-battle
     responses.
   - Translate valid indices into raw Showdown commands.

9. **Implement perspective state tracking**
   - Maintain one isolated tracker per player stream.
   - Accumulate public protocol events and that player's private requests.
   - Maintain stable public Pokemon identities.
   - Produce a complete `PlayerObservation` snapshot at each decision.
   - Never reconstruct player state by subtracting fields from omniscient
     state.

10. **Build the battle coordinator**
    - Connect raw simulator chunks to translators and structured decisions to
      agents.
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
    - Run long-lived Node processes and surface malformed, stale, or failed
      messages explicitly.
    - Keep in-process agents available for fast tests and fixed baselines.

13. **Build evaluation infrastructure**
    - Implement fixed random and heuristic opponents.
    - Run paired evaluations by swapping the same generated teams between
      agents.
    - Report win rate, confidence intervals, battle length, decisions per
      second, and battles per second.

14. **Implement Python observation encoding**
    - Build stable vocabularies for species, moves, items, abilities, types,
      statuses, and effects, including reserved unknown values.
    - Convert Pokemon, side, field, action-candidate, and legal-mask data into
      tensors.

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

22. **Add advanced mechanics features**
    - Add damage ranges, accuracy-adjusted knockout probabilities, entry
      hazards, speed estimates, Random Battle set filtering, and opponent
      beliefs one feature at a time.
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
  -> observation schema
  -> action adapter
  -> perspective state tracker
  -> battle coordinator
  -> masked random validation
  -> JSONL transport
  -> Python encoder and policy
  -> trajectory collection and PPO
  -> checkpoint self-play
  -> evaluation and optimization
```
