/**
 * Captures perspective-specific protocol fixtures from the pinned simulator.
 *
 * Fixtures are produced only by running the real simulator through the shared
 * lifecycle in `battle-lifecycle.ts`. Nothing here hand-authors, trims, or
 * re-serializes protocol content: `|request|` payloads are preserved as the
 * simulator's original, un-reparsed text.
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  runBattleLifecycle,
  type BattleLifecycleOptions,
  type BattleSide,
  type PlayerLifecycleSpec,
} from "../drivers/battle-lifecycle";
import { normalizeProtocolLine } from "../core/protocol";
import { deriveBattleSeeds } from "../drivers/seed";
import { toShowdownSeed } from "../core/showdown";
import type { FixtureCaseSpec, FixturePlayerSpec } from "./fixture-cases";

/** The three files written per case, in fixed order. */
export const FIXTURE_STREAM_FILES = ["p1.jsonl", "p2.jsonl", "omniscient.jsonl"] as const;

/** Every file written per case, in fixed order. */
export const FIXTURE_FILES = ["meta.json", ...FIXTURE_STREAM_FILES] as const;

export interface CapturedFixture {
  caseId: string;
  /** Directory the case was written to, relative to the output root. */
  relativeDirectory: string;
  /** File contents keyed by file name, exactly as written. */
  files: Record<string, string>;
}

function playerLifecycleSpec(
  spec: FixturePlayerSpec,
  teamSeed: ReturnType<typeof toShowdownSeed>,
  agentSeed: ReturnType<typeof toShowdownSeed>
): PlayerLifecycleSpec {
  if (spec.kind === "random") {
    return {
      kind: "random",
      name: spec.name,
      teamSeed,
      agentSeed,
      move: spec.move,
    };
  }
  return {
    kind: "scripted",
    name: spec.name,
    team: spec.team.slice(),
    choices: spec.choices.slice(),
    allowUnansweredRequests: spec.allowUnansweredRequests,
  };
}

/** Builds the lifecycle options for a case. Seeds always come from the master seed. */
export function toLifecycleOptions(
  caseSpec: FixtureCaseSpec,
  onLines?: (player: BattleSide, lines: readonly string[]) => void,
  onDebugLines?: (lines: readonly string[]) => void
): BattleLifecycleOptions {
  const seeds = deriveBattleSeeds(caseSpec.masterSeed);
  return {
    formatId: caseSpec.formatId,
    startSeed: toShowdownSeed(seeds.battle),
    p1: playerLifecycleSpec(
      caseSpec.p1,
      toShowdownSeed(seeds.p1Team),
      toShowdownSeed(seeds.p1Agent)
    ),
    p2: playerLifecycleSpec(
      caseSpec.p2,
      toShowdownSeed(seeds.p2Team),
      toShowdownSeed(seeds.p2Agent)
    ),
    postStartCommands: caseSpec.postStartCommands,
    battleId: caseSpec.caseId,
    onLines,
    onDebugLines,
  };
}

/**
 * Builds `meta.json`'s content with an explicit, fixed key order. The object
 * literal order below is the file's field order; runtime data structures are
 * never spread into it.
 */
function buildMeta(caseSpec: FixtureCaseSpec, showdownVersion: string): string {
  const player = (spec: FixturePlayerSpec): Record<string, unknown> => {
    if (spec.kind === "random") {
      return { kind: "random", name: spec.name, move: spec.move };
    }
    const scripted: Record<string, unknown> = {
      kind: "scripted",
      name: spec.name,
      team: spec.team,
      choices: spec.choices,
    };
    if (spec.allowUnansweredRequests !== undefined) {
      scripted.allowUnansweredRequests = spec.allowUnansweredRequests;
    }
    return scripted;
  };

  const meta: Record<string, unknown> = {
    caseId: caseSpec.caseId,
    category: caseSpec.category,
    formatId: caseSpec.formatId,
    showdownVersion,
    masterSeed: caseSpec.masterSeed,
    p1: player(caseSpec.p1),
    p2: player(caseSpec.p2),
  };
  if (caseSpec.postStartCommands !== undefined) {
    meta.postStartCommands = caseSpec.postStartCommands;
  }
  if (caseSpec.demonstrates !== undefined) {
    meta.demonstrates = caseSpec.demonstrates;
  }
  if (caseSpec.search !== undefined) {
    meta.search = caseSpec.search;
  }
  if (caseSpec.note !== undefined) {
    meta.note = caseSpec.note;
  }
  return `${JSON.stringify(meta, null, 2)}\n`;
}

/**
 * Serializes protocol lines as JSONL: one `JSON.stringify(line)` per file
 * line, UTF-8, `\n` endings, single trailing newline.
 */
function serializeLines(lines: readonly string[]): string {
  if (lines.length === 0) return "";
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

/**
 * Runs a case and writes its four fixture files under
 * `<outputRoot>/<formatId>/<caseId>/`. A rejected capture propagates the error
 * and writes nothing.
 */
export async function captureFixture(
  caseSpec: FixtureCaseSpec,
  outputRoot: string,
  showdownVersion: string
): Promise<CapturedFixture> {
  const captured: { p1: string[]; p2: string[]; omniscient: string[] } = {
    p1: [],
    p2: [],
    omniscient: [],
  };

  // Normal, per-player protocol. Structurally incapable of carrying
  // omniscient data: `player` is a `BattleSide`.
  const onLines = (player: BattleSide, lines: readonly string[]): void => {
    for (const line of lines) {
      captured[player].push(normalizeProtocolLine(line));
    }
  };

  // DEBUG-ONLY channel, opted into explicitly at this one named call site.
  // This is what produces `omniscient.jsonl`.
  const onDebugLines = (lines: readonly string[]): void => {
    for (const line of lines) {
      captured.omniscient.push(normalizeProtocolLine(line));
    }
  };

  // A rejection here propagates: no partial files are written.
  await runBattleLifecycle(toLifecycleOptions(caseSpec, onLines, onDebugLines));

  const files: Record<string, string> = {
    "meta.json": buildMeta(caseSpec, showdownVersion),
    "p1.jsonl": serializeLines(captured.p1),
    "p2.jsonl": serializeLines(captured.p2),
    "omniscient.jsonl": serializeLines(captured.omniscient),
  };

  const relativeDirectory = path.posix.join(caseSpec.formatId, caseSpec.caseId);
  const directory = path.join(outputRoot, caseSpec.formatId, caseSpec.caseId);
  await mkdir(directory, { recursive: true });
  for (const fileName of FIXTURE_FILES) {
    await writeFile(path.join(directory, fileName), files[fileName]!, "utf8");
  }

  return { caseId: caseSpec.caseId, relativeDirectory, files };
}
