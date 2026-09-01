/**
 * Fixed filesystem locations for protocol fixtures.
 *
 * Capture and verification deliberately use separate roots: capture is the
 * only writer of the version-controlled `fixtures/` tree, and verification
 * regenerates into a gitignored scratch directory under `artifacts/`.
 */
import * as path from "node:path";

/** Repository root, resolved from this module's compiled location. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Version-controlled fixture tree. Written only by `capture-fixtures`. */
export const FIXTURES_ROOT = path.join(REPO_ROOT, "fixtures");

/** Gitignored scratch tree. Written only by `verify-fixtures`. */
export const FIXTURES_VERIFY_SCRATCH_ROOT = path.join(REPO_ROOT, "artifacts", "fixture-verify");
