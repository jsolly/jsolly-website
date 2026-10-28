# Repository security checks

`scripts/security-scan.py` owns scanner invocation for Git hooks, Cursor and CI.
The hook installer includes that runner in its verified snapshot. Both installed
Git hook entries use the same trusted dispatcher; neither executes an
unreviewed branch's scanner script. The existing full pre-commit gate remains.

The alternatives were a CI-only check, which would miss the requested local
protection, and separate hook scripts, which would duplicate scanner policy and
escape the existing verified-hook ownership. One shared runner keeps their
behavior consistent.

## Coverage

- Pre-commit retains staged gitleaks scanning and the full gate, and adds
  zizmor workflow checks and cfn-lint for the backup CloudFormation template.
- Pre-push scans each outgoing commit's exact tree with Semgrep `p/default`
  and OSV. It scans outgoing history with gitleaks too. Non-HEAD and multiple
  ref pushes are covered. It reads Git blobs directly so `export-ignore`
  attributes cannot hide source. Delete-only pushes have no source to scan.
- Cursor's `beforeShellExecution` hook scans tracked and unignored working
  files with gitleaks before shell commands. `failClosed: true` blocks crashes,
  timeouts and invalid responses; a scanner finding returns `permission: deny`.
  Git hooks independently check actual commits. This is a development guard,
  not a sandbox against arbitrary shell code, network exfiltration, deliberately
  bypassed hooks, or secrets in ignored runtime files and environment variables.
- `Security / security` scans PRs and main with the same runner, read-only
  repository permission, full-SHA Actions and no AWS credentials. Dependabot
  retains the repository's explicit `ow-ci` maintenance opt-in. John must make
  this check required in the repository ruleset for it to enforce merge
  protection; a failing optional check alone does not prevent merges.

Semgrep metrics and version checking are disabled. Rules are fetched from
`p/default`; that service-managed rule set can change independently of the
pinned CLI. Scanner findings and fatal errors fail the check. Semgrep's own
partial-parser warnings remain visible and are not a claim of complete syntax
coverage. The scanner does not support every Svelte/Astro construct. Generated
dependencies, exported notebooks and inert recipe evidence are outside the
Semgrep source scan. Inline `nosemgrep` comments identify reviewed individual
audit false positives and explain the trusted data or fixture boundary.

Zizmor keeps two precise exceptions for the opt-in Preview workflow's
`issue_comment` and `pull_request_target` triggers. Its existing author/repository
checks and trusted-main-only upload procedure remain in
[development](development.md). PR code is uploaded as inert source, never run
with the Vercel credential. Only the deploy job has PR-comment write permission.

This repository has CloudFormation but no CDK. cfn-lint applies; cdk-nag and
Checkov on `cdk.out` do not. Dependabot covers npm and full-SHA Actions with a
seven-day proposal cooldown. The repository-pinned npm also enforces
`min-release-age=7`; older system npm versions do not, so use the pinned runtime.
Socket installation is a separate human/account task. No GitHub
plan, app installation, ruleset, credential or infrastructure apply is changed.

## Installation and validation

Run the existing reviewed repository setup after this bundle lands. It installs
both verified Git hooks and the mise-pinned tools, including OSV. The pinned
Python scanners are resolved through uvx on use. Missing tools, unavailable
scanner services and nonzero scanner exits block the relevant operation.
Noninteractive Git clients can locate tools through mise without shell shims.

The hook manifest allowlist changed, so an existing pre-push-free snapshot stays
intact until the new bundle is reviewed and installed. For local development,
review the exact bundle digest and follow the exact-digest approval procedure
in [development](development.md). Old installed snapshots are accepted only
for verification/upgrade, never as permission to execute new unreviewed code.

Run the complete security checks directly with:

```bash
python3 scripts/security-scan.py ci
```

The Python test suite exercises exact-ref scanning, export-ignore resistance,
untracked-file coverage, malformed input, failed-scanner denial and unreviewed
scanner rejection. A protocol test does not prove a native Cursor hook fired;
that needs a separate actual Cursor session. Passing source checks does not
prove a security app is installed or a check is required by GitHub rulesets.

## Existing dependency findings

The initial OSV run found vulnerable lockfile dependencies. Compatible patched
versions are updated where available. Findings without compatible published
fixes remain blocking and must be resolved or receive a specific reviewed
disposition before this task can be completed. No vulnerability ignore file,
advisory baseline or blanket suppression is introduced. See the task's current
scan receipt for the remaining package/advisory pairs.
