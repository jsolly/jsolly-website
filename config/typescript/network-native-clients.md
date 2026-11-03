# Native browser clients

Built discovery and CI manifests accept both TypeScript and MJS. This repair
retains the listed existing client paths, scheduling identities and native
callers while changing only imports and equivalent guarded launch calls.
Existing assertions, actions, time limits, profiles and offline settings remain
in place. Their test bodies remain unmigrated and are not claimed as
typechecked. This bounded caller migration does not establish a general
JavaScript exception for future implementation changes.

New JavaScript implementation and executable JavaScript fixtures are strict
TypeScript. The separate Python process-supervisor exception is described
below. The detached browser child previously
embedded in the cleanup test is now the physical strict TypeScript fixture
`tests/fixtures/gate-browser-descendant.ts`, executed directly by pinned Node 26.
Its parent still cancels the gate and asserts that the real Chromium process is
gone or a zombie before removing its temporary directory.

The factories are imported directly from `tests/network/browser.ts`. They own the
public Playwright proxy configuration and require the test network scope. The
production smoke runner keeps its live default; local tests inject guarded
browsers through its existing launch parameter.

Retained clients:

- `tests/built/asset-retention.test.mjs`
- `tests/built/blog-browse.test.mjs`
- `tests/built/blog-post.test.mjs`
- `tests/built/blog-search.test.mjs`
- `tests/built/blogthedata-killswitch.test.mjs`
- `tests/built/csp-browser.test.mjs`
- `tests/built/gate-browser-cleanup.test.mjs`
- `tests/built/hydration.test.mjs`
- `tests/built/initial-render.test.mjs`
- `tests/built/keto-shared-table.test.mjs`
- `tests/built/mobile-menu-animation.test.mjs`
- `tests/built/production-smoke.test.mjs`
- `tests/built/recipe-card-images.test.mjs`
- `tests/built/recipe-native-browse.test.mjs`
- `tests/built/recipe-navigation.test.mjs`
- `tests/built/recipe-page.test.mjs`
- `tests/built/recipe-popover-loading.test.mjs`
- `tests/built/recipe-preferences.test.mjs`
- `tests/built/recipe-publication.test.mjs`
- `tests/built/recipe-search.test.mjs`
- `tests/built/recipe-units.test.mjs`
- `tests/built/recipes-browse.test.mjs`
- `tests/built/recipes-deep-links.test.mjs`
- `tests/built/recipes-library.test.mjs`
- `tests/built/recipes-nutrition-pills.test.mjs`
- `tests/built/recipes-preview.test.mjs`
- `tests/built/recipes-pwa-fixture.mjs`
- `tests/built/recipes-visited-offline.test.mjs`
- `tests/built/safari-print.test.mjs`
- `tests/built/site-update.test.mjs`
- `tests/production-smoke-scenario.test.mjs`

The existing `tests/built/accessibility-sample.test.mjs` also retains its current
Vitest discovery path. Its imports now name the defining TypeScript inventory
and constants modules. `monitoring/accessibility-report.mjs` retains the native
no-install reporting-job entry point and changes only its WIDTHS import to the
defining node-builtins-only TypeScript constants module, which Node 26 loads
directly. Neither existing MJS body is claimed to be typechecked.

## Native runner and fixture consumers

The following existing native MJS entry points also retain their filenames:

- `tests/run-tests.mjs` is invoked by package scripts and runner-contract
  fixtures. Its only behavioral edit routes the existing child environment
  through the strict defining network helper.
- `gate/ci-gate.mjs` is named by the held CI workflow and gate contracts. Its
  direct Vitest child environment receives the same helper; commands and
  acceptance assertions remain intact.
- `gate/ci-evidence.mjs` is the node-builtins-only artifact verification protocol
  consumed by CI. Its discovered-path validator now accepts strict TypeScript
  test filenames alongside existing MJS; a contract case verifies that plain
  JavaScript filenames remain rejected.
- `config/testing/vitest.config.mjs` is the native configuration path used by
  Vitest, CI and isolated runner fixtures. It installs typed setup modules and
  discovers the added typed built regression test.
- `tests/unit/fake-aws-cli.mjs`, `tests/unit/usda.test.mjs` and
  `tests/vercel-preview-workflow.test.mjs` retain their fixture/discovery
  contracts. Their fresh child environments receive the defining typed guard
  without adding host credentials or changing original assertions.
- `tests/workflow-contracts.test.mjs` retains its counted workflow discovery
  contract. Its accessibility CLI command expectation names the actual typed
  native entry point.
- `tests/unit/ci-sharding.test.mjs` retains its counted unit discovery contract.
  Its existing artifact-validation case covers the added TypeScript filename
  and continued rejection of a plain JavaScript filename.

These are narrow native protocol edits, not a claim that the retained bodies
are typechecked. New networking, lifecycle and control implementations belong
to their strict TypeScript defining modules.

The existing transport deadline cases in
`tests/unit/verify-blogthedata-transports.test.mjs` also keep their discovery
filename. They import one typed fixture supervisor and route their existing
production-helper invocation through it. On Linux, a test-owned Python process
adopts and reaps orphaned fixture children so container PID 1 behavior cannot
invalidate the unchanged PID-disappearance assertions. The original timeouts,
assertions, fake CLI and cleanup remain intact. The Python fixture is necessary
because Node has no subreaper or waitpid interface; it changes only its own
process adoption flag and has strict standalone typechecking.

The progressive-recovery test is now strict TypeScript under the scoped
`recipe-image-diagnostics.json` project. Its unchanged MJS fixture owners use
real-source inference and are not claimed to be fully typed; see
[the bounded diagnostic scope](recipe-image-diagnostics.md).

The counted smoke entry point `tests/production-smoke-scenario.test.mjs` retains
its native MJS discovery path and calls the strict
`tests/fixtures/smoke-bootstrap.ts` helper. The two short negative cases use the
existing fixture budget for initial navigation and valid root-heading readiness;
their target waits retain the original short default timeout. Other cases retain
their original default-timeout and navigation sequence. The MJS body is not
claimed to be typechecked; its cases, assertions and constants remain unchanged.
