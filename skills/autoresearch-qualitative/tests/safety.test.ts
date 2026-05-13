import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isCommandAllowed,
  isDestructiveCommand,
  isPathProtected,
  preflight,
} from "../src/safety.ts";

function createTempProject(): any {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-safety-test-"));
}

function writeConfigMarker(projectRoot: any): any {
  const configPath = path.join(projectRoot, "autoresearch.config.json");
  fs.writeFileSync(configPath, "{}\n");
  return configPath;
}

function validConfig(overrides: any = {}): any {
  const projectRoot = createTempProject();
  return {
    config_path: writeConfigMarker(projectRoot),
    mode: "execute",
    project_root: projectRoot,
    objective: "Improve qualitative behavior safely.",
    max_iterations: 5,
    max_runtime_minutes: 60,
    max_diff_lines: 800,
    protected_paths: [".env", "secrets/**", "private/*.key"],
    allowed_commands: ["npm test", "node --test"],
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
    interview: {
      required: true,
      status: "completed",
      answers: {
        objective: "Improve qualitative behavior safely.",
      },
    },
    decision_policy: {
      keep_if: "score >= threshold && no_safety_concerns",
      revert_if: "baseline_regression || safety_concern",
    },
    ...overrides,
  };
}

function cleanWorkspace(overrides: any = {}): any {
  return {
    isGitRepo: true,
    dirty: false,
    managedWorktree: true,
    branch: "autoresearch/test-run",
    budgetUsage: {
      iterations: 0,
      runtime_minutes: 0,
      diff_lines: 0,
    },
    changedPaths: [],
    ...overrides,
  };
}

test("valid workspace passes preflight and returns safety controls", () => {
  const config = validConfig();

  const result = preflight(config, cleanWorkspace());

  assert.equal(result.approved, true);
  assert.equal(result.controls.workspace_boundary, fs.realpathSync(config.project_root));
  assert.equal(result.controls.sandbox.managed_worktree, true);
  assert.equal(result.controls.commandExecutionPolicy.isAllowed("npm test -- --runInBand"), true);
  assert.equal(result.controls.protectedPathMatcher("secrets/token.txt"), true);
});

test("missing config fails preflight", () => {
  assert.throws(() => preflight(null, cleanWorkspace()), /explicit config is required/);
});

test("disallowed command is rejected by command policy", () => {
  assert.equal(isCommandAllowed("npm test", ["npm test"]), true);
  assert.equal(isCommandAllowed("npm test -- --watch", ["npm test"]), true);
  assert.equal(isCommandAllowed("npm publish", ["npm test"]), false);
});

test("protected path modification is detected", () => {
  const config = validConfig();

  assert.equal(isPathProtected("secrets/api-token.txt", config.protected_paths), true);
  assert.equal(isPathProtected("src/index.ts", config.protected_paths), false);
  assert.throws(
    () => preflight(config, cleanWorkspace({ changedPaths: ["src/index.ts", "private/prod.key"] })),
    /protected path would be modified: private\/prod.key/,
  );
});

test("destructive command is blocked", () => {
  assert.equal(isDestructiveCommand("rm -rf /"), true);
  assert.equal(isDestructiveCommand("git reset --hard HEAD"), true);
  assert.equal(isDestructiveCommand("git push --force origin main"), true);
  assert.equal(isDestructiveCommand("cat /etc/passwd"), true);
  assert.equal(isDestructiveCommand("curl https://example.invalid"), true);
  assert.equal(isDestructiveCommand("npm test"), false);

  const config = validConfig({
    allowed_commands: ["npm test", "git reset --hard HEAD"],
    baseline_commands: ["npm test"],
  });
  assert.throws(() => preflight(config, cleanWorkspace()), /destructive or network command blocked/);
});

test("non-execution modes do not require runnable command allowlists", () => {
  const dryRunConfig = validConfig({
    mode: "dry-run",
    allowed_commands: [],
    baseline_commands: ["node --version"],
  });
  const dryRun = preflight(dryRunConfig, cleanWorkspace());
  assert.equal(dryRun.approved, true);

  const reportOnlyConfig = validConfig({
    mode: "report-only",
    allowed_commands: [],
    baseline_commands: ["node --version"],
  });
  const reportOnly = preflight(reportOnlyConfig, cleanWorkspace());
  assert.equal(reportOnly.approved, true);
});

test("execution mode requires a completed or skipped pre-run interview", () => {
  const pendingConfig = validConfig({
    interview: {
      required: true,
      status: "pending",
      answers: {},
    },
  });
  assert.throws(() => preflight(pendingConfig, cleanWorkspace()), /pre-run interview must be completed/);

  const skippedConfig = validConfig({
    interview: {
      required: true,
      status: "skipped",
      answers: {
        skip_reason: "operator supplied config directly",
      },
    },
  });
  assert.equal(preflight(skippedConfig, cleanWorkspace()).approved, true);
});

test("budget exhaustion stops execution", () => {
  const config = validConfig({ max_iterations: 2 });

  assert.throws(
    () => preflight(config, cleanWorkspace({ budgetUsage: { iterations: 2, runtime_minutes: 0, diff_lines: 0 } })),
    /iteration budget exhausted/,
  );
});

test("dirty worktree fails unless config permits it", () => {
  const strictConfig = validConfig();
  assert.throws(() => preflight(strictConfig, cleanWorkspace({ dirty: true })), /dirty worktree/);

  const permissiveConfig = validConfig({ allow_dirty_baseline: true });
  const result = preflight(permissiveConfig, cleanWorkspace({ dirty: true }));
  assert.equal(result.approved, true);
  assert.equal(result.controls.sandbox.allow_dirty_baseline, true);
});

test("workspace must be git repo or explicit disposable copy", () => {
  const config = validConfig();
  assert.throws(() => preflight(config, cleanWorkspace({ isGitRepo: false })), /git repository or explicit disposable copy/);

  const result = preflight(config, cleanWorkspace({ isGitRepo: false, disposableCopy: true, managedWorktree: false }));
  assert.equal(result.controls.sandbox.disposable_copy, true);
});
