/**
 * Executable: regenerates every golden case into a scratch directory and
 * byte-compares it against the checked-in `goldens/` tree.
 *
 * This is the command run routinely. It never writes into `goldens/`.
 */
import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";

import { GOLDEN_CASES } from "./golden-cases";
import { GOLDENS_ROOT, GOLDENS_VERIFY_SCRATCH_ROOT } from "./golden-paths";
import { captureGolden, GOLDEN_FILES } from "./golden-recorder";
import { EXPECTED_SHOWDOWN_VERSION, getInstalledShowdownVersion } from "../core/showdown";

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
      `refusing to verify goldens: expected pokemon-showdown@${EXPECTED_SHOWDOWN_VERSION}, found @${showdownVersion}`
    );
  }

  // Start from a clean scratch tree so a stale file can never mask a change.
  await rm(GOLDENS_VERIFY_SCRATCH_ROOT, { recursive: true, force: true });

  const failures: string[] = [];
  let fileCount = 0;

  for (const caseSpec of GOLDEN_CASES) {
    let captured;
    try {
      captured = await captureGolden(caseSpec, GOLDENS_VERIFY_SCRATCH_ROOT, showdownVersion);
    } catch (error) {
      throw new Error(`golden case "${caseSpec.caseId}" failed to regenerate`, { cause: error });
    }

    for (const fileName of GOLDEN_FILES) {
      const relativePath = path.posix.join(captured.relativeDirectory, fileName);
      const expected = await readCheckedInFile(
        path.join(GOLDENS_ROOT, captured.relativeDirectory, fileName)
      );
      fileCount++;
      if (expected === null) {
        failures.push(`${caseSpec.caseId}: missing checked-in file goldens/${relativePath}`);
        continue;
      }
      const actual = captured.files[fileName]!;
      if (actual !== expected) {
        failures.push(
          `${caseSpec.caseId}: byte mismatch in goldens/${relativePath} ` +
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
    throw new Error(`${failures.length} golden file(s) did not match`);
  }

  console.log(
    `OK: verified ${GOLDEN_CASES.length} golden case(s), ${fileCount} file(s) byte-identical.`
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
