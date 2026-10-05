# inv-ops notes: scripts, gate, CI, infra, docs, repo config

Evidence base: SRC = awesome-blog @ bf1f7ff1, DST = jsolly-website @ 5694e76. Scratch clones in `clones/inv-ops/`
(overlay experiments never touched the real checkouts). Full per-file table: `inventory-ops.json`
(130 files = 127 non-recipe tracked files outside src/ + the 3 src/content JSON files; set equality with
`git ls-files` checked by `gen-inv-ops.py`; dispositions: 61 drop, 24 adapt, 3 move).

## 0. Headline findings (read these first)

1. **DST is a PRIVATE repo; awesome-blog is PUBLIC** (MIT, 29 stars, 11 forks). `gh repo view`. Merging puts blog source
   behind a private repo; the archive stays public. PagesCMS GitHub App is granted only to awesome-blog (docs/publishing.md:3).
2. **DST ruleset 24115660 has `required_linear_history`** (same as SRC). A history-preserving import (subtree/merge commit) cannot land.
   Combined with the gitleaks evidence below, recommend a **file-copy port without history**; history stays in the archived repo.
3. **Vercel `permanent: true` returns 308, not 301.** Live: `curl -I https://blogthedata.com/` -> 308, `/rss` -> 308. John asked for 301s:
   every redirect needs `"statusCode": 301` and the coverage test must assert the exact code. The existing SRC apex rule
   (`/(.*)` host blogthedata.com -> www) runs before anything per-path, so apex URLs would be two hops unless the plan orders/removes it.
4. **Service-worker trap.** The live blogthedata.com origin registers `/recipe-service-worker.js` with scope `/`
   (src/components/recipes/recipe-pwa-client.mjs: register(..., {scope: '/'})) and a legacy worker at
   `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js` (pwa-build.mjs writes both; vercel.json:81 sets no-cache).
   Both return 200 today (curl). The PWA manifest has `scope: "/"`, `start_url: /post/15-minute…/`. After cutover a cross-origin 301
   on those two script URLs makes the browser's update fetch fail, so installed users keep a worker that answers
   `/post/15-minute…/`, `/recipes/*`, `/favicon.ico`, `/media/recipes/*` from cache forever and never see the redirect.
   Plan must keep those two paths as **200 kill-switch workers** (skipWaiting, delete `recipe-*` caches, unregister, navigate clients
   to https://www.jsolly.com/recipes/) on blogthedata.com, not redirects; the redirect-coverage test needs these two as deliberate exceptions.
   Also tell the recipe owner: manifest `scope: "/"` + root registration would make the new worker control all of jsolly.com.
5. **CSP/middleware conflicts in DST** (details in section 9): header `img-src 'self' data:` blocks 214+1 CloudFront images in 105 of 106 posts;
   Astro CSP has no `frame-src` for 13 YouTube / 1 diagrams.net / 2 nbviewer embeds; DST middleware 406s strict feed readers on extensionless
   feed paths, serves not-found Markdown for `Accept: text/markdown` on /blog/*, and swallows `*.md` data files.
6. **Biome: porting SRC code verbatim fails `biome ci` hard** (921 errors/81 warnings on the overlay; ~286 diagnostics in files I own). Knip also fails
   (unlisted deps, unresolved ../src/lib imports). yamllint and markdownlint are fine. Evidence in section 9.
7. **Do not delete `/Users/johnsolly/code/awesome-blog` locally after the merge.** The private ignored `.migration-work/` receipts
   (Django export, backup recovery receipts, final frozen package) exist only there (docs/migration-backups.md). Post-merge local-resource
   cleanup (global brief) must exclude it.
8. **No MX record on blogthedata.com** (Cloudflare API: zone has only 2 CNAMEs + 1 TXT; `dig MX` = SOA only). security.txt
   `Contact: mailto:john@blogthedata.com` is undeliverable today.
9. **Recipes are still landing**: last 6 merges on SRC main were recipe/PWA work, newest bf1f7ff1 (#700) at 2026-10-04 19:00Z. A content/code freeze on
   SRC is needed from the moment the port branch is cut until cutover.

## 1. npm scripts (SRC package.json) - what each does, reads, and disposition

| script | does | reads / depends on | one-time or durable | disposition |
|---|---|---|---|---|
| check:md | markdownlint-cli2 `**/*.md` via scripts/lint-md.sh | `.markdownlint-cli2.jsonc`, nested `src/content/posts/.markdownlint.json` | durable | DST has it; port only the nested posts dotfile |
| check:yaml | node `yaml` parse + dup keys over `.` and `.github` | all *.yml | durable | drop; DST `uvx yamllint@1.38.0 -s .` covers it (verified passes on SRC YAML) |
| worktree:init | `npm ci` via gate-lib | none | durable | drop (DST: `npm ci`) |
| check:actions | actionlint wrapper | .github | durable | identical in DST |
| gate | `FLEET_DOC_FAST=0 bash .git-hooks/pre-commit` | all | durable | DST has same |
| smoke:production / smoke:scenario-contract | runner / stubbed scenario tests | scripts/production-smoke*.mjs, redirects.json, migration-receipt.json | durable | fold scenario into DST's (section 5) |
| dev/build/preview | astro | 141 pages, builds in 2.9 s (scratch clone) | durable | per src inventory |
| check:app | `astro check && svelte-check` | tsconfig | durable | DST `check:ts` = astro check (minimumSeverity error); svelte-check not in DST: decision |
| test:astro | node --test scripts/astro-contract.test.mjs | needs prior `dist/` build; src/lib/*.ts; yaml, cheerio | mixed | split (see inventory entry; 8 durable, 4 one-time tests) |
| verify:migration | compares build to **private** Django dumpdata (argv[2]) | `.migration-work/source-*.json`, src/lib/frontmatter.ts, import-legacy, intentional-rewrites.json, vercel.json, dist/ | **one-time** (not in gate:app) | **drop** |
| verify:drafts | writes real draft+sentinel, builds, scans all of dist for leak, restores build | src/content/posts, `npm run build` x2 | **durable** (6.4 s) | port as test |
| verify:identities | duplicate post/category slug files must FAIL build ("Duplicate post slug:") | src/content/*, build x3 | **durable** (8.1 s) | port as test |
| verify:cms | PagesCMS-shaped post builds; date-only / tz-less timestamps fail | build x2, cheerio | **durable** (8.1 s) | port as test |
| (verify-media-backup.mjs, no npm script) | S3 backup inventory vs download | private downloaded media | one-time | drop |
| gate:app | recipes:check, check:app, build, test:astro, test:search, test:browse, test:recipes, verify:cms, verify:drafts, verify:identities | | | see gate table |
| recipes:sync / recipes:check / test:recipes | recipe pipeline | recipe agent's inventory | durable | NOTE `test:recipes` also runs `scripts/migration-rewrites.test.mjs` -> must be removed from it |
| protect:stacks, check:stack-protection, test:stack-protection | termination protection + stack policy | aws/migration-backups, gate-lib v4, `aws` | durable for the stack | drop with stack (section 6) |
| plan:infra, check:infra-drift, deploy:infra, test:infra | change-set preview / drift tag compare / deploy / tests | aws, `.mise.toml` aws pin, scripts/infra-inputs.json, .gitattributes | durable for the stack | drop with stack |
| test:search / test:browse | MiniSearch unit test / Playwright infinite-scroll tests | src/lib/search.ts / built dist | durable | port |

Measured in the SRC scratch clone (npm ci 3 s): build 4.6 s; test:astro 0.75 s; test:browse 2.3 s; verify:cms 8.1 s; verify:drafts 6.4 s;
verify:identities 8.1 s; all exit 0. Extra gate cost of the three verify:* is about 23 s; in DST each `npm run build` additionally runs
`process-html.mjs` (jsdom over every page + html-minifier) and `built-csp.test.mjs`, so multiply by the number of pages. Rewrite them to build once
per scenario set (or through Astro's programmatic build) instead of 7 sequential `npm run build`s; and note they mutate `src/content/posts/` during the
gate (crash leaves a stray file).

### Who reads the data files
- `src/content/redirects.json` (2 aliases): astro-contract.test.mjs:93, production-smoke-scenario.mjs:2 + test:5, verify-migration.mjs:22, written by import-legacy.mjs:89.
- `src/content/migration-receipt.json` (106 published `/post/<slug>/`, 6 `/category/<slug>/`, `drafts: 0`): astro-contract.test.mjs:97,118; smoke scenario + test; written by import-legacy.mjs:90.
- `src/content/intentional-rewrites.json`: only verify-migration.mjs:14. Drop.
- `vercel.json` (read by tests): astro-contract.test.mjs:82-112,149-161 (redirect rules, `headers[0]` CSP, feed MIME), verify-migration.mjs:23.
- vercel.json redirects (SRC, 3 rules): two `permanent: true` post aliases, and `/(.*)` host `blogthedata.com` -> `https://www.blogthedata.com/$1`.
  Headers: nosniff, Referrer-Policy, X-Frame-Options DENY, CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
  `/release.json` no-store, `/rss` `/rss/` `/atom` `/atom/` Content-Type, SW script no-cache.

## 2. Gate-step table (SRC `.git-hooks/pre-commit` vs DST)

SRC steps (order): bash floor, YAML validation, actionlint, markdown lint, smoke scenario, stack protection contracts, infra contracts, `gate:app`.
(gitleaks/staged secrets scan + doc-only fast path come from `gate_begin_commit`, same lib in both.)

| step | SRC | DST | decision |
|---|---|---|---|
| gate-lib bootstrap, `gate_begin_commit`, secrets scan on staged, doc-only fast path | yes (`"awesome-blog"`) | yes (`"jsolly-website"`, plus degraded no-lib branch) | keep DST. Note `gate__docs_only_paths`: `src/**` Markdown is NOT docs-only, so post edits take the full gate (fine, desired) |
| bash floor | yes | yes | same |
| node pin | `gate_require_node` | same | same |
| biome ci | no | `biome ci . --error-on-warnings` | DST only. **Ported code must pass it** |
| YAML | node check-yaml | yamllint 1.38.0 -s | keep yamllint, drop check-yaml |
| knip | no | yes (`treatConfigHintsAsErrors`) | DST only; ported deps/entries must satisfy it |
| actionlint | yes | yes (+ preview contracts) | same |
| markdown lint | yes | yes | same; needs nested posts `.markdownlint.json` |
| smoke scenario contract | yes | yes | merge scenarios |
| astro check | in `gate:app` (`astro check && svelte-check`) | `check:ts` | keep DST; decide svelte-check |
| unit tests | in gate:app (test:astro/search/browse/recipes) | `npm test` = `src/lib/*.test.ts` via ts loader | extend `npm test` (or add steps) for ported .mjs tests |
| build | in gate:app | `npm run build` (+process-html +built-csp test) | same |
| recipes:check | yes | no | port with recipe pipeline (recipe agent) |
| verify:cms/drafts/identities | yes | no | port (durable) |
| stack protection tests / infra tests | yes | no | drop with the stack (or port only if infra moves) |
| Playwright browser install | CI only | CI only | same; local gate assumes chromium installed |

DST hook is protected by the dotagents dispatcher: a modified tracked hook runs only if its bytes match origin/main or an approved blob (AGENTS.md "Git hooks").

## 3. CI workflow diff (SRC ci.yml vs DST ci.yml)

Same skeleton (gitleaks range scan, verified-tree reuse, `ci` job name, deferral logic). SRC steps after npm ci: check:actions, check:md, test:stack-protection,
test:infra, check:yaml, playwright install, smoke:scenario-contract, `gate:app`. DST: setup-uv, check:actions, check:md, playwright install, smoke contract,
biome ci, check:yaml (yamllint), check:knip, check:ts, `npm test`, `npm run build`. Merge = DST list + ported steps (contract tests after build; browse tests need chromium, already installed).
Drop the two infra steps. Keep job name `ci` (ruleset required context `ci`, integration 15368 on both repos). Version drift: SRC `actions/setup-node@v7`, DST `@v6`.
Dependabot: SRC has npm weekly + github-actions weekly; DST npm daily only. 3 open SRC Dependabot PRs: #696 tailwind-merge 3.7.0, #695 shadcn-svelte 1.7.0, #680 typescript 7.0.2 (DST has parallel PRs #51-54, #1): do not merge in SRC; close before archive.

## 4. Smoke scenario fold-in

SRC scenario (`scripts/production-smoke-scenario.mjs`): `verifyRelease` (GET /release.json sha == deployed SHA), home "Latest Posts!" -> first card -> article h1 == title and non-empty `.post-text`,
bare `/post/<slug>` and the 2 historical aliases must end 200 at canonical slash URL, `/all-posts/` GET search `?searched=<title>` finds the article, RSS/Atom MIME (`application/rss+xml`, `application/atom+xml`)
with and without trailing slash, mobile menu (`Open menu`/`Close menu`, `Main navigation`) -> All posts. DST scenario: home heading, mobile `Toggle mobile menu`, `Mobile navigation`, About/Contact nav, `Accept: text/markdown` negotiation on /about/ (200, text/markdown, Vary Accept).
Fold: DST scenario gains (a) `/blog/` -> article read -> GET search -> feed MIME on the new feed URLs, (b) `Accept: text/markdown` on `/blog/<slug>/` must NOT return the "does not exist" body (middleware conflict), (c) recipes hub reachable at `/recipes/`.
Cross-domain redirect verification (blogthedata.com -> jsolly.com, 301 with exact Location, SW kill-switch 200s) cannot live in this scenario: DST runner (`verifyResponse`) rejects a final origin different from `productionUrl`'s. It needs a separate redirect-verification script/job (plan owner). Do not fork `scripts/production-smoke.mjs`: DST's copy is the canonical template; SRC's differs only by one `verifyRelease` hook call (line 72). Options: drop SHA gating, check /release.json once inside `smoke()`, or upstream the hook (cross-repo handoff).
SRC workflow hardening not in DST (vercel[bot] creator, ref check, ancestor-of-main check, `vars.VERCEL_PRODUCTION_ENVIRONMENT`): observed SRC Production deployments show environment `Production` created by `vercel[bot]` (gh api deployments). DST value UNVERIFIED (403 on deployments).

## 5. .pages.yml (every path / what changes)

References: `media.input: public/media`, `media.output: /media`, `settings.content.merge: true`; collection `posts` -> `path: src/content/posts`, `filename: "{fields.slug}.md"`,
`format: yaml-frontmatter`; `related.options.collection: posts`; `categories` -> `path: src/content/categories`, `filename: "{fields.slug}.json"`; `image.default: /media/default.webp`, image pattern `^(?:/media/\S+|https://\S+)$`;
body = code editor (markdown), excerpt = code editor (html); timestamp patterns (ISO 8601 with seconds + tz).
Changes for DST: (1) file at DST root (no existing `.pages.yml`); (2) if the posts dir is renamed (e.g. `src/content/blog`) change `path` AND rename collection + `related.options.collection` together; astro-contract L134 then must change too;
(3) keep media input/output as is if `/media` is kept (recommended first pass); (4) `slug` description "Stable article URL" -> `/blog/<slug>/`; (5) grant the PagesCMS GitHub App to the private jsolly-website repo; editorial branches must satisfy DST gate + ruleset (PR + `ci`);
(6) yamllint: copied verbatim passes DST `.yamllint` with `-s` (checked). Legacy fields (`legacyId`, `legacyImage`, `legacyAuthorId`) are intentionally unmanaged (merge: true).
Open editorial branches today: only `main` + 3 Dependabot branches (gh api branches) -> no PagesCMS work in flight.

## 6. AWS / infra (decision for John: do not act; fleet rules say agents never deploy/teardown)

Facts: stack `blogthedata-migration-backups` (us-east-1, account 730335616323) created by hand 2026-10-02, `CREATE_COMPLETE`, termination protection + stack policy; template = 1 private S3 bucket
`blogthedata-backups-<acct>` (versioned, AES256, Object Lock GOVERNANCE 30 d, DeletionPolicy/UpdateReplacePolicy Retain) + TLS-only bucket policy; recovery bundle uploaded (version A7Eg…,
retention until **2026-11-01T18:19:35Z**). Inputs: aws/migration-backups/{template.json,deploy.sh} (infra-inputs.json, .gitattributes). Scripts hard-code `jsolly/awesome-blog` (deploy.sh:57 `gate_require_landed main`, protect-stacks.sh:38) and
`/Users/johnsolly/code/awesome-blog`. The stack has never been deployed through deploy:infra (no `InfraDeployCommit` tag yet per docs). `plan:infra` is not functional for agents: dotagents `agent-readonly-plan` covers only shared-infra and asset-buyer stacks (docs/migration-backups.md says status:error AccessDenied).
Also live and NOT in this repo's IaC: bucket `blogthedata` + CloudFront d1d7p8ufhgz4ld (post media; 214 refs) + Heroku app/DB/IAM: AGENTS.md says retain until separately authorized retirement.

| option | what happens | pros | cons |
|---|---|---|---|
| A. Leave IaC frozen in the archived (public) repo | stack untouched; scripts/docs stay in history | zero AWS change, zero cross-repo work; template is already immutable by policy | archived repo cannot land commits so `deploy:infra` can never run again; continuous `check:stack-protection`/drift verification stops; public repo keeps account ID/bucket/version ID in docs |
| B. Retire the backups (John-only destructive op) | delete versions/bucket/stack after retention | removes residual | blocked by Object Lock until 2026-11-01 anyway; only independent copy of legacy Django DB + media; Heroku rollback and post-media bucket still depend on retention decisions |
| C. Move stack definition to shared-infra | same stack name/template, owner repo changes; one `deploy:infra` by John restamps the tag | fleet-correct home (agent-readonly-plan policy lives there), keeps drift/protection verification | separate cross-repo handoff (one chip/repo, John-started lead), edits shared-infra IAM policy, John human deploy; adds work for a stack that will not change |

**Recommendation: A now** (keep frozen; add a README line in the archive naming the stack and the runbook), and record C-or-B as a leftover decision after 2026-11-01 once John decides whether the recovery bundle is kept long-term.
Flip to C if John wants the bucket kept past the Heroku retirement AND wants drift/protection checks. Do not move infra files into jsolly-website: DST has no AWS surface (no .mise.toml pin, no aws-oidc bootstrap), the repo is Vercel-git (no Deploy workflow for the dirty-IaC refusal), and `/optimize-workspaces` would start boarding it.

## 7. Public assets

- `favicon.ico`: collision; md5 differs (SRC ba2f3f15…, DST 2489825b…). Drop; DST wins. `https://www.blogthedata.com/favicon.ico` live 200 -> 301 to jsolly.com favicon.
- `logo.webp`: unreferenced in SRC src/; live 200 (could be hot-linked). URL-map decision. `topographic-logo.svg`: header brand (Base.astro:41) + PWA icon source; live 200; keep only if the blog keeps its own header.
- `pgp-key.txt` + `.well-known/security.txt`: live 200 on blogthedata.com, 404 for security.txt on jsolly.com. Fields: Contact mailto (undeliverable, no MX), Expires 2027-10-02, Encryption/Canonical on www.blogthedata.com. Recommend rewrite to jsolly.com URLs and `Contact: https://www.jsolly.com/contact/` (llms.txt says no public email). Blog post security-txt-allows-researches-to-contact-you hard-links old URLs.
- `social/*.svg`: 4 of 5 duplicate DST `src/images/social/*`; only redditLogo is new (share buttons). Posts: DST middleware does not negotiate `.svg`.
- `media/default.webp` + `media/recipes/*` (45 files): keep `/media/` prefix; pwa-build.mjs hard-codes `/media/recipes`.
- DST outbound references to blogthedata.com that must be retargeted to /blog/ (9): public/llms.txt:13,20,42; src/components/Footer.astro:11; SiteNavigation.svelte:12; home/SiteIntro.astro:52-55; src/content/agent-pages.ts:62,94,111; src/content/socialLinks.ts:47-50. SRC posts contain 76 absolute blogthedata.com URLs (49 unique) in 44 posts to rewrite to /blog/<slug>/ (internal link check).
- Live non-post URLs observed (public GET): /, /all-posts/, /privacy/, /works-cited/, /category/<6>/, /search/ (robots-disallowed), /404.html, /rss (308 -> /rss/), /atom, /sitemap.xml (116 URLs; `/sitemap-index.xml` 404), /robots.txt, /release.json, /search-index.json, /recipes/<20 ids>/, /recipes/meals/, /recipes/smoothies/, /data/recipe-library.{json,md}, /recipes-pwa/*, /recipe-service-worker.js, /post/15-minute…/service-worker.js, /media/*, /social/*, /.well-known/security.txt, /pgp-key.txt, /favicon.ico, /logo.webp, /topographic-logo.svg. `/feed/` and `/sitemap-index.xml` = 404.

## 8. Redirect hosting (input to plan author)

Facts: blogthedata Vercel project `prj_QxSNy3z51xOp295HUvPfDa1JY9h8` owns blogthedata.com, www.blogthedata.com (no domain-level redirect) and blogthedata.vercel.app. Project routes = 0, bulk redirects = 0 (Vercel MCP read). DNS is Cloudflare **DNS-only** (Free plan, both CNAMEs unproxied to `37a94d917290a1e8.vercel-dns-016.com`, no redirect rulesets, no MX; one Google site-verification TXT). jsolly-website project owns jsolly.com (308 -> www) and www.jsolly.com.

| where | survives archive? | notes |
|---|---|---|
| vercel.json in awesome-blog final redirect-only deploy, then archive | The production deployment stays live, but no fix is ever possible (read-only repo, deploys need commits); project must stay connected | matches John's cutover order; add kill-switch SW files in that deployment; test lives in the repo only until archive |
| Vercel project-level bulk redirects/routes on `blogthedata` (dashboard/API, versioned stage->promote; 0 today) | Yes, independent of repo | write = John's step-up; supports status code 301; SW kill-switch files still need a deployment |
| Attach both blogthedata domains to the jsolly-website project + host-conditioned rules in DST vercel.json | Yes, lives in an active, gated, tested repo; blogthedata project and awesome-blog repo can be deleted later | DST already uses `has: host` (jsolly.com->www); kill-switch SW paths need host-conditional rewrites; limit 2,048 vercel.json redirects (we need ~150); shared project means one bad merge can break both; domain move = John's Vercel action |
| Cloudflare redirect rules | n/a today | requires turning on proxy (orange cloud) = write + John's step-up |

Recommendation (for plan author to challenge): **attach domains to jsolly-website** (survives archive, tested in DST gate, one place) with the final awesome-blog redirect-only deployment as the bridging step before the domain moves. Always keep: the Google site-verification TXT (Search Console Change of Address needs the old property verified), domain registration, the `blogthedata` Vercel project until the domain is moved.

## 9. Conflicts with DST (measured)

Overlay experiment: scratch clone of DST + verbatim copy of SRC scripts, aws/, docs/, `.pages.yml`, src/content, src/components/recipes (recipe sources included only to measure; counts below split).
- **Biome** (`npx biome ci . --error-on-warnings`; baseline 56 files green): 921 errors + 81 warnings in 72 files. Top rules: useLayeredStyles 239, useConsistentTestIt 120, useTopLevelRegex 109, useUnicodeRegex 93, noImportantStyles 78 (warn), format 60, noMisplacedAssertion 51, organizeImports 41, noAwaitInLoops 35, useTemplate 31, noShadow 20, noConditionalExpect 19, noSecrets 12, noUndeclaredDependencies 11. Split: src/components/recipes 560, scripts/recipes 156, **my files ~286** (astro-contract.test 63, plan-infra.test 43, verify-migration 28, check-infra-drift.test 19, stack-protection.test 11, verify-cms 11, browse.test 10, src/content JSON 10, verify-identities 9, ...). Of mine only astro-contract/browse/search/verify-cms/drafts/identities/production-smoke-scenario(+test) survive, so budget is ~140 diagnostics across 8 files to fix by hand, tabs + double quotes + `node:test` `it` + top-level regexes + `.js` extensions, and Biome `noSecrets` flags in tests. Adding the 106 post `.md` files did not change Biome's checked-file count (128), so Markdown posts are not Biome-checked.
- **Knip** (`treatConfigHintsAsErrors`): ported scripts are entries (`scripts/**/*.mjs`), so unused-export noise is limited, but: Unlisted dependencies `cheerio`, `yaml`, `turndown` (11 sites); Unresolved imports `../src/lib/html.ts`, `frontmatter.ts`, `search.ts` until src/lib is ported. After dropping importers, `turndown` and `yaml`(if content-files inlined) are not needed; `cheerio` and `minisearch`, `sanitize-html`, `zod`, etc. come from the src side.
- **yamllint** (`uvx yamllint@1.38.0 -s .`, DST `.yamllint` relaxed): SRC `.pages.yml`, dependabot.yml, ci.yml, production-smoke.yml all pass (exit 0).
- **markdownlint**: 0 issues in 118 files once posts and `src/content/posts/.markdownlint.json` (a dotfile; shell globs drop it) are present.
- **gitleaks 8.24.2**: tree scan of SRC clean with repo config and with default config only; history scan of SRC = 8 findings (django_ckeditor_5 bundle sourcemaps). Therefore drop `.gitleaks.toml`/`.gitleaksignore` only for a no-history port; a history import would make DST's range scan red (and `required_linear_history` forbids merge commits anyway).
- **CSP** (DST vercel.json header + astro.config.ts security.csp; both enforced, a resource must pass both):
  - header `img-src 'self' data:` vs SRC `img-src 'self' https: data:`: 214 CloudFront URLs (`d1d7p8ufhgz4ld.cloudfront.net/media/...`) in 105 posts + 1 `d33wubrfki0l68.cloudfront.net`. Options: add the two hosts to DST `img-src`; or migrate post images same-origin (1,010 objects / ~101 MB in S3 bucket `blogthedata`: too big for git, decision) - note AGENTS says existing S3/CloudFront media remains.
  - no `frame-src`: need youtube.com, youtube-nocookie.com, viewer.diagrams.net, nbviewer.org (per-page via Astro CSP API or a global directive); no `connect-src` (default-src 'self' ok for same-origin fetch).
  - `scripts/built-csp.test.mjs` forbids header `script-src`/`default-src`, requires `frame-ancestors 'none'`: new header directives must respect that. SRC `form-action 'self'`/`object-src 'none'`/`base-uri 'self'` are not in DST's header (DST has no forms; adding is optional).
  - "No CDN for app assets" (rules/no-cdn-app-assets.md) forbids runtime CSS/JS/fonts from CDNs; CloudFront is first-party content imagery for the author's own bucket, but note it as an exception to call out.
- **Middleware** (`middleware.ts` -> src/lib/agent-response.ts, accept-negotiate.ts): `shouldNegotiate` true for extensionless paths; no match for text/html or text/markdown -> 406; markdown pages registry (`PAGES`) knows only 5 routes so `Accept: text/markdown` on /blog/* gives the not-found Markdown body (status 404) - needs registry/fall-through; `*.md` suffix always treated as Markdown sibling -> `/recipes/.../recipe-library.md` breaks; `Vary: Accept` appended to feed responses. DST `src/lib/*.test.ts` must gain cases for /blog/* and feeds.
- **Other structure collisions**: `src/lib/utils.ts` exists in both; SRC `src/lib/components/ui/button/button.svelte` (nested) vs DST `src/lib/components/ui/button.svelte` (flat); DST `tsconfig` has `src/**/*` only and excludes `src/**/*.test.ts`; DST `check:ts` is `astro check --minimumSeverity error`; DST has no `svelte-check`; DST astro config has no `trailingSlash` or `markdown` processor (`@astrojs/markdown-satteri`) - src inventory.
- **Dependencies SRC has that DST lacks**: @astrojs/markdown-satteri, bits-ui, @lucide/svelte, entities, minisearch, sanitize-html, zod, cheerio, turndown, yaml, svelte-check, @internationalized/date (check tailwind-variants location). Several are importer-only (turndown, yaml, entities?) - package inventory.

## 10. Open work to drain/freeze before cutover

- 3 open PRs, all Dependabot (#696, #695, #680); 4 branches: main + 3 dependabot. No PagesCMS editorial branches. Issues disabled (0). Discussions enabled (0), wiki enabled (not inspected), Projects enabled, Pages off, 2 watchers, 29 stars, 11 forks, no releases/packages/tags.
- Repo: public, MIT, homepage https://www.blogthedata.com, description "Static technical blog built with Astro, Svelte and PagesCMS." Archive step: set description/homepage to jsolly.com/blog, README pointer, then archive (John). Archiving freezes PRs/branches read-only; close the 3 Dependabot PRs first.
- Ruleset 24115660 (`main`, active): deletion, non_fast_forward, required_linear_history, pull_request, required check `ci`. Actions variables/secrets/webhooks unreadable (403): `VERCEL_PRODUCTION_ENVIRONMENT` value and any webhooks UNVERIFIED.
- Hardcoded things to remember at archive: Vercel `blogthedata` project linked to repo ID 286148731 (docs/astro-migration.md:173); archived repos still serve Vercel's last deployment, but Git-triggered redeploys stop.
- Contributors in history: 15 commits by "Praise Freedom Dike", others minor; irrelevant if history is not imported.

## 11. Decisions for John (each needs an explicit yes)

1. Port as file copy without history (recommended) vs history-preserving import (blocked by linear-history ruleset; gitleaks cost).
2. Redirect hosting (section 8) and 301 vs 308: confirm `statusCode: 301`.
3. AWS stack: A (freeze in archive, recommended) / B / C.
4. security.txt Contact: web contact form (recommended) vs publish an email.
5. `closed-loops` alias target (post missing): /blog/ vs 410.
6. Smoke runner release-SHA gating: drop, in-scenario check, or upstream hook to dotagents template.
7. Adopt SRC production-smoke workflow hardening in DST?
8. CSP: widen `img-src` to the two CloudFront hosts (recommended short term) vs migrate images; per-page `frame-src`.
9. Keep `/media/` prefix (recommended) vs `/blog/media` + `/recipes/media`.
10. LICENSE for merged repo; svelte-check in DST gate; Dependabot github-actions ecosystem for DST.

## 12. Unverified

- DST Vercel project settings (build command/output/Node) match what SRC's vercel.json hard-sets; DST production smoke `Production` environment name (deployments API 403).
- Whether Biome processes `.md`/`.markdown`: count unchanged at 128 files after adding 106 posts suggests no, not otherwise confirmed.
- Whether the Vercel `redirects` `statusCode: 301` plus `has` host conditions behave identically for per-path + apex in one hop (needs a preview deployment test; plan author).
- Actual browser behavior of the old service worker after cutover (spec reasoning: SW script fetch must not redirect; not tested in a real browser).
- Wiki contents, Projects boards on awesome-blog; Search Console property state; registrar/domain expiry for blogthedata.com; Heroku app DNS rollback relevance.
- `.migration-work/` and ~/.local/share/blogthedata-migration contents deliberately not read.
