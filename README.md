# Pokemon Showdown Bot

Initial project placeholder.

See [PLAN.md](PLAN.md) for the high-level roadmap and
[plans/step-01-project-scaffold.md](plans/step-01-project-scaffold.md) for this step's detailed plan.

## Local Toolchain Versions

This project was scaffolded and validated with:

- Node.js `v22.14.0`
- npm `10.9.2`
- Python `3.11.9`

The `engines` field in `package.json` and `requires-python` in `pyproject.toml` document these
versions; they are not strictly enforced.

## Installation

```bash
npm install

python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```

## Validation

```bash
npm run typecheck
npm run build

.venv/bin/python -m pytest
```
