import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LedgerStore,
  REQUIRED_LEDGER_FIELDS,
  createLedgerEntry,
  readLedgerEntries,
} from "../src/ledger.ts";

function createTempProject(): any {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-ledger-test-"));
}

function completeEntry(overrides: any = {}): any {
  return createLedgerEntry({
    run_id: "ledger-run",
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
    score_delta: { correctness: 0 },
    decision: "keep",
    rationale: "Evidence improved.",
    timestamp: "2026-05-13T00:00:00.000Z",
    ...overrides,
  });
}

test("ledger appends entries without overwriting prior entries", () => {
  const projectRoot = createTempProject();
  const ledger = new LedgerStore({ root_dir: projectRoot, run_id: "ledger-run" });
  const first = completeEntry({ iteration: 0, decision: "revert", rationale: "first" });
  const second = completeEntry({ iteration: 1, decision: "keep", rationale: "second" });

  ledger.appendEntry(first);
  const ledgerPath = path.join(projectRoot, ".autoresearch-runs", "ledger-run", "ledger.jsonl");
  const afterFirst = fs.readFileSync(ledgerPath, "utf8");
  ledger.appendEntry(second);
  const afterSecond = fs.readFileSync(ledgerPath, "utf8");

  assert.equal(afterSecond.startsWith(afterFirst), true);
  const entries = readLedgerEntries({ root_dir: projectRoot, run_id: "ledger-run" });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].rationale, "first");
  assert.equal(entries[1].rationale, "second");
});

test("ledger refuses to append after historical mutation", () => {
  const projectRoot = createTempProject();
  const ledger = new LedgerStore({ root_dir: projectRoot, run_id: "ledger-run" });
  ledger.appendEntry(completeEntry({ iteration: 0 }));
  const ledgerPath = path.join(projectRoot, ".autoresearch-runs", "ledger-run", "ledger.jsonl");
  const mutated = fs.readFileSync(ledgerPath, "utf8").replace("Evidence improved.", "mutated history");
  fs.writeFileSync(ledgerPath, mutated);

  assert.throws(
    () => ledger.appendEntry(completeEntry({ iteration: 1 })),
    /Ledger history changed since last append/,
  );
});

test("ledger refuses mutation after reopening a new store", () => {
  const projectRoot = createTempProject();
  const ledger = new LedgerStore({ root_dir: projectRoot, run_id: "ledger-run" });
  ledger.appendEntry(completeEntry({ iteration: 0 }));
  const ledgerPath = path.join(projectRoot, ".autoresearch-runs", "ledger-run", "ledger.jsonl");
  const mutated = fs.readFileSync(ledgerPath, "utf8").replace("Evidence improved.", "mutated history");
  fs.writeFileSync(ledgerPath, mutated);
  const reopenedLedger = new LedgerStore({ root_dir: projectRoot, run_id: "ledger-run" });

  assert.throws(
    () => reopenedLedger.appendEntry(completeEntry({ iteration: 1 })),
    /failed integrity verification/,
  );
});

test("ledger rejects entries missing required schema fields", () => {
  const entry = completeEntry();
  delete entry.decision;

  assert.throws(() => new LedgerStore({ root_dir: createTempProject(), run_id: "ledger-run" }).appendEntry(entry), /decision must be a non-empty string/);
});

test("ledger entry schema contains all required fields", () => {
  const entry = completeEntry();

  for (const field of REQUIRED_LEDGER_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, field), true, `missing ${field}`);
  }
});
