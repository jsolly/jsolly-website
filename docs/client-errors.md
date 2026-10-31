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
pathname. At most three distinct categories per page load are sent, with no
retry. The receiver accepts a category only from that vocabulary and a page
only from the build's route manifest, so error messages, stacks, query strings,
user input, IP addresses and identifiers never reach CloudWatch. Never widen this
boundary to carry an `Error`, its message or anything a visitor typed.

## Receiver behavior

`api/client-error.mjs` validates the report, then writes one structured line:

```json
{"level":"error","message":"Client error reported on /recipes/","context":{"category":"recipe-update","page":"/recipes/"},"error":{"name":"recipe-update","message":"A recipe app update failed."}}
```

shared-infra's enricher reads `message` and `error` into the email's `error:`
line and finds the log group from the alarm's metric filter. If the write fails,
or CloudWatch accepts the call but drops the event, the function answers `502`
and logs `client-error-forward-failed` with the validated report and only the
error's name, code and HTTP status. AWS calls are bounded (1 s connect, 2 s
request, two attempts) under a 10 s function limit, so a stall becomes a logged
`502` instead of a killed invocation.

## Forwarding liveness

Healthy visits send nothing, so silence cannot show that forwarding broke. The
production smoke (`scripts/production-acceptance.test.mjs`), which runs after
every production deployment and daily, posts the `forwarding-probe` category
and requires `204`. The receiver writes the probe at `level: "info"`, so the
error metric filter and alarm never count it, and the browser reporter cannot
send it. A broken path (Vercel OIDC disabled or switched to the Global issuer,
role trust drift, a deleted stream, an SDK regression) fails that run, and the
failed run notifies through GitHub. Read the Vercel runtime log's
`client-error-forward-failed` line for the cause.

Credentials come from Vercel OIDC (team issuer) through
`@vercel/oidc-aws-credentials-provider`. The project must keep **Secure backend
access with OIDC federation** enabled with the **Team** issuer. The role trusts
only `owner:jsollys-projects:project:jsolly-website:environment:production` and
can only `PutLogEvents` on the one stream. Previews are disabled and cannot
assume it.

## Threshold

The alarm fires at five or more reports in a trailing one-hour window, chosen by
John on 2026-10-31. Browser reports arrive from many visitors, so an isolated
failure should not email. A sustained regression does. The receiver is public
and an `Origin` header can be forged, so anyone can submit valid reports. Each
breach sends one ALARM and one OK email, but a sustained flood can hold the alarm
in ALARM, and a real regression during it sends no new email. The project has no
Vercel firewall rate limit on `/api/client-error/`; adding one bounds that.

## Infrastructure

`config/aws/client-errors/template.json` defines the stack
`jsolly-website-client-errors` in account `730335616323`, region `us-east-1`.
Its stack policy denies replacing or deleting the log group and stream.
`scripts/unit/client-errors-stack.test.mjs` pins the trust, permission, alarm and
names to `src/lib/client-error-sink.mjs`. Vercel releases do not deploy this
stack.

Two prerequisites live in shared-infra and must be applied first:

- `VercelOidcProvider` (`oidc.vercel.com/jsollys-projects`), the account's
  single Vercel issuer.
- Enricher discovery through `DescribeMetricFilters`, so this non-Lambda log group
  enriches.

The production smoke's forwarding probe fails until the stack exists, so the
stack is created from the reviewed PR head before the website PR merges.

## Create the stack

John creates the stack in **AWS CloudShell** with its existing administrator
session, after shared-infra's infra deploy and **before** the website PR merges,
from the PR's exact reviewed head commit. Give him one command at a time and wait
for its result. Supply literal values; do not rely on shell variables from an
earlier command.

1. In Vercel, open project `jsolly-website` → Settings → Security and confirm
   **Secure backend access with OIDC federation** is enabled with the **Team**
   issuer. The role trusts only Team-issuer tokens.
2. Download `config/aws/client-errors/template.json` and `stack-policy.json`
   from the exact reviewed commit on GitHub into CloudShell.
3. Confirm the caller is account `730335616323`, region `us-east-1`, that
   `jsolly-website-client-errors` does not yet exist, and that the
   `oidc.vercel.com/jsollys-projects` provider does.
4. Create a **CREATE** change set with `--capabilities CAPABILITY_NAMED_IAM`,
   tag `Project=jsolly-website` and `InfraDeployCommit=<reviewed SHA>`.
5. Inspect the change set: exactly the five resources in the template, all
   `Add`. Reject anything else.
6. Execute it, wait for `stack-create-complete`, then enable termination
   protection and set the stack policy from `stack-policy.json`.
7. Read back the stack status, termination protection, stack policy and outputs.

The website PR then merges, and its production smoke proves the probe reaches
CloudWatch.

## Verify end to end

After the stack exists, send one deliberate report from a browser on
`https://www.jsolly.com/`:

```js
fetch("/api/client-error/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "client-runtime", page: "/" }) }).then((r) => r.status)
```

Expect `204`, then a line in `/jsolly-website/client-errors`. Five such reports
within an hour must produce an enriched ALARM email whose `log-group:` line is
`/jsolly-website/client-errors`, followed by an OK email an hour later. A `502`
means the write failed; read the Vercel runtime log's error name.
