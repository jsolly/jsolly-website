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
  page template, and per recipe page variant, from `SAMPLE` in
  `scripts/accessibility-pages.mjs`, at both widths. Violations fail required
  `ci`. The `accessibility-results` artifact keeps the report.
  `scripts/built/accessibility-sample.test.mjs` fails when a sampled route is no
  longer a built page or a `src/pages` template has no sampled route; add or
  rename the entry in `SAMPLE` in the same change. The vendored notebook renders
  under `public/notebooks/` are audited only by the full run.
- **The Accessibility workflow** (`.github/workflows/a11y.yml`) builds `main`
  and runs the full `npm run check:a11y` after every push to `main`, daily at
  04:17 UTC, and on manual dispatch from `main`. It does not block merges; a
  regression outside the sample surfaces after merge.

## Alerting

The workflow's `report` job assumes
`arn:aws:iam::730335616323:role/github-actions-scheduled-checks` through GitHub
OIDC (us-east-1) and runs `scripts/accessibility-report.mjs`. That script writes
JSON lines to the `/shared-infra/scheduled-checks` log group, in stream
`jsolly-website/a11y/<run id>-<attempt>`:

- one `heartbeat` per run, pass or fail, with the violation count;
- one `a11y-violation` error line per failing page, width and rule, at most 50,
  then one `violations-truncated` line with the omitted count;
- `check-failed` when setup, the build or the audit failed without complete,
  readable results, followed by the heartbeat.

Lines carry the rule, impact and help text, never page markup. `check-failed`
messages come from a fixed set in the script; the audit's own error text stays in
the run's artifact, because GitHub's secret masking does not apply to these lines
and they are quoted into alert email. Every string is one line of at most 500
characters. `scripts/workflow-contracts.test.mjs` keeps `id-token: write` to this
workflow's `report` job, on push, schedule and dispatch runs of `main`. shared-infra owns
the log group, role, metric filters and alarms. Error lines raise
`shared-infra-scheduled-check-errors`; about 30 hours without a heartbeat raises
`shared-infra-scheduled-check-heartbeat-jsolly-website-a11y`. Both notify through
shared-infra's alert topic and email enricher. The run fails whenever it reports
an error line, and when the AWS role cannot be assumed.

To test the alert path end to end, run the workflow from `main` with
**synthetic_violation** checked. It reports one `synthetic-alert-test` violation
alongside the real audit, and the run fails as a real violation would.
The artifact `accessibility-results-<attempt>` keeps each run's full report.
