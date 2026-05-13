import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { LedgerStore, createLedgerEntry } from "./ledger.ts";

/**
 * @typedef {Object} AutoresearchAdapter
 * @property {() => ProjectDiscovery} discoverProject Detects workspace and VCS state without assuming a language ecosystem.
 * @property {() => BaselineSnapshot} snapshotBaseline Runs config-declared baseline commands and captures command outputs.
 * @property {(context?: Object) => ExperimentProposal} proposeExperiment Produces an experiment proposal placeholder for loop/judge integration.
 * @property {(change: CandidateChange) => ChangeApplication} applyChange Applies a diff string or patch file inside the project root.
 * @property {(commands?: string[]) => CommandResult[]} runChecks Runs config-declared checks and captures stdout/stderr/status.
 * @property {(paths?: string[]) => EvidenceCollection} collectEvidence Resolves retained evidence paths inside the project root.
 * @property {(input?: Object) => JudgeResult} judgeResult Normalizes judge verdict data supplied by later judge modules.
 * @property {(decision: DecisionInput) => DecisionResult} decideKeepOrRevert Keeps the candidate or reverts to the pre-change snapshot.
 * @property {(entry: Object) => Object} recordLedgerEntry Appends one immutable ledger JSONL entry.
 * @property {() => LearningSummary} summarizeLearning Reads ledger entries and summarizes accepted/reverted decisions.
 */

function commandToString(command: any): any {
  return Array.isArray(command) ? command.join(" ") : String(command);
}

function runShellCommand(command: any, cwd: any): any {
  const startedAt = Date.now();
  const commandText = commandToString(command);
  const result = childProcess.spawnSync(commandText, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: process.env,
  });

  return {
    command: commandText,
    cwd,
    status: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || (result.error ? result.error.message : ""),
    duration_ms: Date.now() - startedAt,
  };
}

function diffHash(diff: any): any {
  const result = childProcess.spawnSync("git", ["hash-object", "--stdin"], {
    input: diff,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim() || null;
}

function tryRunGit(projectRoot: any, args: any): any {
  const result = childProcess.spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim();
}

function isInsideProject(projectRoot: any, targetPath: any): any {
  const relative = path.relative(projectRoot, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureInsideProject(projectRoot: any, targetPath: any): any {
  const resolved = path.resolve(projectRoot, targetPath);
  if (!isInsideProject(projectRoot, resolved)) {
    throw new Error(`Refusing to access path outside project_root: ${targetPath}`);
  }
  return resolved;
}

function listSnapshotFiles(projectRoot: any, current: any = projectRoot, results: any = []): any {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".autoresearch-runs") continue;
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      listSnapshotFiles(projectRoot, entryPath, results);
    } else if (entry.isFile()) {
      results.push(path.relative(projectRoot, entryPath));
    }
  }
  return results;
}

function createFileSnapshot(projectRoot: any): any {
  const files = new Map();
  for (const relativePath of listSnapshotFiles(projectRoot)) {
    files.set(relativePath, fs.readFileSync(path.join(projectRoot, relativePath)));
  }
  return files;
}

function restoreFileSnapshot(projectRoot: any, snapshot: any): any {
  for (const relativePath of listSnapshotFiles(projectRoot)) {
    if (!snapshot.has(relativePath)) {
      fs.rmSync(path.join(projectRoot, relativePath), { force: true });
    }
  }

  for (const [relativePath, contents] of snapshot.entries()) {
    const absolutePath = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
}

function parsePatchTarget(line: any): any {
  const target = line.replace(/^\+\+\+\s+/, "").trim().split(/\s+/)[0];
  if (target === "/dev/null") return null;
  return target.replace(/^[ab]\//, "");
}

function applyUnifiedDiff(projectRoot: any, diffText: any): any {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  const changedFiles = [];

  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }

    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) {
      throw new Error("Invalid unified diff: missing target file header");
    }
    const relativePath = parsePatchTarget(lines[index]);
    if (!relativePath) {
      throw new Error("Deleting files through generic diff application is not supported in this MVP");
    }
    const absolutePath = ensureInsideProject(projectRoot, relativePath);
    const originalLines = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n").split("\n") : [];
    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") originalLines.pop();
    const outputLines = [];
    let originalIndex = 0;

    index += 1;
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      if (!lines[index].startsWith("@@")) {
        index += 1;
        continue;
      }

      const hunk = lines[index].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!hunk) throw new Error(`Invalid unified diff hunk: ${lines[index]}`);
      const oldStart = Number(hunk[1]) - 1;
      while (originalIndex < oldStart) {
        outputLines.push(originalLines[originalIndex]);
        originalIndex += 1;
      }

      index += 1;
      while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("--- ")) {
        const line = lines[index];
        if (line === "\\ No newline at end of file") {
          index += 1;
          continue;
        }
        const marker = line[0];
        const body = line.slice(1);
        if (marker === " ") {
          if (originalLines[originalIndex] !== body) {
            throw new Error(`Patch context mismatch in ${relativePath}`);
          }
          outputLines.push(body);
          originalIndex += 1;
        } else if (marker === "-") {
          if (originalLines[originalIndex] !== body) {
            throw new Error(`Patch removal mismatch in ${relativePath}`);
          }
          originalIndex += 1;
        } else if (marker === "+") {
          outputLines.push(body);
        } else if (line === "") {
          index += 1;
          continue;
        } else {
          throw new Error(`Unsupported diff line in ${relativePath}: ${line}`);
        }
        index += 1;
      }
    }

    while (originalIndex < originalLines.length) {
      outputLines.push(originalLines[originalIndex]);
      originalIndex += 1;
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${outputLines.join("\n")}\n`);
    changedFiles.push(relativePath);
  }

  if (changedFiles.length === 0) {
    throw new Error("Candidate diff did not contain any file changes");
  }
  return changedFiles;
}

class DefaultAutoresearchAdapter {
  config: any;
  projectRoot: string;
  runId: string;
  ledger: any;
  preChangeSnapshot: any;
  lastBaseline: any;
  lastChange: any;
  lastChecks: any[];
  lastEvidence: any[];

  constructor(config: any, options: any = {}) {
    if (!config || typeof config !== "object") {
      throw new Error("DefaultAutoresearchAdapter requires a config object");
    }
    this.config = config;
    this.projectRoot = path.resolve(config.project_root || options.project_root || process.cwd());
    this.runId = options.run_id || config.run_id || `run-${Date.now()}`;
    this.ledger = options.ledger || new LedgerStore({ root_dir: this.projectRoot, run_id: this.runId });
    this.preChangeSnapshot = null;
    this.lastBaseline = null;
    this.lastChange = null;
    this.lastChecks = [];
    this.lastEvidence = [];
  }

  discoverProject(): any {
    const gitTopLevel = tryRunGit(this.projectRoot, ["rev-parse", "--show-toplevel"]);
    const baselineCommit = tryRunGit(this.projectRoot, ["rev-parse", "HEAD"]);
    return {
      project_root: this.projectRoot,
      vcs: gitTopLevel ? "git" : "none",
      git_root: gitTopLevel || null,
      baseline_commit: baselineCommit || null,
      manifest_paths: [],
    };
  }

  snapshotBaseline(): any {
    const commands = this.config.baseline_commands || [];
    const outputs = commands.map((command: any) => runShellCommand(command, this.projectRoot));
    this.lastBaseline = {
      baseline_commit: this.discoverProject().baseline_commit,
      commands,
      outputs,
      passed: outputs.every((output: any) => output.status === 0),
      timestamp: new Date().toISOString(),
    };
    return this.lastBaseline;
  }

  proposeExperiment(context: any = {}): any {
    return {
      objective: this.config.objective,
      hypothesis: context.hypothesis || "No automatic proposal generated by the generic adapter.",
      requires_candidate_change: true,
    };
  }

  applyChange(change: any): any {
    if (!change || typeof change !== "object") {
      throw new Error("applyChange requires a change object with diff or patch_path");
    }

    this.preChangeSnapshot = createFileSnapshot(this.projectRoot);
    const diff = change.diff || fs.readFileSync(ensureInsideProject(this.projectRoot, change.patch_path), "utf8");
    let changedFiles;
    try {
      const gitApply = childProcess.spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
        cwd: this.projectRoot,
        input: diff,
        encoding: "utf8",
      });
      if (gitApply.status === 0) {
        changedFiles = ["git-apply"];
      } else {
        changedFiles = applyUnifiedDiff(this.projectRoot, diff);
      }
    } catch (error) {
      restoreFileSnapshot(this.projectRoot, this.preChangeSnapshot);
      throw error;
    }

    this.lastChange = {
      changed_files: changedFiles,
      diff,
      candidate_commit: null,
      candidate_diff_hash: diffHash(diff),
      applied: true,
    };
    return this.lastChange;
  }

  runChecks(commands: any = this.config.allowed_commands || []): any {
    const allowedCommands = this.config.allowed_commands || [];
    const requestedCommands = commands || allowedCommands;
    const allowed = new Set(allowedCommands.map(commandToString));
    for (const command of requestedCommands) {
      if (!allowed.has(commandToString(command))) {
        throw new Error(`Command is not declared in allowed_commands: ${commandToString(command)}`);
      }
    }
    this.lastChecks = requestedCommands.map((command: any) => runShellCommand(command, this.projectRoot));
    return this.lastChecks;
  }

  collectEvidence(paths: any = []): any {
    const evidencePaths = paths.map((evidencePath: any) => {
      const absolutePath = ensureInsideProject(this.projectRoot, evidencePath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Evidence path does not exist: ${evidencePath}`);
      }
      return path.relative(this.projectRoot, absolutePath);
    });
    this.lastEvidence = evidencePaths;
    return {
      evidence_paths: evidencePaths,
      retained: Boolean(this.config.evidence && this.config.evidence.retain_artifacts),
    };
  }

  judgeResult(input: any = {}): any {
    return {
      judge_verdicts: input.judge_verdicts || [],
      scores: input.scores || {},
      rationale: input.rationale || "No judge rationale supplied.",
      recommendation: input.recommendation || "revert",
    };
  }

  decideKeepOrRevert(decisionInput: any): any {
    const input = typeof decisionInput === "string" ? { decision: decisionInput } : decisionInput;
    const decision = input.decision;
    if (decision === "keep") {
      return { decision: "keep", reverted: false, rationale: input.rationale || "Change kept." };
    }
    if (decision !== "revert") {
      throw new Error(`Unsupported decision: ${decision}`);
    }
    if (!this.preChangeSnapshot) {
      throw new Error("Cannot revert before applyChange captures a pre-change snapshot");
    }
    restoreFileSnapshot(this.projectRoot, this.preChangeSnapshot);
    return { decision: "revert", reverted: true, rationale: input.rationale || "Change reverted." };
  }

  recordLedgerEntry(entry: any): any {
    return this.ledger.appendEntry(createLedgerEntry({
      run_id: this.runId,
      iteration: entry.iteration,
      baseline_commit: entry.baseline_commit || (this.lastBaseline && this.lastBaseline.baseline_commit) || null,
      candidate_commit: entry.candidate_commit || (this.lastChange && this.lastChange.candidate_commit) || null,
      diff: entry.diff || (this.lastChange && this.lastChange.diff) || null,
      objective: entry.objective || this.config.objective,
      frozen_criteria: entry.frozen_criteria || this.config.criteria || [],
      commands: entry.commands || [
        ...(this.config.baseline_commands || []),
        ...(this.config.allowed_commands || []),
      ],
      outputs: entry.outputs || [
        ...((this.lastBaseline && this.lastBaseline.outputs) || []),
        ...(this.lastChecks || []),
      ],
      evidence_paths: entry.evidence_paths || this.lastEvidence || [],
      judge_verdicts: entry.judge_verdicts || [],
      scores: entry.scores || {},
      decision: entry.decision,
      rationale: entry.rationale || "",
      timestamp: entry.timestamp,
    }));
  }

  summarizeLearning(): any {
    const entries = this.ledger.readEntries();
    return {
      run_id: this.runId,
      total_entries: entries.length,
      kept: entries.filter((entry: any) => entry.decision === "keep").length,
      reverted: entries.filter((entry: any) => entry.decision === "revert").length,
      rationales: entries.map((entry: any) => entry.rationale).filter(Boolean),
    };
  }
}

export {
  DefaultAutoresearchAdapter,
  applyUnifiedDiff,
  createFileSnapshot,
  restoreFileSnapshot,
  runShellCommand,
};
