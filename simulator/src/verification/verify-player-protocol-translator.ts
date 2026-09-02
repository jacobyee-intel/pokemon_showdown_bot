/**
 * Executable verification for the per-player protocol translator.
 *
 * Production translation sees only one side's ChunkOutput. Golden replay
 * opens exactly one p1.jsonl or p2.jsonl at a time; omniscient.jsonl is
 * rejected before it is read.
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { BattleSide, ChunkOutput } from "../core/simulator-messages";
import { GOLDENS_ROOT } from "../goldens/golden-paths";
import { PlayerProtocolTranslator } from "../translator/player-protocol-translator";
import {
  PlayerProtocolTranslatorError,
  type JsonObject,
  type JsonValue,
  type PlayerTranslatorEvent,
} from "../translator/translator-messages";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  assert(
    isDeepStrictEqual(actual, expected),
    `${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`
  );
}

function request(payload: Record<string, unknown>): string {
  return `|request|${JSON.stringify(payload)}`;
}

function side(player: BattleSide, pokemon: readonly Record<string, unknown>[] = [{}]): object {
  return { id: player, pokemon };
}

function chunk(
  battleId: string,
  player: BattleSide,
  seq: number,
  lines: readonly string[]
): ChunkOutput {
  return { kind: "chunk", battleId, player, seq, lines };
}

function assertTranslatorError(
  work: () => unknown,
  code: PlayerProtocolTranslatorError["code"],
  label: string
): PlayerProtocolTranslatorError {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof PlayerProtocolTranslatorError, `${label}: wrong error type`);
  assert(caught.code === code, `${label}: expected ${code}, got ${caught.code}`);
  return caught;
}

function objectValue(value: JsonValue | undefined, label: string): JsonObject {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label}: expected object`
  );
  return value as JsonObject;
}

function arrayValue(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  assert(Array.isArray(value), `${label}: expected array`);
  return value;
}

function pokemonCount(payload: JsonObject): number {
  const requestSide = objectValue(payload.side, "payload.side");
  return arrayValue(requestSide.pokemon, "payload.side.pokemon").length;
}

function checkSyntheticClassification(): void {
  const translator = new PlayerProtocolTranslator({ battleId: "synthetic", player: "p1" });
  const lines = [
    "|turn|1",
    " |request|not-recognized",
    "|REQUEST|not-recognized",
    request({ teamPreview: true, side: side("p1"), extension: { retained: 7 } }),
    request({ active: [{}], side: side("p1"), noCancel: true }),
    request({ forceSwitch: [true], side: side("p1", [{ reviving: false }]) }),
    request({ forceSwitch: [true], side: side("p1", [{ reviving: true }]) }),
    request({ wait: true, side: side("p1"), update: true }),
  ];
  const events = translator.accept(chunk("synthetic", "p1", 918, lines));
  assert(events.length === 5, `classification: expected 5 events, got ${events.length}`);
  assertDeepEqual(
    events.map((event) => event.kind === "wait" ? "wait" : event.requestKind),
    ["team-preview", "move", "forced-switch", "revival-blessing", "wait"],
    "classification: request kinds"
  );
  assertDeepEqual(
    events.filter((event) => event.kind === "decision").map((event) => event.decisionId),
    [0, 1, 2, 3],
    "classification: decision IDs"
  );
  const team = events[0]!;
  assert(team.kind === "decision", "classification: Team Preview was not a decision");
  assertDeepEqual(
    team.payload.extension,
    { retained: 7 },
    "classification: unknown field was not preserved"
  );
  const wait = events[4]!;
  assert(wait.kind === "wait", "classification: wait was not a wait event");
  assert(!("decisionId" in wait), "classification: wait exposed a decision ID");
}

function checkSyntheticErrors(): void {
  assertTranslatorError(
    () => new PlayerProtocolTranslator({ battleId: "", player: "p1" }),
    "invalid-config",
    "empty battle ID"
  );

  const malformedLines = [
    "|request|{",
    "|request|null",
    "|request|[]",
    "|request|1",
    request({ active: [{}] }),
    request({ active: [{}], side: null }),
    request({ active: [{}], side: [] }),
    request({ active: [{}], side: { id: "p1", pokemon: null } }),
    request({ active: [{}], side: { id: "p1", pokemon: [null] } }),
    request({ active: [{}], side: { id: "p3", pokemon: [{}] } }),
    request({ teamPreview: true, active: [{}], side: side("p1") }),
    request({ teamPreview: false, side: side("p1") }),
    request({ active: [], side: side("p1") }),
    request({ active: [null], side: side("p1") }),
    request({ forceSwitch: [], side: side("p1") }),
    request({ forceSwitch: [false], side: side("p1") }),
    request({ forceSwitch: [true, 1], side: side("p1") }),
    request({ wait: false, side: side("p1") }),
  ];
  for (const [index, line] of malformedLines.entries()) {
    const translator = new PlayerProtocolTranslator({
      battleId: `malformed-${index}`,
      player: "p1",
    });
    const error = assertTranslatorError(
      () => translator.accept(chunk(`malformed-${index}`, "p1", 0, [line])),
      "malformed-request",
      `malformed case ${index}`
    );
    assert(error.lineIndex === 0, `malformed case ${index}: missing source line`);
  }

  const unsupported = new PlayerProtocolTranslator({ battleId: "unsupported", player: "p1" });
  const unsupportedError = assertTranslatorError(
    () =>
      unsupported.accept(
        chunk("unsupported", "p1", 0, [
          request({ side: side("p1"), privateSecret: "must-not-appear-in-errors" }),
        ])
      ),
    "unsupported-request",
    "unsupported request"
  );
  assert(
    !unsupportedError.message.includes("must-not-appear"),
    "unsupported request leaked payload content"
  );

  const wrongBattle = new PlayerProtocolTranslator({ battleId: "right", player: "p1" });
  const battleError = assertTranslatorError(
    () => wrongBattle.accept(chunk("wrong", "p1", 0, ["|request|{"])),
    "routing-mismatch",
    "wrong chunk battle"
  );
  assert(battleError.message.includes("battleId"), "wrong chunk battle diagnostic was ambiguous");

  const wrongPlayer = new PlayerProtocolTranslator({ battleId: "battle", player: "p1" });
  const playerError = assertTranslatorError(
    () => wrongPlayer.accept(chunk("battle", "p2", 0, ["|request|{"])),
    "routing-mismatch",
    "wrong chunk player"
  );
  assert(playerError.message.includes("chunk player"), "wrong chunk player diagnostic was ambiguous");

  const wrongPerspective = new PlayerProtocolTranslator({ battleId: "battle", player: "p1" });
  const perspectiveError = assertTranslatorError(
    () =>
      wrongPerspective.accept(
        chunk("battle", "p1", 0, [request({ active: [{}], side: side("p2") })])
      ),
    "routing-mismatch",
    "wrong embedded player"
  );
  assert(
    perspectiveError.message.includes("embedded side.id"),
    "embedded perspective diagnostic was ambiguous"
  );
}

function checkDecisionIdentityAndUpdates(): void {
  const translator = new PlayerProtocolTranslator({ battleId: "identity", player: "p1" });
  const move = { active: [{}], side: side("p1") };
  const events = translator.accept(
    chunk("identity", "p1", 50, [
      request(move),
      request({ wait: true, side: side("p1") }),
      "|error|[Invalid choice] This ordinary protocol line is ignored",
      request({ ...move, update: true }),
    ])
  );
  assert(events.length === 3, "identity: expected decision, wait, decision");
  assert(
    events[0]!.kind === "decision" && events[0]!.decisionId === 0,
    "identity: first decision did not receive ID 0"
  );
  assert(events[1]!.kind === "wait", "identity: middle event was not wait");
  assert(
    events[2]!.kind === "decision" &&
      events[2]!.decisionId === 1 &&
      events[2]!.payload.update === true,
    "identity: updated move did not receive fresh ID 1"
  );

  const forced = new PlayerProtocolTranslator({ battleId: "forced-update", player: "p1" });
  const forcedEvents = forced.accept(
    chunk("forced-update", "p1", -10, [
      request({ forceSwitch: [true], side: side("p1") }),
      request({ forceSwitch: [true], side: side("p1"), update: true }),
    ])
  );
  assertDeepEqual(
    forcedEvents.map((event) => event.kind === "decision" ? event.decisionId : null),
    [0, 1],
    "forced update: fresh decision IDs"
  );
  assert(
    forcedEvents.every(
      (event) => event.kind === "decision" && event.requestKind === "forced-switch"
    ),
    "forced update: classification changed on re-emission"
  );
}

function translatePartitions(
  label: string,
  lines: readonly string[],
  partitions: readonly (readonly string[])[],
  seqs: readonly number[]
): readonly PlayerTranslatorEvent[] {
  assert(
    isDeepStrictEqual(partitions.flat(), lines),
    `${label}: partitions do not preserve the source lines`
  );
  assert(partitions.length === seqs.length, `${label}: missing synthetic seq`);
  const battleId = "chunk-independence";
  const translator = new PlayerProtocolTranslator({ battleId, player: "p1" });
  return partitions.flatMap((part, index) =>
    translator.accept(chunk(battleId, "p1", seqs[index]!, part))
  );
}

function checkChunkIndependence(): void {
  const move = request({ active: [{}], side: side("p1"), marker: "first" });
  const wait = request({ wait: true, side: side("p1"), marker: "second" });
  const forced = request({
    forceSwitch: [true],
    side: side("p1", [{ reviving: false }]),
    marker: "third",
  });
  const lines = ["|turn|1", move, "|", wait, "|upkeep", forced, "|turn|2"];
  const allLines = translatePartitions("chunk-all", lines, [lines], [0]);
  const oneLine = translatePartitions(
    "chunk-one",
    lines,
    lines.map((line) => [line]),
    [70, -2, 400, 1, 1, 999, 3]
  );
  const irregular = translatePartitions(
    "chunk-irregular",
    lines,
    [lines.slice(0, 2), lines.slice(2, 6), lines.slice(6)],
    [900, 12, -400]
  );
  const boundaries = translatePartitions(
    "chunk-boundaries",
    lines,
    [lines.slice(0, 1), lines.slice(1, 2), lines.slice(2, 3), lines.slice(3, 4), lines.slice(4)],
    [5, 5, 5, 5, 5]
  );
  assertDeepEqual(oneLine, allLines, "one-line rechunking changed output");
  assertDeepEqual(irregular, allLines, "irregular rechunking changed output");
  assertDeepEqual(boundaries, allLines, "request-boundary rechunking changed output");
  assertDeepEqual(
    allLines.map((event) => event.kind === "wait" ? "wait" : event.requestKind),
    ["move", "wait", "forced-switch"],
    "source order was not preserved"
  );
}

interface GoldenReplay {
  readonly filePath: string;
  readonly player: BattleSide;
  readonly requestLines: readonly string[];
  readonly events: readonly PlayerTranslatorEvent[];
}

async function replayPlayerGolden(filePath: string): Promise<GoldenReplay> {
  const basename = path.basename(filePath);
  if (basename !== "p1.jsonl" && basename !== "p2.jsonl") {
    throw new Error(`refusing non-player golden: ${basename}`);
  }
  const player: BattleSide = basename === "p1.jsonl" ? "p1" : "p2";
  const content = await readFile(filePath, "utf8");
  const encodedLines = content === "" ? [] : content.split("\n");
  if (encodedLines.length > 0) {
    assert(encodedLines.pop() === "", `${filePath}: JSONL must end with one newline`);
  }
  const protocolLines = encodedLines.map((encoded, index) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      throw new Error(`${filePath}:${index + 1}: invalid outer JSONL record`);
    }
    assert(typeof decoded === "string", `${filePath}:${index + 1}: record is not a string`);
    return decoded;
  });
  const battleId = `golden:${path.relative(GOLDENS_ROOT, path.dirname(filePath))}:${player}`;
  const translator = new PlayerProtocolTranslator({ battleId, player });
  const events = protocolLines.flatMap((line, index) =>
    translator.accept(chunk(battleId, player, index * 17 - 300, [line]))
  );
  const requestLines = protocolLines.filter((line) => line.startsWith("|request|"));
  assert(
    events.length === requestLines.length,
    `${filePath}: ${requestLines.length} requests produced ${events.length} events`
  );
  return { filePath, player, requestLines, events };
}

async function listPlayerGoldens(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listPlayerGoldens(entryPath));
    } else if (entry.name === "p1.jsonl" || entry.name === "p2.jsonl") {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function goldenPath(format: string, caseId: string, player: BattleSide): string {
  return path.join(GOLDENS_ROOT, format, caseId, `${player}.jsonl`);
}

async function checkRepresentativeGoldens(): Promise<void> {
  const tera = await replayPlayerGolden(goldenPath("gen9customgame", "tera", "p1"));
  assert(
    tera.events.some(
      (event) => event.kind === "decision" && event.requestKind === "team-preview"
    ),
    "tera p1: missing Team Preview decision"
  );
  const teraMove = tera.events.find(
    (event) => event.kind === "decision" && event.requestKind === "move"
  );
  assert(teraMove?.kind === "decision", "tera p1: missing move decision");
  assert(
    JSON.stringify(teraMove.payload).includes('"canTerastallize":"Fire"'),
    "tera p1: preserved move payload lost Tera metadata"
  );

  const struggle = await replayPlayerGolden(goldenPath("gen9customgame", "struggle", "p1"));
  assert(
    struggle.events.some(
      (event) =>
        event.kind === "decision" &&
        event.requestKind === "move" &&
        JSON.stringify(event.payload).includes('"move":"Struggle"')
    ),
    "struggle p1: preserved Struggle request did not classify as move"
  );

  const revivalP1 = await replayPlayerGolden(
    goldenPath("gen9customgame", "revival-blessing", "p1")
  );
  assert(
    revivalP1.events.some(
      (event) => event.kind === "decision" && event.requestKind === "forced-switch"
    ),
    "revival p1: missing ordinary forced switch"
  );
  assert(
    revivalP1.events.some(
      (event) =>
        event.kind === "decision" &&
        event.requestKind === "revival-blessing" &&
        JSON.stringify(event.payload).includes('"reviving":true')
    ),
    "revival p1: reviving payload did not classify as Revival Blessing"
  );

  const revivalP2 = await replayPlayerGolden(
    goldenPath("gen9customgame", "revival-blessing", "p2")
  );
  const waits = revivalP2.events.filter((event) => event.kind === "wait");
  assert(waits.length > 0, "revival p2: missing wait event");
  assert(
    waits.every((event) => !("decisionId" in event)),
    "revival p2: wait exposed a decision ID"
  );

  const ordinary = await replayPlayerGolden(
    goldenPath("gen9randombattle", "ordinary-battle", "p1")
  );
  for (const expected of ["move", "forced-switch", "wait"] as const) {
    assert(
      ordinary.events.some((event) =>
        expected === "wait"
          ? event.kind === "wait"
          : event.kind === "decision" && event.requestKind === expected
      ),
      `ordinary p1: missing ${expected}`
    );
  }
  assert(
    ordinary.events.some((event) => pokemonCount(event.payload) === 6),
    "ordinary p1: no preserved six-Pokemon own-team payload"
  );

  const voluntary = await replayPlayerGolden(
    goldenPath("gen9randombattle", "voluntary-switch", "p1")
  );
  assert(
    voluntary.events.some(
      (event) => event.kind === "decision" && event.requestKind === "move"
    ),
    "voluntary switch p1: missing move requests"
  );
  assert(
    voluntary.events.every(
      (event) =>
        event.kind === "wait" ||
        event.requestKind === "move" ||
        event.requestKind === "forced-switch"
    ),
    "voluntary switch p1: introduced a separate request kind"
  );
}

async function checkAllPlayerGoldens(): Promise<number> {
  const filePaths = await listPlayerGoldens(GOLDENS_ROOT);
  assert(filePaths.length > 0, "no player goldens found");
  for (const filePath of filePaths) {
    await replayPlayerGolden(filePath);
  }
  return filePaths.length;
}

async function checkOmniscientRejection(): Promise<void> {
  const omniscient = path.join(
    GOLDENS_ROOT,
    "gen9customgame",
    "tera",
    "omniscient.jsonl"
  );
  let caught: unknown;
  try {
    await replayPlayerGolden(omniscient);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, "omniscient golden was not rejected");
  assert(
    caught.message.includes("refusing non-player golden"),
    "omniscient rejection was not explicit"
  );
}

async function main(): Promise<void> {
  checkSyntheticClassification();
  checkSyntheticErrors();
  checkDecisionIdentityAndUpdates();
  checkChunkIndependence();
  await checkOmniscientRejection();
  await checkRepresentativeGoldens();
  const goldenCount = await checkAllPlayerGoldens();

  console.log(
    `OK: player protocol translator verified (synthetic coverage; ${goldenCount} player goldens).`
  );
}

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
