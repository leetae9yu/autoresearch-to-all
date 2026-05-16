# Autoresearch Qualitative Architecture

## Module Overview

The Skill has two layers:

- **Skill front door**: the user-facing CLI/Skill interface described in `SKILL.md`. It accepts an explicit config path, explains the operating model, starts a run, and points operators to ledger/report artifacts.
- **Internal reusable contract**: the implementation-facing modules below. They must remain testable without relying on a specific provider SDK or a monolithic agent runtime.

Internal modules:

1. `config` — config validation and defaults. Validates required fields, normalizes paths, applies conservative defaults only for template generation or explicit config completion, and fails closed when required budgets or authorities are missing.
2. `safety` — preflight checks and sandbox controls. Verifies workspace boundaries, protected paths, allowed commands, budget limits, evidence redaction settings, and mutation constraints before baseline or experiment steps run.
3. `adapter` — project discovery, baseline, agent handoff, experiment, evidence. Provides project-specific discovery, baseline command execution, worker/subagent prompt dispatch, candidate artifact parsing, bounded experiment application, evidence collection, artifact summarization, and keep/revert operations within the declared workspace.
4. `loop` — unattended experiment orchestration. Coordinates iterations, budget accounting, baseline references, experiment attempts, judge calls, decision policy evaluation, revert/keep actions, and stop conditions.
5. `judge` — LLM-as-judge prompt orchestration. Builds rubric-grounded prompts for host-agent/subagent review, supplies evidence bundles, captures score vectors, rationale, uncertainty, safety concerns, and anti-gaming observations.
6. `ledger` — immutable experiment record keeping. Appends run and iteration records, stores references to evidence artifacts, captures decisions and failures, and prevents silent mutation of historical entries.
7. `report` — final reporting and learning summary. Reads ledger records and evidence summaries to produce the final operator report, retained learnings, rejected hypotheses, and follow-up recommendations.

## Data Flow

The required run flow is:

`Config → Preflight → Baseline → Experiment → Judge → Decision → Ledger → Report`

1. **Config**: The Skill front door receives an explicit config path. Before execution, the host agent runs the pre-run interview and captures answers in config metadata. `config` validates schema, required budgets, declared workspace, allowed commands, judge settings, criteria, evidence policy, interview metadata, and decision policy.
2. **Preflight**: `safety` checks the normalized config against filesystem boundaries, protected paths, budget values, command allowlists, and sandbox controls. Failure stops the run before mutation.
3. **Baseline**: `adapter` discovers the project and executes configured baseline checks. Baseline outputs and artifact summaries become evidence references.
4. **Experiment**: `loop` requests one bounded experiment at a time through `adapter`. If `agent_handoff.command` is configured, the adapter writes a handoff prompt, executes the worker command, parses `candidate.json`, and returns the candidate change. All candidates remain constrained by mutation scopes, budgets, protected paths, and allowed commands.
5. **Judge**: `judge` prepares host-agent/subagent review prompts using baseline evidence, experiment evidence, diffs, command outputs, configured criteria, and rubric text.
6. **Decision**: `loop` evaluates judge scores, command results, safety signals, and decision policy to keep, revert, retry, or stop.
7. **Ledger**: `ledger` appends the immutable iteration record, including the decision and evidence references, regardless of success, rejection, or failure.
8. **Report**: `report` summarizes the run from ledger records and retained evidence, distinguishing kept changes, reverted attempts, unresolved risks, and learnings.

The ledger write occurs for every completed or failed iteration. The final report must be reproducible from ledger and evidence artifacts, not hidden agent state.

## Interface Contracts

These contracts describe responsibilities and exchanged data. Later implementation tasks may choose exact types and file formats, but must preserve the boundaries.

### `config`

Inputs: explicit config path and optional template/default source.

Outputs: validated run config containing project root, objective, budgets, protected paths, allowed commands, baseline commands, judge settings, criteria, evidence policy, and decision policy.

Failures: missing config, missing required budgets, invalid paths, empty unsafe command policy, invalid judge/rubric settings, or decision policy gaps.

### `safety`

Inputs: validated config and current workspace state.

Outputs: preflight result with approved workspace boundary, sandbox controls, budget counters, protected-path matcher, and command execution policy.

Failures: workspace escapes, protected-path conflicts, undeclared mutation scope, missing budget, disallowed command, unsafe evidence retention settings, or pre-existing dirty state that policy forbids.

### `adapter`

Inputs: validated config, preflight controls, iteration plan, and decision action.

Outputs: discovery summary, baseline result, experiment result, diff summary, command outputs, evidence artifact references, revert/keep status.

Failures: unsupported project shape, baseline failure, experiment crash, evidence collection failure, revert failure, or attempted mutation outside declared workspace.

### `loop`

Inputs: validated config, preflight result, adapter implementation, judge implementation, ledger writer, and report writer.

Outputs: run status, iteration outcomes, final decision summary, and report location.

Failures: budget exhaustion, repeated rejected experiments, unrecoverable adapter failure, judge failure, ledger write failure, or safety violation.

### `judge`

Inputs: objective, criteria, rubric, baseline evidence, experiment evidence, diff summary, command outputs, and safety notes.

Outputs: score vector, rationale, confidence/uncertainty, evidence gaps, safety concerns, anti-gaming notes, and recommendation.

Failures: missing rubric, incomplete evidence bundle, malformed judge response, or host/subagent review unavailable.

### `ledger`

Inputs: run metadata, config identity, iteration metadata, evidence references, command summaries, judge result, decision, and failure details.

Outputs: append-only run record and iteration records.

Failures: record validation failure, append/write failure, attempt to overwrite historical records, or missing required evidence reference.

### `report`

Inputs: ledger records, retained evidence summaries, final workspace status, and run metadata.

Outputs: final report with objective, config summary, kept changes, reverted experiments, judge score trends, safety events, learning summary, and recommended next steps.

Failures: missing ledger, inconsistent evidence reference, or report destination outside declared workspace/artifact policy.

## File Layout

Initial layout for Task 1:

```text
skills/autoresearch-qualitative/
├── SKILL.md
├── ARCHITECTURE.md
├── docs/
│   └── .gitkeep
├── src/
│   └── .gitkeep
├── templates/
│   └── .gitkeep
└── tests/
    └── .gitkeep
```

Planned later additions, still governed by this contract:

- `templates/autoresearch-skill.config.yaml` for conservative explicit config creation.
- `templates/rubric.md`, `templates/judge-prompt.md`, and `templates/review-prompt.md` for judge orchestration.
- `src/` modules for `config`, `safety`, `adapter`, `loop`, `judge`, `ledger`, and `report`.
- `tests/` coverage for config validation, fail-closed safety behavior, adapter contract fixtures, judge prompt assembly, ledger immutability, and report generation.
- `docs/` operator notes and extension guidance.

Implementation must not add direct OpenAI/Anthropic SDK judge integration, distributed execution, multi-repo orchestration, autonomous run without config, ML fine-tuning/RL weight updates, vector DB storage, browser automation unless adapter enables it, or mutation outside declared workspace.
