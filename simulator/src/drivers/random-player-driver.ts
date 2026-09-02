/**
 * Temporary bridge between the raw simulator interface and Showdown's own
 * `RandomPlayerAI`.
 *
 * `RandomPlayerAI` is foreign code that insists on owning a stream: it
 * `for await`s over one and writes its choices back to it. This driver is the
 * one place that bridge exists, so no real `getPlayerStreams` stream ever
 * escapes `battle-session.ts`. The AI sees the same `|request|` lines in the
 * same order and draws from the same seeded PRNG, so its decisions are
 * unchanged; re-joining a chunk's lines is safe because `BattlePlayer` splits
 * on `\n` and ignores any line not starting with `|`.
 *
 * `RandomPlayerAI` is temporary smoke-test/golden infrastructure. It must not
 * become production agent infrastructure.
 */
import {
  createPlayerBridgeStream,
  createRandomPlayerAI,
  type ShowdownPRNGSeed,
} from "../core/showdown";
import type { ChunkOutput } from "../core/simulator-messages";

export interface RandomPlayerDriverSpec {
  /** Seed for this side's `RandomPlayerAI` decisions. */
  agentSeed: ShowdownPRNGSeed;
  /**
   * Probability of moving rather than switching when both are legal. Must be
   * strictly between 0 and 1 to make voluntary switches possible: `move: 0` is
   * invalid because `RandomPlayerAI` treats it as the default `1`. This is a
   * property of this temporary driver, not of the simulator.
   */
  move?: number;
}

/**
 * Drives one side with `RandomPlayerAI` until its chunk iterable ends.
 *
 * Resolves when both the AI and the chunk pump have finished; rejects with the
 * AI's own error if the AI fails, promptly and without waiting for a pump that
 * a failed AI would never unblock.
 */
export async function runRandomPlayer(
  chunks: AsyncIterable<ChunkOutput>,
  submitChoice: (choice: string) => void,
  spec: RandomPlayerDriverSpec
): Promise<void> {
  if (spec.move !== undefined && !(spec.move > 0 && spec.move <= 1)) {
    throw new Error(
      `invalid move probability for RandomPlayerAI: expected a value in (0, 1], got ${spec.move}`
    );
  }

  const bridge = createPlayerBridgeStream(submitChoice);
  const ai = createRandomPlayerAI(
    bridge,
    spec.agentSeed,
    spec.move === undefined ? {} : { move: spec.move }
  );

  // Explicit iterator rather than `for await` sugar: the AI-failure handler
  // below needs a concrete object to `return()`. This is strictly this
  // driver's own per-side queue iterator, never the session's outputs.
  const iterator = chunks[Symbol.asyncIterator]();

  let pushEndIssued = false;
  const pushEndOnce = (): void => {
    if (pushEndIssued) return;
    pushEndIssued = true;
    bridge.pushEnd();
  };

  // The AI must already be consuming before chunks are pumped in: a
  // pump-then-start ordering would deadlock any battle whose first request
  // arrives before the AI is listening.
  const aiDone = ai.start();

  let aiError: unknown = null;
  let aiFailed = false;
  let pumpDone: Promise<void> | null = null;

  // Attached immediately at the promise's creation, so a late failure can
  // never surface as an unhandled rejection.
  const aiSettled = aiDone.then(
    () => undefined,
    (error: unknown) => {
      aiFailed = true;
      aiError = error;
      // A failed AI stops consuming the bridge, so a pump blocked on the next
      // chunk would keep this driver pending indefinitely. Cancel only this
      // driver's input; the session and the other side are untouched.
      void iterator.return?.();
      pushEndOnce();
      // Observe the pump's own settlement so it can never become unhandled.
      void pumpDone?.catch(() => undefined);
    }
  );

  pumpDone = (async () => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done === true) return;
        bridge.push(next.value.lines.join("\n"));
      }
    } finally {
      // Driven by iterable completion (or by AI failure), never by a terminal
      // message: drivers never receive one.
      pushEndOnce();
    }
  })();

  await aiSettled;
  // Reject with the original AI error, preserving AI-before-pump precedence.
  if (aiFailed) throw aiError;
  await pumpDone;
}
