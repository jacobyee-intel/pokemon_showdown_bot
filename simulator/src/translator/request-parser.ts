import type { BattleSide } from "../core/simulator-messages";
import {
  PlayerProtocolTranslatorError,
  type DecisionRequestKind,
  type JsonObject,
} from "./translator-messages";

const REQUEST_PREFIX = "|request|";
const DISCRIMINATORS = ["teamPreview", "active", "forceSwitch", "wait"] as const;

export type ParsedPlayerRequest =
  | {
      readonly kind: "decision";
      readonly requestKind: DecisionRequestKind;
      readonly payload: JsonObject;
    }
  | {
      readonly kind: "wait";
      readonly payload: JsonObject;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(
  battleId: string,
  player: BattleSide,
  lineIndex: number,
  detail: string
): never {
  throw new PlayerProtocolTranslatorError(
    "malformed-request",
    battleId,
    player,
    `malformed request: ${detail}`,
    lineIndex
  );
}

export function parsePlayerRequestLine(
  line: string,
  battleId: string,
  player: BattleSide,
  lineIndex: number
): ParsedPlayerRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(REQUEST_PREFIX.length));
  } catch {
    malformed(battleId, player, lineIndex, "invalid JSON");
  }

  if (!isObject(parsed)) malformed(battleId, player, lineIndex, "root must be an object");
  const payload = parsed;
  const side = payload.side;
  if (!isObject(side)) malformed(battleId, player, lineIndex, "side must be an object");
  if (side.id !== "p1" && side.id !== "p2") {
    malformed(battleId, player, lineIndex, "side.id must be p1 or p2");
  }
  if (side.id !== player) {
    throw new PlayerProtocolTranslatorError(
      "routing-mismatch",
      battleId,
      player,
      `embedded side.id mismatch: expected ${player}, received ${side.id}`,
      lineIndex
    );
  }
  if (
    !Array.isArray(side.pokemon) ||
    !side.pokemon.every((pokemon) => isObject(pokemon))
  ) {
    malformed(battleId, player, lineIndex, "side.pokemon must be an array of objects");
  }

  const present = DISCRIMINATORS.filter((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
  if (present.length === 0) {
    throw new PlayerProtocolTranslatorError(
      "unsupported-request",
      battleId,
      player,
      "unsupported request: no recognized discriminator",
      lineIndex
    );
  }
  if (present.length !== 1) {
    malformed(battleId, player, lineIndex, "expected exactly one discriminator");
  }

  switch (present[0]!) {
    case "teamPreview":
      if (payload.teamPreview !== true) {
        malformed(battleId, player, lineIndex, "teamPreview must be true");
      }
      return { kind: "decision", requestKind: "team-preview", payload: payload as JsonObject };

    case "active":
      if (
        !Array.isArray(payload.active) ||
        payload.active.length === 0 ||
        !payload.active.every((active) => isObject(active))
      ) {
        malformed(battleId, player, lineIndex, "active must be a non-empty array of objects");
      }
      return { kind: "decision", requestKind: "move", payload: payload as JsonObject };

    case "forceSwitch": {
      const forceSwitch = payload.forceSwitch;
      if (
        !Array.isArray(forceSwitch) ||
        forceSwitch.length === 0 ||
        !forceSwitch.every((required) => typeof required === "boolean")
      ) {
        malformed(
          battleId,
          player,
          lineIndex,
          "forceSwitch must be a non-empty boolean array"
        );
      }
      if (!forceSwitch.some((required) => required)) {
        malformed(battleId, player, lineIndex, "forceSwitch must contain true");
      }
      const revival = side.pokemon.some((pokemon) => pokemon.reviving === true);
      return {
        kind: "decision",
        requestKind: revival ? "revival-blessing" : "forced-switch",
        payload: payload as JsonObject,
      };
    }

    case "wait":
      if (payload.wait !== true) malformed(battleId, player, lineIndex, "wait must be true");
      return { kind: "wait", payload: payload as JsonObject };
  }
}
