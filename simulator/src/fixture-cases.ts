/**
 * The frozen manifest of every protocol fixture case.
 *
 * This is the single source of truth for both `capture-fixtures.ts` and
 * `verify-fixtures.ts`. Every field here is static: it is the exact content
 * that becomes each `meta.json`, plus everything needed to rerun the case.
 * Nothing in this file may depend on wall-clock time, hostnames, absolute
 * paths, or process state.
 *
 * Values under `demonstrates` were observed once when each case was authored
 * and then frozen; they are documentation, not runtime-derived output.
 */
import type { ShowdownPokemonSet } from "./showdown";

export type FixtureCategory = "natural-random-search" | "custom-scripted" | "forced-terminal";

export interface RandomFixturePlayerSpec {
  kind: "random";
  name: string;
  /**
   * Probability of moving rather than switching when both are legal. Must be
   * strictly between 0 and 1 to make voluntary switches possible; `0` is
   * invalid because `RandomPlayerAI` treats it as the default `1`.
   */
  move: number;
}

export interface ScriptedFixturePlayerSpec {
  kind: "scripted";
  name: string;
  team: ShowdownPokemonSet[];
  choices: string[];
  /**
   * Only set on forced-terminal cases: permits both unconsumed choices and
   * requests that arrive after the recorded terminal command already ended the
   * battle. See `runScriptedPlayer` for why `gen9customgame`'s Team Preview
   * request still arrives before `>forcetie` is relayed.
   */
  allowUnansweredRequests?: boolean;
}

export type FixturePlayerSpec = RandomFixturePlayerSpec | ScriptedFixturePlayerSpec;

export interface FixtureCaseSpec {
  caseId: string;
  category: FixtureCategory;
  formatId: "gen9randombattle" | "gen9customgame";
  /** Derives the battle, team, and agent seeds. Mandatory for every case. */
  masterSeed: number;
  p1: FixturePlayerSpec;
  p2: FixturePlayerSpec;
  /** Raw omniscient commands written right after the `>start`/`>player` block. */
  postStartCommands?: string[];
  /** Frozen, human-authored map of what this case demonstrates, by turn. */
  demonstrates?: Record<string, { turn: number }>;
  search?: { strategy: string; start: number; step: number };
  note?: string;
}

/** Builds a fully specified team member with a fixed key order. */
function set(
  fields: {
    name: string;
    species: string;
    ability: string;
    moves: string[];
    level: number;
    teraType?: string;
  }
): ShowdownPokemonSet {
  const member: ShowdownPokemonSet = {
    name: fields.name,
    species: fields.species,
    item: "",
    ability: fields.ability,
    moves: fields.moves,
    nature: "Hardy",
    gender: "M",
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: fields.level,
  };
  if (fields.teraType !== undefined) {
    member.teraType = fields.teraType;
  }
  return member;
}

const INCREASING_MASTER_SEED_SEARCH = { strategy: "increasing-master-seed", start: 1, step: 1 };

export const FIXTURE_CASES: readonly FixtureCaseSpec[] = [
  {
    caseId: "ordinary-battle",
    category: "natural-random-search",
    formatId: "gen9randombattle",
    masterSeed: 1,
    p1: { kind: "random", name: "p1", move: 1 },
    p2: { kind: "random", name: "p2", move: 1 },
    demonstrates: {
      ordinaryMove: { turn: 1 },
      forcedSwitch: { turn: 12 },
      wait: { turn: 12 },
      faint: { turn: 12 },
      win: { turn: 33 },
    },
    search: INCREASING_MASTER_SEED_SEARCH,
  },
  {
    caseId: "voluntary-switch",
    category: "natural-random-search",
    formatId: "gen9randombattle",
    masterSeed: 1,
    p1: { kind: "random", name: "p1", move: 0.5 },
    p2: { kind: "random", name: "p2", move: 0.5 },
    demonstrates: {
      voluntarySwitch: { turn: 1 },
    },
    search: INCREASING_MASTER_SEED_SEARCH,
  },
  {
    caseId: "tera",
    category: "custom-scripted",
    formatId: "gen9customgame",
    masterSeed: 1,
    p1: {
      kind: "scripted",
      name: "p1",
      team: [
        set({
          name: "Teraburst",
          species: "Charizard",
          ability: "Blaze",
          moves: ["Flamethrower"],
          level: 100,
          teraType: "Fire",
        }),
      ],
      choices: ["default", "move 1 terastallize"],
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: [
        set({
          name: "Target",
          species: "Magikarp",
          ability: "Swift Swim",
          moves: ["Splash"],
          level: 1,
        }),
      ],
      choices: ["default", "move 1"],
    },
    demonstrates: {
      terastallize: { turn: 1 },
    },
  },
  {
    caseId: "struggle",
    category: "custom-scripted",
    formatId: "gen9customgame",
    masterSeed: 1,
    p1: {
      kind: "scripted",
      name: "p1",
      team: [
        set({
          name: "Struggler",
          species: "Rattata",
          ability: "Run Away",
          moves: ["Tackle"],
          level: 100,
        }),
      ],
      choices: ["default", "move 1", "move 1", "move 1", "move 1", "move 1", "move 1"],
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: [
        set({
          name: "Wall",
          species: "Blissey",
          ability: "Natural Cure",
          moves: ["Splash"],
          level: 100,
        }),
      ],
      choices: ["default", "move 1", "move 1", "move 1", "move 1", "move 1", "move 1"],
    },
    postStartCommands: [">editbattle pp p1, 1, 1, 1"],
    demonstrates: {
      struggle: { turn: 2 },
    },
  },
  {
    caseId: "revival-blessing",
    category: "custom-scripted",
    formatId: "gen9customgame",
    masterSeed: 1,
    p1: {
      kind: "scripted",
      name: "p1",
      team: [
        set({
          name: "Sacrifice",
          species: "Magikarp",
          ability: "Swift Swim",
          moves: ["Splash"],
          level: 5,
        }),
        set({
          name: "Reviver",
          species: "Pawmot",
          ability: "Volt Absorb",
          moves: ["Revival Blessing"],
          level: 100,
        }),
      ],
      choices: ["default", "move 1", "switch 2", "move 1", "switch 2", "move 1", "switch 2", "move 1"],
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: [
        set({
          name: "Sweeper",
          species: "Charizard",
          ability: "Blaze",
          moves: ["Earthquake"],
          level: 100,
        }),
      ],
      choices: ["default", "move 1", "move 1", "move 1", "move 1"],
    },
    demonstrates: {
      revivalBlessing: { turn: 2 },
    },
  },
  {
    caseId: "forced-tie-terminal",
    category: "forced-terminal",
    formatId: "gen9customgame",
    masterSeed: 1,
    p1: {
      kind: "scripted",
      name: "p1",
      team: [
        set({ name: "Idle One", species: "Rattata", ability: "Run Away", moves: ["Tackle"], level: 100 }),
      ],
      choices: [],
      allowUnansweredRequests: true,
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: [
        set({ name: "Idle Two", species: "Rattata", ability: "Run Away", moves: ["Tackle"], level: 100 }),
      ],
      choices: [],
      allowUnansweredRequests: true,
    },
    postStartCommands: [">forcetie"],
    note:
      "Uses >forcetie to terminate the battle for terminal-line parsing only. " +
      "This is not a natural simultaneous-KO tie and must not be treated as a " +
      "substitute for one if future semantics depend on true double-faint tie behavior.",
  },
];
