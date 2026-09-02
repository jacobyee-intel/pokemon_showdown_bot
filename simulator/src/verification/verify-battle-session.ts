/**
 * Executable verification program for Step 5: the raw simulator interface.
 *
 * Every sub-case uses fixed literal seeds and one-move authored
 * `gen9customgame` teams, so each is deterministic and short. Because an
 * input-caused `ErrorOutput` deliberately does not terminate the session,
 * every sub-case reaches a terminal either by driving the battle to its
 * natural end or by explicitly closing and draining to the terminal. A
 * sub-case that asserted on a partially drained iterable would hang, and the
 * settle timeout reports that as a failure.
 *
 * No test framework and no new dependency: a local `assert`,
 * `process.exitCode = 1` at startup set to `0` only after every awaited
 * assertion completes, and one success line.
 */
import { ShowdownBattleSession, type StartSpec } from "../core/battle-session";
import { runBattleLifecycle } from "../drivers/battle-lifecycle";
import {
  createRecordingOmniscientObserver,
  type RecordingOmniscientObserver,
} from "../core/debug-omniscient-observer";
import { toShowdownSeed, type ShowdownPokemonSet } from "../core/showdown";
import {
  SimulatorLifecycleError,
  type BattleSide,
  type ChunkOutput,
  type ErrorOutput,
  type SimulatorOutput,
  type TerminalOutput,
} from "../core/simulator-messages";

/** Milliseconds to wait before declaring a sub-case unsettled. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Mirrors the session's own bound on a `simulator-fault` message. Duplicated
 * rather than exported: the bound is an internal detail of `battle-session.ts`
 * and this is an upper bound assertion, not a contract the session advertises.
 */
const FAULT_MESSAGE_MAX_LENGTH = 200;

/** Fixed literal seeds: no derivation, no wall-clock, no process state. */
const BATTLE_SEED = toShowdownSeed([0x1234, 0x5678, 0x9abc, 0xdef0]);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Reads a session's state as a plain `string`, so an assertion on it never
 * narrows the getter for later reads in the same function.
 */
function stateOf(session: ShowdownBattleSession): string {
  return session.state;
}

function soloTeam(
  name: string,
  species: string,
  ability: string,
  move: string
): ShowdownPokemonSet[] {
  return [
    {
      name,
      species,
      item: "",
      ability,
      moves: [move],
      nature: "Hardy",
      gender: "M",
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
    },
  ];
}

/** A short, decisive `gen9customgame`: Charizard flattens Magikarp. */
function startSpec(): StartSpec {
  return {
    formatId: "gen9customgame",
    seed: BATTLE_SEED,
    p1: { name: "p1", team: soloTeam("Striker", "Charizard", "Blaze", "Flamethrower") },
    p2: { name: "p2", team: soloTeam("Target", "Magikarp", "Swift Swim", "Splash") },
  };
}

async function withinTimeout<T>(label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}: never settled within ${SETTLE_TIMEOUT_MS}ms`));
    }, SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface DriveOptions {
  /**
   * Answers one non-`wait` `|request|` line. Returning `null` leaves that
   * request unanswered. Defaults to always answering `"default"`.
   */
  responder?: (player: BattleSide, requestIndex: number) => string | null;
  /** Observes every output; may call session methods. */
  onOutput?: (output: SimulatorOutput) => void;
}

/**
 * Drains `session.outputs()` to completion, answering requests along the way.
 * A driver that never receives a terminal would hang here, which is exactly
 * what the settle timeout is for.
 */
async function drive(
  session: ShowdownBattleSession,
  options: DriveOptions = {}
): Promise<SimulatorOutput[]> {
  const responder = options.responder ?? ((): string => "default");
  const requestCount: Record<BattleSide, number> = { p1: 0, p2: 0 };
  const outputs: SimulatorOutput[] = [];

  for await (const output of session.outputs()) {
    outputs.push(output);
    options.onOutput?.(output);
    if (output.kind !== "chunk") continue;
    for (const line of output.lines) {
      if (!line.startsWith("|request|")) continue;
      if (line.includes('"wait":true')) continue;
      const choice = responder(output.player, requestCount[output.player]++);
      if (choice === null) continue;
      try {
        session.choose(output.player, choice);
      } catch (error) {
        // The battle may already be closing; that is not what this driver
        // asserts on.
        if (error instanceof SimulatorLifecycleError && error.code === "input-after-end") continue;
        throw error;
      }
    }
  }
  return outputs;
}

function chunksOf(outputs: readonly SimulatorOutput[]): ChunkOutput[] {
  return outputs.filter((output): output is ChunkOutput => output.kind === "chunk");
}

function errorsOf(outputs: readonly SimulatorOutput[]): ErrorOutput[] {
  return outputs.filter((output): output is ErrorOutput => output.kind === "error");
}

function terminalsOf(outputs: readonly SimulatorOutput[]): TerminalOutput[] {
  return outputs.filter((output): output is TerminalOutput => output.kind === "terminal");
}

function linesOf(outputs: readonly SimulatorOutput[], player: BattleSide): string[] {
  const lines: string[] = [];
  for (const chunk of chunksOf(outputs)) {
    if (chunk.player === player) lines.push(...chunk.lines);
  }
  return lines;
}

function assertSingleTerminal(
  outputs: readonly SimulatorOutput[],
  label: string,
  status: TerminalOutput["status"]
): TerminalOutput {
  const terminals = terminalsOf(outputs);
  assert(
    terminals.length === 1,
    `${label}: expected exactly one terminal message, found ${terminals.length}`
  );
  const terminal = terminals[0]!;
  assert(
    terminal.status === status,
    `${label}: expected terminal status "${status}", got "${terminal.status}"`
  );
  assert(
    outputs[outputs.length - 1] === terminal,
    `${label}: the terminal message was not the final output`
  );
  return terminal;
}

/* ---------------------------------------------------------------------------
 * 1. States
 * ------------------------------------------------------------------------ */
async function checkStates(): Promise<void> {
  const session = new ShowdownBattleSession({ battleId: "states" });
  assert(stateOf(session) === "created", `expected "created" on construction, got "${stateOf(session)}"`);
  session.start(startSpec());
  assert(stateOf(session) === "running", `expected "running" after start, got "${stateOf(session)}"`);

  const outputs = await drive(session);
  assert(stateOf(session) === "ended", `expected "ended" after a full battle, got "${stateOf(session)}"`);
  assertSingleTerminal(outputs, "states", "ended");

  session.close();
  assert(stateOf(session) === "closed", `expected "closed" after close, got "${stateOf(session)}"`);
}

/* ---------------------------------------------------------------------------
 * 2. Close
 * ------------------------------------------------------------------------ */
async function checkClose(): Promise<void> {
  // From `created`: no streams and no `Battle` exist.
  const fresh = new ShowdownBattleSession({ battleId: "close-created" });
  fresh.close();
  assert(stateOf(fresh) === "closed", `close from created: expected "closed", got "${stateOf(fresh)}"`);
  const freshOutputs = await drive(fresh);
  const freshTerminal = assertSingleTerminal(freshOutputs, "close from created", "closed");
  assert(freshTerminal.winner === null, "close from created: terminal winner must be null");
  assert(
    freshOutputs.length === 1,
    `close from created: expected only the terminal, got ${freshOutputs.length} output(s)`
  );

  // Mid-battle close: `closing` is entered synchronously, buffered chunks may
  // still arrive, and nothing follows the terminal.
  const session = new ShowdownBattleSession({ battleId: "close-running" });
  session.start(startSpec());
  let closedOnce = false;
  let stateAtClose = "";
  const outputs = await drive(session, {
    onOutput: (output) => {
      if (closedOnce || output.kind !== "chunk") return;
      closedOnce = true;
      session.close();
      stateAtClose = stateOf(session);
    },
  });
  assert(closedOnce, "close while running: no chunk was ever observed");
  assert(stateAtClose === "closing", `close while running: expected "closing", got "${stateAtClose}"`);
  const terminal = assertSingleTerminal(outputs, "close while running", "closed");
  assert(terminal.winner === null, "close while running: terminal winner must be null");
  assert(stateOf(session) === "closed", `close while running: expected "closed", got "${stateOf(session)}"`);

  // Three `close()` calls — one mid-battle, two after — never throw and still
  // produce exactly one terminal message.
  const triple = new ShowdownBattleSession({ battleId: "close-idempotent" });
  triple.start(startSpec());
  let closedMidBattle = false;
  const tripleOutputs = await drive(triple, {
    onOutput: (output) => {
      if (closedMidBattle || output.kind !== "chunk") return;
      closedMidBattle = true;
      triple.close();
    },
  });
  triple.close();
  triple.close();
  assertSingleTerminal(tripleOutputs, "three closes", "closed");
  assert(stateOf(triple) === "closed", `three closes: expected "closed", got "${stateOf(triple)}"`);
}

/* ---------------------------------------------------------------------------
 * 3. Input rejection
 * ------------------------------------------------------------------------ */
async function checkInputRejection(): Promise<void> {
  const session = new ShowdownBattleSession({ battleId: "input-rejection" });
  session.choose("p1", "default");
  assert(
    stateOf(session) === "created",
    `choice before start must not change state, got "${stateOf(session)}"`
  );
  session.start(startSpec());
  assert(stateOf(session) === "running", "a start after choice-before-start must still succeed");

  // A second start must be reported without writing anything to Showdown, so
  // the battle still runs to a normal terminal.
  session.start(startSpec());

  const outputs = await drive(session);
  const errors = errorsOf(outputs);
  assert(
    errors.length === 2,
    `expected exactly two input errors, got ${errors.length}: ${errors.map((e) => e.code).join(", ")}`
  );
  assert(errors[0]!.code === "choice-before-start", `expected choice-before-start, got ${errors[0]!.code}`);
  assert(errors[0]!.player === "p1", "choice-before-start must name the offending side");
  assert(errors[1]!.code === "duplicate-start", `expected duplicate-start, got ${errors[1]!.code}`);
  assertSingleTerminal(outputs, "input rejection", "ended");

  // After the terminal, and after `close()`, input throws.
  let afterTerminal: unknown = null;
  try {
    session.choose("p1", "default");
  } catch (error) {
    afterTerminal = error;
  }
  assert(
    afterTerminal instanceof SimulatorLifecycleError && afterTerminal.code === "input-after-end",
    "choose after the terminal must throw input-after-end"
  );

  session.close();
  let afterClose: unknown = null;
  try {
    session.choose("p1", "default");
  } catch (error) {
    afterClose = error;
  }
  assert(
    afterClose instanceof SimulatorLifecycleError && afterClose.code === "input-after-end",
    "choose after close must throw input-after-end"
  );

  let secondOutputs: unknown = null;
  try {
    session.outputs();
  } catch (error) {
    secondOutputs = error;
  }
  assert(
    secondOutputs instanceof SimulatorLifecycleError &&
      secondOutputs.code === "outputs-already-consumed",
    "a second outputs() call must throw outputs-already-consumed"
  );
}

/* ---------------------------------------------------------------------------
 * 4. Input validation
 * ------------------------------------------------------------------------ */
async function checkInputValidation(): Promise<void> {
  const session = new ShowdownBattleSession({ battleId: "choice-syntax" });
  session.start(startSpec());
  let injected = false;
  const outputs = await drive(session, {
    onOutput: (output) => {
      if (injected || output.kind !== "chunk") return;
      injected = true;
      // A multi-line choice would inject arbitrary `>`-commands, and a choice
      // starting with `>` is a command, not a choice.
      session.choose("p1", "move 1\n>forcetie");
      session.choose("p1", ">forcetie");
    },
  });
  assert(injected, "choice syntax: no chunk was ever observed");
  const errors = errorsOf(outputs);
  assert(
    errors.length === 2 && errors.every((error) => error.code === "invalid-choice-syntax"),
    `expected two invalid-choice-syntax errors, got ${errors.map((e) => e.code).join(", ") || "none"}`
  );
  assert(
    errors.every((error) => error.player === "p1"),
    "invalid-choice-syntax must name the offending side"
  );
  // Nothing was written, so the battle still completes normally.
  assertSingleTerminal(outputs, "choice syntax", "ended");

  // An invalid start leaves the session usable and closable rather than wedged.
  const both = new ShowdownBattleSession({ battleId: "invalid-start-both" });
  both.start({
    ...startSpec(),
    p1: {
      name: "p1",
      teamSeed: BATTLE_SEED,
      team: soloTeam("Striker", "Charizard", "Blaze", "Flamethrower"),
    },
  });
  assert(stateOf(both) === "created", `invalid start must stay "created", got "${stateOf(both)}"`);
  both.close();
  const bothOutputs = await drive(both);
  assert(
    errorsOf(bothOutputs).length === 1 &&
      errorsOf(bothOutputs)[0]!.code === "invalid-start",
    "a spec with both teamSeed and team must emit exactly one invalid-start"
  );
  assertSingleTerminal(bothOutputs, "invalid start (both)", "closed");

  const empty = new ShowdownBattleSession({ battleId: "invalid-start-empty" });
  empty.start({ ...startSpec(), p2: { name: "p2", team: [] } });
  assert(stateOf(empty) === "created", `empty team must stay "created", got "${stateOf(empty)}"`);
  empty.close();
  const emptyOutputs = await drive(empty);
  assert(
    errorsOf(emptyOutputs).length === 1 && errorsOf(emptyOutputs)[0]!.code === "invalid-start",
    "an empty team must emit exactly one invalid-start"
  );
  assertSingleTerminal(emptyOutputs, "invalid start (empty team)", "closed");
}

/* ---------------------------------------------------------------------------
 * 5. A Showdown-rejected choice is a chunk, not an ErrorOutput
 * ------------------------------------------------------------------------ */
async function checkRejectedChoiceIsNotAnError(): Promise<void> {
  const session = new ShowdownBattleSession({ battleId: "rejected-choice" });
  session.start(startSpec());
  let stateAtError: string | null = null;
  const outputs = await drive(session, {
    // Request #0 is Team Preview; `move 3` is illegal for a one-move Pokemon.
    responder: (player, index) => (player === "p1" && index === 1 ? "move 3" : "default"),
    onOutput: (output) => {
      if (stateAtError !== null || output.kind !== "chunk" || output.player !== "p1") return;
      if (!output.lines.some((line) => line.startsWith("|error|[Invalid choice]"))) return;
      stateAtError = stateOf(session);
      // Showdown sends no replacement `|request|` after an invalid choice, so
      // the battle can never progress on its own: close and drain.
      session.close();
    },
  });
  assert(stateAtError !== null, "no |error|[Invalid choice] chunk arrived on p1");
  assert(
    stateAtError === "running",
    `a rejected choice must not change state, got "${String(stateAtError)}"`
  );
  assert(
    errorsOf(outputs).length === 0,
    `a rejected choice must not produce an ErrorOutput, got ${errorsOf(outputs).length}`
  );
  assertSingleTerminal(outputs, "rejected choice", "closed");
}

/* ---------------------------------------------------------------------------
 * 6. Fault path
 * ------------------------------------------------------------------------ */
async function checkFaultPath(): Promise<void> {
  const session = new ShowdownBattleSession({ battleId: "fault" });
  session.start({ ...startSpec(), postStartCommands: [">nonsense"] });
  // Must not hang: the relay loop dies on its first error, so the reader loops
  // must stop rather than wait for an EOF that will never come.
  const outputs = await withinTimeout("fault path", drive(session));

  const terminal = assertSingleTerminal(outputs, "fault path", "faulted");
  assert(terminal.winner === null, "faulted terminal must carry a null winner");
  const faultIndex = outputs.findIndex(
    (output) => output.kind === "error" && output.code === "simulator-fault"
  );
  assert(faultIndex >= 0, "expected a simulator-fault ErrorOutput");
  assert(
    outputs[faultIndex + 1] === terminal,
    "simulator-fault must immediately precede the faulted terminal"
  );
  // Chunk content before the fault is deliberately not asserted: delivery on
  // this path is best effort.
}

/* ---------------------------------------------------------------------------
 * 7 & 8. Ordering, EOF, and perspective isolation
 * ------------------------------------------------------------------------ */
async function checkOrderingAndIsolation(): Promise<SimulatorOutput[]> {
  const session = new ShowdownBattleSession({ battleId: "ordering" });
  session.start(startSpec());
  const outputs = await drive(session);

  for (let i = 0; i < outputs.length; i++) {
    assert(outputs[i]!.seq === i, `seq must be gapless from 0: output ${i} has seq ${outputs[i]!.seq}`);
    assert(outputs[i]!.battleId === "ordering", `output ${i} carries the wrong battleId`);
  }
  for (const chunk of chunksOf(outputs)) {
    assert(
      chunk.player === "p1" || chunk.player === "p2",
      `unexpected chunk channel: ${String(chunk.player)}`
    );
    assert(chunk.lines.length > 0, `chunk seq ${chunk.seq} has empty lines`);
  }
  const terminal = assertSingleTerminal(outputs, "ordering", "ended");
  assert(
    terminal.seq === Math.max(...outputs.map((output) => output.seq)),
    "the terminal must carry the maximum seq"
  );

  const p1Requests = linesOf(outputs, "p1").filter((line) => line.startsWith("|request|"));
  const p2Requests = linesOf(outputs, "p2").filter((line) => line.startsWith("|request|"));
  assert(p1Requests.length > 0 && p2Requests.length > 0, "both sides must receive |request| lines");
  assert(
    p1Requests.every((line) => line.includes('"id":"p1"') && !line.includes('"id":"p2"')),
    "a p1 |request| line leaked p2 identity"
  );
  assert(
    p2Requests.every((line) => line.includes('"id":"p2"') && !line.includes('"id":"p1"')),
    "a p2 |request| line leaked p1 identity"
  );
  const p2RequestSet = new Set(p2Requests);
  assert(
    p1Requests.every((line) => !p2RequestSet.has(line)),
    "the p1 and p2 |request| line sets are not disjoint"
  );
  return outputs;
}

/* ---------------------------------------------------------------------------
 * 9. Debug separation
 * ------------------------------------------------------------------------ */
async function checkDebugSeparation(): Promise<void> {
  // Constructed but not passed as `debug`: the channel is still drained, and
  // the observer sees nothing.
  const unusedObserver: RecordingOmniscientObserver = createRecordingOmniscientObserver();
  const plain = new ShowdownBattleSession({ battleId: "debug-off" });
  plain.start(startSpec());
  const plainOutputs = await drive(plain);
  assertSingleTerminal(plainOutputs, "debug off", "ended");
  assert(
    unusedObserver.callCount === 0,
    `an observer that was never passed must never be called, got ${unusedObserver.callCount}`
  );

  const observer = createRecordingOmniscientObserver();
  const debugged = new ShowdownBattleSession({
    battleId: "debug-on",
    debug: { omniscientObserver: observer },
  });
  debugged.start(startSpec());
  const debuggedOutputs = await drive(debugged);
  assertSingleTerminal(debuggedOutputs, "debug on", "ended");

  assert(observer.callCount > 0, "the debug observer received nothing");
  assert(
    observer.lines.some((line) => line === "|tie" || line.startsWith("|win|")),
    "the debug observer did not receive the terminal |win|/|tie| line"
  );

  const omniscientSet = new Set(observer.lines);
  const p1Requests = linesOf(debuggedOutputs, "p1").filter((line) => line.startsWith("|request|"));
  assert(
    p1Requests.some((line) => !omniscientSet.has(line)),
    "no player-private p1 |request| line was absent from the omniscient log"
  );

  const plainP1 = linesOf(plainOutputs, "p1");
  const debuggedP1 = linesOf(debuggedOutputs, "p1");
  assert(
    plainP1.length === debuggedP1.length && plainP1.every((line, i) => line === debuggedP1[i]),
    "attaching the debug observer perturbed the normal p1 output"
  );
}

/* ---------------------------------------------------------------------------
 * 10. Instance isolation
 * ------------------------------------------------------------------------ */
async function checkInstanceIsolation(): Promise<void> {
  const first = new ShowdownBattleSession({ battleId: "instance-a" });
  const second = new ShowdownBattleSession({ battleId: "instance-b" });
  first.start(startSpec());
  second.start(startSpec());

  const [firstOutputs, secondOutputs] = await Promise.all([drive(first), drive(second)]);

  for (const [label, id, outputs] of [
    ["instance-a", "instance-a", firstOutputs],
    ["instance-b", "instance-b", secondOutputs],
  ] as const) {
    assert(outputs.length > 0, `${label}: produced no output`);
    for (let i = 0; i < outputs.length; i++) {
      assert(outputs[i]!.battleId === id, `${label}: output ${i} carries a foreign battleId`);
      assert(outputs[i]!.seq === i, `${label}: seq is not its own gapless sequence from 0`);
    }
    assertSingleTerminal(outputs, label, "ended");
  }
}

/* ---------------------------------------------------------------------------
 * 11. A late choice for a request queued before the terminal
 * ------------------------------------------------------------------------ */
/**
 * Regression: `>forcetie` ends the battle while the Team Preview request is
 * already queued, so the harness dispatch loop forwards that older request to
 * a driver after the session has already reached `ended`. The resulting
 * `input-after-end` is the benign late-choice race and must not fail the run —
 * while an ordinary input error must still propagate.
 */
async function checkLateChoiceRace(): Promise<void> {
  const settled = await runBattleLifecycle({
    formatId: "gen9customgame",
    startSeed: BATTLE_SEED,
    battleId: "late-choice",
    postStartCommands: [">forcetie"],
    p1: {
      kind: "scripted",
      name: "p1",
      team: soloTeam("Idle One", "Rattata", "Run Away", "Tackle"),
      // Answered, not ignored: this is exactly the choice that arrives late.
      choices: ["default"],
      allowUnansweredRequests: true,
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: soloTeam("Idle Two", "Rattata", "Run Away", "Tackle"),
      choices: ["default"],
      allowUnansweredRequests: true,
    },
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  assert(
    settled.ok,
    "late choice: runBattleLifecycle rejected an answered request that was queued " +
      `before the forced terminal: ${
        settled.ok ? "" : settled.error instanceof Error ? settled.error.message : String(settled.error)
      }`
  );
  assert(
    settled.value.winner === "tie",
    `late choice: expected a tie, got "${settled.value.winner}"`
  );

  // The swallow is narrow: a malformed choice is not a late-choice race and
  // still fails the run.
  const malformed = await runBattleLifecycle({
    formatId: "gen9customgame",
    startSeed: BATTLE_SEED,
    battleId: "late-choice-malformed",
    p1: {
      kind: "scripted",
      name: "p1",
      team: soloTeam("Striker", "Charizard", "Blaze", "Flamethrower"),
      choices: ["default\n>forcetie"],
      allowUnansweredRequests: true,
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: soloTeam("Target", "Magikarp", "Swift Swim", "Splash"),
      choices: [],
      allowUnansweredRequests: true,
    },
  }).then(
    () => ({ ok: true as const, message: "" }),
    (error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  assert(!malformed.ok, "malformed choice: runBattleLifecycle must not resolve");
  assert(
    malformed.message.includes("invalid-choice-syntax"),
    `malformed choice: rejection lost the reported code: ${malformed.message}`
  );
}

/* ---------------------------------------------------------------------------
 * 12. An unrecognized winner name must not leak the omniscient line
 * ------------------------------------------------------------------------ */
/**
 * Regression: the terminal `|win|` line lives on the omniscient channel, so
 * the `simulator-fault` it can provoke must carry no part of it. A player name
 * containing a newline is written as one JSON-escaped `>player` command but
 * splits the emitted `|win|` line, so the terminal line names only the part
 * before the newline and matches neither configured name.
 */
async function checkUnrecognizedWinnerDoesNotLeak(): Promise<void> {
  const secret = "LEAKCANARY";
  const observer = createRecordingOmniscientObserver();
  const session = new ShowdownBattleSession({
    battleId: "winner-name",
    debug: { omniscientObserver: observer },
  });
  session.start({
    ...startSpec(),
    p1: { name: `${secret}\ntail`, team: soloTeam("Idle One", "Rattata", "Run Away", "Tackle") },
    p2: { name: "p2", team: soloTeam("Idle Two", "Rattata", "Run Away", "Tackle") },
    postStartCommands: [">forcewin p1"],
  });
  const outputs = await withinTimeout("12. unrecognized winner", drive(session));

  const terminal = assertSingleTerminal(outputs, "unrecognized winner", "faulted");
  assert(terminal.winner === null, "unrecognized winner: faulted terminal must carry a null winner");
  const errors = errorsOf(outputs);
  assert(
    errors.length === 1 && errors[0]!.code === "simulator-fault",
    `unrecognized winner: expected exactly one simulator-fault, got ${
      errors.map((error) => error.code).join(", ") || "none"
    }`
  );
  const message = errors[0]!.message;
  // The raw line reached the debug observer, which is the only sanctioned
  // route; the assertions below are meaningless unless it did.
  assert(
    observer.lines.some((line) => line.startsWith("|win|") && line.includes(secret)),
    "unrecognized winner: the omniscient observer never saw the |win| line"
  );
  assert(
    !message.includes(secret),
    `unrecognized winner: the ErrorOutput leaked the winner name payload: ${message}`
  );
  assert(
    !message.includes("|"),
    `unrecognized winner: the ErrorOutput leaked raw protocol content: ${message}`
  );
  assert(
    message.length <= FAULT_MESSAGE_MAX_LENGTH,
    `unrecognized winner: the ErrorOutput message is unbounded (${message.length} chars)`
  );
}

async function main(): Promise<void> {
  await withinTimeout("1. states", checkStates());
  await withinTimeout("2. close", checkClose());
  await withinTimeout("3. input rejection", checkInputRejection());
  await withinTimeout("4. input validation", checkInputValidation());
  await withinTimeout("5. rejected choice", checkRejectedChoiceIsNotAnError());
  await checkFaultPath();
  const ordering = await withinTimeout("7/8. ordering and isolation", checkOrderingAndIsolation());
  await withinTimeout("9. debug separation", checkDebugSeparation());
  await withinTimeout("10. instance isolation", checkInstanceIsolation());
  await withinTimeout("11. late choice race", checkLateChoiceRace());
  await checkUnrecognizedWinnerDoesNotLeak();

  console.log(
    `OK: ShowdownBattleSession verified (12 assertions; ` +
      `${ordering.length} outputs in the reference battle).`
  );
}

// Fail loud: a stalled promise must not let Node drain its event loop and exit
// successfully without reporting completion.
process.exitCode = 1;

main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }
);
