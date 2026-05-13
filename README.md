# autoresearch-to-all

Autoresearch-style qualitative harness engineering for coding agents.

This repository contains a reusable `autoresearch-qualitative` skill that generalizes the repeated experiment loop from quantitative metric optimization into qualitative project-improvement runs: explicit config, safety preflight, evidence capture, LLM-as-judge review, keep/revert decisions, immutable ledger entries, and final reports.

Inspired by Andrej Karpathy's [`autoresearch`](https://github.com/karpathy/autoresearch), but designed as a generic qualitative harness rather than a single scalar-metric training benchmark.

## What is included

- `skills/autoresearch-qualitative/SKILL.md` — skill operating guide
- `skills/autoresearch-qualitative/ARCHITECTURE.md` — module and data-flow contract
- `skills/autoresearch-qualitative/src/` — config, safety, adapter, ledger, judge, loop, and report modules
- `skills/autoresearch-qualitative/templates/` — config, rubric, judge, and review templates
- `skills/autoresearch-qualitative/tests/` — unit, integration, and fixture E2E tests

## Install for Codex

Run this from the project where you want Codex to use the skill:

```bash
curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash
```

This installs the skill to `.codex/skills/autoresearch-qualitative` and copies a starter `autoresearch-skill.config.yaml` when one does not already exist.

Then add this to your project instructions, such as `AGENTS.md`:

```md
Use `.codex/skills/autoresearch-qualitative/SKILL.md` for qualitative autoresearch loops.
Require explicit config at `autoresearch-skill.config.yaml` before mutating code.
```

Install options:

```bash
# Install somewhere else, e.g. OpenCode-style skills
AUTORESEARCH_TO_ALL_TARGET_DIR=.opencode/skills/autoresearch-qualitative \
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash

# Skip copying the starter config
AUTORESEARCH_TO_ALL_INSTALL_CONFIG=0 \
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash
```

## Verify

```bash
cd skills/autoresearch-qualitative
npx tsc --noEmit
node --test tests/*.test.ts
bash tests/verify-templates.sh
```

## License

MIT. See `LICENSE`.
