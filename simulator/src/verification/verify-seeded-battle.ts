/**
 * Executable verification program for Step 3.
 *
 * Runs one `gen9randombattle` twice from the same fixed master seed, entirely
 * in process, and asserts that both runs are identical. No server is started
 * and no network port is opened.
 */
import { normalizeProtocolLine } from "../core/protocol";
import { runSeededBattle, type SeededBattleResult } from "../drivers/run-seeded-battle";

/** Fixed literal master seed for this verification program. */
const MASTER_SEED = 1;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// The lifecycle already normalizes timestamps; re-normalizing here is
// idempotent and keeps this program's guarantee independent of that detail.
function normalizeLog(log: readonly string[]): string[] {
  return log.map(normalizeProtocolLine);
}

function assertWellFormed(result: SeededBattleResult, label: string): void {
  assert(result.omniscientLog.length > 0, `${label}: omniscient log is empty`);
  assert(
    result.omniscientLog.includes("|turn|1"),
    `${label}: omniscient log has no |turn|1 marker`
  );
  const terminalLines = result.omniscientLog.filter(
    (line) => line === "|tie" || line.startsWith("|win|")
  );
  assert(
    terminalLines.length === 1,
    `${label}: expected exactly one terminal |win|/|tie| line, found ${terminalLines.length}`
  );
  assert(result.turns > 0, `${label}: expected at least one turn, got ${result.turns}`);
  assert(result.masterSeed === MASTER_SEED, `${label}: master seed was not echoed back`);
}

async function main(): Promise<void> {
  const first = await runSeededBattle(MASTER_SEED);
  const second = await runSeededBattle(MASTER_SEED);

  assertWellFormed(first, "run 1");
  assertWellFormed(second, "run 2");

  assert(
    first.winner === second.winner,
    `winner mismatch between runs: ${first.winner} vs ${second.winner}`
  );
  assert(
    first.turns === second.turns,
    `turn count mismatch between runs: ${first.turns} vs ${second.turns}`
  );

  const firstLog = normalizeLog(first.omniscientLog);
  const secondLog = normalizeLog(second.omniscientLog);
  assert(
    firstLog.length === secondLog.length,
    `protocol log length mismatch between runs: ${firstLog.length} vs ${secondLog.length}`
  );
  for (let i = 0; i < firstLog.length; i++) {
    assert(
      firstLog[i] === secondLog[i],
      `protocol log mismatch at line ${i}:\n  run 1: ${firstLog[i]}\n  run 2: ${secondLog[i]}`
    );
  }

  console.log(
    `OK: gen9randombattle master seed ${MASTER_SEED} reproduced exactly ` +
      `(winner ${first.winner}, ${first.turns} turns, ${firstLog.length} protocol lines).`
  );
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
