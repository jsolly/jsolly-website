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
require 'cd "$RUNNER_TEMP" && unset GH_TOKEN && export NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache" &&' 'run the CLI from outside the PR tree without GH_TOKEN and with a fresh npm cache'
require 'npx --yes vercel@59.20.0 deploy --yes --archive=tgz --cwd "$SOURCE_DIR"' 'upload only PR sources with the pinned CLI from outside the PR tree'
require 'SOURCE_DIR: ${{ github.workspace }}/source' 'keep the PR source directory separate from trusted workflow tooling'
require 'working-directory: ${{ runner.temp }}' 'start the credential-bearing deploy shell outside the PR tree'
require 'node-version-file: tooling/.nvmrc' 'select Node from trusted workflow tooling'
require 'ref: ${{ github.event.repository.default_branch }}' 'load workflow tooling from the default branch'
require 'cancel-in-progress: false' 'not cancel an in-flight /preview when a later comment lands'
require "github.event.pull_request.head.repo.full_name == github.repository" 'run label deploys only for same-repo PR heads'
require "contains(github.event.pull_request.labels.*.name, 'preview')" 'gate push redeploys on the preview label'
require "(github.event.action != 'labeled' || github.event.label.name == 'preview')" 'ignore unrelated labels on a preview PR'
require "git -C \"\$SOURCE_DIR\" ls-files --cached --others -- ':(glob)**/vercel.ts' ':(glob)**/vercel.mts'" 'refuse PR source configs that the CLI would execute with VERCEL_TOKEN'
require "if: \${{ needs.resolve.outputs.skip == 'false' }}" 'deploy only after the resolve job accepts the event'
require 'package-manager-cache: false' 'not restore a PR-written npm cache into the token-holding job'
require 'if [[ "$current_sha" != "$HEAD_SHA" ]]; then' 'stand down for a newer head on every trigger'
# Tokens may appear only in the named API/deployment steps, never in setup or
# checkout. The template's fixed indentation keeps this guard dependency-free.
awk '
  /^      - / { step = $0 }
  /^[[:space:]]*(VERCEL_TOKEN|GH_TOKEN):/ {
    if ($0 !~ /^          /) exit 1
    if (step !~ /name: (Resolve the pull request head|Deploy the Preview)$/) exit 1
    if ($0 ~ /VERCEL_TOKEN:/ && step !~ /name: Deploy the Preview$/) exit 1
  }
  /^  resolve:$/ { resolve = 1 }
  resolve && /^      - uses: actions\/checkout@/ { resolveCheckout = NR }
  resolve && /^          ref: \$\{\{ github.event.repository.default_branch \}\}$/ { resolveRef = NR }
  resolve && /^          persist-credentials: false$/ { resolveCredentials = NR }
  /^  preview:$/ { resolve = 0; preview = 1 }
  preview && /name: Check out workflow tooling$/ { tooling = NR }
  preview && /uses: actions\/setup-node@/ { setup = NR }
  preview && /name: Check out PR sources$/ { sources = NR }
  preview && /^          path: tooling$/ { toolingPath = NR }
  preview && /^          path: source$/ { sourcePath = NR }
  END {
    if (!(resolveCheckout && resolveCheckout < resolveRef && resolveRef < resolveCredentials)) exit 1
    if (!(tooling && tooling < toolingPath && toolingPath < setup && setup < sources && sources < sourcePath)) exit 1
  }
' "$WORKFLOW" || fail 'tokens must be step-scoped and Node setup must precede the isolated PR checkout'
if grep -E '^env:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set env per job, so the resolve job never holds VERCEL_TOKEN'
fi
if grep -E '^concurrency:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set concurrency on the deploy job, not the workflow, so non-deploy runs never displace a pending deploy'
fi

echo "✓ vercel-preview workflow contract holds"
