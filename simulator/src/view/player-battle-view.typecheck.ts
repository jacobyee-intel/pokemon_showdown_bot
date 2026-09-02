import type {
  HpView,
  Knowledge,
  PlayerBattleView,
  PokemonView,
} from "./player-battle-view";

const unknown = { kind: "unknown" } as const;
const knownNull = { kind: "known", value: null } as const;

const opponentPokemon = {
  id: "p2-reveal-1",
  side: "p2",
  teamPosition: unknown,
  revealOrder: 1,
  nickname: { kind: "known", value: "Iron Valiant" },
  species: { kind: "known", value: "ironvaliant" },
  level: { kind: "known", value: 78 },
  gender: { kind: "known", value: "N" },
  hp: { kind: "percent", percent: 0 },
  fainted: { kind: "known", value: true },
  status: knownNull,
  stats: unknown,
  statsOverride: unknown,
  moves: [
    { id: "moonblast", pp: unknown },
    { id: "closecombat", pp: unknown },
  ],
  movesComplete: unknown,
  movesOverride: unknown,
  item: unknown,
  ability: { base: unknown, current: unknown },
  formeOverride: knownNull,
  transformedInto: unknown,
  typeOverride: unknown,
  tera: { state: unknown, type: unknown },
  boosts: [],
  effects: [],
} satisfies PokemonView;

const ownPokemon = {
  id: "p1-team-1",
  side: "p1",
  teamPosition: { kind: "known", value: 1 },
  revealOrder: 1,
  nickname: { kind: "known", value: "Ditto" },
  species: { kind: "known", value: "ditto" },
  level: { kind: "known", value: 88 },
  gender: { kind: "known", value: "N" },
  hp: { kind: "exact", current: 212, max: 212 },
  fainted: { kind: "known", value: false },
  status: knownNull,
  stats: {
    kind: "known",
    value: { atk: 100, def: 110, spa: 100, spd: 110, spe: 100 },
  },
  statsOverride: unknown,
  moves: [
    { id: "transform", pp: { kind: "known", value: { current: 16, max: 16 } } },
  ],
  movesComplete: { kind: "known", value: true },
  movesOverride: unknown,
  item: { kind: "known", value: "choicescarf" },
  ability: {
    base: { kind: "known", value: "imposter" },
    current: { kind: "known", value: "imposter" },
  },
  formeOverride: knownNull,
  transformedInto: { kind: "known", value: opponentPokemon },
  typeOverride: knownNull,
  tera: {
    state: { kind: "known", value: "not-terastallized" },
    type: { kind: "known", value: "normal" },
  },
  boosts: [{ stat: "spe", stages: 1 }],
  effects: [{ id: "transform", arguments: ["p2a: Iron Valiant"] }],
} satisfies PokemonView;

const playerBattleView = {
  schemaVersion: 1,
  battleId: "battle-typecheck",
  player: "p1",
  battle: {
    formatId: { kind: "known", value: "gen9randombattle" },
    turn: { kind: "known", value: 5 },
    phase: { kind: "known", value: "battle" },
  },
  ownSide: {
    side: "p1",
    name: { kind: "known", value: "Alice" },
    teamSize: { kind: "known", value: 6 },
    pokemon: [ownPokemon],
    active: [{ slot: 1, pokemonId: ownPokemon.id }],
    conditions: [{ id: "stealthrock", layers: { kind: "known", value: 1 } }],
  },
  opponentSide: {
    side: "p2",
    name: { kind: "known", value: "Bob" },
    teamSize: unknown,
    pokemon: [opponentPokemon],
    // A fainted occupant remains until protocol explicitly replaces the slot.
    active: [{ slot: 1, pokemonId: opponentPokemon.id }],
    conditions: [],
  },
  field: {
    weather: knownNull,
    terrain: unknown,
    effects: [{ id: "trickroom", arguments: [] }],
  },
} satisfies PlayerBattleView;

function exhaustKnowledge<T>(knowledge: Knowledge<T>): T | undefined {
  switch (knowledge.kind) {
    case "known":
      return knowledge.value;
    case "unknown":
      return undefined;
    default: {
      const exhaustive: never = knowledge;
      return exhaustive;
    }
  }
}

function exhaustHp(hp: HpView): number | undefined {
  switch (hp.kind) {
    case "exact":
      return hp.current / hp.max;
    case "percent":
      return hp.percent / 100;
    case "unknown":
      return undefined;
    default: {
      const exhaustive: never = hp;
      return exhaustive;
    }
  }
}

const invalidHp = {
  // @ts-expect-error HpView has exact, percent, and unknown variants only.
  kind: "ratio",
  current: 1,
  max: 2,
} satisfies HpView;

const invalidStatus = {
  ...opponentPokemon,
  // @ts-expect-error MajorStatus does not include arbitrary status IDs.
  status: { kind: "known", value: "confusion" },
} satisfies PokemonView;

const viewWithRequest = {
  ...playerBattleView,
  // @ts-expect-error Requests are not part of PlayerBattleView.
  request: {},
} satisfies PlayerBattleView;

const viewWithLegalMask = {
  ...playerBattleView,
  // @ts-expect-error Legal masks are Step 9 decision metadata, not view state.
  legalMask: [true, false],
} satisfies PlayerBattleView;

void [
  playerBattleView,
  invalidHp,
  invalidStatus,
  viewWithRequest,
  viewWithLegalMask,
  exhaustKnowledge,
  exhaustHp,
];
