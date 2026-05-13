import fs from "node:fs";
import path from "node:path";

import { DefaultAutoresearchAdapter } from "./adapter.ts";
import { loadRuntimeConfig } from "./config.ts";
import { createJudge } from "./judge.ts";
import { generateReport } from "./report.ts";
import { preflight, verifyNoProtectedPathTouched } from "./safety.ts";

type JsonRecord = Record<string, unknown>;
type ScoreMap = Record<string, number>;

interface CandidateChange {
  diff?: string;
  patch_path?: string;
  [key: string]: unknown;
}

interface LoopConfig extends JsonRecord {
  objective?: unknown;
  criteria?: unknown;
  protected_paths?: string[];
  allowed_commands?: string[];
  decision_policy?: unknown;
  project_root?: string;
  max_iterations: number;
  max_runtime_minutes: number;
  max_diff_lines: number;
  run_id?: string;
}

interface LoopState {
  iteration: number;
  now: number;
  startedAt: number;
  diffLinesUsed: number;
}

interface IterationSummary {
  decision: string;
  rationale?: string;
}

type IterationRecord = JsonRecord & IterationSummary;

interface LoopAdapterLike {
  discoverProject(): JsonRecord;
  snapshotBaseline(): JsonRecord;
  proposeExperiment(context?: JsonRecord): ProposalLike | null;
  applyChange(change: CandidateChange | null): JsonRecord;
  runChecks(commands: string[]): Array<JsonRecord & { command?: string }>;
  collectEvidence(paths: string[]): JsonRecord & { evidence_paths: string[] };
  judgeResult(input?: JsonRecord): JsonRecord & { judge_verdicts?: unknown[]; scores?: ScoreMap; rationale?: string };
  decideKeepOrRevert(input: JsonRecord): JsonRecord & { decision: string; reverted?: boolean; rationale?: string };
  recordLedgerEntry(entry: JsonRecord): JsonRecord;
  summarizeLearning?(): JsonRecord;
  ledger?: { ledgerPath?: string };
}

interface ProposalLike extends JsonRecord {
  stop?: boolean;
  reason?: string;
  candidate_change?: CandidateChange;
  change?: CandidateChange;
  candidate?: CandidateChange;
}

function computeScoreDelta(currentScores: unknown, baselineScores: unknown): ScoreMap {
  const current = currentScores && typeof currentScores === "object" && !Array.isArray(currentScores) ? currentScores as ScoreMap : {};
  const baseline = baselineScores && typeof baselineScores === "object" && !Array.isArray(baselineScores) ? baselineScores as ScoreMap : {};
  const delta: ScoreMap = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    delta[key] = (current[key] || 0) - (baseline[key] || 0);
  }
  return delta;
}

interface LedgerEntryInput {
  config: JsonRecord;
  runId: string;
  iteration: number;
  discovery: JsonRecord;
  baseline: JsonRecord;
  frozenCriteria: unknown;
  applied: JsonRecord;
  checks: Array<JsonRecord & { command?: string }>;
  evidence: JsonRecord & { evidence_paths: string[] };
  normalizedJudge: (JsonRecord & { judge_verdicts?: unknown[]; scores?: ScoreMap; rationale?: string }) | null;
  decisionResult: JsonRecord & { decision: string; rationale?: string };
  scoreDelta: ScoreMap;
}

function deepFreezeClone<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value ?? []));
  return deepFreeze(clone) as T;
}

function deepFreeze(value: unknown): unknown {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function countDiffLines(change: CandidateChange | null | undefined): number {
  if (!change || typeof change !== "object") return 0;
  let diff = change.diff || "";
  if (!diff && change.patch_path) {
    diff = fs.readFileSync(change.patch_path, "utf8");
  }
  if (typeof diff !== "string" || diff.trim() === "") return 0;
  return diff.split("\n").filter((line) => line.startsWith("+") || line.startsWith("-")).length;
}

function checkLoopBudgets(config: LoopConfig, state: LoopState): { ok: boolean; reason: string | null } {
  if (state.iteration >= config.max_iterations) {
    return { ok: false, reason: "max_iterations" };
  }

  const elapsedMinutes = (state.now - state.startedAt) / 60000;
  if (elapsedMinutes >= config.max_runtime_minutes) {
    return { ok: false, reason: "max_runtime" };
  }

  if (state.diffLinesUsed >= config.max_diff_lines) {
    return { ok: false, reason: "diff_budget_exhausted" };
  }

  return { ok: true, reason: null };
}

function resolveCandidateChange(proposal: ProposalLike | null): CandidateChange | null {
  if (!proposal || typeof proposal !== "object") return null;
  return proposal.candidate_change || proposal.change || proposal.candidate || proposal;
}

function summarizeFromIterations(runId: string, iterations: IterationSummary[]): JsonRecord {
  return {
    run_id: runId,
    total_entries: iterations.length,
    kept: iterations.filter((entry) => entry.decision === "keep").length,
    reverted: iterations.filter((entry) => entry.decision === "revert").length,
    rationales: iterations.map((entry) => entry.rationale).filter(Boolean),
  };
}

function buildLedgerEntry({
  config,
  runId,
  iteration,
  discovery,
  baseline,
  frozenCriteria,
  applied,
  checks,
  evidence,
  normalizedJudge,
  decisionResult,
  scoreDelta,
}: LedgerEntryInput): JsonRecord {
  const baselineCommands = Array.isArray(baseline.commands) ? baseline.commands : [];
  const baselineOutputs = Array.isArray(baseline.outputs) ? baseline.outputs : [];
  const evidencePaths = Array.isArray(evidence.evidence_paths) ? evidence.evidence_paths : [];
  const judgeVerdicts = normalizedJudge?.judge_verdicts ?? [];
  const scores = normalizedJudge?.scores ?? {};
  const rationale = decisionResult.rationale || normalizedJudge?.rationale || "";

  return {
    run_id: runId,
    iteration,
    baseline_commit: discovery.baseline_commit || baseline.baseline_commit || null,
    candidate_commit: applied.candidate_commit || null,
    diff: applied.diff || null,
    objective: config.objective,
    frozen_criteria: frozenCriteria,
    commands: [
      ...baselineCommands,
      ...checks.map((check: JsonRecord & { command?: string }) => check.command).filter((command): command is string => Boolean(command)),
    ],
    outputs: [
      ...baselineOutputs,
      ...checks,
    ],
    evidence_paths: evidencePaths,
    judge_verdicts: judgeVerdicts,
    scores,
    score_delta: scoreDelta,
    decision: decisionResult.decision,
    rationale,
  };
}

interface RunExperimentLoopOptions {
  configObject?: LoopConfig;
  configPath?: string;
  config?: string;
  argv?: string[];
  configOptions?: JsonRecord;
  run_id?: string;
  clock?: () => number;
  workspaceState?: JsonRecord;
  adapter?: LoopAdapterLike;
  judge?: ReturnType<typeof createJudge>;
  reviewFn?: unknown;
  evidencePaths?: string[];
}

interface RunExperimentLoopResult extends JsonRecord {
  run_id: string;
  config: LoopConfig;
  safety: JsonRecord;
  discovery: JsonRecord & { project_root?: string };
  baseline: JsonRecord & { commands?: string[]; outputs?: Array<Record<string, unknown>>; scores?: ScoreMap };
  frozen_criteria: unknown;
  iterations: IterationRecord[];
  stop_reason: string | null;
  summary: JsonRecord;
  reportMarkdownPath: string;
  reportJsonPath: string;
  report: { status: "generated"; markdownPath: string; jsonPath: string };
}

function runExperimentLoop(options: RunExperimentLoopOptions = {}): RunExperimentLoopResult {
  const config = (options.configObject || loadRuntimeConfig(options.configPath || options.config || options.argv, options.configOptions || {})) as LoopConfig;
  const runId = options.run_id || config.run_id || `run-${Date.now()}`;
  const clock = options.clock || (() => Date.now());
  const startedAt = clock();
  const workspaceState = options.workspaceState || {};

  const safety = preflight(config, workspaceState);
  const adapter: any = options.adapter || new DefaultAutoresearchAdapter(config, { run_id: runId });
  const judge: any = options.judge || createJudge({ reviewFn: options.reviewFn });
  const discovery = adapter.discoverProject() as JsonRecord & { project_root?: string };
  const baseline = adapter.snapshotBaseline() as JsonRecord & { commands?: string[]; outputs?: Array<Record<string, unknown>>; scores?: ScoreMap };
  const frozenCriteria = deepFreezeClone(config.criteria);
  const iterations: IterationRecord[] = [];

  let stopReason: string | null = null;
  let diffLinesUsed = 0;

  for (let iteration = 0; ; iteration += 1) {
    const loopBudget = checkLoopBudgets(config, {
      iteration,
      startedAt,
      now: clock(),
      diffLinesUsed,
    });
    if (!loopBudget.ok) {
      stopReason = loopBudget.reason;
      break;
    }

    const proposal = adapter.proposeExperiment({
      iteration,
      config,
      discovery,
      baseline,
      frozen_criteria: frozenCriteria,
      prior_iterations: iterations,
    }) as ProposalLike | null;

    if (proposal && proposal.stop === true) {
      stopReason = proposal.reason || "proposal_stopped";
      break;
    }

    const change = resolveCandidateChange(proposal);
    const diffLines = countDiffLines(change);
    if (diffLinesUsed + diffLines > config.max_diff_lines) {
      stopReason = "diff_budget_exhausted";
      break;
    }
    diffLinesUsed += diffLines;

    let applied: JsonRecord = { applied: false, candidate_commit: null, diff: change && change.diff ? change.diff : null };
    let checks: Array<Record<string, unknown> & { command?: string }> = [];
    let evidence: any = { evidence_paths: [] };
    let judgeResult: any = { decision: "revert" };
    let normalizedJudge: any = null;
    let decisionResult: any = null;

    try {
      applied = adapter.applyChange(change as CandidateChange);
      verifyNoProtectedPathTouched(applied.diff || (change && change.diff) || "", config.protected_paths || []);
      checks = adapter.runChecks((config.allowed_commands || []) as string[]);
      evidence = adapter.collectEvidence(options.evidencePaths || []);
      judgeResult = judge.evaluate({
        objective: config.objective,
        criteria: frozenCriteria,
        decision_policy: config.decision_policy,
        baseline_evidence: baseline,
        experiment_evidence: { checks, evidence, proposal, applied },
        diff_summary: applied.diff || (change && change.diff) || "",
        command_outputs: [...(baseline.outputs || []), ...checks],
        safety_notes: safety,
      });
      const verdict = judgeResult.verdict;
      normalizedJudge = adapter.judgeResult({
        judge_verdicts: verdict ? [verdict] : [],
        scores: verdict ? verdict.scores : {},
        rationale: verdict ? verdict.rationale : judgeResult.reason,
        recommendation: verdict ? verdict.recommendation : "revert",
      }) as JsonRecord & { judge_verdicts?: unknown[]; scores?: ScoreMap; rationale?: string };
      decisionResult = adapter.decideKeepOrRevert({
        decision: judgeResult.decision,
        rationale: normalizedJudge.rationale || judgeResult.reason,
      }) as JsonRecord & { decision: string; reverted?: boolean; rationale?: string };
    } catch (error: unknown) {
      const protectedPathTouched = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "protected_path_touched";
      const message = error instanceof Error ? error.message : String(error);
      normalizedJudge = adapter.judgeResult({
        judge_verdicts: [],
        scores: {},
        rationale: protectedPathTouched ? "protected_path_touched" : `Experiment iteration failed: ${message}`,
        recommendation: "revert",
      }) as JsonRecord & { judge_verdicts?: unknown[]; scores?: ScoreMap; rationale?: string };
      if (applied && Boolean(applied.applied)) {
        decisionResult = adapter.decideKeepOrRevert({ decision: "revert", rationale: normalizedJudge.rationale });
      } else {
        decisionResult = { decision: "revert", reverted: false, rationale: normalizedJudge.rationale };
      }
    }

    if (!normalizedJudge || !decisionResult) {
      throw new Error("Loop iteration did not produce judge and decision results");
    }

    const ledgerEntry = buildLedgerEntry({
      config,
      runId,
      iteration,
      discovery,
      baseline,
      frozenCriteria,
      applied,
      checks,
      evidence,
      normalizedJudge,
      decisionResult,
      scoreDelta: computeScoreDelta(normalizedJudge.scores, baseline.scores),
    });
    const recorded = adapter.recordLedgerEntry(ledgerEntry);
    const iterationResult: IterationRecord = {
      iteration,
      proposal,
      applied,
      checks,
      evidence,
      judge: judgeResult || null,
      decision: decisionResult.decision,
      rationale: String(ledgerEntry.rationale || ""),
      ledger_entry: recorded,
    };
    iterations.push(iterationResult);
  }

  const summary = typeof adapter.summarizeLearning === "function"
    ? adapter.summarizeLearning()
    : summarizeFromIterations(runId, iterations);

  const projectRoot = path.resolve(discovery.project_root || config.project_root || process.cwd());
  const ledgerPath = adapter.ledger?.ledgerPath || path.join(projectRoot, ".autoresearch-runs", runId, "ledger.jsonl");
  const reportDir = path.dirname(ledgerPath);
  const reportMarkdownPath = path.join(reportDir, "report.md");
  const reportJsonPath = path.join(reportDir, "report.json");
  const report = generateReport(ledgerPath, config);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportMarkdownPath, `${report.markdown}
`, "utf8");
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report.json, null, 2)}
`, "utf8");

  return {
    run_id: runId,
    config,
    safety,
    discovery,
    baseline,
    frozen_criteria: frozenCriteria,
    iterations,
    stop_reason: stopReason,
    summary,
    reportMarkdownPath,
    reportJsonPath,
    report: {
      status: "generated",
      markdownPath: reportMarkdownPath,
      jsonPath: reportJsonPath,
    },
  };
}

export {
  buildLedgerEntry,
  checkLoopBudgets,
  countDiffLines,
  deepFreezeClone,
  resolveCandidateChange,
  runExperimentLoop,
  summarizeFromIterations,
};
