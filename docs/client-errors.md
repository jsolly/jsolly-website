# Client error reporting

Browser failures on `www.jsolly.com` page John through shared-infra's alert
pipeline. A visit that has no error sends nothing.

```text
browser reportError(category)
  -> POST /api/client-error/        (Vercel production function)
  -> PutLogEvents                   (Vercel OIDC -> jsolly-website-client-errors role)
  -> /jsolly-website/client-errors  (log stream vercel, 30-day retention)
  -> metric filter { $.level = "error" } -> jsolly-website/ClientErrorLogCount
  -> alarm jsolly-website-client-errors (>= 5 in one hour; ALARM and OK)
  -> shared-infra topic -> enricher -> plaintext email
```

## What leaves the browser

Only a fixed category from `src/lib/error-categories.mjs` and the page's
pathname. At most three attempts per page load are sent, with no retry. Recipe
update failures share one attempt across their registration, download, worker
version, network check, activation and library-update categories. The first
failure keeps its specific category; later failures in that family do not add
reports. Older installed documents can still send the generic `recipe-update`
category. The receiver accepts a category only from that vocabulary, plus the
production smoke's fixed `forwarding-probe` (see Forwarding liveness), and a page
only from the build's route manifest, so error messages, stacks, query strings,
user input, IP addresses and identifiers never reach CloudWatch. Never widen this
boundary to carry an `Error`, its message or anything a visitor typed.

## Receiver behavior

`api/client-error.mjs` validates the report, then writes one structured line. An
error report takes this shape; the forwarding probe writes the `info` line shown
under Forwarding liveness instead, and the sink refuses any other level:

```json
{"level":"error","message":"Client error reported on /recipes/","context":{"category":"recipe-update","page":"/recipes/"},"error":{"name":"recipe-update","message":"A recipe app update failed."}}
```

shared-infra's enricher reads `message` and `error` into the email's `error:`
line and finds the log group from the alarm's metric filter. If the write fails,
or CloudWatch accepts the call but drops the event, the function answers `502`
and logs `client-error-forward-failed` with the validated report and only the
error's name, code and HTTP status. Each AWS request is bounded (1 s connect,
2 s request); the credential exchange may retry once and the write never does,
so one report is never written twice. The whole forward ends after 8 s, inside
the function's 10 s limit, so a stall becomes a logged `502` instead of a
killed invocation.

## Forwarding liveness

Healthy visits send nothing, so silence cannot show that forwarding broke. The
Production smoke workflow therefore posts one `forwarding-probe` report after each
production deployment and daily, from `tests/production-acceptance.test.mjs`,
and fails unless it answers `204`. The receiver writes the probe as an `info`
line (`{"level":"info","message":"Production smoke verified client-error
forwarding.",...}`), so the `{ $.level = "error" }` metric filter and the alarm
never count it, and the browser reporter cannot send it.

A broken path (Vercel OIDC disabled or switched to the Global issuer, role trust
drift, a deleted stream, an SDK regression) therefore fails that run and shows as
`502` responses and `client-error-forward-failed` lines in the Vercel runtime
logs. The release process waits on the post-deployment run. The daily and manual
runs report to shared-infra's scheduled checks: when the report reaches CloudWatch,
a failed run emails John through the shared error alarm, and a daily run that
stops arriving emails him after about 30 hours through the check's heartbeat
alarm. [shared-infra fields → Coverage](shared-infra.md#coverage) lists what that
leaves uncovered.
The probe proves the write path only. It cannot show that the metric filter or
the alarm still work, because it is deliberately never counted.

Credentials come from Vercel OIDC (team issuer) through
`@vercel/oidc-aws-credentials-provider`. The project must keep **Secure backend
access with OIDC federation** enabled with the **Team** issuer. The role trusts
only `owner:jsollys-projects:project:jsolly-website:environment:production` and
can only `PutLogEvents` on the one stream. Preview deployments cannot assume
it.

## Ingestion limits

`config/security/client-error-limits.json` owns the reviewed limits. The endpoint
validates its fixed payload before `client-error-admission.mjs` checks shared
Vercel Firewall counters. No visitor headers or IP addresses leave the receiver
through the SDK. The calls use a fixed first-party host, server-selected keys and
500 ms deadlines. A production Secret named `CLIENT_ERROR_BUCKET_SECRET` supplies
at least 32 characters of server-only entropy. HMAC-SHA256 derives both counter
keys, so the raw Secret never enters SDK request headers. Without it
the receiver answers `503` before any SDK or CloudWatch call. Keep the Secret
out of the browser and repository; no public counter request can predict these
bucket keys from category names or page URLs alone.

- The edge rule matches only production POSTs to `/api/client-error` and
  `/api/client-error/` on `www.jsolly.com`, with 60 requests per minute per IP.
- The SDK `client-error-ingestion` rule caps accepted reports at 120 per minute,
  shared across source IPs and function instances within a region.
- The SDK `client-error-duplicate` rule permits one error for each category/page
  pair per minute. Repeated reports answer `204` without a CloudWatch write.
- The info-level production probe skips duplicate suppression so `204` still
  proves a new write. Probes consume the same ingestion budget as browser errors.

An exhausted ingestion budget answers `429` with `Retry-After: 60`. A missing
rule, blocked SDK call, timeout or provider error answers `503` with the same
retry header. Neither path writes to CloudWatch or emits an application failure log. The SDK
warns when a configured rule is missing, so a missing-rule failure can still
produce Vercel runtime warnings. The configuration checker must pass before
enforcement is declared healthy.
Responses remain `no-store`. The browser reporter never retries automatically.
The two bounded SDK calls add at most one second before the sink's existing
8-second forwarding deadline, within the function's 10-second maximum.

Counters are distributed by Vercel, not kept in function memory. They are
per-region fixed windows, so they are not a strict worldwide billing cap and a
boundary between windows permits a burst. Public reports remain unauthenticated:
Origin validation is not proof that a failure occurred. A sustained attacker can
still consume the budget or submit false errors within it. Use the browser smoke
and server-side diagnostics to investigate an alert.

## Firewall rollout and verification

The code depends on three separately managed firewall rules. Merging a PR does
not activate their enforcement. Set the server-only production Secret before
deploying this receiver; environment changes apply to the next deployment. New SDK rules start in log mode so traffic can
be observed without rejecting legitimate reports. Do not describe that state as
a fixed security issue.

Print the narrowly scoped target rules without changing the live firewall:

```bash
node monitoring/check-client-error-firewall.mjs --print-rules
```

Review traffic in the project's Firewall dashboard. Change only these rules to
return `429` after their limit. The existing per-IP rule keeps its 60/minute
budget. Apply the staged preview and production rollout before declaring the
finding resolved. This needs a human publish step; unrelated firewall rules and
managed protections stay in place.

Export the active configuration for the project and check the captured JSON:

```bash
node monitoring/check-client-error-firewall.mjs /path/to/active-config.json
```

The checker rejects a different project or team, observation-only actions,
disabled or invalid rules, different budgets and changed match conditions.
Additional active mitigations or bypasses require manual review. Matching rule
definitions is not proof of live enforcement. The checker never writes
configuration or handles credentials. A real production probe must still answer
`204` after enforcement is enabled. Do not flood the production receiver to test
limits: run the local API tests for denial and duplicate cases.

## Threshold

The alarm fires at five or more reports in a trailing one-hour window, chosen by
John on 2026-10-31. Ingestion now counts at most one report per category/page per
minute within each region. Five distinct minute windows can still trigger the
alarm during a sustained regression. An isolated failure should not email.
A forged breach can still hold the alarm in ALARM and mask a later transition;
rate limits bound ingestion, not the truth of public telemetry.

## Infrastructure

`config/aws/client-errors/template.json` defines the stack
`jsolly-website-client-errors` in account `730335616323`, region `us-east-1`.
Its stack policy denies replacing or deleting the log group and stream.
`tests/unit/client-errors-stack.test.mjs` pins the trust, permission, alarm and
names to `src/lib/client-error-constants.mjs`. Vercel releases do not deploy this
stack.

Two prerequisites live in shared-infra and must be applied first:

- `VercelOidcProvider` (`oidc.vercel.com/jsollys-projects`), the account's
  single Vercel issuer.
- Enricher discovery through `DescribeMetricFilters`, so this non-Lambda log group
  enriches.

John created the stack on 31 October 2026 from merge SHA `824a5ee`
(`InfraDeployCommit`), with termination protection and the stack policy, and a
report from `https://www.jsolly.com/` answered `204`. If the stack is ever
missing, every report answers `502` and appears in the Vercel runtime logs as
`client-error-forward-failed`.

## Create the stack

John creates the stack in **AWS CloudShell** with its existing administrator
session, after shared-infra's infra deploy and after the website PR merges, from
the exact reviewed merge SHA on `main`. Give him one command at a time and wait
for its result. Supply literal values; do not rely on shell variables from an
earlier command.

1. In Vercel, open project `jsolly-website` → Settings → Security and confirm
   **Secure backend access with OIDC federation** is enabled with the **Team**
   issuer. The role trusts only Team-issuer tokens.
2. Download `config/aws/client-errors/template.json` and `stack-policy.json`
   from the exact reviewed merge SHA on GitHub into CloudShell.
3. Confirm the caller is account `730335616323`, region `us-east-1`, that
   `jsolly-website-client-errors` does not yet exist, and that the
   `oidc.vercel.com/jsollys-projects` provider does.
4. Create a **CREATE** change set with `--capabilities CAPABILITY_NAMED_IAM`,
   tag `Project=jsolly-website` and `InfraDeployCommit=<merge SHA>`.
5. Inspect the change set: exactly the five resources in the template, all
   `Add`. Reject anything else.
6. Execute it, wait for `stack-create-complete`, then enable termination
   protection and set the stack policy from `stack-policy.json`.
7. Read back the stack status, termination protection, stack policy and outputs.

## Verify end to end

After the stack exists, send one deliberate report from a browser on
`https://www.jsolly.com/`:

```js
fetch("/api/client-error/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "client-runtime", page: "/" }) }).then((r) => r.status)
```

Expect `204`, then a line in `/jsolly-website/client-errors`. Five such reports
within an hour must produce an enriched ALARM email whose `log-group:` line is
`/jsolly-website/client-errors`, followed by an OK email an hour later. A `502`
means the write failed; read the Vercel runtime log's error name, code and
status.

The six update-reporting browser fault scenarios are strict TypeScript, checked
by `config/typescript/recipe-update-reporting.json` through `check:ts`. That scoped
project infers the existing `tests/built/pages.mjs` static-server helper from its
source; the unchanged helper and its JavaScript imports are not claimed to be
fully typechecked. New fixture logic and browser interactions remain strictly
checked without casts or ambient module declarations.
