/**
 * Executable: writes the `fixtures/` tree from the frozen case manifest.
 *
 * This is the only program allowed to write into `fixtures/`. Run it
 * deliberately when adding a new case or intentionally changing an existing
 * one (for example after an approved Pokemon Showdown version upgrade). It is
 * not part of routine verification.
 */
import { FIXTURE_CASES } from "./fixture-cases";
import { FIXTURES_ROOT } from "./fixture-paths";
import { captureFixture, FIXTURE_FILES } from "./fixture-recorder";
import { EXPECTED_SHOWDOWN_VERSION, getInstalledShowdownVersion } from "./showdown";

async function main(): Promise<void> {
  const showdownVersion = getInstalledShowdownVersion();
  if (showdownVersion !== EXPECTED_SHOWDOWN_VERSION) {
    throw new Error(
      `refusing to capture fixtures: expected pokemon-showdown@${EXPECTED_SHOWDOWN_VERSION}, found @${showdownVersion}`
    );
  }

  let fileCount = 0;
  for (const caseSpec of FIXTURE_CASES) {
    try {
      const captured = await captureFixture(caseSpec, FIXTURES_ROOT, showdownVersion);
      fileCount += FIXTURE_FILES.length;
      console.log(`captured ${captured.relativeDirectory}`);
    } catch (error) {
      // Stop at the first failing case rather than writing some cases and
      // silently skipping others.
      throw new Error(`fixture case "${caseSpec.caseId}" failed to capture`, { cause: error });
    }
  }

  console.log(
    `OK: captured ${FIXTURE_CASES.length} fixture case(s), ${fileCount} file(s) into ${FIXTURES_ROOT}.`
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
