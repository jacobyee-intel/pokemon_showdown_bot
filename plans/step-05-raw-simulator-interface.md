# Step 5: Build the Dumb Raw Simulator Interface

## Objective

Introduce a single, message-based interface to one Pokemon Showdown battle:
`ShowdownBattleSession`. It accepts three raw lifecycle operations (`start`,
`choose`, `close`) and emits complete, channel-tagged raw protocol lines for
`p1` and `p2`, plus exactly one terminal message and any lifecycle error
messages. Every existing driver — the Step 3 seeded runner, the Step 4 golden
recorder, the scripted player, and the temporary `RandomPlayerAI` smoke drivers
— moves onto this one interface, with no second lifecycle implementation and no
observable behavior drift. The session is deliberately dumb: a pipe with a state
machine, not a game model.

## Scope

Define the output message contracts; implement `ShowdownBattleSession` as the
sole owner of the lifecycle and of all three underlying player streams; expose
outputs as one single-use `AsyncIterable`; add a separate debug-only omniscient
observer; refactor `battle-lifecycle.ts` into a thin harness over the session
with `runBattleLifecycle`, `runSeededBattle`, `SeededBattleResult`, and
`captureGolden` behaviorally and byte-for-byte unchanged; add one
dependency-free executable verification program.

## Explicit Non-Goals

The session must never parse `|request|` payloads, track any battle state
(Pokemon, HP, PP, boosts, items, abilities, Tera, side conditions, weather,
terrain), derive or validate legal actions, know about action indices or masks,
calculate rewards, interpret `|error|` lines, know about translators,
observations, schemas, Python, or JSONL, or expose omniscient protocol through
any normal output. The only protocol line it ever inspects is the terminal
`|win|`/`|tie` line on the omniscient channel. Out of scope for this step: the
translator contract (Step 6), observation schema (Step 7), action adapter (Step
8), state tracker (Step 9), coordinator (Step 10), JSONL transport (Step 12),
concurrent or multiplexed sessions, any test framework, new golden cases, new
formats, replacing `RandomPlayerAI`, performance tuning, timeouts, retries, and
reconnect logic.

## Output Contracts

New file `simulator/src/core/simulator-messages.ts`: types, string-literal unions,
and one error class. No I/O, no state, and no import from `showdown.ts` or
`pokemon-showdown`, so a translator can depend on it without pulling in the
simulator. It is the **single source of truth** for `BattleSide` and
`BattleWinner`; `battle-lifecycle.ts` re-exports both and nothing redeclares
them.

```typescript
export type BattleSide = "p1" | "p2";
export type BattleWinner = BattleSide | "tie";

export interface SimulatorOutputBase {
  battleId: string;
  /** Emission order: starts at 0, +1 per message, gapless, one domain. */
  seq: number;
}

export interface ChunkOutput extends SimulatorOutputBase {
  kind: "chunk";
  /** Channel tag. Structurally cannot be `"omniscient"`. */
  player: BattleSide;
  /**
   * Raw protocol lines of one Showdown chunk, in order, empty split segments
   * removed, byte-for-byte as emitted: no timestamp normalization, no
   * `|request|` reparsing, no trimming. Always non-empty — a Showdown chunk
   * that splits to zero protocol lines is suppressed entirely and consumes no
   * `seq`. Which lines land in which chunk is incidental; only per-channel
   * line order is contractual.
   */
  lines: readonly string[];
}

export type TerminalStatus = "ended" | "closed" | "faulted";

export interface TerminalOutput extends SimulatorOutputBase {
  kind: "terminal";
  status: TerminalStatus;
  /** Set only for `"ended"`; `null` for `"closed"` and `"faulted"`. */
  winner: BattleWinner | null;
}

export type SimulatorErrorCode =
  | "invalid-start"
  | "duplicate-start"
  | "choice-before-start"
  | "invalid-choice-syntax"
  | "simulator-fault";

export interface ErrorOutput extends SimulatorOutputBase {
  kind: "error";
  code: SimulatorErrorCode;
  /** Diagnostic only; never used for control flow. */
  message: string;
  /** Present only when the offending operation named a side. */
  player?: BattleSide;
}

export type SimulatorOutput = ChunkOutput | TerminalOutput | ErrorOutput;
export type SimulatorThrowCode = "input-after-end" | "outputs-already-consumed";

export class SimulatorLifecycleError extends Error {
  readonly code: SimulatorThrowCode;
  readonly battleId: string;
}
```

`battleId` is a constructor argument carried on every output so a caller holding
several sessions (and, later, a JSONL reader) can attribute messages. Callers
supply it deterministically (`"seeded-1"`, a golden `caseId`); the session never
generates one, since a generated id would be a non-deterministic input. There is
deliberately **no** input message union and no generic `submit`: the three typed
methods below are the input contract. Step 12 adds the wire envelope that maps
onto them; inventing it now would be scaffolding with no Step 5 consumer.

## `ShowdownBattleSession`

New file `simulator/src/core/battle-session.ts` — the only file in the project
allowed to construct `BattleStream` or `getPlayerStreams`.

```typescript
export type SessionState = "created" | "running" | "closing" | "ended" | "closed";

export interface PlayerStartSpec {
  /** The `name` in the `>player` spec; also the `|win|<name>` key. */
  name: string;
  /** Exactly one of `teamSeed` or `team` must be present. */
  teamSeed?: ShowdownPRNGSeed;
  team?: readonly ShowdownPokemonSet[];
}

export interface StartSpec {
  formatId: string;
  /** Battle-mechanics seed. Mandatory, including for forced-terminal cases. */
  seed: ShowdownPRNGSeed;
  p1: PlayerStartSpec;
  p2: PlayerStartSpec;
  /**
   * Raw omniscient commands written immediately after the `>start`/`>player`
   * block, one `write` each, in order (`>forcetie`, `>editbattle pp ...`).
   * Authoring/debug provenance carried by `start`, not a general command
   * channel: there is deliberately no separate command operation.
   */
  postStartCommands?: readonly string[];
}

export class ShowdownBattleSession {
  constructor(options: {
    battleId: string;
    /** Debug-only; normal callers omit this. */
    debug?: { omniscientObserver: DebugOmniscientObserver };
  });
  readonly battleId: string;
  get state(): SessionState;
  start(spec: StartSpec): void;
  choose(player: BattleSide, choice: string): void;
  close(): void;
  /** Single-use. A second call throws `outputs-already-consumed`. */
  outputs(): AsyncIterable<SimulatorOutput>;
}
```

Seeds stay as Showdown's `PRNGSeed` (a plain string type in the pinned release)
rather than the raw `SeedWords` tuple, so `run-seeded-battle.ts`,
`golden-recorder.ts`, and `verify-scripted-error.ts` keep their existing
`toShowdownSeed(...)` call sites unchanged — the least disruptive contract, and
still trivially serializable. `start` is explicit rather than
constructor-driven because construction must be side-effect free so `outputs()`
can be attached before any protocol exists, and because a constructor cannot
report `invalid-start` or `duplicate-start` through the output channel without
giving lifecycle errors two inconsistent delivery mechanisms. `player` and the
start spec are typed method arguments, so wrong-battle and wrong-player inputs
are unreachable in process and carry no error codes; Step 12 adds envelope
validation for those at the transport boundary, where they first become
reachable.

### State Machine

| State | `start(...)` | `choose(...)` | `close()` |
|---|---|---|---|
| `created` | validate, build streams, write start block → `running` | emit `choice-before-start` | emit `terminal{closed}`, finish iterable → `closed` |
| `running` | emit `duplicate-start`; nothing written to Showdown | write the raw choice to that side's stream | → `closing` synchronously, issue `writeEnd` |
| `closing` | throw `input-after-end` | throw `input-after-end` | no-op |
| `ended` | throw `input-after-end` | throw `input-after-end` | issue `writeEnd` → `closed` |
| `closed` | throw `input-after-end` | throw `input-after-end` | no-op |

`ended` is entered when all three reader loops finish while `running` — the only
transition driven by Showdown rather than by an input — and `closing` likewise
exits to `closed` when all three reader loops finish. Rules holding in every
state:

- An emitted `ErrorOutput` never changes state and never aborts the battle.
  `simulator-fault` is the sole error caused by the simulator rather than by an
  input, the sole error that precedes a terminal, and it always immediately
  precedes `terminal{status:"faulted"}`.
- A thrown `SimulatorLifecycleError` never changes state.
- Exactly one `TerminalOutput` is emitted per session and it is always the final
  message; the iterable finishes immediately after it.
- `close()` is idempotent from every state and always returns normally.

### Close Semantics

From `running`, `close()` sets `state = "closing"` **before** touching Showdown,
so once it returns, `choose` and `start` throw and no further input can reach the
battle stream. It then issues `omniscient.writeEnd()`, guarded by a single
`writeEndIssued` boolean so `writeEnd` executes **exactly once** regardless of
how many `close()` calls occur, and in every path that reaches `closed`.
`BattleStream._writeEnd` pushes EOF and destroys the `Battle`, releasing the
simulator's memory. The reader loops then drain; once all three are done,
`terminal{status:"closed", winner:null}` is emitted and the state becomes
`closed`.

From `created` there are no streams and no `Battle`, so `close()` skips
`writeEnd`, emits `terminal{closed}`, and goes straight to `closed`. From
`ended` the readers are finished and the terminal was already emitted, so
`close()` only issues the one-time `writeEnd` and becomes `closed`, emitting
nothing. A mid-battle close is a graceful shutdown, not a truncation: chunks
Showdown had already buffered are still delivered between `close()` and the
terminal. The guarantee is therefore **no chunk is emitted after the terminal
output**, not "no chunk after `close()` is invoked"; drivers must read until the
iterable finishes.

### Lifecycle Sequence on `start`

This must reproduce today's `runBattleLifecycle` byte for byte:

1. Validate the entire `StartSpec` **before constructing anything**, preserving
   today's fail-early `assertValidPlayerSpec` discipline. On failure, emit
   `invalid-start` naming the offending field and stay in `created`, with no
   `BattleStream` and no player streams built.
2. `createBattleStream()`, then `getShowdownPlayerStreams(...)`.
3. Start the `omniscient`, `p1`, and `p2` reader loops **before** writing.
4. Write the start block as **one single multi-line `write`**, exactly as today:
   `>start {...}` / `>player p1 {...}` / `>player p2 {...}`. Splitting it into
   three writes is forbidden: `BattleStream._write` calls `battle.sendUpdates()`
   once per write, so three writes would fire `sendUpdates` against a partially
   configured battle. Player spec JSON is built exactly as today's
   `buildPlayerSpecJson` — `{name, seed}` for a `teamSeed` player,
   `{name, team: packShowdownTeam([...spec.team])}` for an authored team, in
   that key order. `PlayerStartSpec.team` is `readonly` so callers cannot mutate
   it after `start`; the session therefore copies it into a fresh mutable array
   at the `packShowdownTeam` call rather than widening `showdown.ts`'s
   signature, which keeps the Showdown boundary untouched.
5. Write each `postStartCommands` entry as its own `write`, in order.
6. → `running`.

`invalid-start` covers: empty `formatId`; empty `seed`; either player's `name`
empty; a player specifying neither or both of `teamSeed` and `team`; a present
but empty `team`; a `postStartCommands` entry that does not start with `>` or
contains a newline. The `move` probability check for `RandomPlayerAI` moves to
`random-player-driver.ts` — it is a property of that temporary driver, not of
the simulator.

### Raw Choice Submission

A choice is written verbatim via `streams[player].write(choice)`.
`getPlayerStreams` already prefixes each written line with `>p1 `/`>p2 `, so the
choice is written bare, exactly as `scripted-player.ts` does today. One guard,
and only one: `invalid-choice-syntax` is emitted, and nothing is written, when
the choice is empty, contains `\n` or `\r`, or starts with `>`. This is a
command-injection guard, not a legality check: because every written line is
prefixed, a multi-line choice would inject arbitrary `>`-commands. Everything
else — an illegal move slot, a switch to a fainted Pokemon, a stale choice — is
written through unexamined, and Showdown answers with an `|error|` line
delivered as an ordinary `ChunkOutput` on that player's channel. That is **not**
an `ErrorOutput` and does not change state.

### The Fault Path

`BattleStream._write` catches command-processing exceptions and calls
`pushError(err, true)` on itself; the `getPlayerStreams` relay loop then throws,
its `.catch` calls `pushError(err, true)` on all six per-perspective streams,
and the relay loop is dead — those streams never reach EOF on their own. On a
reader-loop exception the session must record the first error, mark that channel
done, and **stop iterating that channel** (the stream is not at EOF and resuming
would block forever). When all three channels are done and either a channel
errored or the terminal line could not be interpreted, it emits
`simulator-fault`, then `terminal{status:"faulted", winner:null}`, then finishes
the iterable and enters `ended`.

Chunk delivery on this path is **best effort**, for a specific reason: the relay
loop terminates on its first error, so any protocol the `BattleStream` had
already emitted but that the relay had not yet extracted and routed is never
pushed to the per-side streams at all. (Items already buffered in a per-side
stream *are* still delivered — `pushError` appends to a separate error buffer
and `next()` drains pending values before surfacing it — but that only covers
what the relay had already routed.) The "no chunk after the terminal" and
gapless-`seq` guarantees still hold, while "nothing Showdown produced is
dropped" is scoped to non-faulted termination (`"ended"` and `"closed"`) only;
consumers must conservatively treat a faulted terminal as an incomplete
transcript regardless of how much of it arrived. The fault `ErrorOutput.message`
is sanitized to the error's `name` plus the first line of its `message`,
truncated to 200 characters: Showdown's command-processing errors quote the
offending caller-supplied `>`-command, but no chunk content, `|request|`
payload, or team data is ever copied into it.

### The One Sanctioned Parse

On the **omniscient** channel the session tests each line for `=== "|tie"` or
`startsWith("|win|")` to fill `TerminalOutput.winner`, mapping the `|win|<name>`
payload back to a side using the `name` fields from `StartSpec`. A name matching
neither side, or more than one terminal line, is a `simulator-fault`. Omniscient
is the right channel because the session must drain it anyway (an unread stream
buffers without bound) and the terminal must be detectable whether or not a
debug observer is attached. This one test is the entire extent of the session's
protocol knowledge: it does not count turns and never retains an omniscient
line. The unrecognized-name fault carries a fixed, content-free message: the
offending line and the name it holds are omniscient data and never cross into
an `ErrorOutput`.

## Output Consumption, Ordering, and Queueing

`outputs()` returns one single-use `AsyncIterable<SimulatorOutput>`. An
`AsyncIterable` expresses termination by finishing, which is exactly the
close/EOF semantics this step needs; callbacks are rejected because a handler
firing synchronously inside `choose` could re-enter the session while `choose`
is still on the stack. It is single-use because messages are **consumed**
(dequeued) — two consumers would each get a partial stream, the exact
single-consumer hazard the p1/p2 streams already taught us in Step 4. The
iterator returned by `outputs()` implements `return()`, so breaking out of a
`for await` over it calls `close()` and an abandoned loop cannot leak a live
`Battle`. This close-on-cancel behavior belongs to the session iterator alone;
the harness's per-side driver queues are separate objects whose iterators can be
cancelled without touching the session (see "Refactoring Strategy"). Fan-out to
several interested parties (a player driver plus a golden recorder) is the
harness's job: `battle-lifecycle.ts` owns the single `for await` and dispatches
per channel; no separate dispatcher module is added. Queueing is deliberately minimal: an
unbounded in-memory FIFO filled from construction, so attaching `outputs()` late
loses nothing. The session always drains all three underlying Showdown streams
as fast as they produce, so Showdown can never stall on an unread stream and a
slow consumer costs memory only, never a deadlock. No high-water mark,
pause/resume, coalescing, or dropping — one battle produces on the order of
thousands of lines, and real backpressure is a deferred transport concern.

Ordering guarantees, stated narrowly: `seq` starts at 0, increases by exactly 1
per message, and has no gaps; within one `player` channel protocol **lines** are
delivered in exactly the order Showdown produced them, while chunk grouping
carries no guarantee; interleaving **between** `p1` and `p2` is unspecified,
because three independent reader loops make it depend on microtask scheduling,
and every consumer is per-channel by construction so none needs it;
`TerminalOutput` has the highest `seq` and is emitted only after all three
channels are done, so for `"ended"` and `"closed"` every chunk Showdown produced
is delivered (for `"faulted"`, see above).

## Debug Omniscient Observer

New file `simulator/src/core/debug-omniscient-observer.ts`. The name is deliberately
loud so `rg -l omniscient simulator/src` reads as an audit.

```typescript
/** DEBUG-ONLY. Never reachable from `SimulatorOutput`. */
export interface DebugOmniscientObserver {
  onOmniscientLines(lines: readonly string[]): void;
}

/** Accumulates raw omniscient lines. Debug, goldens, and provenance only. */
export function createRecordingOmniscientObserver(): DebugOmniscientObserver & {
  readonly lines: readonly string[];
  readonly callCount: number;
};
```

The **primary** guarantee is the type design: `SimulatorOutput` has no
omniscient variant and `ChunkOutput.player` is `BattleSide`, which cannot be
`"omniscient"`, so no type exists through which an omniscient line could reach a
normal consumer. That is a compile-time property, not something a test can
meaningfully sample. At runtime the omniscient reader splits each chunk with
**exactly the same `splitProtocolChunk` semantics used for player chunks** —
same `\n` split, same dropping of empty segments — holds the resulting lines in
a local, calls `options.debug?.omniscientObserver.onOmniscientLines(lines)`
inline, and drops them. A chunk that splits to zero lines makes no callback at
all, mirroring the suppression rule for `ChunkOutput`. Lines are delivered raw:
`normalizeProtocolLine` stays at the recorder and `omniscientLog` call sites,
unchanged from today. The reader never stores omniscient lines on the session,
never enqueues them, and never copies them into an error message. With `debug`
absent the channel is still drained, and discarded apart from the terminal-line
test. The old `ObservedStream`
(`"p1" | "p2" | "omniscient"`) union is dropped entirely: the harness now has
two separately typed callbacks — `onLines(player: BattleSide, ...)` for normal
protocol and `onDebugLines(lines)` for omniscient — so no single channel-tagged
callback can carry both. Sanctioned debug consumers, and only these:
`battle-lifecycle.ts` (which owes Step 3 an `omniscientLog`), the golden
recorder's `omniscient.jsonl` writer, and the new verification program. This
restates `goldens/README.md`'s isolation rule at the type level; it does not
widen it.

## Refactoring Strategy

The rule is Step 4's: **exactly one lifecycle implementation.**
`battle-session.ts` becomes it; `battle-lifecycle.ts` becomes a harness.

**`battle-lifecycle.ts`** keeps every export it has today, with unchanged
`ShowdownPRNGSeed` types for `startSeed`, `teamSeed`, and `agentSeed`, so no
caller's seed plumbing changes; `BattleSide` and `BattleWinner` become
re-exports from `simulator-messages.ts`; `observeStreamPushes` is **deleted**;
`onChunk?: (stream, chunk: string)` becomes
`onLines?: (player: BattleSide, lines: readonly string[])`; and
`BattleLifecycleOptions` gains `battleId?: string` defaulting to `"battle"` plus
an explicit `onDebugLines?: (lines: readonly string[]) => void`.
`onDebugLines` is the harness's **only** omniscient path: `runBattleLifecycle`
wraps it in a `DebugOmniscientObserver` and passes it as the session's `debug`
option, so an omniscient line can only reach a caller that named the debug
option. `onLines` now takes a `BattleSide` rather than `ObservedStream`, which
makes it structurally impossible to route omniscient data through the normal
callback; `ObservedStream` is no longer needed and is dropped.

`runBattleLifecycle` always installs a recording omniscient observer of its own
(it owes Step 3 an `omniscientLog`) and fans that observer out to `onDebugLines`
when supplied. It then runs one deterministic sequence, described here as a
single state machine because every deadlock in this design comes from one of its
edges being missed:

1. **Create the two per-side queues and start both drivers, without awaiting.**
   Each queue carries `ChunkOutput` values only. Immediately at creation — not
   at await time — attach a handler to `p1Done` and `p2Done` that records the
   first driver rejection (in `[p1, p2]` order, keeping the original `Error`
   object untouched so `verify-scripted-error.ts`'s diagnostic text survives
   verbatim) and calls `session.close()`.
   This edge is what breaks the driver-rejection deadlock: a driver that throws
   — an illegal scripted choice, a rethrown `RandomPlayerAI` error — stops
   consuming its queue and stops answering requests, so the battle would
   otherwise wait forever. Closing on rejection forces EOF, EOF produces the
   terminal, the dispatch loop finishes, and its `finally` closes both queues
   so the surviving driver can finish. Attaching at creation time is also what
   keeps a late sibling rejection from surfacing as an unhandled rejection.
2. **Call `session.start(spec)`.** It is synchronous and the output queue
   buffers from construction, so no chunk produced by `start` can be missed by
   the loop entered next. An `invalid-start` therefore surfaces as an
   `ErrorOutput` in step 3 like any other input error, and follows the same
   close-and-drain path.
3. **Run the dispatch loop inside `try`/`finally`.** The `try` is one
   `for await` over `session.outputs()`:
   - `ChunkOutput` → `onLines(output.player, output.lines)`, then push onto that
     side's driver queue.
   - `ErrorOutput` → record the first one and call `session.close()`; then
     **keep draining until the terminal** instead of
     breaking out, so the remaining protocol still reaches the drivers and the
     recorder. This is a *harness* policy: the session itself still does not
     change state on an input-caused error (see "State Machine"), and a caller
     that tolerates such errors may keep its battle running. For
     `simulator-fault` the close is redundant, since the session emits its
     terminal immediately afterwards anyway.
   - `TerminalOutput` → **record it only.** A terminal value is never pushed
     into a driver queue: drivers see chunks and then EOF, and never a terminal
     message.

   The `finally` closes **both driver queues on every exit path** — normal
   completion, an exception thrown by `onLines`, or a rejection surfacing from
   `session.outputs()` itself. Queue closure must not hang off the terminal
   branch: if it did, a dispatch-loop rejection before the terminal would leave
   both queues open, both drivers unsettled, and the aggregate wait blocked
   forever, making a dispatch rejection unreachable by the error handling in
   step 4. Putting closure in `finally` is what makes `dispatchDone`'s rejection
   observable.
4. **Wait with `Promise.allSettled([p1Done, p2Done, dispatchDone])`**, then
   rethrow deterministically in this fixed order: the recorded driver rejection
   (p1 before p2), then a dispatch-loop rejection, then the recorded
   `ErrorOutput`, then a non-`"ended"` terminal status. `allSettled` is required
   rather than `Promise.all` so a second rejection arriving after the first
   cannot escape unhandled.
5. **`session.close()` in a `finally`.** It is idempotent, so this is safe
   whether the dispatch loop, a driver rejection handler, or nothing at all
   closed the session first.

Choices reach the session through a per-side `submitChoice` wrapper rather than
`session.choose` directly. The wrapper swallows a `SimulatorLifecycleError`
whose code is `input-after-end` **only** when the session itself is no longer
accepting choices — `session.state !== "running"`, which covers `closing`,
`ended`, and `closed` alike. In every other situation, and for every other
code, it rethrows; an emitted input error such as `invalid-choice-syntax` is
unaffected, because it is an `ErrorOutput` rather than a throw. Gating on the
session's own public state rather than on harness-observed progress matters:
the harness observes the terminal only after the dispatch loop has drained
every chunk queued ahead of it, so a session can already be `ended` while an
older queued request is still being forwarded to a driver, and a harness-local
flag would reject that driver's answer spuriously. It also still covers the
window between `session.close()` and the terminal, where a second error would
otherwise mask the original `ErrorOutput` or driver error the harness is about
to report.

It returns the same `{ winner, turns, omniscientLog }`: `winner` from the
terminal message, `turns` still the `|turn|` line count, `omniscientLog` still
the per-line-normalized omniscient lines. `parseTerminal` shrinks to the turn
count plus the "exactly one terminal line" assertion; winner-name mapping moves
into the session.

**`scripted-player.ts`** is rewritten to consume this side's chunks instead of a
Showdown stream, and no longer imports `showdown.ts`:
`runScriptedPlayer(chunks: AsyncIterable<ChunkOutput>, submitChoice: (choice:
string) => void, options: ScriptedPlayerOptions): Promise<void>`. Typing the
input as `ChunkOutput` — not `SimulatorOutput` — is what enforces the queue
contract: a driver can never be handed a terminal or error message, and its loop
ends only on EOF. Behavior is preserved exactly: `|error|` on this side is still
fatal and still throws with the identical message text; `"wait":true` lines are
still skipped; only `|request|` lines consume a choice; the exhausted-choices
and unused-choices errors keep their exact texts; `allowUnansweredRequests`
keeps its exact meaning and its `gen9customgame` Team Preview comment; choices
are still submitted bare. `verify-scripted-error.ts` must pass **unmodified**,
which is what pins those message texts.

**`random-player-driver.ts`** (new) isolates the one bridge the foreign
`RandomPlayerAI` requires, rather than letting it keep a real player stream:
`runRandomPlayer(chunks: AsyncIterable<ChunkOutput>, submitChoice, spec: {
agentSeed: ShowdownPRNGSeed; move?: number }): Promise<void>`. It creates the
bridge via a new `showdown.ts` export
`createPlayerBridgeStream(onWrite: (text: string) => void)` (a
`new Streams.ObjectReadWriteStream<string>({ write })`), and the order of the
next three steps is load-bearing:

1. Construct the AI and call `.start()` **first**, keeping the returned promise
   without awaiting it. `RandomPlayerAI.start()` is a `for await` over the
   bridge; it must already be consuming before chunks are pumped in, or a
   pump-then-start ordering would deadlock any battle whose first request
   arrives before the AI is listening.
2. Immediately at that promise's creation, attach a rejection handler to
   `aiDone` that: records the AI error; calls `return()` on **the per-driver
   `ChunkOutput` iterator** to cancel the pump; calls `bridge.pushEnd()` (guarded
   by a `pushEndIssued` boolean so it runs at most once across both paths);
   observes `pumpDone` with a no-op `catch` so its own settlement can never
   become an unhandled rejection; and settles `runRandomPlayer` promptly by
   rejecting with the original AI error. The driver must **not** sit waiting for
   `pumpDone` after the AI has already failed: a failed AI stops consuming the
   bridge, so a pump still blocked on the next chunk could keep the driver
   pending indefinitely. Cancelling the pump is what makes the failure prompt,
   and rejecting with the recorded AI error is what preserves AI-before-pump
   error precedence without any `allSettled` inside this driver.
3. Run the pump concurrently. It takes the iterator explicitly
   (`chunks[Symbol.asyncIterator]()`) rather than relying on `for await` sugar,
   so step 2's handler has a concrete object to `return()`; for each
   `ChunkOutput` it pushes `lines.join("\n")` into the bridge. **Normal path:**
   the harness closes the queue after the terminal, the chunk iterable reaches
   EOF, the pump calls `bridge.pushEnd()` (same one-shot guard), the AI's
   `for await` ends, and `aiDone` and `pumpDone` both settle —
   `runRandomPlayer` resolves once both have. `pushEnd` is always driven by
   iterable completion or by AI failure, never by a terminal message, since
   drivers never receive one.

Cancellation ownership is strictly per driver: the iterator `return()`ed in
step 2 is the harness's **local per-side queue iterator**, never
`session.outputs()`. Only the harness's single dispatch loop holds the session
iterator, and only that iterator's `return()` closes the session; a driver
cancelling its own input therefore tears down exactly one bridge and cannot end
the battle or disturb the other side. The session is closed on this path only
indirectly, by the harness's driver-rejection handler in step 1 of the sequence
above.

The `move` probability validation moves here. `RandomPlayerAI` sees identical
`|request|` lines in identical order and draws from the same seeded PRNG, so its
decisions are unchanged; re-joining is safe because it splits on `\n` and
ignores any line not starting with `|`.

**`golden-recorder.ts`** changes in three places. `toLifecycleOptions` gains a
second observer parameter and becomes
`toLifecycleOptions(caseSpec, onLines?: (player: BattleSide, lines: readonly
string[]) => void, onDebugLines?: (lines: readonly string[]) => void):
BattleLifecycleOptions`, setting `battleId: caseSpec.caseId` and forwarding both
observers. `captureGolden` supplies
`(player, lines) => { for (const line of lines) captured[player].push(normalizeProtocolLine(line)); }`
for p1/p2 — dropping the now-redundant `splitProtocolChunk` call — and
`(lines) => { for (const line of lines) captured.omniscient.push(normalizeProtocolLine(line)); }`
for `onDebugLines`, which is what produces `omniscient.jsonl`. That file's
content is therefore explicitly opted into at one named call site, and the
normal `SimulatorOutput` path remains structurally incapable of carrying
omniscient data. `buildMeta`'s key order, `serializeLines`, the file list and
write order, and the propagate-don't-write-partials rule are untouched.
**`showdown.ts`** gains only `createPlayerBridgeStream`; the temporary internal
`random-player-ai` import stays where it is and is not widened.
**`protocol.ts`** is unchanged: the session emits raw, unnormalized lines and
`normalizeProtocolLine` keeps being applied by exactly the consumers that apply
it today, so all recorded bytes are unchanged. The session deliberately does not
normalize — `|t:|` rewriting is a determinism policy, not raw protocol.

The `push`-tee is retired rather than ported. Today the recorder wraps each
stream's `push`, because p1/p2 are single-consumer and a second `for await`
would steal a side's private `|request|` chunks; that constraint is now
structural, since the session is the only reader of `p1`, `p2`, and `omniscient`
and never exposes them. The recorder subscribes to the harness's
already-dispatched p1/p2 `ChunkOutput`s — the same lines in the same per-channel
order — while omniscient lines reach `omniscient.jsonl` only through the
explicit debug observer, so the two paths have disjoint types and capture cannot
leak omniscient data into a p1/p2 file. Nothing is captured before `start`
because nothing exists before `start`, and nothing is missed after it because
the queue buffers from construction.

## Files

```text
simulator/src/
├── core/
│   ├── simulator-messages.ts        # NEW: output contracts, error class
│   ├── battle-session.ts            # NEW: ShowdownBattleSession
│   ├── debug-omniscient-observer.ts # NEW: debug-only omniscient sink
│   └── showdown.ts                  # MODIFIED: + player bridge stream
├── drivers/
│   ├── random-player-driver.ts      # NEW: temporary RandomPlayerAI bridge
│   ├── battle-lifecycle.ts          # MODIFIED: harness over the session
│   └── scripted-player.ts           # MODIFIED: consumes SimulatorOutput
├── goldens/
│   └── golden-recorder.ts          # MODIFIED: player/debug capture callbacks
└── verification/
    └── verify-battle-session.ts     # NEW: executable verification program
```

Unchanged: `run-seeded-battle.ts`, `protocol.ts`, `seed.ts`, `golden-cases.ts`,
`golden-paths.ts`, `capture-goldens.ts`, `verify-goldens.ts`,
`verify-seeded-battle.ts`, `verify-scripted-error.ts`, `verify-showdown.ts`,
`showdown-internal.d.ts`, `main.ts`. Also modified: `package.json` (the script
below), `README.md` (a short "Raw Simulator Interface" section linking this
plan), `MEGAPLAN.md` (mark Step 5 complete). The simulator files are grouped
by responsibility without adding a dependency or changing `goldens/` or
`schemas/`.

```json
{
  "scripts": {
    "verify:battle-session": "npm run build && node simulator/dist/verification/verify-battle-session.js"
  }
}
```

## Verification

### New: `npm run verify:battle-session`

`simulator/src/verification/verify-battle-session.ts`, in the established style: a local
`assert`, `process.exitCode = 1` at startup set to `0` only after every awaited
assertion completes, one success line, no test framework, no new dependency.
Sub-cases use fixed literal seeds and the one-move authored `gen9customgame`
teams `verify-scripted-error.ts` already uses, so each is deterministic and
short; reuse that file's settle-timeout helper so a hang fails loudly.

Because an input-caused `ErrorOutput` deliberately does **not** terminate the
session, every sub-case must reach a terminal before asserting, by one of two
routes: keep driving the battle to its natural terminal (correct for cases whose
whole point is that the battle continues normally, such as `duplicate-start` and
`invalid-choice-syntax`), or explicitly `close()` and drain `outputs()` to the
terminal (required whenever no further protocol will arrive). The second route
is mandatory for `invalid-start`, where no battle exists, and for any case that
sends a syntactically valid but Showdown-rejected raw choice: Showdown answers
with an `|error|` line and issues **no** new `|request|`, so the battle can
never progress on its own and only an explicit close reaches EOF. A sub-case
that asserts on a partially drained iterable would hang, and the settle timeout
would report it as a failure. One assertion per distinct guarantee:

1. **States.** `created` on construction, `running` after `start`, `ended` after
   a full battle, `closed` after the following `close()`.
2. **Close.** `close()` from `created` yields `closed` with exactly one
   `terminal{status:"closed", winner:null}`. `close()` while `running` yields
   `closing` synchronously and the iterable finishes with exactly one such
   terminal and nothing after it (buffered chunks arriving between `close()` and
   the terminal are permitted). Three `close()` calls — one mid-battle, two
   after — never throw and produce exactly one terminal message.
3. **Input rejection.** `choose` before `start` emits `choice-before-start` and
   leaves `state === "created"`, and a later `start` still succeeds; a second
   `start` emits `duplicate-start` and the battle still runs to a normal
   terminal, proving nothing was written to Showdown; `choose` after the
   terminal and after `close()` both throw `input-after-end`; a second
   `outputs()` call throws `outputs-already-consumed`.
4. **Input validation.** A choice containing `\n` and a choice starting with `>`
   each emit `invalid-choice-syntax` and the battle still completes normally to
   a `terminal{status:"ended"}`; a spec with both `teamSeed` and `team`, and one
   with an empty `team`, each emit `invalid-start` and leave
   `state === "created"`, after which `close()` yields exactly one
   `terminal{status:"closed"}` and finishes the iterable — confirming that an
   input error leaves the session usable and closable rather than wedged.
5. **Rejected choice is not an error.** `"move 3"` for a one-move Pokemon
   arrives as a `ChunkOutput` on `p1` whose lines include
   `|error|[Invalid choice]`, produces no `ErrorOutput`, and leaves
   `state === "running"`. Showdown sends no replacement `|request|` after an
   invalid choice, so this case must then `close()` and drain to the terminal
   rather than waiting for protocol that will never come.
6. **Fault path.** `postStartCommands: [">nonsense"]` produces `simulator-fault`
   immediately followed by `terminal{status:"faulted"}`, the iterable finishes,
   and the program does not hang; chunk content before the fault is not
   asserted. (If the pinned release routes this differently than the source
   reading predicts, substitute a `>player` spec Showdown rejects and record the
   observed path in a comment; do not weaken the must-not-hang assertion.)
7. **Ordering and EOF.** Over a full battle: `seq` starts at 0 and is gapless;
   every `ChunkOutput` has `player` in `{"p1","p2"}` and non-empty `lines`;
   there is exactly one terminal message; it has the maximum `seq`; the iterable
   finished after it.
8. **Perspective isolation.** Every `|request|` line delivered to `p1` contains
   `"id":"p1"` and none contains `"id":"p2"`, and the p1 and p2 `|request|` line
   sets are disjoint.
9. **Debug separation.** With a recording observer constructed but **not**
   passed as `debug`, its `callCount` is 0 after a full battle. With it passed,
   it receives the terminal `|win|`/`|tie` line, while `p1` receives at least
   one `|request|` line that appears nowhere in the omniscient log — the
   player-private direction, which `getPlayerStreams` guarantees by never
   routing `sideupdate` data to omniscient. Both runs' p1 line sequences are
   identical, proving the observer does not perturb normal output.
10. **Instance isolation.** Two sessions in one process each keep their own
    `battleId` and their own `seq` sequence starting at 0.
11. **Late-choice race.** A `>forcetie` battle whose Team Preview request is
    **answered** — the request is queued before the forced terminal, so the
    driver's answer arrives after the session has already reached `ended` —
    makes `runBattleLifecycle` resolve with a tie rather than reject. The
    companion half of the same sub-case proves the swallow stayed narrow: a
    scripted choice containing `\n` still makes the lifecycle reject with
    `invalid-choice-syntax`.
12. **Unrecognized winner name does not leak.** A `>forcewin` battle whose
    winning side's configured name contains a newline emits a `|win|` line
    matching neither name. The resulting `simulator-fault` must reach the
    normal output carrying none of that name, no `|` protocol content, and no
    more than the sanitized-message length bound, while the raw line still
    reaches the debug observer.

### Regression

`npm run typecheck`, `npm run build`, `npm run verify:showdown`, and
`.venv/bin/python -m pytest` must pass unchanged. `npm run verify:seeded-battle`
must still reproduce master seed 1 identically across two runs **and** produce
the same winner, turn count, and timestamp-normalized transcript as before the
refactor. This pre/post comparison is a **mandatory hard gate**, not a
formality: this step changes the async interleaving between Showdown and both
drivers (queues and a bridge stream now sit between them), and a
byte-for-byte-identical transcript is the only evidence that the interleaving
change did not alter battle mechanics. Capture the winner, turn count, and full
normalized transcript from a pre-refactor run into a scratch file under
`artifacts/`, diff it against a post-refactor run, and treat any difference as a
blocking failure rather than an expected consequence of refactoring.
`npm run verify:scripted-error` must pass with the file untouched, proving the
scripted player's `|error|` → rejected-promise conversion and its exact
diagnostic text survived.

`npm run goldens:verify`, run twice in immediate succession, must report all
six cases and 24 files byte-identical against the checked-in `goldens/` tree.
This is the strongest single regression check in this step: it covers
per-channel line ordering, `|request|` preservation, `>forcetie`/`>editbattle`
handling, and omniscient/p1/p2 separation across both formats.
`npm run goldens:capture` is **not** run — if it were needed, the refactor has
drifted.

## Transport, Concurrency, and the Step 6 Boundary

Transport and concurrency are deferred and need no scaffolding now: the output
messages are plain data with no functions or class instances, so they are
transport-neutral as written, and all session state (`seq`, the queue, the state
machine, the streams) is instance-local with no module-level mutable state in
`battle-session.ts`, so several sessions already coexist in one process.

Step 6 depends on this step through exactly two things. First,
`simulator-messages.ts`: a translator imports `SimulatorOutput`, `ChunkOutput`,
`BattleSide`, and `TerminalOutput`, and nothing from `battle-session.ts`,
`battle-lifecycle.ts`, or `showdown.ts`, and never imports
`debug-omniscient-observer.ts`. Second, golden replay: for a given case, the
`lines` of every `ChunkOutput` with `player === "p1"`, concatenated in order and
passed through `normalizeProtocolLine`, equal
`goldens/<formatId>/<caseId>/p1.jsonl` line for line. Guaranteed by
`goldens:verify` passing after the refactor, this makes golden replay a
sufficient test harness for translation without running a battle. A translator
therefore consumes exactly one player's raw stream, never both, never omniscient
data, and can be developed with no live simulator at all.

## Completion Criteria

1. `ShowdownBattleSession` is the only place in the project that constructs
   `BattleStream` or `getPlayerStreams`; `observeStreamPushes` and every `push`
   monkey-patch are gone.
2. `simulator-messages.ts` defines the `chunk`/`terminal`/`error` outputs with
   `battleId`, gapless per-session `seq`, and lifecycle status; is the single
   source of truth for `BattleSide`/`BattleWinner`; and has no omniscient
   variant. Omniscient protocol is reachable only through the session
   constructor's `debug` option.
3. The state machine behaves exactly as the table specifies, including the
   synchronous `closing` transition, idempotent `close()`, `writeEnd` issued
   exactly once, input errors that never change state, and exactly one terminal
   message as the final output.
4. `npm run verify:battle-session` passes all twelve assertions and exits `0`, and
   every regression command listed above passes — in particular
   `verify:seeded-battle` with an unchanged transcript, `verify:scripted-error`
   with its file unmodified, and `goldens:verify` reporting all six cases and
   24 files byte-identical twice in a row without `goldens:capture` being run.
5. All `pokemon-showdown` imports, including the temporary internal
   `random-player-ai` path, remain confined to `simulator/src/core/showdown.ts` and
   that exception is not widened; no new dependency and no test framework was
   added.
6. `README.md` documents the raw simulator interface and the new command, and
   `MEGAPLAN.md` marks Step 5 complete.
7. `git status --porcelain` shows only this step's files plus the pre-existing
   uncommitted `PLAN.md` → `MEGAPLAN.md` rename and its documentation updates,
   which must be preserved exactly as they are.
