# Platform research: redirect hosting, CSP, service worker, SEO (blogthedata.com into jsolly.com)

Date: 2026-10-04. Read-only research; nothing was deployed, committed or written outside the scratch root.
Machine-readable answers (23 entries with evidence and confidence): `platform-research.json` in this directory.
Reproducible experiments: `platform-experiments/` (compiled Vercel routes, source-pattern compiler test, middleware test).

Method highlights: ran the real `vercel build` offline in a scratch clone of jsolly-website to see Vercel's compiled route order, compiled candidate redirect `source` patterns with `@vercel/routing-utils`, built jsolly-website with Astro 7.3.2 and tested per-page CSP, probed live blogthedata.com and jsolly.com with `curl` (GET/HEAD), and read Vercel and Cloudflare account state with read-only calls.

## Account facts that drive the decision

- Vercel team `jsolly's projects` is on the **Hobby plan** (get_auth_user: billing.plan "hobby"). Bulk Redirects are Pro/Enterprise only, so option C costs money.
- Vercel project `blogthedata` (prj_QxSNy3z51xOp295HUvPfDa1JY9h8) was created 2026-10-02, holds blogthedata.com and www.blogthedata.com (no domain-level redirect configured; apex to www is a vercel.json host rule), deploys from jsolly/awesome-blog main (bf1f7ff1). Project `jsolly-website` (prj_9irfTPLYZwwuC7YK0oB3bkc1QXtW) holds www.jsolly.com and jsolly.com (jsolly.com redirects to www, 308).
- Cloudflare: both zones are Free plan, DNS-only (grey cloud) records, no custom redirect rulesets, no page rules. Nameservers are Cloudflare for both domains. Both zones have a google-site-verification TXT.
- awesome-blog `vercel.json` already uses `trailingSlash: true` (same as jsolly-website), two path redirects, a host rule apex to www, and a no-cache header rule for the recipe service worker. Its CSP is set by Astro (`security.csp`) with `img-src 'self' https: data:`, `connect-src 'self'`, `form-action 'self'` and `frame-src` for YouTube, diagrams.net and nbviewer.

## Findings that change the plan (ranked)

1. **Trailing-slash 308 runs before every vercel.json redirect.** Real compiled routes for jsolly-website: trailing-slash rules are route 3-4, the apex redirect is 5, headers 6, middleware 7. Live proof: `https://www.blogthedata.com/post/how-to-leverage-closed-loops` (no slash) goes 308 to the slash form first, then to the destination. So redirects hosted inside jsolly-website (which must keep trailingSlash true) cannot be one hop for slashless legacy URLs. A project without `trailingSlash` can use one rule `/post/:slug{/}?` per path.
2. **A redirect on the service worker script URL makes the update fail and strands users on the old SW.** Spec: top-level SW script fetch uses redirect mode "error". The live recipe SW is cache-first and precaches the recipe page, so returning users keep the old PWA forever unless a 200 tombstone SW is served at the same URL.
3. **jsolly-website's middleware breaks merged features.** Tested with the real code: extensionless feed URLs with a feed-reader Accept header get 406; any `.md` data file (the recipe SW precaches `/data/recipe-library.md`) gets a 404 markdown response; `Accept: text/markdown` on `/blog/<slug>/` gets 404 markdown.
4. **CSP header and Astro meta policies intersect.** The Vercel header today carries `img-src 'self' data:` and `style-src`, which would block the blog's external https images even if a page's meta allows them. Per-page CSP in Astro static builds works and merges with global directives, but hashes are site-global (verified: a script added to one page added its hash to /about/'s meta) and `insertScriptResource` drops the default `'self'`; `is:inline` scripts are not hashed at all.
5. **Feed GUIDs and Atom ids are the old permalinks.** A new feed that derives them from jsolly.com URLs makes every post look new to readers (RFC 4287 forbids changing atom:id on relocation).
6. **An existing awesome-blog redirect lands on a 404 today** (`/post/how-to-leverage-closed-loops/` to `/post/stop-asking-questions-to-save-time/`).
7. Host-conditioned rules cannot be tested before go-live (host will not match on a generated URL).

## Redirect hosting: option evaluation

Constraints: (a) survives awesome-blog archival, edits need no unarchive; (b) redirect list tested in an active gate; (c) can serve a real file (tombstone SW); (d) per-path 301, one hop, both hosts, both slash forms; (e) blogthedata hosts never fall through to jsolly pages; (f) middleware interaction; (g) minimal moving parts.

| Option | (a) | (b) | (c) | (d) | (e) | (f) | (g) | Verdict |
|---|---|---|---|---|---|---|---|---|
| A. Keep project `blogthedata`, redirect-only deployment from final awesome-blog commit | partial: frozen; edits need unarchive or manual CLI deploy | no (repo archived, no gate) | yes | yes | yes | none | good | Works but fails (a)/(b) |
| **A'. Keep project `blogthedata`, re-point its Git source to jsolly-website Root Directory `legacy/blogthedata`** | yes | yes | yes | yes | yes | none (no middleware.ts in that root) | good: reuses project, domains, DNS | **Recommended** |
| B. Attach blogthedata domains to jsolly-website, host-conditioned rules in its vercel.json | yes | yes | awkward (host-conditioned rewrite from a /legacy file) | **no**: trailingSlash gives 2 hops for slashless URLs; apex may add a hop | needs a host catch-all; one wrong regex can redirect jsolly.com | redirects skip middleware, rest passes through it | domain move, shared CSP/headers/middleware coupling | Fallback |
| C. Vercel Bulk Redirects | yes (runtime edits, no deploy) | partial (file in repo, not unit-testable offline) | **no** (redirect only) | yes (runs before everything; needs host+slash variants per path) | needs another project to serve the SW | n/a | **needs Pro** | Reject on Hobby |
| D. Domain-level redirect | yes | n/a | no (redirects the SW URL) | no (blanket, cannot map /blog/<slug>/) | n/a | n/a | simple | Reject |
| E. Cloudflare redirect rules | yes | no (rules live in Cloudflare; agents may not write it) | origin still needed | yes | needs proxying | n/a | proxy in front of Vercel (not recommended), 10-rule Free limit | Reject |
| F. New redirect-only repo/project | yes | yes (new gate) | yes | yes | yes | none | extra repo to maintain | Same as A' with more overhead |

### Recommended design (A')

- New directory `legacy/blogthedata/` in jsolly-website containing: `vercel.json` (generated from the URL map; no `trailingSlash` key, no `framework`, `git.deploymentEnabled` main only), `robots.txt` (allow all, no Disallow), the tombstone SW file, a small `404.html`, and nothing that needs a build.
- Per-path rules, host-agnostic (no `has`): `{"source":"/post/<escaped-slug>{/}?","destination":"https://www.jsolly.com/blog/<slug>/","statusCode":301}`. Host-agnostic means apex, www and the generated URL all match in one hop and every rule is testable on the project's own deployment before go-live. Special case: `/post/15-minute-dump-and-go-instant-pot-recipes{/}?` to `https://www.jsolly.com/recipes/`. Feeds `/rss{/}?` and `/atom{/}?` to the new feed URLs. Homepage `/` to `https://www.jsolly.com/blog/` (needed for Change of Address).
- Tombstone SW at `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js`: a real static file. Redirect routes run BEFORE the filesystem phase (compiled order), so a matching redirect would shadow the file; therefore no rule may match this path. Keep the page redirect source exactly `/post/15-minute-dump-and-go-instant-pot-recipes{/}?`, which does not match the `.js` path, and never add a catch-all, served `application/javascript` with `Cache-Control: no-cache`. Body: install `skipWaiting`; activate deletes caches, `registration.unregister()`, then `clients.matchAll({type:'window', includeUncontrolled:true})` and `client.navigate(client.url)`; no fetch handler.
- Unmapped paths: static 404 (not a blanket redirect). Decision for John: 404 or 410.
- Redirect order matters (first match wins in array order): feeds, SW exclusions, special case, then per-path rules; no catch-all, so no negative lookaheads are needed.
- Gate test (in jsolly-website, `node --test`; must be wired into `npm test` or the gate explicitly, because `npm test` today only globs `src/lib/*.test.ts`): compile `legacy/blogthedata/vercel.json` with `getTransformedRoutes` (error on invalid sources), run every URL in the map (both slash forms, mixed-case slugs, a query-string case; hosts are irrelevant because the rules are host-agnostic) through a tiny matcher of the compiled routes, assert exactly one hop with status 301 and the exact `Location`; assert the SW path returns the file, not a redirect; assert robots has no `Disallow: /`; assert every destination exists in the built jsolly `dist/` (internal link check). Add `@vercel/routing-utils` as an explicit devDependency (currently only transitive through `vercel`, Knip will flag a direct import otherwise).
- Post-cutover monitoring: the existing Production smoke workflow gets a legacy section that curls the map against the real domain (separate manual-approval step).

### Cutover runbook for John (agents do not touch Vercel project settings; each step needs his explicit approval)

Connecting the Git source is the go-live switch: with auto-assign of production domains ON, the next push to jsolly-website main (any commit, even unrelated) publishes the redirect-only site to blogthedata.com. So:

1. Earlier implementation commits land `legacy/blogthedata/` on main while the `blogthedata` project is still connected to awesome-blog. This has no effect on blogthedata.com.
2. Turn OFF "Auto-assign Custom Production Domains" (Settings, Environments, Production, Branch Tracking) for the blogthedata project BEFORE connecting anything. Docs show no plan restriction on this toggle (not exercised here).
3. `vercel git disconnect` (awesome-blog), connect jsolly/jsolly-website with Root Directory `legacy/blogthedata`, Framework Other, no build command, output directory `.`. Until a new deployment is promoted, the last awesome-blog deployment keeps serving.
4. Trigger one staged production deployment (push touching `legacy/blogthedata`, or redeploy). Run the URL-map test against its generated URL with `vercel curl --deployment <url>` (Vercel Authentication protects generated URLs).
5. Promote it (no rebuild). From this moment the awesome-blog deployment is the immediately previous deployment.
6. Verify every URL in the map on the real domains, then re-enable auto-assign (or keep manual promote for future redirect edits).
7. Rollback reality on Hobby: Instant Rollback only reaches the immediately previous deployment. If a second redirect-only deployment happens before verification finishes, rollback to awesome-blog is no longer possible. Fallback while awesome-blog is still unarchived: reconnect it to the project and redeploy main (bf1f7ff1). Do not archive until redirects are verified and no redirect fixes are pending.
8. Submit Change of Address (both domain-level properties verified) after production verification; archive awesome-blog last.

## Question-by-question answers (short; full evidence in the JSON)

1. **308 vs 301.** `permanent:true` is 308. Use `"statusCode": 301` (cannot be combined with `permanent`). Compiles to status 301. Google treats 301 and 308 identically as permanent signals.
2. **Trailing slash and ordering.** Trailing-slash 308 comes first (real `vercel build` output, plus live proof). Redirects evaluate in array order, first match wins. Valid dual-form patterns: `/post/:slug{/}?`, `/post/foo{/}?`, `/post/foo(/)?`. Invalid: `/post/foo/?`, `/post/:slug/?`. http to https and apex to www are separate platform or host hops (3 hops from `http://jsolly.com/about` today).
3. **Case.** Source matching is case-sensitive (docs and live 404s). No option to relax it on vercel.json redirects.
4. **Query strings.** Passed through automatically (live proof with utm params).
5. **Limits.** 2,048 redirects in vercel.json. Bulk Redirects: up to 1,000,000, file via `bulkRedirectsPath` or runtime CLI/API/dashboard, 301 allowed, run before everything, no wildcards, Pro/Enterprise only.
6. **Host conditions.** `has:[{type:"host",value:"(www\\.)?blogthedata\\.com"}]` compiles; host match is anchored; cannot be exercised before the domain is attached.
7. **Redirects vs middleware.** Redirects first; a redirect ends routing so middleware never runs for it; redirect responses carry none of the vercel.json headers.
8. **Duplicate header rules.** Likely last-wins (CLI dev router assigns by lowercase key; Next.js documents last-wins); not documented by Vercel for production. Avoid overlap.
9. **Domain-level redirect.** Hostname-only target, status 301/302/307/308, blanket. Cannot map paths.
10. **Domain move.** Add the domain to the destination project and confirm Move; do not delete first. Not needed under A'.
11. **Archived repo.** Not documented. The aliased production deployment is never auto-deleted (retention exception); edits afterwards need a Git-less deploy, so re-point to an active repo before archiving.
12. **Astro per-page CSP.** Works in static builds via `Astro.csp.insertDirective`, merged with global directives; hashes are site-global; `insertScriptResource` drops `'self'` unless you add it.
13. **Meta limits.** frame-ancestors, report-uri, sandbox are ignored in meta; keep frame-ancestors in the Vercel header.
14. **Service worker.** Redirect on script URL means update fails and the old SW stays. Kill switch is a same-URL no-op tombstone with unregister and client navigation. Clear-Site-Data is only a supplement.
15. **Change of Address.** Supported from a domain to a path on another domain (both domain-level properties, 301 from old homepage). Keep redirects 1 year minimum, ideally indefinitely.
16. **Feeds.** 301 the feed URLs, keep guid and atom:id values identical to the old permalinks.
17. **Vercel state.** See the account facts section.
18. **Cloudflare state.** DNS-only everywhere, no redirect rules, no page rules.

## Unverified (needs John or a dry run)

- Whether production edge applies last-wins for overlapping header rules (only dev-router source and Next.js docs).
- Whether Vercel auto-disconnects or warns on an archived GitHub repo.
- Whether the Cloudflare CNAME target `37a94d917290a1e8.vercel-dns-016.com` is team-scoped (relevant only if a domain move is ever done).
- Which Search Console properties exist (domain vs URL-prefix) and under which account.
- Project retention policy overrides (not visible through the tools) and the registrar and renewal date for blogthedata.com (Vercel shows it as an external domain).
- Whether `ignoreCommand` works under Vercel's clone depth for the legacy project (optional; skipping is not required).
- Hobby fair-use (non-commercial) if the blog carries ads or affiliate income.
