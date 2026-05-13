import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REQUIRED_LEDGER_FIELDS = [
  "run_id",
  "iteration",
  "baseline_commit",
  "candidate_commit",
  "diff",
  "objective",
  "frozen_criteria",
  "commands",
  "outputs",
  "evidence_paths",
  "judge_verdicts",
  "scores",
  "score_delta",
  "decision",
  "rationale",
  "timestamp",
];

function checksumFile(filePath: any): any {
  if (!fs.existsSync(filePath)) {
    return crypto.createHash("sha256").update("").digest("hex");
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countLedgerLines(filePath: any): any {
  if (!fs.existsSync(filePath)) return 0;
  const contents: string = fs.readFileSync(filePath, "utf8");
  if (contents === "") return 0;
  return contents.split("\n").filter((line) => line.trim() !== "").length;
}

function parseLedgerLines(filePath: any): any[] {
  if (!fs.existsSync(filePath)) return [];
  const contents: string = fs.readFileSync(filePath, "utf8");
  if (contents.trim() === "") return [];
  return contents
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error: any) {
        throw new Error(`Malformed ledger entry at line ${index + 1}: ${error.message}`);
      }
    });
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result: Record<string, any>, key: string) => {
        if (key !== "entry_hash") {
          result[key] = canonicalize(value[key]);
        }
        return result;
      }, {} as Record<string, any>);
  }
  return value;
}

function computeEntryHash(entry: any): any {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(entry))).digest("hex");
}

function withIntegrityFields(entry: any, previousHash: any): any {
  const entryWithPreviousHash = {
    ...entry,
    previous_hash: previousHash || null,
  };
  return {
    ...entryWithPreviousHash,
    entry_hash: computeEntryHash(entryWithPreviousHash),
  };
}

function validateLedgerIntegrity(entries: any[]): any[] {
  let previousHash: string | null = null;
  entries.forEach((entry: any, index: number) => {
    validateLedgerEntry(entry);
    if (!entry.entry_hash) {
      throw new Error(`Ledger entry at line ${index + 1} is missing entry_hash`);
    }
    if (entry.previous_hash !== previousHash) {
      throw new Error(`Ledger entry at line ${index + 1} has an invalid previous_hash`);
    }
    const expectedHash = computeEntryHash(entry);
    if (entry.entry_hash !== expectedHash) {
      throw new Error(`Ledger entry at line ${index + 1} failed integrity verification`);
    }
    previousHash = entry.entry_hash;
  });
  return entries;
}

function validateLedgerEntry(entry: any): any {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Ledger entry must be an object");
  }

  for (const field of REQUIRED_LEDGER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      throw new Error(`Ledger entry missing required field: ${field}`);
    }
  }

  if (typeof entry.run_id !== "string" || entry.run_id.trim() === "") {
    throw new Error("Ledger entry run_id must be a non-empty string");
  }
  if (!Number.isInteger(entry.iteration) || entry.iteration < 0) {
    throw new Error("Ledger entry iteration must be a non-negative integer");
  }
  if (!Array.isArray(entry.frozen_criteria)) {
    throw new Error("Ledger entry frozen_criteria must be an array");
  }
  if (!Array.isArray(entry.commands)) {
    throw new Error("Ledger entry commands must be an array");
  }
  if (!Array.isArray(entry.outputs)) {
    throw new Error("Ledger entry outputs must be an array");
  }
  if (!Array.isArray(entry.evidence_paths)) {
    throw new Error("Ledger entry evidence_paths must be an array");
  }
  if (!Array.isArray(entry.judge_verdicts)) {
    throw new Error("Ledger entry judge_verdicts must be an array");
  }
  if (!entry.scores || typeof entry.scores !== "object" || Array.isArray(entry.scores)) {
    throw new Error("Ledger entry scores must be an object");
  }
  if (!entry.score_delta || typeof entry.score_delta !== "object" || Array.isArray(entry.score_delta)) {
    throw new Error("Ledger entry score_delta must be an object");
  }
  if (typeof entry.decision !== "string" || entry.decision.trim() === "") {
    throw new Error("Ledger entry decision must be a non-empty string");
  }
  if (typeof entry.rationale !== "string") {
    throw new Error("Ledger entry rationale must be a string");
  }
  if (typeof entry.timestamp !== "string" || Number.isNaN(Date.parse(entry.timestamp))) {
    throw new Error("Ledger entry timestamp must be an ISO timestamp string");
  }

  return entry;
}

function createLedgerEntry(values: any): any {
  return validateLedgerEntry({
    run_id: values.run_id,
    iteration: values.iteration,
    baseline_commit: values.baseline_commit || null,
    candidate_commit: values.candidate_commit || null,
    diff: values.diff || null,
    objective: values.objective,
    frozen_criteria: values.frozen_criteria || [],
    commands: values.commands || [],
    outputs: values.outputs || [],
    evidence_paths: values.evidence_paths || [],
    judge_verdicts: values.judge_verdicts || [],
    scores: values.scores || {},
    score_delta: values.score_delta || {},
    decision: values.decision,
    rationale: values.rationale || "",
    timestamp: values.timestamp || new Date().toISOString(),
  });
}

class LedgerStore {
  runId: string;
  rootDir: string;
  runDir: string;
  ledgerPath: string;
  lastKnownLineCount: number;
  lastKnownChecksum: string;

  constructor(options: any) {
    if (!options || typeof options !== "object") {
      throw new Error("LedgerStore options are required");
    }
    if (!options.run_id || typeof options.run_id !== "string") {
      throw new Error("LedgerStore requires a run_id");
    }

    this.runId = options.run_id;
    this.rootDir = path.resolve(options.root_dir || process.cwd());
    this.runDir = path.join(this.rootDir, ".autoresearch-runs", this.runId);
    this.ledgerPath = path.join(this.runDir, "ledger.jsonl");

    fs.mkdirSync(this.runDir, { recursive: true });
    if (!fs.existsSync(this.ledgerPath)) {
      fs.closeSync(fs.openSync(this.ledgerPath, "ax"));
    }

    this.lastKnownLineCount = countLedgerLines(this.ledgerPath);
    this.lastKnownChecksum = checksumFile(this.ledgerPath);
  }

  assertAppendOnlyState(): any {
    const currentLineCount = countLedgerLines(this.ledgerPath);
    const currentChecksum = checksumFile(this.ledgerPath);
    if (currentLineCount !== this.lastKnownLineCount || currentChecksum !== this.lastKnownChecksum) {
      throw new Error("Ledger history changed since last append; refusing to overwrite or append over mutated entries");
    }
    validateLedgerIntegrity(parseLedgerLines(this.ledgerPath));
  }

  appendEntry(entry: any): any {
    const normalized = createLedgerEntry({ ...entry, run_id: entry.run_id || this.runId });
    if (normalized.run_id !== this.runId) {
      throw new Error(`Ledger entry run_id ${normalized.run_id} does not match store run_id ${this.runId}`);
    }

    this.assertAppendOnlyState();
    const existingEntries = this.readEntries();
    const previousHash = existingEntries.length > 0 ? existingEntries[existingEntries.length - 1].entry_hash : null;
    const entryWithIntegrity = withIntegrityFields(normalized, previousHash);
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(entryWithIntegrity)}\n`, { encoding: "utf8", flag: "a" });
    this.lastKnownLineCount = countLedgerLines(this.ledgerPath);
    this.lastKnownChecksum = checksumFile(this.ledgerPath);
    return entryWithIntegrity;
  }

  readEntries(): any {
    return validateLedgerIntegrity(parseLedgerLines(this.ledgerPath));
  }
}

function readLedgerEntries(options: any): any[] {
  const runDir = path.join(path.resolve(options.root_dir || process.cwd()), ".autoresearch-runs", options.run_id);
  return validateLedgerIntegrity(parseLedgerLines(path.join(runDir, "ledger.jsonl")));
}

export {
  LedgerStore,
  REQUIRED_LEDGER_FIELDS,
  createLedgerEntry,
  computeEntryHash,
  readLedgerEntries,
  validateLedgerEntry,
  validateLedgerIntegrity,
};
