# Step 1: Minimal Project Scaffold

## Objective

Create the smallest useful dual-language project scaffold. This step establishes local TypeScript and Python development without adding simulator or training functionality.

## Structure

```text
pokemon_showdown_bot/
├── simulator/
│   └── src/
│       └── main.ts
├── trainer/
│   ├── src/
│   │   └── pokemon_showdown_bot/
│   │       └── __init__.py
│   └── tests/
│       └── test_import.py
├── config/
│   └── README.md
├── schemas/
│   └── README.md
├── artifacts/
│   └── .gitkeep
├── plans/
│   └── step-01-project-scaffold.md
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── pyproject.toml
├── README.md
└── PLAN.md
```

## Directory Responsibilities

- `simulator/` contains the TypeScript Pokemon Showdown integration.
- `trainer/` contains the Python and PyTorch training code.
- `schemas/` contains versioned Node-to-Python contracts.
- `config/` contains future simulator, model, training, and evaluation settings.
- `artifacts/` contains generated checkpoints, trajectories, evaluations, and logs.
- `plans/` contains one implementation plan per step from the high-level roadmap.

## Work

1. Record the supported local Node, npm, and Python versions in `README.md`. Treat `package.json` engine ranges as documentation rather than strict enforcement.
2. Create the directories and placeholder files shown above.
3. Configure strict TypeScript compilation using Node's `NodeNext` module and module-resolution settings. Keep the package in CommonJS mode for compatibility with Pokemon Showdown and verify the entry point compiles under that mode.
4. Compile `simulator/src` into `simulator/dist`.
5. Declare TypeScript and `@types/node` as npm development dependencies and add scripts for compiling and type-checking the inert TypeScript entry point.
6. Set `engines.node` and `engines.npm` in `package.json`.
7. Configure `pyproject.toml` with a setuptools build backend, project name and version, explicit package discovery under `trainer/src`, and pytest discovery under `trainer/tests`.
8. Set `requires-python` and declare a `dev` optional dependency containing pytest.
9. Add a minimal Python import test.
10. Add explicit ignore rules for `node_modules/`, `simulator/dist/`, `.venv/`, `__pycache__/`, `*.py[cod]`, `.pytest_cache/`, `*.egg-info/`, `.env`, and generated artifacts.
11. Preserve the empty artifact directory with `artifacts/*` and `!artifacts/.gitkeep` ignore rules.
12. Document local installation and validation commands in `README.md`.
13. Generate and commit the npm lockfile.

## Explicitly Out of Scope

- Continuous integration
- Pokemon Showdown
- PyTorch
- Linters and formatters
- Application architecture placeholders
- Battle simulation
- Observation schemas
- Training and evaluation logic
- Training and evaluation commands

## Local Commands

```bash
npm install
npm run typecheck
npm run build

python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest
```

## Completion Criteria

1. TypeScript compiles successfully.
2. The Python package installs and imports successfully.
3. The Python import test passes.
4. Generated dependencies, caches, build output, logs, trajectories, evaluations, and checkpoints are ignored.
5. After running all local commands, `git status --porcelain` produces no output.
6. From a fresh clone, `npm ci` and the documented Python setup and test commands succeed end to end.
