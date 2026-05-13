#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${AUTORESEARCH_TO_ALL_REPO_URL:-https://github.com/leetae9yu/autoresearch-to-all.git}"
REF="${AUTORESEARCH_TO_ALL_REF:-main}"
SKILL_NAME="autoresearch-qualitative"
TARGET_DIR="${AUTORESEARCH_TO_ALL_TARGET_DIR:-.codex/skills/${SKILL_NAME}}"
CONFIG_TARGET="${AUTORESEARCH_TO_ALL_CONFIG_TARGET:-autoresearch-skill.config.yaml}"
INSTALL_CONFIG="${AUTORESEARCH_TO_ALL_INSTALL_CONFIG:-1}"

usage() {
  cat <<'USAGE'
Install autoresearch-qualitative for Codex-style projects.

Usage:
  curl -fsSL https://raw.githubusercontent.com/leetae9yu/autoresearch-to-all/main/install.sh | bash

Environment overrides:
  AUTORESEARCH_TO_ALL_TARGET_DIR      Install path. Default: .codex/skills/autoresearch-qualitative
  AUTORESEARCH_TO_ALL_CONFIG_TARGET   Config copy path. Default: autoresearch-skill.config.yaml
  AUTORESEARCH_TO_ALL_INSTALL_CONFIG  Copy default config when absent. Default: 1
  AUTORESEARCH_TO_ALL_REF             Git ref to install. Default: main
  AUTORESEARCH_TO_ALL_REPO_URL        Git repo URL override.

Examples:
  AUTORESEARCH_TO_ALL_TARGET_DIR=.opencode/skills/autoresearch-qualitative bash install.sh
  AUTORESEARCH_TO_ALL_INSTALL_CONFIG=0 bash install.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

need_command git
need_command mktemp

case "$TARGET_DIR" in
  ""|"/"|"."|"..")
    printf 'error: unsafe target directory: %s\n' "$TARGET_DIR" >&2
    exit 1
    ;;
esac

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
       npx tsc --noEmit
       node --test tests/*.test.ts

Suggested AGENTS.md snippet:

  Use $TARGET_DIR/SKILL.md for qualitative autoresearch loops.
  Require explicit config at $CONFIG_TARGET before mutating code.

EOF
