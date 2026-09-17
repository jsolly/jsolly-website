#!/usr/bin/env bash
# Lock SHA injection on .github/workflows/vercel-preview.yml. CLI --archive=tgz
# deploys omit .git, so gen-release-id.mjs and middleware must receive the PR
# head SHA via this app's existing env names (no GeoRoids-specific vars).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/vercel-preview.yml"
VERCEL_JSON="$ROOT/vercel.json"

fail() {
	echo "✗ $*" >&2
	exit 1
}

[[ -f "$WORKFLOW" ]] || fail "missing $WORKFLOW"
[[ -f "$VERCEL_JSON" ]] || fail "missing $VERCEL_JSON"

require() {
	local needle="$1"
	local label="$2"
	if ! grep -F -- "$needle" "$WORKFLOW" >/dev/null; then
		fail "Vercel Preview workflow must ${label}: ${needle}"
	fi
}

require 'scripts/vercel-preview-comment.sh' 'run the comment matcher'
require 'ref: ${{ steps.pr.outputs.head_sha }}' 'check out the PR head SHA'
require 'not deploying forks' 'refuse fork pull requests'
require '--archive=tgz' 'upload a tarball because CLI deploys omit .git'
require '--build-env "VERCEL_GIT_COMMIT_SHA=${HEAD_SHA}"' 'pass the PR SHA as a build env'
require '--build-env "GITHUB_SHA=${HEAD_SHA}"' 'pass the PR SHA as the gen-release-id fallback'
require '--env "VERCEL_GIT_COMMIT_SHA=${HEAD_SHA}"' 'pass the PR SHA as middleware runtime env'
require '--env "GITHUB_SHA=${HEAD_SHA}"' 'pass the PR SHA as the middleware fallback env'
require '--meta "githubDeployment=1"' 'mark the CLI deploy as a GitHub deployment'
require '--meta "githubCommitSha=${HEAD_SHA}"' 'attach the PR SHA as GitHub commit metadata'
require 'VERCEL_PROJECT_ID: prj_9irfTPLYZwwuC7YK0oB3bkc1QXtW' 'target project jsolly-website'
require '--scope jsollys-projects' 'deploy into team jsollys-projects'

node --input-type=module -e '
import { readFileSync } from "node:fs";
const vercel = JSON.parse(readFileSync(process.argv[1], "utf8"));
const enabled = vercel.git?.deploymentEnabled;
if (enabled?.main !== true) {
	console.error("✗ vercel.json must keep Git deploys enabled on main");
	process.exit(1);
}
if (enabled?.["*"] !== false || enabled?.["**"] !== false) {
	console.error("✗ vercel.json must disable Git deploys for non-main branches");
	process.exit(1);
}
' "$VERCEL_JSON"

echo "✓ vercel-preview workflow injects the PR commit SHA"
