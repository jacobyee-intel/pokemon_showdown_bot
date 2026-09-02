import type { BattleSide, ChunkOutput } from "../core/simulator-messages";
import { parsePlayerRequestLine } from "./request-parser";
import {
  PlayerProtocolTranslatorError,
  type PlayerTranslatorEvent,
} from "./translator-messages";

export interface PlayerProtocolTranslatorOptions {
  readonly battleId: string;
  readonly player: BattleSide;
}

export class PlayerProtocolTranslator {
  readonly battleId: string;
  readonly player: BattleSide;

  private nextDecisionId = 0;
  private nextLineIndex = 0;

  constructor(options: PlayerProtocolTranslatorOptions) {
    this.battleId = options.battleId;
    this.player = options.player;
    if (this.battleId.length === 0) {
      throw new PlayerProtocolTranslatorError(
        "invalid-config",
        this.battleId,
        this.player,
        "battleId must not be empty"
      );
    }
  }

  accept(chunk: ChunkOutput): readonly PlayerTranslatorEvent[] {
    if (chunk.battleId !== this.battleId) {
      throw new PlayerProtocolTranslatorError(
        "routing-mismatch",
        this.battleId,
        this.player,
        `chunk battleId mismatch: expected ${this.battleId}, received ${chunk.battleId}`
      );
    }
    if (chunk.player !== this.player) {
      throw new PlayerProtocolTranslatorError(
        "routing-mismatch",
        this.battleId,
        this.player,
        `chunk player mismatch: expected ${this.player}, received ${chunk.player}`
      );
    }

    const events: PlayerTranslatorEvent[] = [];
    for (const line of chunk.lines) {
      const lineIndex = this.nextLineIndex++;
      if (!line.startsWith("|request|")) continue;

      const request = parsePlayerRequestLine(line, this.battleId, this.player, lineIndex);
      if (request.kind === "wait") {
        events.push({
          kind: "wait",
          battleId: this.battleId,
          player: this.player,
          payload: request.payload,
        });
        continue;
      }
      events.push({
        kind: "decision",
        battleId: this.battleId,
        player: this.player,
        decisionId: this.nextDecisionId++,
        requestKind: request.requestKind,
        payload: request.payload,
      });
    }
    return events;
  }
}
