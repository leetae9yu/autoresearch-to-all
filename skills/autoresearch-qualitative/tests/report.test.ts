import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  categorizeFailure,
  computeScoreTrends,
  deriveRecommendations,
  generateReport,
  redactSecrets,
} from "../src/report.ts";
import { createLedgerEntry } from "../src/ledger.ts";

function createTempProject(): any {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-report-test-"));
}

function completeEntry(overrides: any = {}): any {
  return createLedgerEntry({
    run_id: "report-run",
    iteration: 0,
    baseline_commit: "base-commit",
    candidate_commit: "candidate-commit",
    diff: "diff --git a/file b/file",
    objective: "Improve qualitative behavior safely.",
    frozen_criteria: [{ id: "correctness", weight: 1 }],
    commands: ["node -e true"],
    outputs: [{ command: "node -e true", status: 0, stdout: "", stderr: "" }],
    evidence_paths: ["evidence/report.txt"],
    judge_verdicts: [{ verdict: "pass" }],
    scores: { correctness: 1 },
    decision: "keep",
    rationale: "Evidence improved.",
    timestamp: "2026-05-13T00:00:00.000Z",
    ...overrides,
  });
}

function writeLedger(projectRoot: any, entries: any): any {
  const runDir = path.join(projectRoot, ".autoresearch-runs", "report-run");
  fs.mkdirSync(runDir, { recursive: true });
  const ledgerPath = path.join(runDir, "ledger.jsonl");
  const lines = entries.map((e: any) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(ledgerPath, lines + "\n", "utf8");
  return ledgerPath;
}

function validConfig(overrides: any = {}): any {
  return {
    run_id: "report-run",
    objective: "Improve qualitative behavior safely.",
    max_iterations: 5,
    max_runtime_minutes: 60,
    max_diff_lines: 800,
    protected_paths: [".env", "secrets/**"],
    allowed_commands: ["npm test"],
    baseline_commands: ["npm test"],
    judge: {
      mode: "host-agent",
      rubric: "Keep safe improvements only.",
    },
    criteria: [
      {
        id: "correctness",
        description: "Evidence supports the objective.",
        weight: 1,
      },
    ],
    evidence: {
      retain_artifacts: true,
      redact_secrets: true,
    },
    decision_policy: {
      keep_if: "score >= threshold && no_safety_concerns",
      revert_if: "baseline_regression || safety_concern",
    },
    ...overrides,
  };
}

test("report from mixed ledger includes kept, reverted, and crash entries", () => {
  const projectRoot = createTempProject();
  const entries = [
    completeEntry({ iteration: 0, decision: "keep", scores: { correctness: 4 }, rationale: "Good evidence." }),
    completeEntry({
      iteration: 1,
      decision: "revert",
      scores: { correctness: 2 },
      rationale: "Baseline regression detected.",
    }),
    completeEntry({
      iteration: 2,
      decision: "revert",
      scores: { correctness: 1 },
      rationale: "Experiment iteration failed: command crashed",
      outputs: [{ command: "node -e false", status: 1, stdout: "", stderr: "crash" }],
    }),
  ];
  const ledgerPath = writeLedger(projectRoot, entries);
  const config = validConfig();

  const { markdown, json } = generateReport(ledgerPath, config);

  assert.equal(json.iteration_count, 3);
  assert.equal(json.kept_count, 1);
  assert.equal(json.reverted_count, 2);
  assert.ok(markdown.includes("## Kept Changes"));
  assert.ok(markdown.includes("## Reverted Changes"));
  assert.ok(json.failure_categories.execution_failure >= 1);
  assert.ok(json.failure_categories.baseline_regression >= 1);
});

test("report includes all required sections", () => {
  const projectRoot = createTempProject();
  const entries = [completeEntry({ iteration: 0, decision: "keep" })];
  const ledgerPath = writeLedger(projectRoot, entries);
  const config = validConfig();

  const { markdown } = generateReport(ledgerPath, config);

  assert.ok(markdown.includes("# Autoresearch Qualitative Report"));
  assert.ok(markdown.includes("## Run Summary"));
  assert.ok(markdown.includes("## Objective"));
  assert.ok(markdown.includes("## Config Summary"));
  assert.ok(markdown.includes("## Experiments"));
  assert.ok(markdown.includes("## Kept Changes"));
  assert.ok(markdown.includes("## Reverted Changes"));
  assert.ok(markdown.includes("## Score Trends"));
  assert.ok(markdown.includes("## Failure Taxonomy"));
  assert.ok(markdown.includes("## Learnings & Recommendations"));
});

test("secret redaction replaces configured patterns", () => {
  const text = "API_KEY=sk-12345 password: secret123 token: abc";
  const redacted = redactSecrets(text);

  assert.ok(!redacted.includes("sk-12345"));
  assert.ok(!redacted.includes("secret123"));
  assert.ok(!redacted.includes("abc"));
  assert.ok(redacted.includes("[REDACTED]"));
});

test("secret redaction respects custom patterns from config", () => {
  const projectRoot = createTempProject();
  const entries = [
    completeEntry({
      iteration: 0,
      decision: "keep",
      rationale: "The custom_secret=foobar was found.",
    }),
  ];
  const ledgerPath = writeLedger(projectRoot, entries);
  const config = validConfig({ secret_patterns: [/custom_secret\s*=\s*[^\s]+/gi] });

  const { markdown } = generateReport(ledgerPath, config);

  assert.ok(!markdown.includes("foobar"));
  assert.ok(markdown.includes("[REDACTED]"));
});

test("learning recommendations derived from score trends", () => {
  const projectRoot = createTempProject();
  const entries = [
    completeEntry({ iteration: 0, decision: "keep", scores: { correctness: 4 } }),
    completeEntry({ iteration: 1, decision: "keep", scores: { correctness: 3 } }),
    completeEntry({ iteration: 2, decision: "revert", scores: { correctness: 1 } }),
  ];
  const ledgerPath = writeLedger(projectRoot, entries);
  const config = validConfig();

  const { json } = generateReport(ledgerPath, config);

  assert.ok(Array.isArray(json.recommended_next_steps));
  assert.ok(json.recommended_next_steps.length > 0);
  const hasDecliningRec = json.recommended_next_steps.some((r: any) =>
    r.includes("declining"),
  );
  assert.ok(hasDecliningRec, "Expected a recommendation about declining scores");
});

test("policy-level learning statement is present, not ML training", () => {
  const projectRoot = createTempProject();
  const entries = [completeEntry({ iteration: 0, decision: "keep" })];
  const ledgerPath = writeLedger(projectRoot, entries);
  const config = validConfig();

  const { markdown } = generateReport(ledgerPath, config);

  assert.ok(markdown.includes("policy-level"));
  assert.ok(markdown.includes("not machine-learning training"));
});

test("empty ledger produces report with unknown run and zero counts", () => {
  const projectRoot = createTempProject();
  const ledgerPath = writeLedger(projectRoot, []);
  const config = validConfig({ run_id: "empty-run" });

  const { markdown, json } = generateReport(ledgerPath, config);

  assert.equal(json.iteration_count, 0);
  assert.equal(json.kept_count, 0);
  assert.equal(json.reverted_count, 0);
  assert.ok(markdown.includes("empty-run") || markdown.includes("unknown"));
});

test("categorizeFailure classifies execution failures from outputs", () => {
  const entry = completeEntry({
    decision: "revert",
    outputs: [{ command: "test", status: 1, stdout: "", stderr: "error" }],
    rationale: "Something went wrong.",
  });

  assert.equal(categorizeFailure(entry), "execution_failure");
});

test("computeScoreTrends detects improving and declining trends", () => {
  const entries = [
    completeEntry({ iteration: 0, scores: { correctness: 1 } }),
    completeEntry({ iteration: 1, scores: { correctness: 2 } }),
    completeEntry({ iteration: 2, scores: { correctness: 4 } }),
  ];

  const trends = computeScoreTrends(entries);

  assert.equal(trends.correctness.trend, "improving");
  assert.ok(trends.correctness.average > 0);
});
