#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${AUTORESEARCH_TO_ALL_REPO_URL:-https://github.com/leetae9yu/autoresearch-to-all.git}"
REF="${AUTORESEARCH_TO_ALL_REF:-main}"
SKILL_NAME="autoresearch-qualitative"
TARGET_DIR="${AUTORESEARCH_TO_ALL_TARGET_DIR:-.codex/skills/${SKILL_NAME}}"
CONFIG_TARGET="${AUTORESEARCH_TO_ALL_CONFIG_TARGET:-autoresearch-skill.config.yaml}"
INSTALL_CONFIG="${AUTORESEARCH_TO_ALL_INSTALL_CONFIG:-1}"
MODE="install"

usage() {
  cat <<'USAGE'
Install autoresearch-qualitative for Codex-style projects.

Usage:
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash -s -- --doctor

Environment overrides:
  AUTORESEARCH_TO_ALL_TARGET_DIR      Install path. Default: .codex/skills/autoresearch-qualitative
  AUTORESEARCH_TO_ALL_CONFIG_TARGET   Config copy path. Default: autoresearch-skill.config.yaml
  AUTORESEARCH_TO_ALL_INSTALL_CONFIG  Copy default config when absent. Default: 1
  AUTORESEARCH_TO_ALL_REF             Git ref to install. Default: main
  AUTORESEARCH_TO_ALL_REPO_URL        Git repo URL override.

Examples:
  AUTORESEARCH_TO_ALL_TARGET_DIR=.opencode/skills/autoresearch-qualitative bash install.sh
  AUTORESEARCH_TO_ALL_INSTALL_CONFIG=0 bash install.sh
  bash install.sh --doctor
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --doctor)
      MODE="doctor"
      shift
      ;;
    --no-config)
      INSTALL_CONFIG="0"
      shift
      ;;
    --target-dir)
      TARGET_DIR="${2:-}"
      if [[ -z "$TARGET_DIR" ]]; then
        printf 'error: --target-dir requires a value\n' >&2
        exit 1
      fi
      shift 2
      ;;
    --config-target)
      CONFIG_TARGET="${2:-}"
      if [[ -z "$CONFIG_TARGET" ]]; then
        printf 'error: --config-target requires a value\n' >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

need_command git
need_command mktemp

doctor_check() {
  local label="$1"
  local command="$2"
  if eval "$command" >/dev/null 2>&1; then
    printf 'PASS: %s\n' "$label"
  else
    printf 'FAIL: %s\n' "$label"
    return 1
  fi
}

run_doctor() {
  local failures=0
  printf 'Autoresearch qualitative doctor\n\n'

  doctor_check "git is available" "command -v git" || failures=$((failures + 1))
  doctor_check "target skill exists: $TARGET_DIR/SKILL.md" "test -f '$TARGET_DIR/SKILL.md'" || failures=$((failures + 1))
  doctor_check "starter config exists: $CONFIG_TARGET" "test -f '$CONFIG_TARGET'" || failures=$((failures + 1))

  if command -v codex >/dev/null 2>&1; then
    printf 'PASS: Codex CLI is available\n'
  else
    printf 'WARN: Codex CLI not found in PATH\n'
  fi

  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || printf '0')"
    if [[ "$node_major" -ge 20 ]]; then
      printf 'PASS: Node.js %s is available\n' "$(node -v)"
    else
      printf 'FAIL: Node.js 20+ required, found %s\n' "$(node -v 2>/dev/null || printf 'unknown')"
      failures=$((failures + 1))
    fi
  else
    printf 'WARN: Node.js not found; skip local TypeScript/test verification\n'
  fi

  if [[ -f "$TARGET_DIR/tsconfig.json" ]] && command -v npm >/dev/null 2>&1; then
    if (cd "$TARGET_DIR" && npm exec --yes --package typescript -- tsc --noEmit >/dev/null 2>&1); then
      printf 'PASS: skill typecheck passes\n'
    else
      printf 'WARN: skill typecheck skipped or unavailable; run from the cloned repository for full verification\n'
    fi
  fi

  if [[ -f "$TARGET_DIR/tests/verify-templates.sh" ]]; then
    if TEMPLATES_DIR="$TARGET_DIR/templates" bash "$TARGET_DIR/tests/verify-templates.sh" >/dev/null 2>&1; then
      printf 'PASS: skill templates verify\n'
    else
      printf 'FAIL: skill templates verification failed\n'
      failures=$((failures + 1))
    fi
  fi

  if [[ "$failures" -gt 0 ]]; then
    printf '\nDoctor found %s blocking issue(s).\n' "$failures" >&2
    exit 1
  fi

  printf '\nDoctor completed successfully.\n'
}

case "$TARGET_DIR" in
  ""|"/"|"."|"..")
    printf 'error: unsafe target directory: %s\n' "$TARGET_DIR" >&2
    exit 1
    ;;
esac

if [[ "$MODE" == "doctor" ]]; then
  run_doctor
  exit 0
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

printf 'Installing %s from %s (%s)\n' "$SKILL_NAME" "$REPO_URL" "$REF"

git clone --depth 1 --branch "$REF" "$REPO_URL" "$tmp_dir/repo" >/dev/null 2>&1 || {
  printf 'error: failed to clone %s at ref %s\n' "$REPO_URL" "$REF" >&2
  exit 1
}

source_dir="$tmp_dir/repo/skills/$SKILL_NAME"
if [[ ! -d "$source_dir" ]]; then
  printf 'error: skill directory not found in repository: %s\n' "skills/$SKILL_NAME" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
rm -rf "$TARGET_DIR"
cp -R "$source_dir" "$TARGET_DIR"

if [[ "$INSTALL_CONFIG" != "0" ]]; then
  if [[ -e "$CONFIG_TARGET" ]]; then
    printf 'Config already exists, leaving unchanged: %s\n' "$CONFIG_TARGET"
  else
    cp "$TARGET_DIR/templates/autoresearch-skill.config.yaml" "$CONFIG_TARGET"
    printf 'Copied starter config: %s\n' "$CONFIG_TARGET"
  fi
fi

cat <<EOF

Installed: $TARGET_DIR

Next steps:
  1. Review and edit: $CONFIG_TARGET
  2. Tell Codex to use: $TARGET_DIR/SKILL.md
  3. Optional verification:
       cd $TARGET_DIR
       npm exec --yes --package typescript -- tsc --noEmit
       npm test
       npm run verify:templates
  4. Optional doctor check:
       curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash -s -- --doctor

Suggested AGENTS.md snippet:

  Use $TARGET_DIR/SKILL.md for qualitative autoresearch loops.
  Require explicit config at $CONFIG_TARGET before mutating code.
  Run the pre-run interview from $TARGET_DIR/templates/pre-run-interview.md before starting an experiment loop.
  Treat Codex /goal as iteration-local only; the harness ledger/candidate artifacts are the source of truth.

EOF
