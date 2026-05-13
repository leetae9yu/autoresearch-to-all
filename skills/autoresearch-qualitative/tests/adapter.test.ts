import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DefaultAutoresearchAdapter } from "../src/adapter.ts";

function createTempProject(): any {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-adapter-test-"));
}

function baseConfig(projectRoot: any, overrides: any = {}): any {
  return {
    project_root: projectRoot,
    objective: "Improve qualitative behavior safely.",
    baseline_commands: ["node -e \"process.stdout.write('baseline-ok')\""],
    allowed_commands: ["node -e \"process.stdout.write('check-ok')\""],
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
    ...overrides,
  };
}

function samplePatch(): any {
  return [
    "--- a/note.txt",
    "+++ b/note.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n");
}

test("adapter runs baseline commands and returns captured outputs", () => {
  const projectRoot = createTempProject();
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "baseline-run" });

  const baseline = adapter.snapshotBaseline();

  assert.equal(baseline.passed, true);
  assert.equal(baseline.outputs.length, 1);
  assert.equal(baseline.outputs[0].status, 0);
  assert.equal(baseline.outputs[0].stdout, "baseline-ok");
  assert.equal(baseline.outputs[0].command, "node -e \"process.stdout.write('baseline-ok')\"");
});

test("adapter applies and reverts a candidate patch", () => {
  const projectRoot = createTempProject();
  fs.writeFileSync(path.join(projectRoot, "note.txt"), "before\n");
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "patch-run" });

  const applied = adapter.applyChange({ diff: samplePatch() });
  assert.equal(applied.applied, true);
  assert.equal(applied.candidate_commit, null);
  assert.equal(typeof applied.candidate_diff_hash, "string");
  assert.equal(fs.readFileSync(path.join(projectRoot, "note.txt"), "utf8"), "after\n");

  const decision = adapter.decideKeepOrRevert({ decision: "revert", rationale: "test revert" });
  assert.equal(decision.reverted, true);
  assert.equal(fs.readFileSync(path.join(projectRoot, "note.txt"), "utf8"), "before\n");
});

test("adapter applies a candidate patch from patch_path", () => {
  const projectRoot = createTempProject();
  fs.writeFileSync(path.join(projectRoot, "note.txt"), "before\n");
  fs.writeFileSync(path.join(projectRoot, "change.patch"), samplePatch());
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "patch-path-run" });

  const applied = adapter.applyChange({ patch_path: "change.patch" });

  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(projectRoot, "note.txt"), "utf8"), "after\n");
});

test("adapter rejects check commands not declared in allowed_commands", () => {
  const projectRoot = createTempProject();
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "allowlist-run" });

  assert.throws(
    () => adapter.runChecks(["node -e \"process.stdout.write('not-allowed')\""]),
    /not declared in allowed_commands/,
  );
});

test("adapter restores snapshot when fallback patch application fails", () => {
  const projectRoot = createTempProject();
  fs.writeFileSync(path.join(projectRoot, "first.txt"), "one\n");
  fs.writeFileSync(path.join(projectRoot, "second.txt"), "two\n");
  const invalidPatch = [
    "--- a/first.txt",
    "+++ b/first.txt",
    "@@ -1 +1 @@",
    "-one",
    "+changed",
    "--- a/second.txt",
    "+++ b/second.txt",
    "@@ -1 +1 @@",
    "-does-not-match",
    "+changed",
    "",
  ].join("\n");
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "atomic-run" });

  assert.throws(() => adapter.applyChange({ diff: invalidPatch }), /Patch removal mismatch/);
  assert.equal(fs.readFileSync(path.join(projectRoot, "first.txt"), "utf8"), "one\n");
  assert.equal(fs.readFileSync(path.join(projectRoot, "second.txt"), "utf8"), "two\n");
});

test("default adapter does not require a package manifest", () => {
  const projectRoot = createTempProject();
  const adapter = new DefaultAutoresearchAdapter(baseConfig(projectRoot), { run_id: "no-manifest-run" });

  const discovery = adapter.discoverProject();
  const checks = adapter.runChecks();

  assert.equal(fs.existsSync(path.join(projectRoot, "package.json")), false);
  assert.equal(discovery.project_root, projectRoot);
  assert.equal(discovery.vcs, "none");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].stdout, "check-ok");
});
