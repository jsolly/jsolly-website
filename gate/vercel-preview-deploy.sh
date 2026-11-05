#!/usr/bin/env bash
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; open a fresh shell and rerun repository setup." >&2; exit 1; }
set -euo pipefail

# A labeled PR keeps one Preview comment, edited in place, so it does
# not gain one per push. A one-shot request gets a new comment, which
# notifies the requester.
marker='<!-- vercel-preview -->'
upsert_comment() {
  local body="$1"$'\n\n'"$marker" id
  id="$(
    gh api --paginate "repos/${REPO}/issues/${PR_NUMBER}/comments" \
      --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"${marker}\"))) | .id" \
      | tail -n 1
  )"
  if [[ -n "$id" && "$LABELED" == "true" ]]; then
    gh api --method PATCH "repos/${REPO}/issues/comments/${id}" -f body="$body" >/dev/null
  else
    gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$body"
  fi
}

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  upsert_comment "Preview deploy skipped: GitHub secret \`VERCEL_TOKEN\` is not set. Create a Vercel token with deploy access and add it as that secret, then comment \`/preview\` or push to a \`preview\`-labeled PR."
  exit 1
fi

# Every trigger stands down if the PR moved while this run waited.
# A labeled PR gets a newer run; a one-shot request can be repeated.
# The label path also deploys only while the PR remains labeled.
pr_json="$(gh api "repos/${REPO}/pulls/${PR_NUMBER}")"
current_sha="$(printf '%s\n' "$pr_json" | jq -r '.head.sha')"
if [[ "$(printf '%s\n' "$pr_json" | jq -r '.state')" != "open" || "$current_sha" != "$HEAD_SHA" ]]; then
  echo "PR head moved from ${HEAD_SHA} to ${current_sha}; the newer run deploys it."
  exit 0
fi
if [[ "$EVENT_NAME" == "pull_request_target" ]] &&
  [[ "$(printf '%s\n' "$pr_json" | jq -r 'any(.labels[]; (.name | ascii_downcase) == "preview")')" != "true" ]]; then
  echo "The preview label was removed; not deploying."
  exit 0
fi

local_sha="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
if [[ "$local_sha" != "$HEAD_SHA" ]]; then
  echo "Checked-out SHA ${local_sha} != PR head ${HEAD_SHA}" >&2
  exit 1
fi

# The CLI compiles and runs a vercel.{ts,mts,js,mjs,cjs} config, at the
# root or in the project's server-side Root Directory, in a child
# process that inherits VERCEL_TOKEN, so PR code would hold the token;
# on the label path that happens on every push with no human step.
# Fleet repos configure through vercel.json only, so refuse any
# config at any depth, tracked or not.
configs="$(
  git -C "$SOURCE_DIR" ls-files --cached --others -- ':(glob)**/vercel.ts' ':(glob)**/vercel.mts' \
    ':(glob)**/vercel.js' ':(glob)**/vercel.mjs' ':(glob)**/vercel.cjs' \
    | tr '\n' ' '
)"
if [[ -n "$configs" ]]; then
  upsert_comment "Preview deploy refused: the Vercel CLI would execute \`${configs% }\` with \`VERCEL_TOKEN\` in its environment. Configure the project through \`vercel.json\` instead."
  exit 1
fi

# --archive=tgz does not upload .git. Inject the PR SHA: Git-integration
# system vars are often empty on CLI deploys.
# npx runs from $RUNNER_TEMP, outside the PR tree, so npm reads no PR
# .npmrc and finds no PR node_modules/vercel while VERCEL_TOKEN is in
# its environment; --cwd points the CLI back at the checkout. The CLI
# needs no GitHub token, so GH_TOKEN is dropped from its environment,
# and it gets a fresh npm cache that no earlier run could have seeded.
preview_url="$(
  cd "$RUNNER_TEMP" && unset GH_TOKEN && export NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache" &&
    npx --yes vercel@59.20.0 deploy --yes --archive=tgz --cwd "$SOURCE_DIR" \
    --scope jsollys-projects \
    --build-env "VERCEL_GIT_COMMIT_SHA=${HEAD_SHA}" \
    --meta "githubDeployment=1" \
    --meta "githubCommitSha=${HEAD_SHA}" \
    --meta "githubCommitRef=${HEAD_REF}" \
    --meta "githubCommitOrg=${REPO%%/*}" \
    --meta "githubCommitRepo=${REPO#*/}" \
    --meta "githubOrg=${REPO%%/*}" \
    --meta "githubRepo=${REPO#*/}" \
    --meta "githubPrId=${PR_NUMBER}" \
    | tee /dev/stderr \
    | grep -E '^https://' \
    | tail -n 1
)"
if [[ ! "$preview_url" =~ ^https:// ]]; then
  echo "Vercel CLI did not print a Preview URL; last line was: ${preview_url:-empty}" >&2
  exit 1
fi
# Keep one protected URL per project/PR. A completed older build
# must not replace the alias or comment after the PR head moves.
pr_json="$(gh api "repos/${REPO}/pulls/${PR_NUMBER}")"
if [[ "$(printf '%s\n' "$pr_json" | jq -r '.state')" != "open" ]] ||
  [[ "$(printf '%s\n' "$pr_json" | jq -r '.head.sha')" != "$HEAD_SHA" ]]; then
  echo "PR closed or moved during the build; leaving its Preview URL unchanged."
  exit 0
fi
if [[ "$EVENT_NAME" == "pull_request_target" ]] &&
  [[ "$(printf '%s\n' "$pr_json" | jq -r 'any(.labels[]; (.name | ascii_downcase) == "preview")')" != "true" ]]; then
  echo "The preview label was removed during the build; leaving its URL unchanged."
  exit 0
fi
if [[ ! "$VERCEL_PROJECT_ID" =~ ^prj_[A-Za-z0-9]+$ ]]; then
  echo "Invalid Vercel project ID; refusing to assign a Preview alias." >&2
  exit 1
fi
preview_alias="pr-${PR_NUMBER}-${VERCEL_PROJECT_ID#prj_}.vercel.app"
preview_alias="${preview_alias,,}"
(
  cd "$RUNNER_TEMP" && unset GH_TOKEN &&
    NPM_CONFIG_CACHE="$RUNNER_TEMP/npm-cache" npx --yes vercel@59.20.0 alias set "$preview_url" "$preview_alias" --scope jsollys-projects
)
deployment_url="$preview_url"
preview_url="https://${preview_alias}"
{
  echo "url<<PREVIEW_URL_EOF"
  printf '%s\n' "$preview_url"
  echo "PREVIEW_URL_EOF"
} >>"$GITHUB_OUTPUT"

if [[ "$LABELED" == "true" ]]; then
  note="Redeploys on every push while this PR has the \`preview\` label. Remove the label to stop."
else
  note="This is a one-shot deploy. New commits do not rebuild until you comment \`/preview\` again, or add the \`preview\` label to redeploy on every push."
fi
upsert_comment "$(
  printf '%s\n\n%s\n' \
    "Preview for \`${HEAD_REF}\` (\`${HEAD_SHA}\`): ${preview_url} (build: ${deployment_url})" \
    "$note"
)"
