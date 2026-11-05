#!/usr/bin/env bash
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; open a fresh shell and rerun repository setup." >&2; exit 1; }
set -euo pipefail

pr_number="$EVENT_PR"
if [[ ! "$pr_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid pull request number: ${pr_number:-empty}" >&2
  exit 1
fi

pr_json="$(gh api "repos/${REPO}/pulls/${pr_number}")"
state="$(printf '%s\n' "$pr_json" | jq -r '.state')"
head_sha="$(printf '%s\n' "$pr_json" | jq -r '.head.sha')"
head_ref="$(printf '%s\n' "$pr_json" | jq -r '.head.ref')"
base_ref="$(printf '%s\n' "$pr_json" | jq -r '.base.ref')"
head_repo="$(printf '%s\n' "$pr_json" | jq -r '.head.repo.full_name // empty')"
# GitHub's contains() in the job `if:` ignores case; match it.
labeled="$(printf '%s\n' "$pr_json" | jq -r 'any(.labels[]; (.name | ascii_downcase) == "preview")')"

if [[ "$state" != "open" ]]; then
  echo "PR ${pr_number} is ${state}; not deploying." >&2
  exit 1
fi
if [[ "$head_repo" != "$REPO" ]]; then
  echo "PR ${pr_number} head repo ${head_repo} is not ${REPO}; not deploying forks." >&2
  exit 1
fi
if [[ "$base_ref" != "$DEFAULT_BRANCH" ]]; then
  echo "PR base is not the default branch; not deploying." >&2
  exit 1
fi
if [[ "$EVENT_NAME" == "pull_request_target" && "$labeled" != "true" ]]; then
  echo "The preview label was removed; not deploying." >&2
  exit 1
fi
if [[ ! "$head_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "PR head SHA is not a 40-character hex commit: ${head_sha}" >&2
  exit 1
fi
if [[ ! "$head_ref" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "PR head ref is not a safe git branch name: ${head_ref}" >&2
  exit 1
fi

{
  echo "pr_number=${pr_number}"
  echo "commit_sha=${head_sha}"
  echo "head_ref=${head_ref}"
  echo "labeled=${labeled}"
  echo "skip=false"
} >>"$GITHUB_OUTPUT"
