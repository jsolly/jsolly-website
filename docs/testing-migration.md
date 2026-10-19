# Test runner migration

The application uses TypeScript, JavaScript ES modules, Astro and Svelte, with
Python repository utilities and Bash quality checks. Retained notebooks and
rendered notebook HTML are content, not executable test suites.

## Inventory and ownership

| Before | After | Discovery and coverage |
| --- | --- | --- |
| `node:test` and the TAP count wrapper | Vitest 5.0.5 and a JSON count wrapper | The unit, built, CSP and smoke-contract globs remain. Current ledgers are 276, 210, 4 and 20 tests, including the five worker-readiness regressions added by PR #155. |
| Standalone production smoke command | One Vitest production acceptance test | Same readiness, release identity, browser scenario, worker control, deadlines and artifact helper; workflow uses `npm run smoke:production`. |
| Python `unittest.TestCase` and direct script execution | pytest 9.1.1 through uvx | All 21 hook/bootstrap methods and 13 subtest iterations remain, with pytest assertions, temporary-path fixtures and native subtests. `unittest.mock.patch` remains a mocking utility. |
| Playwright Chromium automation | Playwright Chromium automation under Vitest | Browser assertions, routes, GET restrictions and explicit test deadlines stay intact. Playwright was not a separate test runner. |
| Bash workflow contract fixtures | Two counted Vitest workflow tests | `npm run check:actions` preserves actionlint and executes the same shell assertions through Vitest subprocess tests. |

No Jest, Mocha, pytest alternatives or Playwright Test runner dependency was found.
The shell assertion scripts and production acceptance helper remain test helpers;
Vitest owns their orchestration.

The Vitest configuration uses isolated fork processes and sequential tests within
each file. Hooks run in declaration order. Spies restore automatically after each
test. JavaScript assertions continue to use `node:assert/strict`. No existing
coverage threshold or test ledger was reduced. The repository did not have an
instrumented coverage threshold to migrate.

`config/testing/vitest.config.mjs` owns JavaScript discovery.
`scripts/run-tests.mjs` selects the suite, requires a successful Vitest exit and
checks its passing-test count against `config/testing/test-counts.json`. Its
fixture exercises mismatched counts, skipped tests, failed tests, empty discovery,
missing result fields and malformed JSON. `config/testing/pytest.ini` owns Python
discovery, and the full gate calls `npm run test:python`.

Vitest supports the pinned Node 24 runtime and the existing Vite 8 dependencies.
See the [official Vitest prerequisites](https://vitest.dev/guide/migration/) and
[pytest subtests documentation](https://docs.pytest.org/en/stable/how-to/subtests.html).

## Earlier transfer verification

The migration must retain failing checks until they can run with their required
prerequisites. A discovered browser test whose setup fails is not passing coverage.

- Runtime collection found all 205 built tests, matching the unchanged ledger.
  Browser execution was blocked by the missing Chromium download in that source executor.
- `npm run build` passed, including all four CSP tests and the unchanged ledger.
- Astro/Svelte type checks, Knip, Biome, YAML, Actions and Markdown checks passed.
  The staged migration also passed the pinned gitleaks scan.
- pytest passed all 21 tests; the first detailed run also reports all 13 subtests.
- Assertion-call counts match across all 95 migrated JavaScript test files outside
  the rewritten runner contract. All 21 Python test method names match the base.
- Vitest collected all 276 unit tests. The two CLI child-process disappearance
  checks fail in this environment. Running their original `node:test` file from
  the base commit reproduces both failures. The assertions remain unchanged.
- The standard pinned Playwright Chromium download failed with HTTP 403,
  `Domain forbidden`. Those source-executor runs did not establish browser acceptance. No host,
  proxy, executable-path or download restriction was changed to work around it.
- Production acceptance is retained and collected by Vitest. The known live
  `networkidle` timeout was reported before this migration. No claim of production
  acceptance success follows from local configuration or collection.

A complete green local gate is still required before pushing. Exact-head CI and
independent review are also required before merge. No preview or manual production deployment is part of
this migration.

## Reconciled browser validation

The transferred patch was verified against its SHA-256 manifest, then reconciled
with main at `4845f2298ff16e5f3a3617e1c0923ce3f2e457f1`. All five PR #155
worker-readiness tests remain, with the built ledger at 210.

Vitest exports `NODE_ENV=test`, `DEV`, `PROD` and `MODE` to its workers. The
isolated build helper now clears the runner's mode flags and selects production
mode, so its output must still match the gate's production build. The hydration
comparison and all node-reuse assertions remain intact.

The website-update fixture and every hydration navigation context now use the
existing off-origin stand-ins before opening pages with blog images. Its original `node:test` version reproduced certificate failures from
external image requests. Error assertions remain unchanged.

The recipe filter helper retains a real pointer click on the exact load-more
button. If scrolling triggers automatic pagination and detaches that button,
the helper still requires the original card-growth check before continuing.
Other click failures and all final recipe-ID assertions remain unchanged.

The rollback fixture now waits for B hydration/readiness before changing the
served deployment and for confirmed target A before its original update click.
This strengthens transition ordering while retaining all cache, data, offline
and deferred-asset assertions. The earlier intermittent timeout did not yield
a captured state proving its precise cause.

The PR #155 worker-readiness fixtures subscribe to the post-reload summary
request and its expected failure before starting reload. Both original waits
remain awaited with their existing deadlines, and the failure listener matches
that exact new request rather than the old request cancelled by reload.
Their combined promise also has
a rejection observer so an earlier navigation failure cannot leave a second
unhandled rejection.

Use the supported cloud subreaper for process-cleanup checks. In this executor,
all 276 unit tests and all 20 browser smoke contracts passed without changes to
their assertions. The recipe-browse and website-update focused run passed all
19 tests. A complete green gate remains required before publication.
