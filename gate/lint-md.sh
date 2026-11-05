#!/usr/bin/env bash
# Lint markdown with the markdownlint-cli2 version pinned in package.json / package-lock.json.
# Pass --fix to auto-fix violations: bash gate/lint-md.sh --fix
#
# Use only the lockfile-installed binary so local and CI gates run the same version.
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; open a fresh shell and rerun repository setup." >&2; exit 1; }
set -euo pipefail
cd "$(dirname "$0")/.."
bin="node_modules/.bin/markdownlint-cli2"
if [[ ! -x "$bin" ]]; then
  echo "lint-md: $bin not found — run 'npm ci' before linting." >&2
  exit 1
fi
exec "$bin" --config config/quality/.markdownlint-cli2.jsonc "$@" "**/*.md"
