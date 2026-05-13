# Codex Goal Handoff

Use Codex `/goal` as an iteration-level continuation aid only. Do not treat `/goal` state as the source of truth for this run.

## Source of truth

The authoritative run state is the autoresearch artifact set:

- Config: `{config_path}`
- Mission: `{mission_path}`
- Rubric: `{rubric_path}`
- Ledger: `{ledger_path}`
- Candidate contract: `{candidate_path}`

## Codex instructions

1. If no active Codex goal exists, create one for this iteration objective:
   - Objective: `{iteration_objective}`
   - Stop condition: write a valid `candidate.json` or report `noop`, `abort`, or `interrupted`.
2. Work only inside the declared project root and mutation scope.
3. Do not modify protected paths.
4. Run only configured allowed commands.
5. When the iteration is complete, write `{candidate_path}` using the candidate contract schema.
6. Do not decide keep/revert yourself. The harness owns evaluation, judging, ledger updates, and keep/revert.

## Candidate status meanings

- `candidate`: a change was produced and committed or otherwise captured for evaluation.
- `noop`: no useful change was found; the harness may continue to the next iteration.
- `abort`: stop the run without reset because continuing would be unsafe or impossible.
- `interrupted`: work stopped before a reliable candidate could be produced.

## Completion reminder

After writing the candidate artifact, return a concise summary with:

- candidate status
- changed files
- commands run
- evidence paths
- known risks
