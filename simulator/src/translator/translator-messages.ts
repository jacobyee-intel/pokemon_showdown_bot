import type { BattleSide } from "../core/simulator-messages";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type DecisionRequestKind =
  | "team-preview"
  | "move"
  | "forced-switch"
  | "revival-blessing";

export interface DecisionEvent {
  readonly kind: "decision";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly decisionId: number;
  readonly requestKind: DecisionRequestKind;
  readonly payload: JsonObject;
}

export interface WaitEvent {
  readonly kind: "wait";
  readonly battleId: string;
  readonly player: BattleSide;
  readonly payload: JsonObject;
}

export type PlayerTranslatorEvent = DecisionEvent | WaitEvent;

export type PlayerProtocolTranslatorErrorCode =
  | "invalid-config"
  | "routing-mismatch"
  | "malformed-request"
  | "unsupported-request";

export class PlayerProtocolTranslatorError extends Error {
  readonly code: PlayerProtocolTranslatorErrorCode;
  readonly battleId: string;
  readonly player: BattleSide;
  readonly lineIndex?: number;

  constructor(
    code: PlayerProtocolTranslatorErrorCode,
    battleId: string,
    player: BattleSide,
    message: string,
    lineIndex?: number
  ) {
    super(message);
    this.name = "PlayerProtocolTranslatorError";
    this.code = code;
    this.battleId = battleId;
    this.player = player;
    if (lineIndex !== undefined) this.lineIndex = lineIndex;
  }
}
