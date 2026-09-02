# Step 2: Pin Pokemon Showdown

## Objective

Add the canonical Pokemon Showdown simulator as an exact npm dependency and verify that the current Generation 9 Random Battle format can be loaded. Do not run battles or add simulator behavior yet.

## Dependency

Use the published npm package:

```json
{
  "dependencies": {
    "pokemon-showdown": "0.11.11"
  }
}
```

Do not use a caret or tilde range.

Release provenance:

```text
npm package:     pokemon-showdown@0.11.11
upstream commit: 739a5e1fee432ad80ff7136d70cca993be358b59
```

`package-lock.json` must record the resolved package tarball and integrity hash.

Before installing, confirm that the repository filesystem has at least 300 MB of available quota. The published package and its dependency tree require substantial disk space despite only the simulator API being used.

## Structure

```text
pokemon_showdown_bot/
├── simulator/
│   └── src/
│       ├── main.ts
│       ├── core/
│       │   └── showdown.ts
│       └── verification/
│           └── verify-showdown.ts
├── plans/
│   └── step-02-pin-showdown.md
├── package.json
├── package-lock.json
└── README.md
```

## Integration Boundary

All application imports from Pokemon Showdown must pass through `simulator/src/core/showdown.ts`. No other project file should import `pokemon-showdown` or its internal paths directly.

The boundary should initially expose only what Step 2 needs:

```typescript
export const EXPECTED_SHOWDOWN_VERSION = "0.11.11";

export type ShowdownFormat = ReturnType<typeof Dex.formats.get>;

export function getInstalledShowdownVersion(): string {
  // Read the installed package metadata within this boundary.
}

export function getGen9RandomBattleFormat(): ShowdownFormat {
  // Resolve gen9randombattle through Pokemon Showdown's public simulator API.
}
```

Later steps may extend this boundary with `BattleStream`, `getPlayerStreams`, `Dex`, and other required simulator APIs. Do not expose them before they are needed.

Enable `resolveJsonModule` if package metadata is imported as JSON. Keep package metadata access inside `showdown.ts`; other project files must not import `pokemon-showdown/package.json`.

The upstream commit is release provenance recorded in the plan and README, not runtime-verifiable metadata. The published package does not contain its npm `gitHead`. Runtime verification must rely on the exact installed version and lockfile integrity.

Pokemon Showdown's published declarations depend on ambient project types that are not fully referenced from its package entry point. Keep the existing `skipLibCheck: true`; do not add local declarations or unsafe casts to repair upstream declaration errors.

## Verification Program

Use `simulator/src/verification/verify-showdown.ts` as a small executable verification program. Avoid adding Jest, Vitest, or another test framework during this step.

It must fail with a nonzero exit status unless all of the following are true:

1. The installed `pokemon-showdown` package version is `0.11.11`.
2. The resolved object has `exists === true`.
3. Its ID is exactly `gen9randombattle`.
4. Its effect type is `Format`, rather than a rule or condition.
5. Its game type is `singles`.
6. Its team generator is `random`.
7. `Dex.forFormat(format).gen === 9`.
8. Its rule table resolves without throwing.

Do not use `format.gen` for the generation check; this field is `0` for `gen9randombattle` in the pinned release. Use the format-specific Dex returned by `Dex.forFormat(format)`.

Add an npm script that builds the TypeScript project and runs the compiled verification program:

```json
{
  "scripts": {
    "verify:showdown": "npm run build && node simulator/dist/verification/verify-showdown.js"
  }
}
```

The verification program should use explicit assertions and print one short success message. It must not start a server, open a port, generate a team, or run a battle.

## Documentation

Update `README.md` with:

- The pinned Pokemon Showdown version.
- The corresponding upstream commit.
- The `npm run verify:showdown` command.
- A note that the dependency runs locally and does not require a Pokemon Showdown server.

## Upgrade Policy

Updating Pokemon Showdown must be intentional:

1. Select a new exact npm version.
2. Obtain and record that release's npm `gitHead` using `npm view pokemon-showdown@<version> gitHead`.
3. Update the version and commit constants together.
4. Regenerate `package-lock.json`.
5. Run all existing simulator and trainer validations.
6. Once protocol fixtures exist, regenerate or verify them before accepting the upgrade.

Do not update Pokemon Showdown automatically during unrelated dependency maintenance.

## Future Vendoring

Vendoring is explicitly deferred. Preserve an easy migration path by keeping all imports behind `showdown.ts`.

If vendoring becomes necessary, prefer changing the dependency to:

```json
{
  "dependencies": {
    "pokemon-showdown": "file:vendor/pokemon-showdown"
  }
}
```

This allows existing imports to remain unchanged.

Vendor published package contents with an existing `dist/` directory, or explicitly add a reproducible build for a source checkout. A bare repository checkout does not contain the compiled entry point expected by the package metadata.

## Work

1. Confirm at least 300 MB of available filesystem quota.
2. Add the dependency with `npm install --save-exact pokemon-showdown@0.11.11`.
3. Regenerate and commit `package-lock.json`.
4. Add the minimal `showdown.ts` integration boundary.
5. Add the executable verification program.
6. Add `verify:showdown` to the npm scripts.
7. Update `README.md`.
8. Run the completion checks.

## Explicitly Out of Scope

- Vendoring or modifying Pokemon Showdown
- Git submodules
- Starting a Pokemon Showdown server
- Running battles
- Generating Random Battle teams
- Capturing protocol fixtures
- State tracking
- Action generation or masking
- Python integration
- PyTorch
- Additional test frameworks

## Completion Checks

```bash
npm ci
npm run typecheck
npm run build
npm run verify:showdown

.venv/bin/python -m pytest
git status --short
```

## Completion Criteria

1. A clean `npm ci` installs exactly `pokemon-showdown@0.11.11`.
2. The package version is verified in code, while the upstream commit is recorded as documentation-only provenance.
3. TypeScript imports Pokemon Showdown without custom declarations or unsafe casts.
4. `gen9randombattle` resolves as an existing random-team Generation 9 singles format with a valid rule table.
5. The verification program exits successfully.
6. Existing TypeScript and Python validations continue to pass.
7. No server, database, client, submodule, vendored source, or battle runner is added.
