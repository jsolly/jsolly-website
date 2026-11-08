#!/usr/bin/env bash
# Lock the safety and metadata contract of .github/workflows/vercel-preview.yml.
# CLI --archive=tgz deploys omit .git, so the build must receive the PR head SHA.
# Copy from templates/github/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/vercel-preview.yml"
RESOLVER="$ROOT/gate/vercel-preview-resolve.sh"
DEPLOY="$ROOT/gate/vercel-preview-deploy.sh"

fail() {
	echo "✗ $*" >&2
	exit 1
}

[[ -f "$WORKFLOW" ]] || fail "missing $WORKFLOW"

require() {
	local needle="$1"
	local label="$2"
	local source="${3:-$WORKFLOW}"
	if ! grep -F -- "$needle" "$source" >/dev/null; then
		fail "Vercel Preview workflow must ${label}: ${needle}"
	fi
}

require 'run: bash "$GITHUB_WORKSPACE/tooling/gate/vercel-preview-resolve.sh"' 'execute the resolver from the trusted default-branch checkout'
require 'run: bash "$GITHUB_WORKSPACE/tooling/gate/vercel-preview-deploy.sh"' 'execute deployment tooling from the trusted checkout outside PR sources'
require '  pull_request_target:' 'load automatic workflow code from main'
require '    branches: [main]' 'restrict automatic requests to main'
require "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)" 'restrict manual dispatch to the default branch'
require '      DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}' 'verify current PR base'
require 'base_ref" != "$DEFAULT_BRANCH"' 'reject PRs retargeted away from main' "$RESOLVER"
require '"$EVENT_NAME" == "pull_request_target" && "$labeled" != "true"' 'recheck label inside the deploy slot' "$RESOLVER"
require '--build-env "VERCEL_GIT_COMMIT_SHA=${HEAD_SHA}"' 'pass the PR SHA as a Vite build env' "$DEPLOY"
require '--meta "githubDeployment=1"' 'mark the CLI deploy as a GitHub deployment' "$DEPLOY"
require '--meta "githubCommitSha=${HEAD_SHA}"' 'attach the PR SHA as GitHub commit metadata' "$DEPLOY"
require 'jq -r '"'"'.head.sha'"'"'' 'resolve the Preview SHA from the PR head, not github.sha' "$RESOLVER"
require 'ref: ${{ steps.pr.outputs.commit_sha }}' 'check out the resolved PR head SHA'
require 'echo "commit_sha=${head_sha}"' 'publish the validated immutable commit output' "$RESOLVER"
require 'printf '"'"'%s'"'"' "$COMMENT_BODY" | bash gate/vercel-preview-comment.sh' 'pipe comments through the exact /preview matcher'
require 'github.event.comment.author_association == '"'"'OWNER'"'"'' 'restrict comment deploys to owner/member/collaborator'
require 'head_repo" != "$REPO"' 'refuse fork PR heads' "$RESOLVER"
require 'persist-credentials: false' 'do not persist the Actions token on checkout'
require 'cd "$RUNNER_TEMP" && unset GH_TOKEN && export NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache" &&' 'run the CLI from outside the PR tree without GH_TOKEN and with a fresh npm cache' "$DEPLOY"
require 'npx --yes vercel@59.20.0 deploy --yes --archive=tgz --cwd "$SOURCE_DIR"' 'upload only PR sources with the pinned CLI from outside the PR tree' "$DEPLOY"
require 'SOURCE_DIR: ${{ github.workspace }}/source' 'keep the PR source directory separate from trusted workflow tooling'
require 'working-directory: ${{ runner.temp }}' 'start the credential-bearing deploy shell outside the PR tree'
require 'node-version-file: tooling/.nvmrc' 'select Node from trusted workflow tooling'
require 'ref: ${{ github.event.repository.default_branch }}' 'load workflow tooling from the default branch'
require 'cancel-in-progress: false' 'not cancel an in-flight /preview when a later comment lands'
require "github.event.pull_request.head.repo.full_name == github.repository" 'run label deploys only for same-repo PR heads'
require "contains(github.event.pull_request.labels.*.name, 'preview')" 'gate push redeploys on the preview label'
require "(github.event.action != 'labeled' || github.event.label.name == 'preview')" 'ignore unrelated labels on a preview PR'
require "git -C \"\$SOURCE_DIR\" ls-files --cached --others -- ':(glob)**/vercel.ts' ':(glob)**/vercel.mts'" 'refuse PR source configs that the CLI would execute with VERCEL_TOKEN' "$DEPLOY"
require "if: \${{ needs.resolve.outputs.skip == 'false' }}" 'deploy only after the resolve job accepts the event'
require 'package-manager-cache: false' 'not restore a PR-written npm cache into the token-holding job'
require '|| "$current_sha" != "$HEAD_SHA" ]]; then' 'stand down for a newer head on every trigger' "$DEPLOY"
require 'npx --yes vercel@59.20.0 alias set "$preview_url" "$preview_alias" --scope jsollys-projects' 'assign a stable repository/branch alias with the pinned isolated CLI' "$DEPLOY"
require 'if [[ "$preview_ref" == main ]]; then' 'keep any branch that reduces to main off the main snapshot alias' "$DEPLOY"
require 'preview_label+="-${HEAD_REF//\//--}"' 'keep plain branch names, writing each / as --' "$DEPLOY"
require '"$HEAD_REF" | shasum -a 256 | cut -c 1-8' 'hash the exact ref whenever its name changed or overflowed' "$DEPLOY"
require '! "-$HEAD_REF" =~ $hash_tail' 'hash a branch that already ends in eight hex digits, so it cannot match another branch' "$DEPLOY"
require "LC_ALL=C tr -cs 'a-z0-9' '-'" 'reduce the branch to characters valid in one DNS label' "$DEPLOY"
require 'preview_alias="${preview_label}.preview.jsolly.com"' 'publish the alias under the wildcard preview certificate' "$DEPLOY"
require '(no stable link: this branch name reduces to' 'say in the comment when a branch gets no stable link' "$DEPLOY"
require '"$preview_line" \' 'post the stable link line in the PR comment' "$DEPLOY"
require 'PR closed or moved during the build; leaving its Preview URL unchanged.' 'recheck the head after building before changing the alias' "$DEPLOY"
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
  preview && /name: Resolve the pull request head$/ { head = NR }
  preview && /name: Check out workflow tooling$/ { tooling = NR }
  preview && /uses: actions\/setup-node@/ { setup = NR }
  preview && /name: Check out PR sources$/ { sources = NR }
  preview && /^          path: tooling$/ { toolingPath = NR }
  preview && /^          path: source$/ { sourcePath = NR }
  END {
    if (!(resolveCheckout && resolveCheckout < resolveRef && resolveRef < resolveCredentials)) exit 1
    if (!(tooling && tooling < toolingPath && toolingPath < head && head < setup && setup < sources && sources < sourcePath)) exit 1
  }
' "$WORKFLOW" || fail 'tokens must be step-scoped and Node setup must precede the isolated PR checkout'
if grep -E '^env:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set env per job, so the resolve job never holds VERCEL_TOKEN'
fi
if grep -E '^concurrency:' "$WORKFLOW" >/dev/null; then
	fail 'Vercel Preview workflow must set concurrency on the deploy job, not the workflow, so non-deploy runs never displace a pending deploy'
fi

echo "✓ vercel-preview workflow contract holds"
