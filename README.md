# autoresearch-to-all

[한국어](README_ko.md) | English

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
Run the pre-run interview from `.codex/skills/autoresearch-qualitative/templates/pre-run-interview.md` before starting an experiment loop.
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

To check an installed project later:

```bash
curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash -s -- --doctor
```

## Codex goal handoff

The Skill treats Codex `/goal` or any configured worker command as an iteration-local continuation tool, not as durable run state. The harness owns config validation, safety preflight, candidate validation, judge calls, keep/revert decisions, ledger entries, and reports.

## Pre-run interview

Before execution, the host agent should interview the operator to clarify objective, success evidence, protected paths, allowed commands, budgets, decision policy, and evidence retention. The interview answers are stored under `interview.answers` in the config, and execution preflight refuses to proceed while a required interview remains `pending`.

Useful templates:

- `templates/pre-run-interview.md` — interview/question contract for filling config before mutation
- `templates/codex-goal-handoff.md` — prompt handoff for a Codex iteration
- `templates/candidate-contract.json` — candidate artifact schema written by the worker agent
- `templates/fragments/evidence-contract.md` — evidence requirements for qualitative judgment
- `templates/fragments/codex-goal-boundary.md` — boundary between Codex `/goal` and harness state

Recommended flow:

1. The harness creates/fills mission, rubric, and ledger paths.
2. If `agent_handoff.command` is configured, the adapter writes `handoff.md` and runs the worker/subagent command.
3. The worker writes `candidate.json` using the candidate contract, including `candidate_change.diff` or `candidate_change.patch_path`.
4. The harness evaluates, judges, and decides keep/revert.

## Verify

```bash
cd skills/autoresearch-qualitative
npm exec --yes --package typescript -- tsc --noEmit
npm test
npm run verify:templates
```

## License

MIT. See `LICENSE`.
