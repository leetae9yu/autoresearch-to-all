/* eslint-disable */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runExperimentLoop } from "../src/loop.ts";

function createTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-loop-test-"));
}

function writeConfig(projectRoot: string, overrides: Record<string, unknown> = {}): string {
  const config = {
    project_root: ".",
    objective: "Improve qualitative behavior safely.",
    max_iterations: 2,
    max_runtime_minutes: 60,
    max_diff_lines: 20,
    protected_paths: [".env", "secrets/**"],
    allowed_commands: [
      "node -e \"process.stdout.write('baseline-ok')\"",
      "node -e \"process.stdout.write('check-ok')\"",
    ],
    baseline_commands: ["node -e \"process.stdout.write('baseline-ok')\""],
    judge: {
      mode: "host-agent",
      rubric: "Keep only well-evidenced safe improvements.",
    },
    criteria: [{ id: "correctness", description: "Evidence supports the objective.", weight: 1 }],
    evidence: { retain_artifacts: true, redact_secrets: true },
    decision_policy: {
      keep_if: "all_required_criteria_pass && no_safety_concerns && evidence_supports_objective && recommendation_is_keep",
      revert_if: "any_safety_concern || baseline_regression || evidence_missing",
    },
    ...overrides,
  };
  const configPath = path.join(projectRoot, "autoresearch.config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function keepVerdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scores: {
      correctness: 4,
      maintainability: 4,
      safety_security: 4,
      evidence_quality: 4,
      simplicity: 4,
      risk_cost: 4,
      objective_fit: 4,
    },
    guardrail_failures: [],
    confidence: 0.9,
    evidence_refs: [{ dimension: "correctness", ref: "check output", quote: "check-ok" }],
    recommendation: "keep",
    rationale: "Evidence supports keeping the change.",
    evidence_gaps: [],
    safety_concerns: [],
    anti_gaming_notes: [],
    ...overrides,
  };
}

type LoopScore = { id: string; description?: string; weight?: number };
type LoopRecord = Record<string, unknown> & { frozen_criteria?: LoopScore[]; evidence_paths?: string[]; decision?: string; rationale?: string; stop?: boolean; reason?: string };

class FakeAdapter {
  config: Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  proposals: LoopRecord[];
  records: LoopRecord[];
  decisions: LoopRecord[];
  applied: LoopRecord[];
  reverted: number;

  constructor(config: Record<string, unknown> & { project_root: string; baseline_commands: string[] }, proposals: LoopRecord[]) {
    this.config = config;
    this.proposals = [...proposals];
    this.records = [];
    this.decisions = [];
    this.applied = [];
    this.reverted = 0;
  }

  discoverProject(): LoopRecord {
    return { project_root: this.config.project_root, vcs: "none", baseline_commit: null };
  }

  snapshotBaseline(): LoopRecord {
    const baselineCommand = (this.config.baseline_commands as string[])[0];
    return {
      baseline_commit: null,
      commands: this.config.baseline_commands,
      outputs: [{ command: baselineCommand, status: 0, stdout: "baseline-ok", stderr: "" }],
      passed: true,
      timestamp: "2026-05-13T00:00:00.000Z",
    };
  }

  proposeExperiment(): LoopRecord {
    return this.proposals.shift() || { stop: true, reason: "proposal_queue_empty" };
  }

  applyChange(change: LoopRecord): LoopRecord {
    this.applied.push(change);
    return { applied: true, candidate_commit: null, diff: change.diff, candidate_diff_hash: "hash" };
  }

  runChecks(commands: string[]): LoopRecord[] {
    return commands.map((command: string) => ({ command, status: 0, stdout: "check-ok", stderr: "", duration_ms: 1 }));
  }

  collectEvidence(): { evidence_paths: string[]; retained: boolean } {
    return { evidence_paths: [], retained: true };
  }

  judgeResult(input: LoopRecord = {}): LoopRecord {
    return {
      judge_verdicts: input.judge_verdicts || [],
      scores: input.scores || {},
      rationale: input.rationale || "No judge rationale supplied.",
      recommendation: input.recommendation || "revert",
    };
  }

  decideKeepOrRevert(input: LoopRecord): { decision: string; reverted: boolean; rationale?: string } {
    this.decisions.push(input);
    const decision = input.decision === "keep" ? "keep" : "revert";
    if (decision === "revert") this.reverted += 1;
    return { decision, reverted: decision === "revert", rationale: input.rationale as string | undefined };
  }

  recordLedgerEntry(entry: LoopRecord): LoopRecord {
    const recorded = { ...entry, entry_hash: `entry-${this.records.length}` };
    const projectRoot = String(this.config.project_root);
    const runId = String(entry.run_id);
    const ledgerPath = path.join(projectRoot, ".autoresearch-runs", runId, "ledger.jsonl");
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(recorded)}\n`, "utf8");
    this.records.push(recorded);
    return recorded;
  }

  summarizeLearning(): LoopRecord {
    return {
      run_id: "loop-run",
      total_entries: this.records.length,
      kept: this.records.filter((entry: any) => entry.decision === "keep").length,
      reverted: this.records.filter((entry: any) => entry.decision === "revert").length,
      rationales: this.records.map((entry: any) => entry.rationale),
    };
  }
}

function makeDiff(name: string = "file.txt"): string {
  return [`--- a/${name}`, `+++ b/${name}`, "@@ -1 +1 @@", "-before", "+after", ""].join("\n");
}

test("loop completes keep and revert iterations and records ledger entries", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot);
  let reviewCount = 0;
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }, { diff: makeDiff("two.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn(): any {
      reviewCount += 1;
      return reviewCount === 1 ? keepVerdict() : keepVerdict({ scores: { correctness: 1 }, recommendation: "revert", rationale: "Regression found." });
    },
  });

  assert.equal(result.stop_reason, "max_iterations");
  assert.equal(result.iterations.length, 2);
  assert.equal(result.iterations[0].decision, "keep");
  assert.equal(result.iterations[1].decision, "revert");
  assert.equal(adapter.records.length, 2);
  assert.equal((adapter.records[0].frozen_criteria as LoopScore[])[0].id, "correctness");
  assert.equal(result.report.status, "generated");
  assert.ok(fs.existsSync(result.reportMarkdownPath));
  assert.ok(fs.existsSync(result.reportJsonPath));
  assert.match(fs.readFileSync(result.reportMarkdownPath, "utf8"), /# Autoresearch Qualitative Report/);
  assert.equal(JSON.parse(fs.readFileSync(result.reportJsonPath, "utf8")).run_id, "loop-run");
});

test("loop reverts protected path touches before judge approval", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot);
  let reviewCount = 0;
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("secrets/token.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn(): any {
      reviewCount += 1;
      return keepVerdict();
    },
  });

  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].decision, "revert");
  assert.equal(result.iterations[0].rationale, "protected_path_touched");
  assert.equal(adapter.decisions[0].decision, "revert");
  assert.equal(adapter.decisions[0].rationale, "protected_path_touched");
  assert.equal(reviewCount, 0);
});

test("loop stops at max_iterations without proposing extra work", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot, { max_iterations: 1 });
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }, { diff: makeDiff("two.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn: () => keepVerdict(),
  });

  assert.equal(result.stop_reason, "max_iterations");
  assert.equal(result.iterations.length, 1);
  assert.equal(adapter.applied.length, 1);
});

test("loop stops at max_runtime before starting an iteration", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot, { max_runtime_minutes: 1 });
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }]);
  const times = [0, 61000];

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn: () => keepVerdict(),
    clock: () => times.shift() ?? 61000,
  });

  assert.equal(result.stop_reason, "max_runtime");
  assert.equal(result.iterations.length, 0);
  assert.equal(adapter.applied.length, 0);
});

test("guardrail failure forces revert even when keep_if is true", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot);
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn: () => keepVerdict({ guardrail_failures: [{ condition: "secret", detail: "touched", severity: "critical" }] }),
  });

  assert.equal(result.iterations[0].decision, "revert");
  assert.equal(adapter.reverted, 1);
});

test("missing judge review function fails gracefully through default revert", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot);
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
  });

  assert.equal(result.iterations[0].decision, "revert");
  assert.match(String(result.iterations[0].rationale), /no external review function/);
  assert.equal(adapter.records.length, 1);
});

test("loop stops before apply when diff budget would be exhausted", () => {
  const projectRoot = createTempProject();
  const configPath = writeConfig(projectRoot, { max_diff_lines: 1 });
  const configObject = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> & { project_root: string; baseline_commands: string[] };
  configObject.config_path = configPath;
  configObject.project_root = projectRoot;
  const adapter = new FakeAdapter(configObject, [{ diff: makeDiff("one.txt") }]);

  const result = runExperimentLoop({
    configPath,
    run_id: "loop-run",
    workspaceState: { disposableCopy: true, sandboxPrepared: true },
    adapter,
    reviewFn: () => keepVerdict(),
  });

  assert.equal(result.stop_reason, "diff_budget_exhausted");
  assert.equal(result.iterations.length, 0);
  assert.equal(adapter.applied.length, 0);
});
