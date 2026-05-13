#!/usr/bin/env bash
# Verification script for judge template files
# Checks that all required placeholders, schema descriptions, and guardrail language appear.

set -euo pipefail

TEMPLATES_DIR="${TEMPLATES_DIR:-skills/autoresearch-qualitative/templates}"
RUBRIC="$TEMPLATES_DIR/rubric.md"
JUDGE="$TEMPLATES_DIR/judge-prompt.md"
REVIEW="$TEMPLATES_DIR/review-prompt.md"
CODEX_HANDOFF="$TEMPLATES_DIR/codex-goal-handoff.md"
CANDIDATE_CONTRACT="$TEMPLATES_DIR/candidate-contract.json"
EVIDENCE_FRAGMENT="$TEMPLATES_DIR/fragments/evidence-contract.md"
GOAL_BOUNDARY_FRAGMENT="$TEMPLATES_DIR/fragments/codex-goal-boundary.md"

ERRORS=0

fail() {
  echo "FAIL: $1"
  ERRORS=$((ERRORS + 1))
}

pass() {
  echo "PASS: $1"
}

check_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    fail "File not found: $file"
    return 1
  fi
  pass "File exists: $file"
  return 0
}

check_contains() {
  local file="$1"
  local pattern="$2"
  local desc="$3"
  if grep -qi "$pattern" "$file"; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

echo "=== Checking rubric.md ==="
if check_file "$RUBRIC"; then
  check_contains "$RUBRIC" "score vector" "rubric explains score vectors"
  check_contains "$RUBRIC" "guardrail" "rubric explains guardrail precedence"
  check_contains "$RUBRIC" "correctness" "dimension: correctness"
  check_contains "$RUBRIC" "maintainability" "dimension: maintainability"
  check_contains "$RUBRIC" "safety" "dimension: safety/security"
  check_contains "$RUBRIC" "evidence quality" "dimension: evidence quality"
  check_contains "$RUBRIC" "simplicity" "dimension: simplicity"
  check_contains "$RUBRIC" "risk" "dimension: risk/cost"
  check_contains "$RUBRIC" "objective fit" "dimension: objective fit"
  check_contains "$RUBRIC" "protected path" "guardrail: protected path"
  check_contains "$RUBRIC" "test" "guardrail: tests fail"
  check_contains "$RUBRIC" "disallowed command" "guardrail: disallowed command"
  check_contains "$RUBRIC" "anti-gaming" "anti-gaming checklist present"
  check_contains "$RUBRIC" "diff size" "anti-gaming: diff size gaming"
  check_contains "$RUBRIC" "test removal" "anti-gaming: test removal"
  check_contains "$RUBRIC" "metric manipulation" "anti-gaming: metric manipulation"
  check_contains "$RUBRIC" "revert" "guardrail forces revert"
fi

echo ""
echo "=== Checking judge-prompt.md ==="
if check_file "$JUDGE"; then
  check_contains "$JUDGE" "{objective}" "placeholder: {objective}"
  check_contains "$JUDGE" "{criteria}" "placeholder: {criteria}"
  check_contains "$JUDGE" "{rubric}" "placeholder: {rubric}"
  check_contains "$JUDGE" "{baseline_evidence}" "placeholder: {baseline_evidence}"
  check_contains "$JUDGE" "{experiment_evidence}" "placeholder: {experiment_evidence}"
  check_contains "$JUDGE" "{diff_summary}" "placeholder: {diff_summary}"
  check_contains "$JUDGE" "{command_outputs}" "placeholder: {command_outputs}"
  check_contains "$JUDGE" "{safety_notes}" "placeholder: {safety_notes}"
  check_contains "$JUDGE" '"scores"' "schema: scores"
  check_contains "$JUDGE" '"guardrail_failures"' "schema: guardrail_failures"
  check_contains "$JUDGE" '"confidence"' "schema: confidence"
  check_contains "$JUDGE" '"evidence_refs"' "schema: evidence_refs"
  check_contains "$JUDGE" '"recommendation"' "schema: recommendation"
  check_contains "$JUDGE" '"rationale"' "schema: rationale"
  check_contains "$JUDGE" "Do not modify" "prohibition: file mutation"
  check_contains "$JUDGE" "keep" "recommendation option: keep"
  check_contains "$JUDGE" "revert" "recommendation option: revert"
  check_contains "$JUDGE" "retry" "recommendation option: retry"
fi

echo ""
echo "=== Checking review-prompt.md ==="
if check_file "$REVIEW"; then
  check_contains "$REVIEW" '"issues"' "schema: issues[]"
  check_contains "$REVIEW" '"confidence"' "schema: confidence"
  check_contains "$REVIEW" '"recommendation"' "schema: recommendation"
  check_contains "$REVIEW" "correctness" "review question: correctness"
  check_contains "$REVIEW" "side effect" "review question: side effects"
  check_contains "$REVIEW" "objective" "review question: alignment with objective"
  check_contains "$REVIEW" "Do not modify" "prohibition: file mutation"
  check_contains "$REVIEW" "proceed" "recommendation option: proceed"
  check_contains "$REVIEW" "revise" "recommendation option: revise"
  check_contains "$REVIEW" "reject" "recommendation option: reject"
fi

echo ""
echo "=== Checking Codex handoff templates ==="
if check_file "$CODEX_HANDOFF"; then
  check_contains "$CODEX_HANDOFF" 'Codex `/goal`' "handoff explains Codex goal boundary"
  check_contains "$CODEX_HANDOFF" "source of truth" "handoff names source of truth"
  check_contains "$CODEX_HANDOFF" "{candidate_path}" "handoff includes candidate placeholder"
  check_contains "$CODEX_HANDOFF" "candidate.json" "handoff requires candidate artifact"
fi

if check_file "$CANDIDATE_CONTRACT"; then
  check_contains "$CANDIDATE_CONTRACT" "schema_version" "candidate schema has version"
  check_contains "$CANDIDATE_CONTRACT" "base_commit" "candidate schema has base commit"
  check_contains "$CANDIDATE_CONTRACT" "candidate_commit" "candidate schema has candidate commit"
  check_contains "$CANDIDATE_CONTRACT" "changed_files" "candidate schema has changed files"
fi

if check_file "$EVIDENCE_FRAGMENT"; then
  check_contains "$EVIDENCE_FRAGMENT" "Missing evidence" "evidence fragment rejects missing evidence"
  check_contains "$EVIDENCE_FRAGMENT" "ledger" "evidence fragment mentions ledger"
fi

if check_file "$GOAL_BOUNDARY_FRAGMENT"; then
  check_contains "$GOAL_BOUNDARY_FRAGMENT" "not the durable run state" "goal boundary rejects durable goal state"
  check_contains "$GOAL_BOUNDARY_FRAGMENT" "candidate contract" "goal boundary mentions candidate contract"
fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "=== ALL CHECKS PASSED ==="
  exit 0
else
  echo "=== $ERRORS CHECK(S) FAILED ==="
  exit 1
fi
