# Codex Goal Boundary Fragment

Codex `/goal` may help one agent continue an iteration, but it is not the durable run state.

The harness owns:

- config validation
- safety preflight
- mission/rubric artifacts
- candidate contract validation
- evaluation and judge calls
- keep/revert decisions
- ledger and final report

Codex owns only the active session work needed to produce a candidate artifact.
