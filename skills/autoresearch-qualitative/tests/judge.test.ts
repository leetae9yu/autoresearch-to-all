import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJudgePrompt,
  createJudge,
  evaluateDecisionPolicy,
  evaluatePolicyExpression,
  parseVerdictResponse,
} from "../src/judge.ts";

function keepVerdict(overrides: any = {}): any {
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
    confidence: 0.85,
    evidence_refs: [{ dimension: "correctness", ref: "checks", quote: "ok" }],
    recommendation: "keep",
    rationale: "Evidence supports keeping the change.",
    evidence_gaps: [],
    safety_concerns: [],
    anti_gaming_notes: [],
    ...overrides,
  };
}

test("judge prompt substitutes template placeholders with context", () => {
  const prompt = buildJudgePrompt({
    objective: "Improve clarity.",
    criteria: [{ id: "clarity", description: "Output is easier to review." }],
    baseline_evidence: { passed: true },
    experiment_evidence: { passed: true },
    diff_summary: "Changed README.",
    command_outputs: [{ command: "npm test", status: 0 }],
    safety_notes: "No protected paths touched.",
  });

  assert.match(prompt, /Improve clarity\./);
  assert.match(prompt, /clarity: Output is easier to review\./);
  assert.match(prompt, /Changed README\./);
  assert.doesNotMatch(prompt, /\{objective\}/);
});

test("judge parses structured JSON verdicts inside markdown fences", () => {
  const parsed = parseVerdictResponse(`before\n\`\`\`json\n${JSON.stringify(keepVerdict())}\n\`\`\`\nafter`);

  assert.equal(parsed.recommendation, "keep");
  assert.equal(parsed.scores.correctness, 4);
  assert.equal(parsed.confidence, 0.85);
  assert.deepEqual(parsed.guardrail_failures, []);
});

test("judge returns a graceful revert when review output cannot be parsed", () => {
  const judge = createJudge({ reviewFn: () => "not json" });

  const result = judge.evaluate({
    objective: "Improve clarity.",
    criteria: [],
    decision_policy: {
      keep_if: "all_required_criteria_pass && no_safety_concerns && evidence_supports_objective",
      revert_if: "any_safety_concern || baseline_regression || evidence_missing",
    },
  });

  assert.equal(result.decision, "revert");
  assert.equal(result.verdict, null);
  assert.match(result.reason, /unparseable/);
});

test("decision policy supports boolean expressions and revert precedence", () => {
  const verdict = keepVerdict({
    guardrail_failures: [{ condition: "protected path", detail: "secret", severity: "critical" }],
  });

  const decision = evaluateDecisionPolicy(verdict, {
    keep_if: "all_required_criteria_pass && recommendation_is_keep",
    revert_if: "any_safety_concern || baseline_regression",
  });

  assert.equal(decision.decision, "revert");
  assert.equal(evaluatePolicyExpression("confidence >= 0.8 && !baseline_regression", { confidence: 0.9, baseline_regression: false }), true);
  assert.equal(evaluatePolicyExpression("all_of(no_safety_concerns, evidence_supports_objective)", { no_safety_concerns: true, evidence_supports_objective: true }), true);
});

test("createJudge calls injectable review function with prompt and context", () => {
  let received: any = null;
  const judge = createJudge({
    reviewFn(input: any): any {
      received = input;
      return keepVerdict();
    },
  });

  const result = judge.evaluate({
    objective: "Improve clarity.",
    criteria: [{ id: "clarity", description: "Clearer output." }],
    decision_policy: {
      keep_if: "all_required_criteria_pass && no_safety_concerns && evidence_supports_objective && recommendation_is_keep",
      revert_if: "any_safety_concern || baseline_regression || evidence_missing",
    },
  });

  assert.equal(result.decision, "keep");
  assert.match(received.prompt, /Improve clarity\./);
  assert.equal(received.context.objective, "Improve clarity.");
});
