#!/usr/bin/env bash
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; open a fresh shell and rerun repository setup." >&2; exit 1; }
# CI preparation only. This never reports a whole-gate pass.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
# shellcheck source=/dev/null
source "$ROOT/gate/gate-lib.sh"
run_step "bash floor" gate_check_bash_floor
gate_require_node
node gate/ci-gate.mjs prepare
