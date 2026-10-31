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

Failures email through shared-infra's shared error alarm. Each check's missing
heartbeat emails through its own alarm in jsolly/shared-infra, which alerts only
once that alarm is deployed.
