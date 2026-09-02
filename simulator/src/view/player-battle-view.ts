import type { BattleSide } from "../core/simulator-messages";

/**
 * Perspective-local knowledge. Known `null` records an explicitly observed
 * absence; `unknown` records that the player has not established the fact.
 */
export type Knowledge<T> =
  | { readonly kind: "known"; readonly value: T }
  | { readonly kind: "unknown" };

export type PokemonViewId = string;
export type NormalizedId = string;
export type SpeciesId = NormalizedId;
export type MoveId = NormalizedId;
export type ItemId = NormalizedId;
export type AbilityId = NormalizedId;
export type TypeId = NormalizedId;
export type EffectId = NormalizedId;

export type StatId =
  | "atk"
  | "def"
  | "spa"
  | "spd"
  | "spe"
  | "accuracy"
  | "evasion";

export type MajorStatus = "brn" | "frz" | "par" | "psn" | "slp" | "tox";
export type Gender = "M" | "F" | "N";
export type BattlePhase = "team-preview" | "battle" | "ended";
export type TeraState = "not-terastallized" | "terastallized";

/** A complete replacement snapshot containing facts observed by one player. */
export interface PlayerBattleView {
  readonly schemaVersion: 1;
  readonly battleId: string;
  readonly player: BattleSide;
  readonly battle: BattleView;
  readonly ownSide: SideView;
  readonly opponentSide: SideView;
  readonly field: FieldView;
}

export interface BattleView {
  readonly formatId: Knowledge<NormalizedId>;
  readonly turn: Knowledge<number>;
  readonly phase: Knowledge<BattlePhase>;
}

export interface SideView {
  readonly side: BattleSide;
  readonly name: Knowledge<string>;
  readonly teamSize: Knowledge<number>;
  readonly pokemon: readonly PokemonView[];
  readonly active: readonly ActiveSlotView[];
  readonly conditions: readonly SideConditionView[];
}

export interface PokemonView {
  readonly id: PokemonViewId;
  readonly side: BattleSide;
  readonly teamPosition: Knowledge<number>;
  readonly revealOrder: number;
  readonly nickname: Knowledge<string>;
  /** Latest permanently announced species identity. */
  readonly species: Knowledge<SpeciesId>;
  readonly level: Knowledge<number>;
  readonly gender: Knowledge<Gender>;
  readonly hp: HpView;
  readonly fainted: Knowledge<boolean>;
  readonly status: Knowledge<MajorStatus | null>;
  /** Exact normal non-HP stats established by the player's private request. */
  readonly stats: Knowledge<ObservedStats>;
  /** Temporary Transform stats; known null records an explicit clear. */
  readonly statsOverride: Knowledge<ObservedStats | null>;
  /** Permanently learned or publicly revealed moves in semantic order. */
  readonly moves: readonly MoveView[];
  readonly movesComplete: Knowledge<boolean>;
  /** Temporary Transform moves; known null records an explicit clear. */
  readonly movesOverride: Knowledge<readonly MoveView[] | null>;
  readonly item: Knowledge<ItemId | null>;
  readonly ability: AbilityView;
  readonly formeOverride: Knowledge<SpeciesId | null>;
  /** Direct reference to the represented Transform target, when established. */
  readonly transformedInto: Knowledge<PokemonView | null>;
  readonly typeOverride: Knowledge<readonly TypeId[] | null>;
  readonly tera: TeraView;
  readonly boosts: readonly BoostView[];
  readonly effects: readonly EffectView[];
}

export type HpView =
  | { readonly kind: "exact"; readonly current: number; readonly max: number }
  | { readonly kind: "percent"; readonly percent: number }
  | { readonly kind: "unknown" };

export interface ObservedStats {
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface MoveView {
  readonly id: MoveId;
  readonly pp: Knowledge<{
    readonly current: number;
    readonly max: number;
  }>;
}

export interface AbilityView {
  readonly base: Knowledge<AbilityId | null>;
  readonly current: Knowledge<AbilityId | null>;
}

export interface TeraView {
  readonly state: Knowledge<TeraState>;
  readonly type: Knowledge<TypeId>;
}

/** Active slots contain only the one-based slot and side-local Pokémon ID. */
export interface ActiveSlotView {
  readonly slot: number;
  readonly pokemonId: PokemonViewId;
}

export interface BoostView {
  readonly stat: StatId;
  readonly stages: number;
}

export interface EffectView {
  readonly id: EffectId;
  /** Explicit player-visible protocol arguments, preserved in protocol order. */
  readonly arguments: readonly string[];
}

export interface SideConditionView {
  readonly id: EffectId;
  readonly layers: Knowledge<number>;
}

export interface FieldView {
  readonly weather: Knowledge<EffectId | null>;
  readonly terrain: Knowledge<EffectId | null>;
  readonly effects: readonly EffectView[];
}
