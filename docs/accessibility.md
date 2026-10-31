# Accessibility checks

Run `npm run build`, then `npm run check:a11y`. Install the pinned browser once
with `npx playwright install chromium`.

The axe-core audit scans every built HTML page at desktop and mobile widths.
It waits for Astro islands to hydrate and runs every default axe rule, including
best practices. Violations fail the command. The ignored
`accessibility-results.json` records the expected page-viewport count, the error
that stopped the audit (or `null`), and each completed page-viewport's
violations and findings that need manual review, with node selectors and
explanations. To inspect selected routes, run `npm run check:a11y -- / /path/`.

This is a local audit tool. It blocks external HTTP requests to avoid live API
calls and analytics. Embedded third-party content, authenticated states, open
menus/dialogs, dark mode, keyboard behavior, and canvas rendering need separate
review. Passing axe does not certify accessibility. Rebuild after source changes.

## Where it runs

- **PR CI** (`CI / built (1)`) runs `npm run check:a11y:sample`: one route per
  page template, plus each variant a template renders differently (original,
  `source-` and retired recipes; active and retired categories; two kinds of
  post), from `SAMPLE` in `scripts/accessibility-pages.mjs`, at both widths.
  Violations fail required `ci`. The `accessibility-results` artifact keeps the
  report. `scripts/built/accessibility-sample.test.mjs` fails when a sampled route
  is no longer a built page, a `src/pages` template has no sampled route, or a
  recipe or category variant drops out; add or rename the entry in `SAMPLE` in
  the same change.
- **The Accessibility workflow** (`.github/workflows/a11y.yml`) builds `main`
  and runs the full `npm run check:a11y` after pushes to `main`, daily at
  04:17 UTC, and on manual dispatch from `main`. It does not block merges.
  Pages outside the sample, including new or edited posts and recipes and the
  vendored notebook renders under `public/notebooks/`, are first audited after
  merge, when they are already in production. One run audits at a time; GitHub
  keeps at most one pending run and replaces it with a newer one, so after a
  burst of pushes the newest commit is audited, not every push.

## Alerting

Alerting depends on jsolly/shared-infra's scheduled-checks change (log group,
role, metric filters and alarms) being deployed. Until then the `report` job
fails because the role does not exist, and a failing audit is visible only as a
red Actions run. Once it is deployed, dispatch the workflow on `main` once so the
first heartbeat arrives.

The workflow's `report` job assumes
`arn:aws:iam::730335616323:role/github-actions-scheduled-checks` through GitHub
OIDC (us-east-1) and runs `scripts/accessibility-report.mjs`. That script writes
JSON lines to the `/shared-infra/scheduled-checks` log group, in stream
`jsolly-website/a11y/<run id>-<attempt>`. [shared-infra fields](shared-infra.md)
lists each event's fields:

- one `heartbeat` per completed run, pass or fail, with the violation count;
- one `a11y-violation` error line per failing page, width and rule, at most 50,
  then one `violations-truncated` line with the omitted count;
- `check-failed`, followed by the heartbeat, when the run has no complete,
  readable results: setup or the build failed, the audit stopped or was
  incomplete, the results file is unreadable, the results never reached the
  report job after a successful audit (artifact handoff), or the audit job
  ended unsuccessfully after a clean audit.

The report job downloads the results by the artifact ID the audit job publishes,
so re-running only a failed report job still reads the original audit.

Lines carry the rule, impact and help text, never page markup. `check-failed`
messages come from a fixed set in the script; the audit's own error text stays in
the run's artifact, because GitHub's secret masking does not apply to these lines
and they are quoted into alert email. Every string is one line of well-formed
text of at most 500 characters, without control or format characters.
`scripts/workflow-contracts.test.mjs` keeps `id-token: write` to this workflow's
`report` job, on push, schedule and dispatch runs of `main`. shared-infra owns
the log group, role, metric filters and alarms. Error lines raise
`shared-infra-scheduled-check-errors`; about 30 hours without a heartbeat raises
`shared-infra-scheduled-check-heartbeat-jsolly-website-a11y`. Both notify through
shared-infra's alert topic and email enricher. The run fails whenever it reports
an error line, and when the AWS role cannot be assumed or CloudWatch rejects an
event.

To test the alert path end to end, run the workflow from `main` with
**synthetic_violation** checked. It reports one `synthetic-alert-test` violation
alongside the real audit, and the run fails as a real violation would.
The artifact `accessibility-results-<attempt>` keeps each run's full report.
