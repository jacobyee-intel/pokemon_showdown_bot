/**
 * Executable: writes the `goldens/` tree from the frozen case manifest.
 *
 * This is the only program allowed to write into `goldens/`. Run it
 * deliberately when adding a new case or intentionally changing an existing
 * one (for example after an approved Pokemon Showdown version upgrade). It is
 * not part of routine verification.
 */
import { GOLDEN_CASES } from "./golden-cases";
import { GOLDENS_ROOT } from "./golden-paths";
import { captureGolden, GOLDEN_FILES } from "./golden-recorder";
import { EXPECTED_SHOWDOWN_VERSION, getInstalledShowdownVersion } from "../core/showdown";

async function main(): Promise<void> {
  const showdownVersion = getInstalledShowdownVersion();
  if (showdownVersion !== EXPECTED_SHOWDOWN_VERSION) {
    throw new Error(
      `refusing to capture goldens: expected pokemon-showdown@${EXPECTED_SHOWDOWN_VERSION}, found @${showdownVersion}`
    );
  }

  let fileCount = 0;
  for (const caseSpec of GOLDEN_CASES) {
    try {
      const captured = await captureGolden(caseSpec, GOLDENS_ROOT, showdownVersion);
      fileCount += GOLDEN_FILES.length;
      console.log(`captured ${captured.relativeDirectory}`);
    } catch (error) {
      // Stop at the first failing case rather than writing some cases and
      // silently skipping others.
      throw new Error(`golden case "${caseSpec.caseId}" failed to capture`, { cause: error });
    }
  }

  console.log(
    `OK: captured ${GOLDEN_CASES.length} golden case(s), ${fileCount} file(s) into ${GOLDENS_ROOT}.`
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
