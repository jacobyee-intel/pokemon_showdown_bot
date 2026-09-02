/**
 * Fixed filesystem locations for protocol goldens.
 *
 * Capture and verification deliberately use separate roots: capture is the
 * only writer of the version-controlled `goldens/` tree, and verification
 * regenerates into a gitignored scratch directory under `artifacts/`.
 */
import * as path from "node:path";

/** Repository root, resolved from this module's compiled location. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Version-controlled golden tree. Written only by `capture-goldens`. */
export const GOLDENS_ROOT = path.join(REPO_ROOT, "goldens");

/** Gitignored scratch tree. Written only by `verify-goldens`. */
export const GOLDENS_VERIFY_SCRATCH_ROOT = path.join(REPO_ROOT, "artifacts", "golden-verify");
