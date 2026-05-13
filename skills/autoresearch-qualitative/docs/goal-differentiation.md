# `/goal` Differentiation and Skill Positioning

## What `/goal` does

OpenAI Codex CLI and Claude Code both expose a `/goal` command. Public docs describe it as a way to set a durable objective for the current session and resume work toward that objective across interruptions. It is a session-level continuation control, not a research harness.

What is publicly documented:
- `/goal` persists intent so the agent can return to a stated objective after context shifts or breaks.
- It acts as a user-facing steering mechanism inside a single interactive session.

What is not publicly documented:
- Repeated controlled trials with explicit variants.
- Immutable evidence capture and qualitative coding.
- Score-vector rubrics, guardrail overrides, or aggregation across experiments.
- Reproducible experiment ledgers or research artifact output.

Because those capabilities are not publicly documented, this document treats them as outside the scope of `/goal` unless and until public docs change.

## What this Skill does

`autoresearch-qualitative` is an empirical evaluation harness. It runs unattended, repeated experiments over a target project, captures evidence per trial, scores outcomes with an LLM-as-judge, and keeps or reverts changes based on declared criteria. The unit of work is a bounded experiment, not a session.

## Comparison

| Dimension | OpenAI/Anthropic `/goal` | `autoresearch-qualitative` Skill |
|-----------|--------------------------|----------------------------------|
| **Unit of work** | Single session continuation | Repeated bounded experiment |
| **Purpose** | Persistent objective inside one session | Empirical evaluation and research-led improvement |
| **Evidence model** | Not publicly documented | Immutable per-experiment evidence files with diff, logs, and judge notes |
| **Experimental control** | Not publicly documented | Explicit run config, safety preflight, protected paths, command allowlists, timeout/iteration budgets |
| **Aggregation** | Not publicly documented | Ledger with checksum chaining, score vectors, and cross-trial summary |
| **Reproducibility** | Not publicly documented | Git-based baselines, candidate commits, diff hashes, and run-id directories |
| **Agent-agnostic orchestration** | Not publicly documented | Adapter contract for project discovery, checks, judging, and keep/revert decisions |
| **Longitudinal feedback** | Not publicly documented | Final report with reusable learnings and transferable heuristics |
| **Research artifact output** | Not publicly documented | Structured report, rubric scores, guardrail failures, and learning summary |

## Complementary, not competitive

`/goal` and this Skill solve different problems.

- `/goal` keeps a session on track. It is useful when you want the agent to remember what it is doing while you step away or switch tasks.
- This Skill runs experiments. It is useful when you want the agent to try a change, measure whether it helped, record why, and decide whether to keep it, across many trials.

You can use both together. Set a `/goal` that describes the overall improvement target, then invoke the Skill inside that session to execute the empirical loop. The Skill does not replace session management; it adds experimental rigor on top of it.

## Uncertainty disclaimer

Public docs for `/goal` may change. Any claim in this document that is marked "not publicly documented" should be re-checked against the latest official documentation for OpenAI Codex CLI and Claude Code before publishing.

## Status

This document reflects the state of public documentation as of the date of the Skill release. The Skill maintains its own versioning and changelog independently of any CLI tool updates.
