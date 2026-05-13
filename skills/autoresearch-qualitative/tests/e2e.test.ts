import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DefaultAutoresearchAdapter } from "../src/adapter.ts";
import { validateConfig } from "../src/config.ts";
import { readLedgerEntries } from "../src/ledger.ts";
import { runExperimentLoop } from "../src/loop.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixture");

function copyFixture(): any {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-e2e-fixture-"));
  fs.cpSync(fixtureRoot, projectRoot, { recursive: true });
  return projectRoot;
}

function configPath(projectRoot: any): any {
  return path.join(projectRoot, "autoresearch-skill.config.yaml");
}

function workspaceState(overrides: any = {}): any {
  return {
    disposableCopy: true,
    dirty: false,
    managedWorktree: true,
    branch: "autoresearch/e2e-fixture",
    budgetUsage: {
      iterations: 0,
      runtime_minutes: 0,
      diff_lines: 0,
    },
    ...overrides,
  };
}

function verdict(recommendation: any, overrides: any = {}): any {
  return {
    scores: {
      correctness: recommendation === "keep" ? 4 : 1,
      maintainability: 4,
      safety_security: recommendation === "keep" ? 4 : 1,
      evidence_quality: 4,
      simplicity: 4,
      risk_cost: recommendation === "keep" ? 4 : 1,
      objective_fit: recommendation === "keep" ? 4 : 1,
    },
    guardrail_failures: [],
    confidence: 0.95,
    evidence_refs: [{ dimension: "correctness", ref: "fixture test output", quote: "node --test" }],
    recommendation,
    rationale: recommendation === "keep" ? "Fixture checks passed for a safe improvement." : "Fixture checks exposed a regression.",
    evidence_gaps: [],
    safety_concerns: [],
    anti_gaming_notes: [],
    ...overrides,
  };
}

function createMockJudge(): any {
  return {
    evaluate(context: any): any {
      const checks = context.experiment_evidence?.checks || [];
      const diff = context.diff_summary || "";
      if (diff.includes(".env")) {
        return {
          decision: "revert",
          verdict: verdict("revert", {
            guardrail_failures: ["protected_path"],
            safety_concerns: ["Candidate touches .env."],
            rationale: "Protected path changes are rejected.",
          }),
        };
      }
      if (diff.includes("-  return left + right;") && diff.includes("+  return left - right;")) {
        return {
          decision: "revert",
          verdict: verdict("revert", {
            guardrail_failures: ["baseline_regression"],
            rationale: "Candidate changes addition into subtraction.",
          }),
        };
      }
      if (checks.every((check: any) => check.status === 0)) {
        return { decision: "keep", verdict: verdict("keep") };
      }
      return {
        decision: "revert",
        verdict: verdict("revert", {
          guardrail_failures: ["baseline_regression"],
          rationale: "Calculator tests failed after applying the candidate.",
        }),
      };
    },
  };
}

class FixturePatchAdapter extends DefaultAutoresearchAdapter {
  patchName: any;

  constructor(config: any, patchName: any, options: any = {}) {
    super(config, options);
    this.patchName = patchName;
  }

  proposeExperiment(context: any = {}): any {
    if (context.iteration > 0) return { stop: true, reason: "fixture_patch_exhausted" };
    return {
      objective: this.config.objective,
      hypothesis: `Apply ${this.patchName} to the calculator fixture.`,
      candidate_change: {
        patch_path: path.join(this.projectRoot, this.patchName),
      },
    };
  }
}

function runFixtureLoop(projectRoot: any, patchName: any, overrides: any = {}): any {
  const config = validateConfig(configPath(projectRoot));
  if (overrides.config) Object.assign(config, overrides.config);
  const adapter = new FixturePatchAdapter(config, patchName, { run_id: overrides.run_id || `e2e-${patchName}` });
  return runExperimentLoop({
    configObject: config,
    run_id: overrides.run_id || `e2e-${patchName}`,
    adapter,
    judge: createMockJudge(),
    workspaceState: workspaceState(overrides.workspaceState),
  });
}

test("full loop keeps an improving fixture patch and records it in the ledger", () => {
  const projectRoot = copyFixture();

  const result = runFixtureLoop(projectRoot, "improve.patch", { run_id: "e2e-improve" });

  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].decision, "keep");
  assert.equal(result.summary.kept, 1);
  assert.match(fs.readFileSync(path.join(projectRoot, "src", "calculator.ts"), "utf8"), /function multiply/);
  const ledgerEntries = readLedgerEntries({ root_dir: projectRoot, run_id: "e2e-improve" });
  assert.equal(ledgerEntries.length, 1);
  assert.equal(ledgerEntries[0].decision, "keep");
});

test("full loop reverts a regressing fixture patch", () => {
  const projectRoot = copyFixture();

  const result = runFixtureLoop(projectRoot, "regress.patch", { run_id: "e2e-regress" });

  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].decision, "revert");
  assert.match(fs.readFileSync(path.join(projectRoot, "src", "calculator.ts"), "utf8"), /return left \+ right/);
  const ledgerEntries = readLedgerEntries({ root_dir: projectRoot, run_id: "e2e-regress" });
  assert.equal(ledgerEntries[0].decision, "revert");
});

test("protected fixture patch is rejected by preflight before mutation", () => {
  const projectRoot = copyFixture();
  const beforeEnvExists = fs.existsSync(path.join(projectRoot, ".env"));

  assert.throws(
    () => runFixtureLoop(projectRoot, "protected.patch", {
      run_id: "e2e-protected",
      workspaceState: { pendingPaths: [".env"] },
    }),
    /protected path would be modified: \.env/,
  );
  assert.equal(fs.existsSync(path.join(projectRoot, ".env")), beforeEnvExists);
});

test("full loop stops after one iteration when max_iterations is one", () => {
  const projectRoot = copyFixture();

  const result = runFixtureLoop(projectRoot, "improve.patch", {
    run_id: "e2e-budget",
    config: { max_iterations: 1 },
  });

  assert.equal(result.iterations.length, 1);
  assert.equal(result.stop_reason, "max_iterations");
  const ledgerEntries = readLedgerEntries({ root_dir: projectRoot, run_id: "e2e-budget" });
  assert.equal(ledgerEntries.length, 1);
});

test("invalid config refuses before mutating the fixture", () => {
  const projectRoot = copyFixture();
  const sourcePath = path.join(projectRoot, "src", "calculator.ts");
  const originalSource = fs.readFileSync(sourcePath, "utf8");
  const invalidConfigPath = path.join(projectRoot, "invalid.config.yaml");
  fs.writeFileSync(invalidConfigPath, "project_root: \".\"\n");

  assert.throws(
    () => runExperimentLoop({
      configPath: invalidConfigPath,
      judge: createMockJudge(),
      workspaceState: workspaceState(),
    }),
    /Missing required field: allowed_commands/,
  );
  assert.equal(fs.readFileSync(sourcePath, "utf8"), originalSource);
});
