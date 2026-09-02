/**
 * Executable verification program: an illegal scripted choice must make
 * `runBattleLifecycle` reject with an actionable diagnostic.
 *
 * Showdown answers an illegal choice with an `|error|` line on that side's
 * stream and sends no new `|request|`, so without the scripted player's
 * `|error|` handling the lifecycle would simply never settle. This program
 * fails if the lifecycle resolves, if it stays unsettled, or if the rejection
 * loses the side, Showdown's error text, or the offending choice.
 */
import { runBattleLifecycle } from "../drivers/battle-lifecycle";
import { deriveBattleSeeds } from "../drivers/seed";
import { toShowdownSeed, type ShowdownPokemonSet } from "../core/showdown";

/** Milliseconds to wait before declaring the lifecycle unsettled. */
const SETTLE_TIMEOUT_MS = 20_000;

const ILLEGAL_CHOICE = "move 3";
const ILLEGAL_CHOICE_INDEX = 1;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function soloTeam(name: string, species: string, ability: string, move: string): ShowdownPokemonSet[] {
  return [
    {
      name,
      species,
      item: "",
      ability,
      moves: [move],
      nature: "Hardy",
      gender: "M",
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
    },
  ];
}

async function withinTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`lifecycle never settled within ${SETTLE_TIMEOUT_MS}ms`));
    }, SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  // `move 3` is illegal: this Charizard has exactly one move.
  const lifecycle = runBattleLifecycle({
    formatId: "gen9customgame",
    startSeed: toShowdownSeed(deriveBattleSeeds(1).battle),
    p1: {
      kind: "scripted",
      name: "p1",
      team: soloTeam("Illegal", "Charizard", "Blaze", "Flamethrower"),
      choices: ["default", ILLEGAL_CHOICE],
    },
    p2: {
      kind: "scripted",
      name: "p2",
      team: soloTeam("Target", "Magikarp", "Swift Swim", "Splash"),
      choices: ["default", "move 1"],
    },
  });

  let settled: "resolved" | "rejected";
  let message = "";
  try {
    await withinTimeout(lifecycle);
    settled = "resolved";
  } catch (error) {
    settled = "rejected";
    message = error instanceof Error ? error.message : String(error);
  }

  assert(settled === "rejected", "expected runBattleLifecycle to reject on an illegal choice");
  assert(
    !message.includes("never settled"),
    `runBattleLifecycle stayed unsettled instead of rejecting: ${message}`
  );
  assert(
    message.includes("scripted player p1"),
    `rejection does not name the offending side: ${message}`
  );
  assert(
    message.includes("[Invalid choice]"),
    `rejection does not carry Showdown's error text: ${message}`
  );
  assert(
    message.includes(`#${ILLEGAL_CHOICE_INDEX + 1}`) &&
      message.includes(`index ${ILLEGAL_CHOICE_INDEX}`) &&
      message.includes(`"${ILLEGAL_CHOICE}"`),
    `rejection does not identify the offending choice index and value: ${message}`
  );

  console.log(`OK: illegal scripted choice rejected with an actionable diagnostic: ${message}`);
}

// Fail loud: a stalled promise must not let Node drain its event loop and exit
// successfully without reporting completion.
process.exitCode = 1;

main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }
);
