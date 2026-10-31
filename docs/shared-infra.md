# shared-infra fields

This site has no Lambda or application logs in shared-infra. Its only
CloudWatch output is the Accessibility workflow's report
([accessibility](accessibility.md)): `scripts/accessibility-report.mjs` writes one
JSON object per log event to `/shared-infra/scheduled-checks` (us-east-1), in
stream `jsolly-website/a11y/<run id>-<attempt>`. The shape follows
jsolly/shared-infra's scheduled-checks contract.

Every event carries:

| Field | Value |
| --- | --- |
| `level` | `error` (alarmed) or `info` |
| `event` | one of the events below |
| `repo` | `jsolly-website` |
| `check` | `a11y` |
| `run_url` | `https://github.com/jsolly/jsolly-website/actions/runs/<run id>/attempts/<attempt>` |
| `sha` | the audited commit |

| `event` | `level` | Further fields |
| --- | --- | --- |
| `heartbeat` | `info` | `outcome` (`pass` or `fail`), `violations` (total, including omitted) |
| `a11y-violation` | `error` | `page` (route), `width` (1280 or 390), `rule` (axe rule id), `impact`, `help` |
| `violations-truncated` | `error` | `omitted` (violation lines beyond the first 50) |
| `check-failed` | `error` | `message`, from the fixed set in `auditOutcome` |

Each completed run writes exactly one `heartbeat`, last. String values are one
line of at most 500 characters and never contain page markup or raw error text;
the run's `accessibility-results-<attempt>` artifact holds the full report.

To read a run's events, open its stream in that log group, or query the group in
CloudWatch Logs Insights with `fields @timestamp, event, page, width, rule, message
| filter repo = "jsolly-website" and check = "a11y" | sort @timestamp desc`.
