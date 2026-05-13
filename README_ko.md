# autoresearch-to-all

한국어 | [English](README.md)

코딩 에이전트를 위한 autoresearch 스타일의 정성적 하네스 엔지니어링 도구입니다.

이 저장소는 재사용 가능한 `autoresearch-qualitative` Skill을 제공합니다. 기존 `autoresearch`가 단일 정량 지표를 반복 최적화하는 흐름에 가깝다면, 이 Skill은 프로젝트 개선 작업을 대상으로 명시적 설정, 안전 preflight, 증거 수집, LLM-as-judge 리뷰, keep/revert 결정, 불변 ledger, 최종 리포트까지 포함하는 정성적 실험 루프로 일반화합니다.

Andrej Karpathy의 [`autoresearch`](https://github.com/karpathy/autoresearch)에서 영감을 받았지만, 이 프로젝트는 특정 학습 benchmark가 아니라 다양한 프로젝트에 붙일 수 있는 범용 정성 평가 하네스를 목표로 합니다.

## 포함된 것

- `skills/autoresearch-qualitative/SKILL.md` — Skill 운영 가이드
- `skills/autoresearch-qualitative/ARCHITECTURE.md` — 모듈 및 데이터 흐름 계약
- `skills/autoresearch-qualitative/src/` — config, safety, adapter, ledger, judge, loop, report 모듈
- `skills/autoresearch-qualitative/templates/` — config, rubric, judge, review 템플릿
- `skills/autoresearch-qualitative/tests/` — unit, integration, fixture E2E 테스트

## Codex에 설치하기

Codex가 이 Skill을 사용할 프로젝트 루트에서 아래 명령을 실행하세요.

```bash
curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash
```

기본 동작:

- `.codex/skills/autoresearch-qualitative`에 Skill 설치
- `autoresearch-skill.config.yaml`이 없으면 starter config 복사

그 다음 프로젝트의 `AGENTS.md` 같은 지침 파일에 아래 내용을 추가하세요.

```md
Use `.codex/skills/autoresearch-qualitative/SKILL.md` for qualitative autoresearch loops.
Require explicit config at `autoresearch-skill.config.yaml` before mutating code.
```

## 설치 옵션

```bash
# 다른 위치에 설치하기, 예: OpenCode 스타일 skills 디렉터리
AUTORESEARCH_TO_ALL_TARGET_DIR=.opencode/skills/autoresearch-qualitative \
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash

# starter config 복사를 건너뛰기
AUTORESEARCH_TO_ALL_INSTALL_CONFIG=0 \
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash
```

설치된 프로젝트 상태를 나중에 점검하려면 doctor 모드를 실행하세요.

```bash
curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash -s -- --doctor
```

## Codex goal handoff

이 Skill은 Codex `/goal`을 한 iteration을 이어가기 위한 보조 수단으로만 취급합니다. durable source of truth는 harness가 소유하는 config, candidate artifact, ledger, report입니다.

관련 템플릿:

- `templates/codex-goal-handoff.md` — Codex iteration에 넘기는 handoff 프롬프트
- `templates/candidate-contract.json` — worker agent가 작성해야 하는 candidate artifact schema
- `templates/fragments/evidence-contract.md` — 정성 판단에 필요한 evidence 규칙
- `templates/fragments/codex-goal-boundary.md` — Codex `/goal`과 harness 상태의 경계

권장 흐름:

1. Harness가 mission, rubric, ledger 경로를 준비합니다.
2. Codex는 `/goal`을 사용해 한 candidate-producing iteration만 이어갑니다.
3. Codex는 candidate contract에 맞춰 `candidate.json`을 작성합니다.
4. Harness가 평가, judge, keep/revert 결정을 수행합니다.

## 사용 흐름

1. Skill을 설치합니다.
2. `autoresearch-skill.config.yaml`을 프로젝트에 맞게 수정합니다.
3. Codex에게 `.codex/skills/autoresearch-qualitative/SKILL.md`를 기준으로 정성적 autoresearch 루프를 수행하라고 지시합니다.
4. Skill은 설정을 검증하고, 안전 preflight를 통과한 뒤, 제한된 반복 실험을 수행합니다.
5. 각 실험은 증거, judge verdict, score vector, keep/revert 결정, rationale을 ledger에 기록합니다.
6. 마지막에는 markdown/json 리포트를 생성합니다.

## 검증

저장소를 clone한 뒤 아래 명령으로 검증할 수 있습니다.

```bash
cd skills/autoresearch-qualitative
npx tsc --noEmit
node --test tests/*.test.ts
cd ../..
bash skills/autoresearch-qualitative/tests/verify-templates.sh
```

## `/goal`과의 차이

OpenAI Codex CLI나 Claude Code의 `/goal`은 공개 문서상 세션 안에서 목표를 지속 추적하는 기능에 가깝습니다. 이 Skill은 그 위에 얹을 수 있는 **실험/평가 하네스**입니다.

핵심 차이:

- `/goal`: 하나의 목표를 계속 수행하도록 돕는 session continuation primitive
- `autoresearch-qualitative`: 여러 실험을 반복 실행하고, 증거를 수집하고, judge가 평가하고, keep/revert와 학습 요약을 남기는 empirical harness

즉 `/goal`을 대체하기보다, 개별 실험 실행에는 `/goal` 같은 continuation 기능을 쓰고 전체 연구 루프는 이 Skill이 관리하는 식으로 함께 사용할 수 있습니다.

## 라이선스

MIT. 자세한 내용은 `LICENSE`를 참고하세요.
