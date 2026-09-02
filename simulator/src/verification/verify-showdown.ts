/**
 * Executable verification program for Step 2.
 *
 * Confirms that the pinned `pokemon-showdown` package is installed at the
 * expected version and that the Generation 9 Random Battle format resolves
 * correctly. This program does not start a server, generate a team, or run
 * a battle.
 */
import {
  EXPECTED_SHOWDOWN_VERSION,
  getFormatGeneration,
  getGen9RandomBattleFormat,
  getInstalledShowdownVersion,
  resolveRuleTable,
} from "../core/showdown";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const installedVersion = getInstalledShowdownVersion();
  assert(
    installedVersion === EXPECTED_SHOWDOWN_VERSION,
    `expected pokemon-showdown@${EXPECTED_SHOWDOWN_VERSION}, found @${installedVersion}`
  );

  const format = getGen9RandomBattleFormat();
  assert(format.exists === true, "gen9randombattle format does not exist");
  assert(format.id === "gen9randombattle", `unexpected format id: ${format.id}`);
  assert(format.effectType === "Format", `unexpected effectType: ${format.effectType}`);
  assert(format.gameType === "singles", `unexpected gameType: ${format.gameType}`);
  assert(format.team === "random", `unexpected team generator: ${format.team}`);

  const generation = getFormatGeneration(format);
  assert(generation === 9, `expected Dex.forFormat(format).gen === 9, got ${generation}`);

  // Resolving the rule table must not throw for a valid, existing format.
  resolveRuleTable(format);

  console.log(
    `OK: pokemon-showdown@${installedVersion} gen9randombattle verified (gen ${generation}).`
  );
}

main();
