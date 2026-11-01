# Repository security checks

`gate/security-scan.py` owns scanner invocation for pre-commit, Cursor and
CI. The hook installer includes that runner in its verified snapshot, and neither
hook executes an unreviewed branch's scanner script. The existing full
pre-commit gate remains.

Pre-push is the one exception: the dispatcher (`gate/hooks/pre-commit`) runs
gitleaks itself, because the push check must stay within a few seconds. It
uses the CI log options, so a change to them in `security-scan.py` or
`gate/ci-secrets-scan.sh` must also change the dispatcher.

## Coverage

- Pre-commit retains staged gitleaks scanning and the full gate, and adds
  zizmor workflow checks and cfn-lint for every `config/aws/*/template.json`
  (the migration backup and client-error stacks).
- Pre-push runs gitleaks only over the commits each pushed ref sends that the
  destination lacks, judged by the named remote's tracking refs and the ref's
  current remote commit; that takes well under a second. A new ref pushed to a
  bare URL scans the commit's whole history (about ten seconds). A commit made
  with hooks bypassed is still checked. It reads the objects the push sends, ignoring
  local replace refs, and refuses a ref that names something other than a
  commit. Semgrep `p/default`, OSV and full-history gitleaks run in
  `Security / security`.
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

Semgrep metrics and version checking are disabled. Rules are fetched from
`p/default`; that service-managed rule set can change independently of the
pinned CLI. Scanner findings and fatal errors fail the check. Semgrep's own
partial-parser warnings remain visible and are not a claim of complete syntax
coverage. The scanner does not support every Svelte/Astro construct. Generated
dependencies, exported notebooks and inert recipe evidence are outside the
Semgrep source scan. The root `.semgrepignore` lists exactly those paths: it
replaces Semgrep's built-in ignore list, which would otherwise skip `tests/` and
`build/`. Inline `nosemgrep` comments identify reviewed individual
audit false positives and explain the trusted data or fixture boundary.

Zizmor keeps two precise exceptions for the opt-in Preview workflow's
`issue_comment` and `pull_request_target` triggers. Its existing author/repository
checks and trusted-main-only upload procedure remain in
[development](development.md). PR code is uploaded as inert source, never run
with the Vercel credential. Only the deploy job has PR-comment write permission.

The Preview resolver publishes a validated 40-character hexadecimal
`commit_sha`, which both checkout and deployment consume. Deployment also
compares the local checkout and live PR head with that SHA. Branch references
are rejected. The explicit output name avoids CodeQL's overlapping mutable-ref
and SHA heuristics for fields named `head_sha`; no CodeQL query is suppressed.
See the [checkout query implementation](https://github.com/github/codeql/blob/main/actions/ql/lib/codeql/actions/security/UntrustedCheckoutQuery.qll).

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
scanner services and nonzero scanner exits block the relevant operation.
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

The Python test suite exercises the outgoing-commit range and every pushed ref,
untracked-file coverage, malformed input, failed-scanner denial and unreviewed
scanner rejection. A protocol test does not prove a native Cursor hook fired;
that needs a separate actual Cursor session. Passing source checks does not
prove a security app is installed or a check is required by GitHub rulesets.

## Existing dependency findings

The initial OSV run found vulnerable lockfile dependencies. Compatible patched
versions are updated where available. Findings without compatible published
fixes require a specific reviewed disposition. John approved deepmerge, zod and
sandbox on 28 October 2026 and glob and minimatch on 31 October 2026, after
independent review:

| Package | Advisory | Disposition |
| --- | --- | --- |
| deepmerge 4.3.1 | GHSA-gcqx-w48m-w2h4 | Accept prototype-poisoning risk through 27 November 2026. Used by the Svelte Vite plugin to merge build configuration. |
| zod 3.22.4 | GHSA-mrhx-c7xc-m3w5 | Accept resource-exhaustion risk through 27 November 2026. Four nested Vercel CLI consumers still require the Zod 3 API. |
| sandbox 4.4.0 | GHSA-fm4j-4xhm-xpwx; GHSA-gc25-3vc5-2jf9 | Not applicable: the advisories describe gf3/sandbox before 1.0.0; the locked package is Vercel's Sandbox CLI. |
| glob 13.0.6 | GHSA-3g3m-2fjr-6pw4 | Accept AbortSignal cancellation-bypass risk through 30 November 2026. Reached only through the Vercel CLI's `@vercel/nft`, whose latest release still requires glob `^13`; the fix is glob 14.0.2 or later. |
| minimatch 10.2.6 | GHSA-g3hv-75wg-m249 | Accept pattern denial-of-service risk through 30 November 2026. Reached only through Vercel CLI consumers: glob 13 declares `^10.2.2`, `@vercel/python-analysis` pins 10.1.1 and `@ts-morph/common` declares `^3.0.4`; the existing `minimatch: >=10.2.3` override holds all three at 10.2.6. The fix is minimatch 11.0.1 or later, a major release that removes `makeRe`, the `AST` class and regular-expression set items. |

These are not fixes. Build/development usage reduces public-visitor exposure
but does not establish that every repository or tool input is safe. Latest
deepmerge and Vercel releases had no compatible fix at review time; downgrading
deepmerge or forcing Zod 4 into declared Zod 3 consumers is not a verified repair,
and neither is forcing glob 14 into `@vercel/nft` or minimatch 11 into glob 13
without proving the Vercel CLI still works on it.
The site's direct Zod dependency is patched at 4.6.7.

The trusted scanner owns these dispositions. OSV runs with an empty external
config and all findings enabled; branch-supplied ignore files cannot hide them.
Every advisory stays visible in output. Exceptions require the exact package
version, registry URL, integrity, complete set of lockfile locations and a
fingerprint of callers resolving that package. Changes block until reviewed.
Each risk acceptance expires after the date in its row, in America/New_York:
deepmerge and zod block from 28 November, glob and minimatch from 1 December. Patched dependencies need no exception.
John owns the acceptance; replace it with upstream patches when available.

Evidence: [deepmerge report](https://github.com/TehShrike/deepmerge/issues/273),
[Zod advisory](https://osv.dev/GHSA-mrhx-c7xc-m3w5),
[Vercel sandbox metadata](https://registry.npmjs.org/sandbox/4.4.0) and
[old gf3 sandbox metadata](https://registry.npmjs.org/sandbox/0.8.2).
Controlled local tests reproduced deepmerge's returned-object prototype change
and Zod 3's per-invalid-entry issue accumulation, without exhausting memory.
