#!/usr/bin/env bash
# Lock the safety and metadata contract of .github/workflows/vercel-preview.yml.
# CLI --archive=tgz deploys omit .git, so the build must receive the PR head SHA.
# Copy from templates/github/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/vercel-preview.yml"

fail() {
	echo "✗ $*" >&2
	exit 1
}

[[ -f "$WORKFLOW" ]] || fail "missing $WORKFLOW"

require() {
	local needle="$1"
	local label="$2"
	if ! grep -F -- "$needle" "$WORKFLOW" >/dev/null; then
		fail "Vercel Preview workflow must ${label}: ${needle}"
	fi
}

require '--build-env "VERCEL_GIT_COMMIT_SHA=${HEAD_SHA}"' 'pass the PR SHA as a Vite build env'
require '--meta "githubDeployment=1"' 'mark the CLI deploy as a GitHub deployment'
require '--meta "githubCommitSha=${HEAD_SHA}"' 'attach the PR SHA as GitHub commit metadata'
require 'jq -r '"'"'.head.sha'"'"'' 'resolve the Preview SHA from the PR head, not github.sha'
require 'ref: ${{ needs.resolve.outputs.head_sha }}' 'check out the resolved PR head SHA'
require 'printf '"'"'%s'"'"' "$COMMENT_BODY" | bash scripts/vercel-preview-comment.sh' 'pipe comments through the exact /preview matcher'
require 'github.event.comment.author_association == '"'"'OWNER'"'"'' 'restrict comment deploys to owner/member/collaborator'
require 'head_repo" != "$REPO"' 'refuse fork PR heads'
require 'persist-credentials: false' 'do not persist the Actions token on checkout'
require 'cd "$RUNNER_TEMP" && env -u GH_TOKEN NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache" npx --yes vercel@59.20.0 deploy --yes --archive=tgz --cwd "$GITHUB_WORKSPACE"' 'run the pinned GeoRoids CLI from outside the PR tree (npm reads no PR .npmrc or node_modules/vercel while VERCEL_TOKEN is set) with the tgz archive that omits .git'
require 'cancel-in-progress: false' 'not cancel an in-flight /preview when a later comment lands'
require "github.event.pull_request.head.repo.full_name == github.repository" 'run label deploys only for same-repo PR heads'
require "contains(github.event.pull_request.labels.*.name, 'preview')" 'gate push redeploys on the preview label'
require "(github.event.action != 'labeled' || github.event.label.name == 'preview')" 'ignore unrelated labels on a preview PR'
require "git ls-files --cached --others -- ':(glob)**/vercel.ts' ':(glob)**/vercel.mts'" 'refuse a Vercel config at any depth that the CLI would execute with VERCEL_TOKEN'
require "if: \${{ needs.resolve.outputs.skip == 'false' }}" 'deploy only after the resolve job accepts the event'
require 'package-manager-cache: false' 'not restore a PR-written npm cache into the token-holding job'
require 'if [[ "$EVENT_NAME" == "pull_request" && "$current_sha" != "$HEAD_SHA" ]]; then' 'on the label path, stand down for a newer head instead of deploying an old one'
if grep -E '^env:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set env per job, so the resolve job never holds VERCEL_TOKEN'
fi
if grep -E '^concurrency:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set concurrency on the deploy job, not the workflow, so non-deploy runs never displace a pending deploy'
fi

echo "✓ vercel-preview workflow contract holds"
