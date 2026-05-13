# Pre-run Interview

Run this interview before starting an `autoresearch-qualitative` experiment loop. Use the host question/interview tool when available; otherwise ask the same questions in chat. Do not mutate the project until the answers are captured in `interview.answers` and the operator confirms the generated config.

Ask one targeted question at a time. Focus on the weakest unclear dimension, then stop and wait for the operator's answer before continuing. Never infer missing answers during the interview phase.

## Required questions

1. **Objective**: What project behavior should the experiment improve?
2. **Success evidence**: Which commands, files, logs, screenshots, or manual checks prove improvement?
3. **Safety boundaries**: Which paths, secrets, generated files, or workflows must never be touched?
4. **Allowed commands**: Which exact commands may the loop run for baseline and candidate checks?
5. **Budget**: What maximum iterations, runtime minutes, and diff lines are acceptable?
6. **Decision policy**: What conditions should force keep, revert, or retry?
7. **Evidence retention**: Which artifacts should be retained, and which data must be redacted?

## Output contract

After the interview, write or update the config with:

```yaml
interview:
  required: true
  status: completed
  answers:
    objective: "..."
    success_evidence: "..."
    safety_boundaries: "..."
    allowed_commands: "..."
    budget: "..."
    decision_policy: "..."
    evidence_retention: "..."
```

If the operator explicitly skips the interview, set `status: skipped` and include the reason in `answers.skip_reason`. Skipping must not authorize missing config fields.
