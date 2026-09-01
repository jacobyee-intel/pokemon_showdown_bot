/**
 * Executable: regenerates every fixture case into a scratch directory and
 * byte-compares it against the checked-in `fixtures/` tree.
 *
 * This is the command run routinely. It never writes into `fixtures/`.
 */
import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";

import { FIXTURE_CASES } from "./fixture-cases";
import { FIXTURES_ROOT, FIXTURES_VERIFY_SCRATCH_ROOT } from "./fixture-paths";
import { captureFixture, FIXTURE_FILES } from "./fixture-recorder";
import { EXPECTED_SHOWDOWN_VERSION, getInstalledShowdownVersion } from "./showdown";

async function readCheckedInFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const showdownVersion = getInstalledShowdownVersion();
  if (showdownVersion !== EXPECTED_SHOWDOWN_VERSION) {
    throw new Error(
      `refusing to verify fixtures: expected pokemon-showdown@${EXPECTED_SHOWDOWN_VERSION}, found @${showdownVersion}`
    );
  }

  // Start from a clean scratch tree so a stale file can never mask a change.
  await rm(FIXTURES_VERIFY_SCRATCH_ROOT, { recursive: true, force: true });

  const failures: string[] = [];
  let fileCount = 0;

  for (const caseSpec of FIXTURE_CASES) {
    let captured;
    try {
      captured = await captureFixture(caseSpec, FIXTURES_VERIFY_SCRATCH_ROOT, showdownVersion);
    } catch (error) {
      throw new Error(`fixture case "${caseSpec.caseId}" failed to regenerate`, { cause: error });
    }

    for (const fileName of FIXTURE_FILES) {
      const relativePath = path.posix.join(captured.relativeDirectory, fileName);
      const expected = await readCheckedInFile(
        path.join(FIXTURES_ROOT, captured.relativeDirectory, fileName)
      );
      fileCount++;
      if (expected === null) {
        failures.push(`${caseSpec.caseId}: missing checked-in file fixtures/${relativePath}`);
        continue;
      }
      const actual = captured.files[fileName]!;
      if (actual !== expected) {
        failures.push(
          `${caseSpec.caseId}: byte mismatch in fixtures/${relativePath} ` +
            `(checked-in ${expected.length} bytes, regenerated ${actual.length} bytes)`
        );
      }
    }
  }

  if (failures.length > 0) {
    // Report every mismatch, not just the first, so a regression is fully
    // visible in one run.
    for (const failure of failures) {
      console.error(`FAIL ${failure}`);
    }
    throw new Error(`${failures.length} fixture file(s) did not match`);
  }

  console.log(
    `OK: verified ${FIXTURE_CASES.length} fixture case(s), ${fileCount} file(s) byte-identical.`
  );
}

// Fail loud: a stalled stream must not exit successfully.
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
