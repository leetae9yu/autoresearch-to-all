import fs from "node:fs";

const DEFAULT_SECRET_PATTERNS = [
  /API_KEY\s*=\s*[^\s]+/gi,
  /api[_-]?key\s*[:=]\s*[^\s]+/gi,
  /password\s*[:=]\s*[^\s]+/gi,
  /secret\s*[:=]\s*[^\s]+/gi,
  /token\s*[:=]\s*[^\s]+/gi,
];

function parseLedgerFile(ledgerPath: any): any {
  if (!fs.existsSync(ledgerPath)) return [];
  const contents = fs.readFileSync(ledgerPath, "utf8");
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

function redactSecrets(text: any, secretPatterns: any = []): any {
  if (typeof text !== "string") return text;
  let result = text;
  const patterns = secretPatterns.length > 0 ? secretPatterns : DEFAULT_SECRET_PATTERNS;
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      result = result.replace(pattern, "[REDACTED]");
    } else if (typeof pattern === "string") {
      const regex = new RegExp(pattern, "gi");
      result = result.replace(regex, "[REDACTED]");
    }
  }
  return result;
}

function categorizeFailure(entry: any): any {
  const rationale = (entry.rationale || "").toLowerCase();
  const outputs = entry.outputs || [];
  const hasCommandFailure = outputs.some((o: any) => o && typeof o.status === "number" && o.status !== 0);

  if (hasCommandFailure) return "execution_failure";
  if (rationale.includes("safety") || rationale.includes("concern")) return "safety_concern";
  if (rationale.includes("regression") || rationale.includes("baseline")) return "baseline_regression";
  if (rationale.includes("evidence") || rationale.includes("missing") || Object.keys(entry.scores || {}).length === 0) {
    return "evidence_missing";
  }
  return "other";
}

function computeScoreTrends(entries: any[]): any {
  const criteriaIds = new Set<string>();
  for (const entry of entries) {
    if (entry.scores && typeof entry.scores === "object") {
      for (const key of Object.keys(entry.scores)) {
        criteriaIds.add(key);
      }
    }
  }

  const trends: Record<string, any> = {};
  for (const id of criteriaIds) {
    const values = entries
      .map((e: any) => e.scores[id])
      .filter((v: any) => typeof v === "number");
    if (values.length === 0) {
      trends[id] = { average: 0, trend: "flat" };
      continue;
    }
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const mid = Math.floor(values.length / 2);
    const first = values.slice(0, Math.max(1, mid));
    const second = values.slice(mid);
    const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
    const secondAvg = second.reduce((a, b) => a + b, 0) / second.length;
    const diff = secondAvg - firstAvg;
    let trend = "flat";
    if (diff > 0.5) trend = "improving";
    else if (diff < -0.5) trend = "declining";
    trends[id] = { average: Number(average.toFixed(2)), trend };
  }
  return trends;
}

function deriveRecommendations(entries: any[], scoreTrends: any, failureCategories: any): any {
  const recommendations = [];

  const hasDeclining = Object.values(scoreTrends as Record<string, any>).some((t: any) => t.trend === "declining");
  if (hasDeclining) {
    recommendations.push("Review criteria weights or rubric prompts; scores are declining across iterations.");
  }

  if (failureCategories.safety_concern > 0) {
    recommendations.push("Strengthen safety guardrails and preflight checks.");
  }
  if (failureCategories.baseline_regression > 0) {
    recommendations.push("Improve baseline validation before applying changes.");
  }
  if (failureCategories.evidence_missing > 0) {
    recommendations.push("Refine evidence collection steps and required artifacts.");
  }
  if (failureCategories.execution_failure > 0) {
    recommendations.push("Investigate command failures and environment stability.");
  }

  const revertedCount = entries.filter((e: any) => e.decision === "revert").length;
  const keptCount = entries.filter((e: any) => e.decision === "keep").length;

  if (revertedCount > keptCount) {
    recommendations.push("Consider tightening decision thresholds or improving candidate generation.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Continue current policy; results are stable.");
  }

  return recommendations;
}

function generateReport(ledgerPath: any, config: any): any {
  const entries = parseLedgerFile(ledgerPath);
  const runId = entries.length > 0 ? entries[0].run_id : (config.run_id || "unknown");

  const kept = entries.filter((e: any) => e.decision === "keep");
  const reverted = entries.filter((e: any) => e.decision === "revert");

  const failureCategories: Record<string, number> = {};
  for (const entry of reverted) {
    const category = categorizeFailure(entry);
    failureCategories[category] = (failureCategories[category] || 0) + 1;
  }

  const scoreTrends = computeScoreTrends(entries);
  const averageScores: Record<string, number> = {};
  for (const [id, data] of Object.entries(scoreTrends as Record<string, any>)) {
    averageScores[id] = data.average;
  }

  const recommendations = deriveRecommendations(entries, scoreTrends, failureCategories);

  const lines = [];
  lines.push("# Autoresearch Qualitative Report");
  lines.push("");
  lines.push("## Run Summary");
  lines.push(`- **Run ID**: ${runId}`);
  lines.push(`- **Iterations**: ${entries.length}`);
  lines.push(`- **Kept**: ${kept.length}`);
  lines.push(`- **Reverted**: ${reverted.length}`);
  lines.push("");

  lines.push("## Objective");
  lines.push(config.objective || "Not specified.");
  lines.push("");

  lines.push("## Config Summary");
  lines.push(`- **Max Iterations**: ${config.max_iterations || "N/A"}`);
  lines.push(`- **Max Runtime (minutes)**: ${config.max_runtime_minutes || "N/A"}`);
  lines.push(`- **Decision Policy**: keep if ${JSON.stringify(config.decision_policy?.keep_if || "N/A")}, revert if ${JSON.stringify(config.decision_policy?.revert_if || "N/A")}`);
  lines.push("");

  lines.push("## Experiments");
  lines.push("| Iteration | Decision | Scores | Evidence Paths | Rationale |");
  lines.push("|-----------|----------|--------|----------------|-----------|");
  for (const entry of entries) {
    const scores = JSON.stringify(entry.scores || {});
    const evidence = (entry.evidence_paths || []).join(", ") || "none";
    const rationale = (entry.rationale || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${entry.iteration} | ${entry.decision} | ${scores} | ${evidence} | ${rationale} |`);
  }
  lines.push("");

  lines.push("## Kept Changes");
  if (kept.length === 0) {
    lines.push("None.");
  } else {
    for (const entry of kept) {
      lines.push(`- Iteration ${entry.iteration}: ${entry.rationale || "No rationale."}`);
    }
  }
  lines.push("");

  lines.push("## Reverted Changes");
  if (reverted.length === 0) {
    lines.push("None.");
  } else {
    for (const entry of reverted) {
      lines.push(`- Iteration ${entry.iteration}: ${entry.rationale || "No rationale."}`);
    }
  }
  lines.push("");

  lines.push("## Score Trends");
  for (const [id, data] of Object.entries(scoreTrends as Record<string, any>)) {
    lines.push(`- **${id}**: average ${data.average}, trend ${data.trend}`);
  }
  lines.push("");

  lines.push("## Failure Taxonomy");
  const categoryNames = Object.keys(failureCategories);
  if (categoryNames.length === 0) {
    lines.push("No failures recorded.");
  } else {
    for (const category of categoryNames) {
      lines.push(`- **${category}**: ${failureCategories[category]}`);
    }
  }
  lines.push("");

  lines.push("## Learnings & Recommendations");
  lines.push("> Learning is policy-level (prompts, rubrics, and decision thresholds), not machine-learning training.");
  lines.push("");
  for (const rec of recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push("");

  const markdown = redactSecrets(lines.join("\n"), config.secret_patterns);

  const json = {
    run_id: runId,
    iteration_count: entries.length,
    kept_count: kept.length,
    reverted_count: reverted.length,
    average_scores: averageScores,
    failure_categories: failureCategories,
    recommended_next_steps: recommendations,
  };

  return { markdown, json };
}

export {
  categorizeFailure,
  computeScoreTrends,
  DEFAULT_SECRET_PATTERNS,
  deriveRecommendations,
  generateReport,
  redactSecrets,
};
