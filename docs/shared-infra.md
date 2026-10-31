# shared-infra fields

This site has no Lambda in shared-infra. Two GitHub Actions checks report to
shared-infra's `/shared-infra/scheduled-checks` log group (us-east-1), one JSON
object per log event, through the shared writer
`scripts/scheduled-check-report.mjs`. The shape follows jsolly/shared-infra's
scheduled-checks contract. Browser error reports go to the site's own log group
instead ([client errors](client-errors.md)).

| Check | Reporter | Runs that report | Stream |
| --- | --- | --- | --- |
| `a11y` | `scripts/accessibility-report.mjs` ([accessibility](accessibility.md)) | push to `main`, daily, dispatch | `jsolly-website/a11y/<run id>-<attempt>` |
| `production-smoke` | `scripts/production-smoke-report.mjs` | daily (`47 10 * * *`) and dispatch on `main` | `jsolly-website/production-smoke/<run id>-<attempt>` |

Every event carries:

| Field | Value |
| --- | --- |
| `level` | `error` (alarmed) or `info` |
| `event` | one of the events below |
| `repo` | `jsolly-website` |
| `check` | `a11y` or `production-smoke` |
| `run_url` | `https://github.com/jsolly/jsolly-website/actions/runs/<run id>/attempts/<attempt>` |
| `sha` | the workflow's commit (`GITHUB_SHA`); for `a11y`, the audited commit |

`production-smoke` events also carry `release_sha`, the production release the
run verified, when the run resolved one.

| `event` | `level` | Further fields |
| --- | --- | --- |
| `heartbeat` | `info` | `outcome` (`pass` or `fail`); for `a11y`, `violations` (total, including omitted) |
| `a11y-violation` | `error` | `page` (route), `width` (1280 or 390), `rule` (axe rule id), `impact`, `help` |
| `violations-truncated` | `error` | `omitted` (violation lines beyond the first 50) |
| `check-failed` | `error` | `message`, from the fixed set in the check's reporter |

Each completed run writes exactly one `heartbeat`, last. String values are one
line of at most 500 characters and never contain page markup or raw error text;
the run's `accessibility-results-<attempt>` or `production-smoke-<request id>`
artifact holds the full report.

To read a run's events, open its stream in that log group, or query the group in
CloudWatch Logs Insights with `fields @timestamp, event, page, width, rule, message
| filter repo = "jsolly-website" and check = "a11y" | sort @timestamp desc`
(or `check = "production-smoke"`).

## Coverage

What emails John, and what does not:

- A failed check run whose report job reaches CloudWatch writes `check-failed`
  (or violation) lines; `shared-infra-scheduled-check-errors` emails within
  minutes.
- If the report job itself fails (role assumption, OIDC trust drift, a
  CloudWatch error), nothing is written. The run's own failure is the only
  immediate signal (`gh run list --repo jsolly/jsolly-website --workflow
  production-smoke.yml`, or `a11y.yml`), and the check's missing-heartbeat alarm
  emails about 30 hours after the last heartbeat. Production smoke's report job
  is `continue-on-error`, so a reporting failure leaves the run green: a
  dispatched release check follows the smoke job alone.
- Production smoke's post-deployment runs (`deployment_status`) never report,
  because their token subject follows the deployment's ref. The release process
  waits on them; a failure from a deploy no release process follows shows only as
  a red run until the next daily run, which pages if the breakage persists.
- Each heartbeat alarm alerts only once it is deployed in jsolly/shared-infra. It
  reads ALARM from its deploy until the first heartbeat, so dispatch the check
  once on `main` right after that deploy.
- Any reporting run resets its check's 30-hour window, so a manual dispatch can
  hide a stopped schedule for up to one window.
