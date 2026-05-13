# autoresearch-to-all

Autoresearch-style qualitative harness engineering for coding agents.

This repository contains a reusable `autoresearch-qualitative` skill that generalizes the repeated experiment loop from quantitative metric optimization into qualitative project-improvement runs: explicit config, safety preflight, evidence capture, LLM-as-judge review, keep/revert decisions, immutable ledger entries, and final reports.

Inspired by Andrej Karpathy's [`autoresearch`](https://github.com/karpathy/autoresearch), but designed as a generic qualitative harness rather than a single scalar-metric training benchmark.

## What is included

- `skills/autoresearch-qualitative/SKILL.md` — skill operating guide
- `skills/autoresearch-qualitative/ARCHITECTURE.md` — module and data-flow contract
- `skills/autoresearch-qualitative/src/` — config, safety, adapter, ledger, judge, loop, and report modules
- `skills/autoresearch-qualitative/templates/` — config, rubric, judge, and review templates
- `skills/autoresearch-qualitative/tests/` — unit, integration, and fixture E2E tests

## Verify

```bash
cd skills/autoresearch-qualitative
npx tsc --noEmit
node --test tests/*.test.ts
bash tests/verify-templates.sh
```

## License

MIT. See `LICENSE`.
