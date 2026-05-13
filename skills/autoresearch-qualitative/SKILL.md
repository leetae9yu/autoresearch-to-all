# Autoresearch Qualitative Skill

## Purpose

`autoresearch-qualitative` is a Skill front door for running guarded, unattended qualitative improvement experiments inside a declared project workspace. It generalizes the autoresearch loop from optimizing a single scalar metric to iterating on project changes that are reviewed through evidence, rubric-scored judgment, and explicit keep/revert decisions.

The Skill is user-facing: it explains how an operator selects a config, what artifacts are produced, and which safety boundaries apply. The internal reusable contract lives in `ARCHITECTURE.md` and is intended for implementation modules, tests, adapters, and future automation tasks.

## Usage

Use the Skill when a project has an explicit experiment objective, a bounded workspace, allowed commands, baseline checks, mutation limits, judge criteria, and evidence retention settings. A normal run follows this high-level sequence:

1. Operator invokes the Skill with an explicit config path.
2. The Skill validates config and safety budgets before any project mutation.
3. The adapter discovers the project and records baseline evidence.
4. The loop applies one bounded experiment at a time within declared mutation scopes.
5. The judge evaluates evidence against the configured rubric and criteria.
6. The decision policy keeps or reverts the experiment.
7. The ledger records the immutable outcome and the report summarizes learnings.

The Skill must refuse execution when the config is absent, incomplete, or outside safety limits. Documentation-only, dry-run, or report-only modes may exist later, but execution modes still require explicit configuration.

## Config

The config is the run authority. It declares the project root, objective, budgets, protected paths, allowed commands, baseline commands, judge mode, rubric, criteria, evidence policy, and decision policy.

Config responsibilities:

- Define the workspace where mutation is allowed.
- Set required budgets such as max iterations, max runtime, and max diff size.
- List commands that the Skill may execute.
- List paths that must never be modified.
- Describe judge criteria and rubric inputs.
- Define evidence retention and redaction behavior.
- Define keep/revert policy for experiment decisions.

No autonomous run may begin without an explicit config. Defaults may help operators create a config, but defaults must not silently authorize mutation.

## Safety

Safety is fail-closed. The Skill must perform preflight checks before baseline collection or mutation, and later implementation must preserve these boundaries:

- Mutate only inside the declared workspace.
- Never mutate protected paths.
- Execute only commands allowed by config.
- Enforce runtime, iteration, and diff-size budgets.
- Preserve baseline evidence before experiments.
- Revert experiments when checks fail, judge policy rejects the change, or budgets are exceeded.
- Redact or exclude configured sensitive artifacts from retained evidence.
- Record failures in the ledger rather than hiding them.

The Skill does not grant itself permissions from project discovery. Discovery may inform reporting, but config remains the source of authority.

## Ledger

The ledger is the immutable experiment record. Each experiment entry should capture the config identity, iteration number, baseline reference, mutation summary, commands run, evidence paths, judge inputs, judge scores, decision, revert/keep action, timestamps, and failure details.

Ledger records are append-only. Later tasks may define the storage format, but the contract is that reports and learning summaries must be derived from recorded evidence rather than unstated agent memory.

## Judge

The judge evaluates qualitative outcomes using the host coding agent and/or subagent review path rather than direct provider SDK integration. Judge orchestration prepares prompts from the configured rubric, criteria, baseline evidence, experiment diff, command outputs, and artifact summaries.

The judge should produce a score vector and rationale that the decision policy can consume. It must also call out uncertainty, evidence gaps, safety concerns, and signs of metric gaming.

## Non-goals

This Skill explicitly does not provide:

- no direct OpenAI/Anthropic SDK judge integration
- no distributed execution
- no multi-repo orchestration
- no autonomous run without config
- no ML fine-tuning/RL weight updates
- no vector DB
- no browser automation unless adapter enables it
- no mutation outside declared workspace
- no generic agent backend abstraction for Codex/Claude execution in the MVP

These non-goals keep the MVP safe, testable, and compatible with host-agent/subagent review rather than provider-specific automation.

## /goal Difference

OpenAI and Anthropic `/goal`-style workflows are user-facing goal execution commands inside their respective agents. `autoresearch-qualitative` is different in two ways:

- The Skill front door is the operator interface for a bounded qualitative experiment run with explicit config, budgets, evidence, judge review, ledger, and report artifacts.
- The internal reusable contract is a testable library/module architecture for config validation, safety preflight, project adapters, loop orchestration, judge prompt orchestration, immutable ledger writes, and final reporting.

The Skill does not attempt to replace `/goal`, wrap provider-specific goal systems, or create a generic backend abstraction for them. It defines a portable experiment harness contract that later tasks can implement safely.
