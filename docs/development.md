# Development and release

This repository owns its gate, setup, CI and deployment scripts. A separate
configuration repository, private package or global skill installation is not
required. Templates used during migration are examples, not an enforced upstream.

Prerequisites: Git, Bash >= 5 and Python >= 3.11. Install mise on non-Linux hosts;
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
