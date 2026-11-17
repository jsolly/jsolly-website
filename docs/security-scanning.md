# Repository security checks

`gate/security-scan.py` owns scanner invocation for pre-commit, Cursor and
CI. The hook installer includes that runner in its verified snapshot, and neither
hook executes an unreviewed branch's scanner script. The existing full
pre-commit gate remains.

Pre-push keeps range gitleaks in the dispatcher (`gate/hooks/pre-commit`).
It uses the CI log options, so a change to them in `security-scan.py` or
`gate/ci-secrets-scan.sh` must also change the dispatcher. Semgrep and OSV run in required CI, without
a local network probe or skip path.

## Coverage

- Pre-commit retains staged gitleaks scanning and the full gate, and adds
  zizmor workflow checks and cfn-lint for every `config/aws/*/template.json`
  (the migration backup and client-error stacks).
- Pre-push runs only gitleaks over each pushed ref's outgoing commits, excluding
  the destination's advertised old commit when available locally. Tracking refs
  cannot exclude history because they may be stale. New refs scan their whole
  history. Removed secrets and non-HEAD refs are still checked. The hook validates
  native push records, ignores local replace refs, refuses non-commit objects and
  octopus merges, and fails when the pinned scanner is unavailable. It executes
  installed snapshot code, with no source-tree copy or scanner-service requests.
  `Security / security` runs required Semgrep and OSV, full-history gitleaks,
  zizmor and cfn-lint. Findings and scanner errors fail that check.
- Cursor's `beforeShellExecution` hook scans tracked and unignored working
  files with gitleaks before shell commands. `failClosed: true` blocks crashes,
  timeouts and invalid responses; a scanner finding returns `permission: deny`.
  Git hooks independently check actual commits. This is a development guard,
  not a sandbox against arbitrary shell code, network exfiltration, deliberately
  bypassed hooks, or secrets in ignored runtime files and environment variables.
- `Security / security` scans PRs and main with the same runner, read-only
  repository permission, full-SHA Actions and no AWS credentials. Dependabot
  PRs run it like every other PR. The repository ruleset requires it, so a
  failing check blocks the merge.

Every gitleaks scan (staged, pre-push, Cursor, the CI range scan and the
full-history scan) reads the gate's own policy: the pinned release's default
rules and no ignore list, held as `GATE_GITLEAKS_POLICY` in `gate/gate-lib.sh`
and `GITLEAKS_POLICY` in `gate/security-scan.py`. Change both together, through
review. Left to its defaults, gitleaks takes its rules from a `.gitleaks.toml`
at the root it scans and always reads a `.gitleaksignore` there, so either file
could switch a finding off. Each scan therefore refuses to run when either file
sits at the root of the index, the pushed commit, the checkout or the directory
it scans from, tracked or not. Inline `gitleaks:allow` comments still mark
reviewed individual false positives.

Semgrep metrics and version checking are disabled. Rules are fetched from
`p/default`; that service-managed rule set can change independently of the
pinned CLI. Scanner findings and fatal errors fail the check. Semgrep's own
partial-parser warnings remain visible and are not a claim of complete syntax
coverage. The scanner does not support every Svelte/Astro construct. Generated
dependencies, exported notebooks and inert recipe evidence are outside the
Semgrep source scan, through the scanner's `--exclude` list. The scanner also
passes `--x-ignore-semgrepignore-files`, so Semgrep's built-in ignore list does
not skip `tests/` and `build/`, and no `.semgrepignore` file changes the scope.
Semgrep marks that flag internal and subject to change, so a Semgrep version bump
must confirm a planted finding under `tests/` is still reported.
Inline `nosemgrep` comments identify reviewed individual
audit false positives and explain the trusted data or fixture boundary.

This repository has CloudFormation but no CDK. cfn-lint applies; cdk-nag and
Checkov on `cdk.out` do not. Dependabot covers npm and full-SHA Actions with a
seven-day proposal cooldown. The repository-pinned npm also enforces
`min-release-age=7`; older system npm versions do not, so use the pinned runtime.
Socket installation is a separate human/account task. No GitHub
plan, app installation, ruleset, credential or infrastructure apply is changed.

## Installation and validation

Run the existing reviewed repository setup after this bundle lands. It installs
both Git hooks from a verified snapshot and the mise-pinned tools, including OSV. The pinned
Python scanners are resolved through uvx on use. Missing tools, unavailable
scanner services and nonzero scanner exits block the relevant operation,
with no scanner-service skips.
Noninteractive Git clients can locate tools through mise without shell shims.

The hook manifest allowlist changed, so an existing pre-push-free snapshot stays
intact until the new bundle is reviewed and installed. For local development,
review the exact bundle digest and follow the exact-digest approval procedure
in [development](development.md). Old installed snapshots are accepted only
for verification/upgrade, never as permission to execute new unreviewed code.
A snapshot installed before the trust files moved from `scripts/` to `gate/`
keeps its pre-push hook until that one-time upgrade, also described in
[development](development.md).

Run the complete security checks directly with:

```bash
python3 gate/security-scan.py ci
```

Vitest installed-hook fixtures exercise outgoing history and every pushed ref.
The Python test suite retains hook trust, Cursor and CI scanner coverage, including
the gate-owned gitleaks policy and the refusal of a repository one,
untracked-file coverage, malformed input, failed-scanner denial and unreviewed
scanner rejection. A protocol test does not prove a native Cursor hook fired;
that needs a separate actual Cursor session. Passing source checks does not
prove a security app is installed or a check is required by GitHub rulesets.

## Dependency findings

Every OSV advisory blocks CI. The scanner supplies an empty external config and
checks all findings, so repository ignore files cannot hide a vulnerability.

The repository does not install the Vercel CLI. Production deploys through
Vercel's Git integration; build, tests and CI do not need the CLI. Removing that
optional development tool removes its vulnerable Zod 3, glob and minimatch
consumers rather than forcing incompatible transitive upgrades. The site's
runtime Zod dependency remains at 4.6.7.

The previous dated risk acceptances and Sandbox package-name exceptions are
retired. Regression tests submit each former advisory and require rejection.
Operational Vercel CLI use, including the human-only cutover transport, requires
a separately maintained CLI outside this project's dependencies. It does not
change the Git-based deployment process.
