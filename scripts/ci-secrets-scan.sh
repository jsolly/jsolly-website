#!/usr/bin/env bash
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; open a fresh shell and rerun repository setup." >&2; exit 1; }
set -eo pipefail

tmp=$(mktemp -d)
curl --fail --location --silent --show-error \
  https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_linux_x64.tar.gz \
  --output "$tmp/gitleaks.tar.gz"
echo "fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e  $tmp/gitleaks.tar.gz" | sha256sum --check
tar -xzf "$tmp/gitleaks.tar.gz" -C "$tmp"
sudo install -m 755 "$tmp/gitleaks" /usr/local/bin/gitleaks
if [[ "$GITHUB_REF" != refs/heads/main ]]; then
  range="refs/remotes/origin/main..HEAD" # a PR, or a dispatch elsewhere: all it adds to main
else
  # Main: all since the nearest commit in this history with a green main push run, so a leak
  # keeps main red until it is dealt with. The run listing can lag, so read main's newest 100
  # push runs up to three times, until a read shows this run attempt (a dispatch is not a
  # push run, so its first successful read stands). Anchor on the last successful read
  # either way: each green run it lists scanned its own history, and this run's earlier
  # attempt is left out. Three failed reads fail the step; no green in history scans all.
  runs=""
  read_ok=""
  fresh=""
  for attempt in 1 2 3; do
    [[ "$attempt" == 1 ]] || sleep "$((attempt - 1))"
    if ! listed="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100" --jq '.workflow_runs[] |
      "\(.id) \(.run_attempt) \(if .head_branch == "main" and .event == "push" and .conclusion == "success" then .head_sha else "-" end)"')"; then
      echo "::warning::reading main's push runs failed (read $attempt of 3)"
      continue
    fi
    runs="$listed"
    read_ok=1
    if [[ "$GITHUB_EVENT_NAME" != push ]] || grep -q "^$GITHUB_RUN_ID $GITHUB_RUN_ATTEMPT " <<<"$runs"; then
      fresh=1
      break
    fi
  done
  if [[ -z "$read_ok" ]]; then
    echo "::error::reading main's push runs failed three times"
    exit 1
  fi
  if [[ -z "$fresh" ]]; then
    echo "::warning::no read of main's push runs showed this run attempt, so the anchor may be older than it needs to be"
  fi
  declare -A green_runs=()
  while read -r id _ sha; do
    [[ "$id" == "$GITHUB_RUN_ID" || -z "$sha" || "$sha" == - ]] || green_runs[$sha]=1
  done <<<"$runs"
  green=""
  while read -r sha; do
    if [[ -n "${green_runs[$sha]:-}" ]]; then
      green="$sha"
      break
    fi
  done < <(git rev-list --topo-order HEAD)
  if [[ -z "$green" ]]; then
    echo "::warning::none of main's newest 100 push runs is green in this history; scanning all of it"
  fi
  range="${green:+$green..}HEAD"
fi
echo "Scanning $range"
# --text reads what .gitattributes or a NUL byte would show as binary. remerge shows what a
# two-parent merge alone introduces; a merge with more parents shows nothing. In --log-opts,
# --no-color and --no-textconv override git config that colors the log (gitleaks then parses
# none of it and passes) or rewrites a patch through a textconv driver. Without gitleaks' own
# --no-color, --verbose also prints the text on either side of a redacted match.
merges="$(git rev-list --min-parents=3 "$range")"
if [[ -n "$merges" ]]; then
  echo "::error::$range holds a merge with three or more parents, which the scan cannot read"
  exit 1
fi
/usr/local/bin/gitleaks git --no-banner --no-color --redact --verbose --log-opts="--text --diff-merges=remerge --no-color --no-textconv $range"
