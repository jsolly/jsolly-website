# Development and release

This repository owns its gate, setup, CI and deployment scripts. A separate
configuration repository, private package or global skill installation is not
required. Templates used during migration are examples, not an enforced upstream.

Prerequisites: Git, Bash >= 5, Python >= 3.11 and OpenSSL. The built smoke test
uses OpenSSL to generate a temporary localhost certificate for its real HTTPS
service-worker fixture; the certificate is deleted after the test. Install mise
on non-Linux hosts;
fresh Linux setup provisions a pinned, checksum-verified public mise binary in
`/usr/local/bin`, using noninteractive sudo only when needed. The repository's `.mise.toml`
and `.nvmrc` own its tool pins. On a reviewed fresh `origin/main` checkout run:

```bash
bash scripts/setup-agent-environment.sh
```

Setup installs repo-owned hooks outside the working tree, provisions the pinned
tools and lockfile dependencies, and installs pinned Chromium when this repo uses
Playwright. Run the repo's documented quality gate with its pinned tools:

```bash
mise exec -- npm run gate
```

Use the repository's README and AGENTS.md for its build, test and deployment
commands. A missing prerequisite is a failed setup; report it rather than claiming
that the gate ran. No setup command deploys the application or infrastructure.

## Test file timings

CI runs one `ci` job on the standard Ubuntu 24.04 x64 runner. Built test files
use four isolated fork workers; cases within a file remain sequential. Measure the
whole job as well as the gate when comparing runner or scheduling changes.

CI sets `NODE_COMPILE_CACHE` to a fresh runner-temporary directory for the complete
gate and its child processes. Node reuses compiled modules within that run; no
cache crosses runs, and changed sources are compiled again. The gate collects
functional test results and counts, not V8 coverage profiles. Disable this cache
when separately collecting V8 coverage, as Node documents reduced profiling
precision for cached functions.

CI enables `TEST_FILE_TIMINGS=1` for the complete gate. Each Vitest file emits
one `TIMING` JSON row with its suite, relative path, state and `wall_ms`.
The interval starts when the worker queues the file for collection and ends
after its tests and `afterAll` hooks. It includes imports and hooks, excludes
worker startup and environment preparation, and is not summed testcase time.
`collect_ms` and `tests_hooks_ms` expose Vitest's corresponding diagnostics.
Parallel file durations overlap; do not add them to estimate the gate duration.
The `test-file-timings` artifact retains JSONL rows and the checkout SHA/tree,
even when validation fails. Each runner writes its own file, including CSP
runs nested inside built tests. The gate suppresses successful step output,
so the artifact is the durable record.

To collect the same evidence locally from the repository root:

```bash
TEST_FILE_TIMINGS=1 TEST_FILE_TIMINGS_DIR=/tmp/jsolly-test-timings mise exec -- npm run gate
```

The directory accumulates reports across runs; use a fresh directory for each
comparison. Without `TEST_FILE_TIMINGS_DIR`, rows go only to stdout, useful for
direct suite commands. The optional reporter leaves the exact passing-test ledger
and failure checks unchanged. Preserve the artifacts before retiring a probe branch.

The recipe browser suites separate control behavior from content enumeration.
Filter/navigation cases check independently expected totals, the initial batch,
and a later filtered batch at phone and desktop widths. Complete recipe partitions
and pagination stay in the module/API suites; dedicated browser cases retain
scrolling, button pagination and focus/recovery. The filter/navigation suite blocks
service workers; offline/install/update suites exercise real workers separately.

The shared built-test server loads DOM and frontmatter parsers only when a
caller requests those readers. Browser-only files do not initialize unused
DOM windows or blog parser dependencies; the readers and assertions stay intact.

CI installs the pinned Chromium headless shell used by every browser test, plus
its OS dependencies. It omits the unused headed Chromium download.

The CSP suite parses each built page once into immutable facts, retaining its
separate policy, script-byte/order and image checks. Maintenance and CMS fixture
builds each run the same suite against their own output. PWA snapshot rebuild
checks belong to the install suite; every PWA file still builds real isolated
A/B/C snapshots. Each file calls `setupRecipePwaFixture` with the additional
deployment variants its cases use; unused full-site copies are not prepared.
Smoke contract cases run concurrently in one browser process, with Vitest's
five-case limit and a fresh context and private stubs per case. Built cases
remain sequential within each file.
PWA builds reuse immutable asset bytes and digests within one invocation. Each
rebuild reads fresh bytes, and every test file retains its independent A/B/C builds.
The update suite also checks that live API requests leave a stopped worker asleep
and that workers still install and serve offline data without static routing.

## Hook trust

The dispatcher lives in this clone's Git common directory, shared only by its
linked worktrees. It registers pre-commit only. The complete hook/library/setup
bundle must match current reviewed `origin/main`, or a deliberately approved exact
bundle digest. Missing files, symlinks, unreviewed modes and a foreign origin fail
closed. The dispatcher executes a verified snapshot, then runs quality scripts in
the committing checkout. Re-run reviewed setup after changing tool setup on main.

This is hook-registration integrity, not a sandbox. Never check out or execute
third-party/fork PR code in a trusted clone; review its diff through GitHub. Do not
run its npm lifecycle or setup scripts. Use a separate disposable environment when
execution of untrusted code has been explicitly authorized.

After independent semantic/security review of your own gate change, get its exact
digest with `bash scripts/repo-python.sh scripts/repo-hooks.py digest`. Use the installed snapshot's
`approve --root <absolute-repo-root> --digest <reviewed-digest>` command, with actual
values, to approve only those bytes; never approve a fork's bundle. Approvals are
repo-local. Revoke explicit approvals with `git config --local --unset-all
repo.trustedGateBundle`; current reviewed main remains trusted. Changing origin
invalidates the bundle identity. No environment variable selects another library.

The authoritative identity manifest is `config/agents/repository.json`. Current
checkouts refuse a retired root `.repo-independent.json`, including dangling links.
An installed snapshot from before this relocation needs the explicit upgrade flow.
After reviewing the complete candidate hook bundle, run from its repository root:

```bash
digest="$(bash scripts/repo-python.sh scripts/repo-hooks.py digest)" &&
  bash scripts/repo-python.sh scripts/repo-hooks.py approve-upgrade --digest "$digest" &&
  bash scripts/repo-python.sh scripts/repo-hooks.py install &&
  bash scripts/repo-python.sh scripts/repo-hooks.py verify
```

The upgrade reauthorizes the exact old installed snapshot against protected
`origin/main` or an existing repo-local approval, verifies its origin, files, modes,
digest and dispatcher, then approves only the reviewed new digest. It does not
trust an old manifest in the candidate checkout. Once reviewed main has the new
layout, ordinary setup installs it directly, including over a valid old snapshot.
Older checkouts must merge the reviewed migration before rerunning setup.

## Review and integration

Work from fresh main on an isolated branch. Review the actual final diff for bugs,
secrets, security, tests and repository guidelines; use an independent reviewer
for substantial or sensitive changes. Run the required complete local gate before
pushing. Create a same-repository PR; use a draft while approval/work remains.
Merge only when the required CI validates the exact current head. Never push to
the default branch, weaken rulesets, bypass checks or use an admin merge. Optional
personal review skills may help, but they are not prerequisites for this flow.

Preserve existing code-only Deploy, production-main-only Vercel and opt-in Preview
rules. Never trigger a preview merely to validate this migration. Verify the
intended deployment and exact-release smoke when the repository requires them.

## Infrastructure and access

Use existing scoped identities. Agents do not recover credentials, broaden grants
or run destructive infrastructure/database operations. Keep read-only checks on
the read-only role, including the repo-owned credential-isolation wrapper.
`check:infra-pending` reports merged infrastructure inputs not yet deployed; AWS
CloudFormation drift detection separately reports manual live-resource changes.
Infrastructure apply and protection changes remain a concrete handoff to the
human owner, with exact repository commands. A successful code deploy does not
prove infrastructure adoption. Never bypass a dirty-infrastructure deploy refusal.

Repository instructions and access rules are maintained here. Personal home
configuration and optional global skills remain separate and are not installed,
removed or overwritten by repo setup.

## Website updates

Production pages embed the same full build SHA as `/release.json`. That endpoint
has `Cache-Control: no-store`. The shared notice validates the same-origin JSON
response, full SHA and final URL, with an eight-second timeout. Connected visible
tabs check at startup, on foreground/reconnect events (coalesced to one minute),
and at a five-minute interval with jitter. Failures back off up to thirty minutes;
hidden/offline tabs stop their timers and unload removes listeners.

A different SHA offers **Update and reload**. **Later** collapses the actions;
**Show update** reopens them. Dismissal belongs to that release, so a distinct
release announces again. A click rechecks the target; a newer target requires a
second choice. Actual dirty forms or cooking checks require confirmation, and
cancelling preserves the tab. No check automatically reloads a page. A reload
that still receives the old shell leaves a manual retry notice instead of looping.
Development, opt-in Previews and maintenance omit the notice.

Controlled recipe pages use the downloaded-snapshot workflow in
[recipe operations](recipes.md). Vercel cache purges do not invalidate those browser
snapshots. Runtime, fixtures and release tests are owned by this repository.

Ordinary-page old-asset retention remains an unresolved acceptance gap. The
portfolio/blog use hashed Astro assets, but there is no verified guarantee that
an A-only chunk remains reachable through the production alias after B deploys.
Their A/B fixtures test release detection/reload, not changed asset retention.
[Vercel Skew Protection](https://vercel.com/docs/skew-protection) requires both
project support and deployment-pinned requests; deployment retention alone does
not prove this alias behavior. Recipe-controlled clients have the versioned
snapshot routing described above. Do not claim equivalent protection for an
ordinary tab that has not finished loading its assets.

The gate's built browser tests serve distinct releases A, B and C at one origin.
They exercise first installation, explicit multi-tab activation, postponement and
reopening, dirty cooking confirmation, third-release races, invalid metadata,
timeouts, stale reloads, and hidden/offline polling. The recipe suite also uses
the actual previously deployed worker source as an inert fixture, checking old
mutable data and A-only deferred assets after B activation. A previously deployed
shell without this detector still needs one initial close-and-reopen cycle.

Acceptance evidence must distinguish executed browser cases from source review:
first install, two-tab update, delayed/failed install, offline application, old
assets/data, user-work confirmation, accessibility at both viewports/themes,
dismissal/C, metadata failures, request ordering, lifecycle races, retry recovery,
polling cleanup, rollback/scope isolation, and prior-client migration. Authentication
is absent on this public site. Do not infer full coverage from a fresh B visit.

Large workflow shell bodies live in `scripts/ci-secrets-scan.sh`,
`scripts/vercel-preview-resolve.sh` and `scripts/vercel-preview-deploy.sh`.
The pinned ShellCheck checks these files directly, and actionlint retains every
workflow and remaining inline-script check. This avoids the pinned release's
[macOS stdin deadlock](https://github.com/rhysd/actionlint/issues/650).
Preview tooling still executes from the trusted default-branch checkout.

Knip's Vercel dependency exception belongs to the John-only `vercel-curl`
transport in `scripts/verify-blogthedata-cutover.mjs`, which resolves
`node_modules/.bin/vercel` dynamically. Preview deployment uses its own isolated
pinned CLI, and agents never run the cutover verifier's Vercel transport.
