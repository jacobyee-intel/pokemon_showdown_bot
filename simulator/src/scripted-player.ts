/**
 * A deterministic player driven by a fixed, ordered list of raw choice
 * strings.
 *
 * This helper reads raw chunks directly from the player's stream (the object
 * `getPlayerStreams` returns) and has no dependency on `RandomPlayerAI` or
 * `BattlePlayer`. It deliberately does not parse requests into a typed
 * structure and does not infer legality: the author of a scripted scenario is
 * fully responsible for supplying choices that are legal for the exact team
 * and turn order they authored. That responsibility belongs to the future
 * action adapter, not here. An illegal choice is still reported rather than
 * hidden: Showdown answers it with an `|error|` line and no new request, so
 * this player treats any `|error|` on its side as fatal.
 */
import type { ShowdownPlayerStream } from "./showdown";

export type ScriptedSide = "p1" | "p2";

export interface ScriptedPlayerOptions {
  /** Which side of the battle this player drives (used in error messages). */
  side: ScriptedSide;
  /** One choice per non-`wait` `|request|` line the side receives, in order. */
  choices: readonly string[];
  /**
   * Only forced-terminal cases may set this.
   *
   * It permits both unconsumed choices and requests that arrive with no choice
   * left. The plan for this step assumed a recorded terminal command such as
   * `>forcetie` ends the battle before any request reaches a side. In the
   * pinned simulator that is not quite true: `gen9customgame` starts with Team
   * Preview, and that request is queued to both sides while `>start`/`>player`
   * is processed — before the following `>forcetie` command is relayed to the
   * per-side streams. The request therefore still arrives even though the
   * battle has already ended and no decision is possible (answering it would
   * only produce an `|error|` line). Ignoring it is the smallest correct
   * adjustment; every non-terminal case still requires an exact one-to-one
   * match between requests and choices.
   */
  allowUnansweredRequests?: boolean;
}

/**
 * Drives one side until its stream ends. Resolves when the battle stream
 * closes; rejects if the script and the battle disagree.
 */
export async function runScriptedPlayer(
  stream: ShowdownPlayerStream,
  options: ScriptedPlayerOptions
): Promise<void> {
  const { side, choices, allowUnansweredRequests = false } = options;
  let nextChoiceIndex = 0;
  let lastSentIndex: number | null = null;

  for await (const chunk of stream) {
    for (const line of chunk.split("\n")) {
      // An `|error|` line means the simulator rejected what this side sent.
      // No new `|request|` follows it, so the script can never make progress:
      // failing here turns an otherwise unresolvable lifecycle into an
      // actionable rejection.
      if (line.startsWith("|error|")) {
        const detail =
          lastSentIndex === null
            ? "no choice had been sent yet"
            : `last sent choice #${lastSentIndex + 1} (index ${lastSentIndex}) ` +
              `was "${choices[lastSentIndex]}"`;
        throw new Error(
          `scripted player ${side} received a simulator error: ` +
            `${line.slice("|error|".length)} (${detail})`
        );
      }
      if (line.includes('"wait":true')) continue;
      if (!line.startsWith("|request|")) continue;

      if (nextChoiceIndex >= choices.length) {
        if (allowUnansweredRequests) continue;
        throw new Error(
          `scripted player ${side} exhausted its choice list: received request ` +
            `#${nextChoiceIndex + 1} but only ${choices.length} choice(s) were supplied`
        );
      }

      const choice = choices[nextChoiceIndex];
      lastSentIndex = nextChoiceIndex;
      nextChoiceIndex++;
      // `getPlayerStreams` already prefixes everything written to this stream
      // with `>${side} `, so the choice is written bare. Writing `>${side} ...`
      // here would produce a doubled `>p1 >p1 ...` command and be rejected by
      // the simulator.
      void stream.write(choice);
    }
  }

  if (!allowUnansweredRequests && nextChoiceIndex < choices.length) {
    throw new Error(
      `scripted player ${side} finished with ${choices.length - nextChoiceIndex} ` +
        `unused choice(s): no request ever arrived for "${choices[nextChoiceIndex]}"`
    );
  }
}
