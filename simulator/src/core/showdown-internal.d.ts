/**
 * Minimal ambient declaration for one internal `pokemon-showdown` runtime
 * module that ships without a declaration file.
 *
 * Only the surface actually used by `showdown.ts` is declared here. Showdown's
 * raw TypeScript sources are deliberately not imported and its broader internal
 * types are deliberately not copied into this project.
 */
declare module "pokemon-showdown/dist/sim/tools/random-player-ai" {
  import type { PRNG, Streams } from "pokemon-showdown";

  export class RandomPlayerAI {
    constructor(
      playerStream: Streams.ObjectReadWriteStream<string>,
      options?: {
        move?: number;
        mega?: number;
        seed?: ReturnType<typeof PRNG.generateSeed> | null;
      },
      debug?: boolean
    );

    start(): Promise<void>;
  }
}
