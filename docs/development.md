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

CI runs preparation, two built shards and the required aggregate `ci` on
Ubuntu 24.04 ARM runners. Built test files use four isolated fork workers per shard; pure unit tests use two workers to leave CPU for
types and build. Cases within a built file remain sequential. Measure the
whole workflow as well as each job and the local gate when comparing scheduling changes.

CI restores Node compilation caches and Vitest's file-duration metadata for the
same OS, architecture, Node major and dependency lock. Executable bytecode needs
a trusted producer: restoration and saving run only on `main` or same-repository
PRs authored by the repository owner. Other runs execute the complete gate with
fresh local caches. Node recompiles stale or corrupt entries; those checks do not
authenticate executable cache data.
Vitest uses previous durations only to order files, running every test again.
Each successful run saves a new cache snapshot. Cold runs still run the full gate.

setup-node caches `~/.npm` under a key hashed from `.nvmrc` and
`package-lock.json`; every workflow that caches npm lists both files, so they
share one entry. Protected main reuse skips `npm ci` in preparation, so that job
skips the npm cache too. Its post step would otherwise save an empty `~/.npm`
first, and every later job would restore that empty entry as a hit and never
replace it.

Build and built-test commands use separate directories below `NODE_COMPILE_CACHE`.
Private validation trees keep their caches in their own scratch directories.
The gate collects functional test results and counts, not V8 coverage profiles.
Disable compilation caching when separately collecting V8 coverage, as Node
documents reduced profiling precision for cached functions.

The full gate runs build → CSP → built tests in the original checkout. Its
`dist/`, `.recipe-browse/` and generated route manifest remain available to local
preview and deployment consumers. Static checks, types, unit/Python fixtures and
smoke contracts each run in a private validation tree while that build chain runs.
Each copy has independent Git metadata, the effective staged index, working-source
bytes and mutable dependency caches. The scheduler rejects changes to HEAD, the
index or nonignored source files during validation. All commands and counted suites
must pass; failures retain diagnostics under the printed `jsolly-gate-*` directory.
In CI, `JSOLLY_INSTALL_BROWSER=1` runs the same headless-shell and full OS
installation command alongside static checks, pure unit tests, types and build.
Smoke contracts and built browser tests wait for installation to succeed; built
tests also wait for the complete build and CSP suite. Installation failures fail
the gate. The real Chromium process-cleanup regression belongs to the built suite;
the unit suite retains detached-process and shutdown-race coverage. Local gates use the browser already provisioned by repository setup.
The preview shortcut and gate bootstrap remain unchanged. `gate/gate-lib.sh` is
unchanged. No previous passing result is accepted as current test evidence.

Static link and Markdown checks read HTML through parse5 instead of allocating
browser-like DOM windows. They preserve document recovery, base URLs, inert
templates, noscript descendants, namespaces and decoded attribute values. XML
feeds still use an XML parser. Browser scenarios retain Chromium.

CI enables `TEST_FILE_TIMINGS=1` for the complete gate. Each Vitest file emits
one `TIMING` JSON row with its suite, relative path, state and `wall_ms`.
The interval starts when the worker queues the file for collection and ends
after its tests and `afterAll` hooks. It includes imports and hooks, excludes
worker startup and environment preparation, and is not summed testcase time.
`collect_ms` and `tests_hooks_ms` expose Vitest's corresponding diagnostics.
Parallel file durations overlap; do not add them to estimate the gate duration.
The `test-file-timings-prepare` and per-shard timing artifacts retain JSONL rows;
preparation also records the checkout SHA/tree,
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

## Hosted preparation and built shards

Local `npm run gate` still runs every check and the entire counted built suite.
Hosted CI runs four jobs: preparation, two built-test shards, and the required
`ci` check. Preparation uses the same isolated scheduler for static checks,
types, units, Python fixtures, smoke contracts and build/CSP. Its shell enforces
the same Bash and Node checks. Chromium readiness still gates smoke contracts,
and the source/index fingerprint must stay unchanged.

Preparation records Vitest's complete built-file discovery and the source ledger.
It transfers only generated `dist/`, `.recipe-browse/` and the route manifest in
a compressed JSON bundle with source SHA/tree, run/attempt and file digests. Each
shard verifies that identity and every byte before restoring generated files into
its separate checkout. Symlinks, path escapes and source/dependency overlays fail.
Each job owns its dependencies, browser fixtures and mutable caches.

Shard runners provision their separate dependencies and the same Chromium/OS
support while preparation runs. A bounded read-only API waiter requires the unique
successful preparation job from this run/attempt, using the event head SHA (which
can differ from the PR merge checkout). Each runner then verifies preparation's
single authoritative full/reuse result against its checkout SHA/tree/run/attempt.
The existing artifact verifier remains the build-output boundary. A failed,
cancelled, skipped, ambiguous or stale preparation never starts tests. Protected
main reuse skips validation steps inside successful jobs that verified that result.

Both built shards retain four fork workers and every existing scenario/deadline.
The CI-only Vitest sequencer assigns all discovered files to the least-loaded
shard by measured file cost, then starts expensive files first. Cost hints in
`config/testing/built-file-costs.json` come from the initial four-job hosted run;
they affect scheduling only. New files receive a default cost and remain included.
The manifest and source ledger still determine complete coverage. Local full-gate
ordering remains Vitest's normal duration ordering.
The final `ci` job executes even when dependencies fail or cancel. It requires
successful preparation and both shards, matching identities, disjoint file sets
whose union exactly equals discovery, and actual passing assertions matching the
single built-suite ledger. Skipped, todo, missing, extra and duplicate evidence
fail. Only this successful aggregate publishes the protected `ci-tree-v1-ci`
proof. Deferrals retain `ci-deferred`; main reuse requires the existing protected
identical-tree proof and explicitly names reused validation. No ruleset changes.

Measure the complete workflow through all jobs, not the aggregate's short runtime.
Report initial and restored-cache full runs separately, including runner wait.
Use **Re-run all jobs** for the whole workflow. Preparation-only or built-only
retries cannot produce a complete current-attempt result because every handoff
is attempt-bound.
Compilation/order cache keys are separate for preparation and each built shard;
the existing main/owner-only producer trust rule applies to every cache.

## Hook trust

The dispatcher lives in this clone's Git common directory, shared only by its
linked worktrees. It registers pre-commit and pre-push. The complete hook/library/setup/scanner
bundle must match current reviewed `origin/main`, or a deliberately approved exact
bundle digest. Missing files, symlinks, unreviewed modes and a foreign origin fail
closed. For pre-commit and Cursor the dispatcher executes a verified snapshot, then
runs quality scripts in the committing checkout. Pre-push runs gitleaks from the
installed snapshot's own dispatcher and library without re-verifying it on each
push; it never runs the branch's files. Re-run reviewed setup after changing tool
setup on main.

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

Repository setup installs public tools and trusted hooks only. Vercel owns app
deployment. The [retained migration backup stack](migration-backups.md) has its
own human-reviewed CloudFormation apply; Vercel never applies that infrastructure.
Agents do not apply that stack or broaden its grants. The
[client-error stack](client-errors.md) is applied the same way; it holds the one
runtime workload trust, Vercel production OIDC into a role that can only write
one CloudWatch log stream. There is no local AWS credential-isolation wrapper.
Separately authorized agent AWS reads use one native production `aws_mcp`
connection for `agent@jsolly.com`, AgentMcp, account `730335616323`. Keep AWS Core
knowledge tools, named human profiles, Vercel/PagesCMS credentials and retained
CloudFront/S3 media. Do not export OAuth credentials, add a second AWS MCP or use
a local AWS credential bridge.

USDA maintenance is human-operated through the [protected stdin procedure](recipes.md#usda-api-lookups).
Its scripts no longer resolve agent credentials or retrieve secret values.
Agents use public USDA records or human-supplied public caches. Source cleanup
does not retire installed helpers, cached sessions, saved cloud settings or live
IAM trust. Native acceptance and dependency closure own those later steps.

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

Vercel builds pin generated JavaScript entrypoints, inter-chunk imports,
stylesheets and CSS font/image references to their deployment with `?dpl=`.
The repository's static-only Astro integration supplies the native client asset
pin and Vite resource URLs. The existing HTML postprocessor pins the static
stylesheet links Astro currently omits, preserving inline script bytes and
hydration comments. The ordinary static builder, root routing middleware, browse
function and local `dist/` output retain their existing ownership.

Hosted builds fail when Skew Protection or the deployment ID is missing. Local
and ordinary CI builds remain unpinned. The recipe worker builder recognizes only
the current build's generated deployment pin; its digest-bound snapshots keep
pathname keys and include pinned transitive modules and CSS font resources.
Other query URLs remain outside that snapshot contract. A mixed deployment ID
in generated assets fails the worker build.

On October 26, 2026 the live website project had Skew Protection enabled with
Maximum Age = 12 hours and no cross-site allowed domains. That window starts at
deployment creation, not when a tab opens. Do not claim availability after that
window or retroactive protection for a client that loaded an older unpinned
release. Full document navigation and `release.json` remain current, so explicit
updates still reach the latest release. Mutable public media and arbitrary
application fetches are outside the generated-asset pinning contract. Recipe
clients additionally retain their verified downloaded snapshots.

Local browser fixtures build two different pinned releases. They exercise an
old document's previously unloaded JavaScript and stylesheet after replacement,
with a missing/different unpinned negative control, and real offline recipe
installation, save and reopening. These fixtures prove compiler/client/worker
behavior; production acceptance separately requires a cold same-origin old
module request returning original bytes while a newer deployment is current.
Record its age, exact hashes and a distinguishable B/unpinned control. A passing
build, deployment metadata or two identical asset bodies cannot establish that
provider result.

After a pinned production release, run `node scripts/asset-retention-probe.mjs capture`
with a new absolute JSON evidence path as its second argument. The command uses
GET requests on the fixed production origin and refuses an existing output file.
It records actual About-page module and stylesheet URLs, SHA-256 hashes, sizes,
release identity and deployment pin. Keep this evidence outside the repository.
Record deployment creation time separately from Vercel; capture time does not
start or extend the project's 12-hour protection window.

After another meaningful, reviewed release becomes current, run the same command
with `verify` and the original evidence path. It requires a different current
release, exact retained bytes, stable release identity during verification and a
missing or byte-distinct unpinned module control. The JSON result records the
control's actual status and hash when present. This is HTTP availability evidence.
Complete acceptance with a fresh same-origin browser, service workers and browser
cache disabled, importing the recorded old component after the replacement.
Verify the module loaded over the network, returned the recorded bytes, and
produced no import or console error. Do not count HTTP verification alone as
browser execution, or two identical asset bodies as cross-deployment routing.

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

### Preview workflow trust

Automatic `preview` label events use `pull_request_target` for main-targeted,
same-repo PRs. The workflow definition and helper scripts come from main.
Manual dispatch is accepted only from main. The first job validates the request
without deployment credentials; the serialized deploy job resolves the current
eligible head after acquiring its slot. Closed, forked, retargeted or unlabeled
PRs are refused. Rechecks before upload and alias publication suppress stale
builds. Node setup and trusted tooling precede the isolated PR source checkout;
PR code is uploaded as data and never executed locally with deployment tokens.

GitHub's public-repository event policy may block `pull_request_target`.
[Review the applicable policy and insights](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target#default-policy-for-pull_request_target)
before relying on automatic label events. The documented default is evaluated
now and conditionally enforced December 2, 2026. The repository's Active policy
[Allow opt-in website Preview workflow](https://github.com/jsolly/jsolly-website/settings/actions/rules/8924)
was saved and reloaded on October 26, 2026. It targets only
`.github/workflows/vercel-preview.yml` and allows its existing `pull_request_target`,
`issue_comment` and `workflow_dispatch` events. Other workflows remain outside
this exception. Recheck that policy after changing this workflow's name or
triggers. Manual main-branch dispatch and `/preview` remain explicit
one-shot paths. Source tests do not prove a live Preview lifecycle.
