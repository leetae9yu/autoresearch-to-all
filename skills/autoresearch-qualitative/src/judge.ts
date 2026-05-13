import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

function loadTemplate(templateName: any): any {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Judge template not found: ${templateName}`);
  }
  return fs.readFileSync(templatePath, "utf8");
}

function substitutePlaceholders(template: any, values: any): any {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{${key}}`;
    const replacement = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "");
    result = result.split(placeholder).join(replacement);
  }
  return result;
}

function buildJudgePrompt(context: any): any {
  const template = loadTemplate("judge-prompt.md");
  const rubricContent = loadTemplate("rubric.md");

  const values = {
    objective: context.objective || "",
    criteria: Array.isArray(context.criteria)
      ? context.criteria.map((c: any) => `${c.id}: ${c.description}`).join("\n")
      : String(context.criteria || ""),
    rubric: rubricContent,
    baseline_evidence: context.baseline_evidence
      ? JSON.stringify(context.baseline_evidence, null, 2)
      : "(no baseline evidence provided)",
    experiment_evidence: context.experiment_evidence
      ? JSON.stringify(context.experiment_evidence, null, 2)
      : "(no experiment evidence provided)",
    diff_summary: context.diff_summary || "(no diff summary provided)",
    command_outputs: context.command_outputs
      ? JSON.stringify(context.command_outputs, null, 2)
      : "(no command outputs provided)",
    safety_notes: context.safety_notes || "(no safety notes provided)",
  };

  return substitutePlaceholders(template, values);
}

function parseVerdictResponse(responseText: any): any {
  if (!responseText || typeof responseText !== "string") {
    return null;
  }

  const jsonBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const textToParse = jsonBlockMatch ? jsonBlockMatch[1] : responseText.trim();

  try {
    const parsed = JSON.parse(textToParse);
    return normalizeVerdict(parsed);
  } catch {
    const braceStart = textToParse.indexOf("{");
    const braceEnd = textToParse.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        const parsed = JSON.parse(textToParse.slice(braceStart, braceEnd + 1));
        return normalizeVerdict(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeVerdict(parsed: any): any {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const scores = parsed.scores && typeof parsed.scores === "object" && !Array.isArray(parsed.scores)
    ? parsed.scores
    : {};

  const guardrailFailures = Array.isArray(parsed.guardrail_failures)
    ? parsed.guardrail_failures
    : [];

  const evidenceRefs = Array.isArray(parsed.evidence_refs)
    ? parsed.evidence_refs
    : [];

  const evidenceGaps = Array.isArray(parsed.evidence_gaps)
    ? parsed.evidence_gaps
    : [];

  const safetyConcerns = Array.isArray(parsed.safety_concerns)
    ? parsed.safety_concerns
    : [];

  const antiGamingNotes = Array.isArray(parsed.anti_gaming_notes)
    ? parsed.anti_gaming_notes
    : [];

  const recommendation = typeof parsed.recommendation === "string"
    ? parsed.recommendation.toLowerCase()
    : "revert";

  const validRecommendations = new Set(["keep", "revert", "retry"]);
  const normalizedRecommendation = validRecommendations.has(recommendation)
    ? recommendation
    : "revert";

  return {
    scores,
    guardrail_failures: guardrailFailures,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.0,
    evidence_refs: evidenceRefs,
    recommendation: normalizedRecommendation,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    evidence_gaps: evidenceGaps,
    safety_concerns: safetyConcerns,
    anti_gaming_notes: antiGamingNotes,
  };
}

function defaultReviewFn(context: any): any {
  return {
    recommendation: "revert",
    scores: {
      correctness: 3.0,
      maintainability: 3.0,
      safety_security: 3.0,
      evidence_quality: 3.0,
      simplicity: 3.0,
      risk_cost: 3.0,
      objective_fit: 3.0,
    },
    guardrail_failures: [],
    confidence: 0.0,
    evidence_refs: [],
    rationale: "Default review: no external review function provided.",
    evidence_gaps: ["No external review function was provided."],
    safety_concerns: [],
    anti_gaming_notes: [],
  };
}

function evaluateDecisionPolicy(verdict: any, decisionPolicy: any): any {
  const keepIf = decisionPolicy && decisionPolicy.keep_if;
  const revertIf = decisionPolicy && decisionPolicy.revert_if;

  const context = buildPolicyContext(verdict);

  const shouldRevert = evaluatePolicyRule(revertIf, context);
  if (shouldRevert) {
    return { decision: "revert", reason: "revert_if condition met" };
  }

  const shouldKeep = evaluatePolicyRule(keepIf, context);
  if (shouldKeep) {
    return { decision: "keep", reason: "keep_if conditions met" };
  }

  return { decision: "revert", reason: "keep_if conditions not met" };
}

function buildPolicyContext(verdict: any): any {
  const hasGuardrailFailures = Array.isArray(verdict.guardrail_failures) && verdict.guardrail_failures.length > 0;
  const hasSafetyConcerns = Array.isArray(verdict.safety_concerns) && verdict.safety_concerns.length > 0;
  const scores = verdict.scores || {};
  const allCriteriaPass = Object.values(scores).every((s) => typeof s === "number" && s >= 3.0);
  const anyScoreBelow2 = Object.values(scores).some((s) => typeof s === "number" && s < 2.0);
  const hasEvidenceRefs = Array.isArray(verdict.evidence_refs) && verdict.evidence_refs.length > 0;
  const hasEvidenceGaps = Array.isArray(verdict.evidence_gaps) && verdict.evidence_gaps.length > 0;
  const recommendationIsKeep = verdict.recommendation === "keep";

  return {
    all_required_criteria_pass: allCriteriaPass,
    no_safety_concerns: !hasSafetyConcerns && !hasGuardrailFailures,
    evidence_supports_objective: hasEvidenceRefs && !anyScoreBelow2,
    any_safety_concern: hasSafetyConcerns || hasGuardrailFailures,
    baseline_regression: anyScoreBelow2,
    evidence_missing: hasEvidenceGaps || !hasEvidenceRefs,
    recommendation_is_keep: recommendationIsKeep,
    confidence: verdict.confidence || 0,
  };
}

function evaluatePolicyRule(rule: any, context: any): any {
  if (!rule) return false;

  if (typeof rule === "string") {
    return evaluatePolicyExpression(rule, context);
  }

  if (typeof rule === "object" && !Array.isArray(rule)) {
    const conditions = Object.entries(rule);
    if (conditions.length === 0) return false;
    return conditions.every(([key, expected]) => {
      const actualValue = context[key];
      if (typeof expected === "boolean") return actualValue === expected;
      if (typeof expected === "string") return String(actualValue) === expected;
      return actualValue === expected;
    });
  }

  return false;
}

function evaluatePolicyExpression(expression: any, context: any): any {
  if (typeof expression !== "string") return false;

  const trimmed = expression.trim();
  if (trimmed === "") return false;

  const orParts = splitTopLevelOperator(trimmed, "||");
  if (orParts.length > 1) {
    return orParts.some((part: any) => evaluatePolicyExpression(part, context));
  }

  const andParts = splitTopLevelOperator(trimmed, "&&");
  if (andParts.length > 1) {
    return andParts.every((part: any) => evaluatePolicyExpression(part, context));
  }

  if (trimmed.startsWith("!") && !trimmed.startsWith("!=")) {
    return !evaluatePolicyExpression(trimmed.slice(1), context);
  }

  if (trimmed.startsWith("(") && trimmed.endsWith(")") && enclosesWholeExpression(trimmed)) {
    return evaluatePolicyExpression(trimmed.slice(1, -1), context);
  }

  if (trimmed.startsWith("not(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(4, -1).trim();
    return !evaluatePolicyExpression(inner, context);
  }

  if (trimmed.startsWith("all_of(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(7, -1).trim();
    const parts = splitPolicyExpressions(inner);
    return parts.every((part: any) => evaluatePolicyExpression(part.trim(), context));
  }

  if (trimmed.startsWith("any_of(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(7, -1).trim();
    const parts = splitPolicyExpressions(inner);
    return parts.some((part: any) => evaluatePolicyExpression(part.trim(), context));
  }

  const comparison = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
  if (comparison) {
    return evaluateComparison(context[comparison[1]], comparison[2], parsePolicyLiteral(comparison[3], context));
  }

  if (context.hasOwnProperty(trimmed)) {
    return Boolean(context[trimmed]);
  }

  return false;
}

function splitTopLevelOperator(text: any, operator: any): any {
  const parts = [];
  let depth = 0;
  let current = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;

    if (depth === 0 && text.slice(index, index + operator.length) === operator) {
      parts.push(current.trim());
      current = "";
      index += operator.length;
      continue;
    }

    current += text[index];
    index += 1;
  }
  if (parts.length > 0) parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

function enclosesWholeExpression(text: any): any {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0 && index < text.length - 1) return false;
  }
  return depth === 0;
}

function parsePolicyLiteral(raw: any, context: any): any {
  const value = raw.trim();
  if (context.hasOwnProperty(value)) return context[value];
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function evaluateComparison(left: any, operator: any, right: any): any {
  if ([">=", "<=", ">", "<"].includes(operator)) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) return false;
    if (operator === ">=") return leftNumber >= rightNumber;
    if (operator === "<=") return leftNumber <= rightNumber;
    if (operator === ">") return leftNumber > rightNumber;
    if (operator === "<") return leftNumber < rightNumber;
  }
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  return false;
}

function splitPolicyExpressions(text: any): any {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function createJudge(options: any = {}): any {
  const reviewFn = options.reviewFn || defaultReviewFn;

  return {
    evaluate(context: any): any {
      const prompt = buildJudgePrompt(context);
      const reviewResult = reviewFn({ prompt, context });

      const verdict = parseVerdictResponse(
        typeof reviewResult === "string" ? reviewResult : JSON.stringify(reviewResult)
      );

      if (!verdict) {
        return {
          verdict: null,
          decision: "revert",
          reason: "judge returned unparseable response",
          prompt,
          raw: reviewResult,
        };
      }

      const policyResult = evaluateDecisionPolicy(verdict, context.decision_policy);

      return {
        verdict,
        decision: policyResult.decision,
        reason: policyResult.reason,
        prompt,
        raw: reviewResult,
      };
    },
  };
}

export {
  buildJudgePrompt,
  buildPolicyContext,
  createJudge,
  enclosesWholeExpression,
  evaluateComparison,
  evaluateDecisionPolicy,
  evaluatePolicyExpression,
  loadTemplate,
  normalizeVerdict,
  parsePolicyLiteral,
  parseVerdictResponse,
  splitTopLevelOperator,
  substitutePlaceholders,
};
