# Orchestrator decisions brief (input to plan synthesis)

These are the orchestrator's resolved positions after reconciling the nine discovery reports
(`discovery-digest.md` and the per-agent JSON/notes files in this directory). The synthesizer
must not re-litigate them. It may flag a position as wrong only with new primary evidence. Items
tagged **JOHN** are decisions the plan must present with this recommendation and the condition
that would flip it.

## Facts that anchor the plan

- SRC awesome-blog `origin/main` = `bf1f7ff1` = the SHA live in production (`/release.json`). It has
  106 posts (22 with mixed-case slugs), 6 categories (`Geodev` is mixed-case) and 21 recipes
  (15 meals, 6 smoothies). The fresh build has 141 pages and 265 files.
- SRC is public (MIT). DST jsolly-website is **private**, has `required_linear_history` on `main`,
  and merging to `main` deploys to production through Vercel Git.
- CI (`ci.yml`) runs on `pull_request` for any base branch, so PRs into an integration branch get CI.
- Vercel is on the Hobby plan: no Bulk Redirects, and Instant Rollback reaches only the previous
  deployment. Vercel project `blogthedata` (prj_QxSNy3z51xOp295HUvPfDa1JY9h8) owns blogthedata.com,
  www.blogthedata.com and blogthedata.vercel.app. Cloudflare DNS is DNS-only, no MX, and has a
  google-site-verification TXT record.

## Resolved positions

1. **Redirect host = option A′.** Keep Vercel project `blogthedata`; its domains, certs and DNS
   stay untouched. Re-point its Git source to `jsolly/jsolly-website` with Root Directory
   `legacy/blogthedata`. That directory is a static, no-build project containing:
   - a `vercel.json` of host-agnostic per-path redirects, every one with `"statusCode": 301`;
   - no `trailingSlash` key, and sources in `{/}?` form, so both slash forms resolve in one hop;
   - no catch-all;
   - `git.deploymentEnabled` set to main only.

   It also serves real files: two kill-switch service workers, `/.well-known/security.txt`
   (Vercel cannot redirect `/.well-known`), a permissive `robots.txt` and a static `404.html`.
   Unmapped paths return 404 (**JOHN**, recommended 404). Fallback: option B, attaching the
   domains to jsolly-website, which costs two hops for slashless URLs. Rejected: C (Bulk
   Redirects need Pro), D (domain redirect is blanket and would redirect the SW script), E
   (Cloudflare needs proxying) and F (an extra repo is more moving parts than A′).

   The redirect list is generated from a committed URL map (`legacy/blogthedata/url-map.json`) by
   a script with a `--check` mode, like `recipes:check`. It is tested in jsolly-website's gate
   by compiling it with `@vercel/routing-utils` (add as a pinned devDependency after verifying
   it exists on npm).

   Go-live on Hobby:
   1. Turn off auto-assign of custom production domains.
   2. Connect Git with the root dir.
   3. Stage the production deployment.
   4. Test it on its deployment URL.
   5. Promote it.
   6. Verify the full map.

   All Vercel dashboard changes are John's.
2. **Status code.** `statusCode: 301` on every redirect, and tests assert exactly 301. On http,
   Vercel's HTTPS upgrade adds an unavoidable 308 first hop; document it as the hop budget.
3. **Case.** Preserve slug case in both sources and destinations (`/blog/<Exact-Case>/`). Do not
   add lowercase-variant rows, since they 404 today. Legacy category slugs get explicit rows:
   `geodev`→`Geodev`, `devtools`→`dev-tools`, `webdev`→`web-dev`, `web-development`→`web-dev`.
4. **DST layout.**
   - Content: `src/content/blog/posts/*.md` (plus its `.markdownlint.json`, which must be copied
     explicitly), `src/content/blog/categories/*.json`, `src/content.config.ts`.
   - Code: lib in `src/lib/blog/`, components in `src/components/blog/` and
     `src/components/recipes/`, and a standalone `src/layouts/BlogLayout.astro` that honors
     MAINTENANCE_MODE and emits no Markdown alternate link.
   - Styles: `src/styles/blog/` inside a named `@layer blog`, with the layer order declared.
   - Blog routes: `/blog/`, `/blog/<slug>/`, `/blog/category/<slug>/`, `/blog/all-posts/`,
     `/blog/search/` (keeps `?searched=`), `/blog/works-cited/`, `/blog/rss.xml`,
     `/blog/atom.xml`, `/blog/search-index.json`, `/blog/media/default.webp`.
   - Blog chrome assets (logo, topographic logo, social SVGs) move under `/blog/` when the
     BlogLayout still uses them.
   - Privacy merges into `/privacy/`. Drop `sitemap.xml.ts`, `robots.txt.ts` and `release.json.ts`
     in favour of DST's sitemap integration and static robots.
5. **Recipes layout.**
   - Pages: `/recipes/` (the library rendered from RecipeExperience, keeping `#<id>` and
     `#meal-results` deep links), `/recipes/meals/`, `/recipes/smoothies/`, and `/recipes/<id>/`
     (keeping `?servings=&starch=`).
   - Assets: `/recipes/data/recipe-library.{json,md}` (generated, not copied), `/recipes/media/*`
     and `/recipes/pwa/{manifest.webmanifest,icon-*.png}`.
   - Service worker: `/recipes/service-worker.js` with scope `/recipes/`, generated after
     process-html, using `cache.match(..., {ignoreVary:true})`.
   - Drop the generated recipe post, `article-generator.mjs` and its tests. Its editorial prose
     was never rendered live and is preserved only in the archived repo history (**JOHN** D2,
     recommended archive-only).
   - Rename the localStorage key; the cross-origin state loss is accepted (**JOHN**, minor).
   - Replace cheerio with jsdom in pwa-build and the tests.
   - Derive recipe pages from `recipes.json`, not from `readdir`.
6. **Feeds.** `/blog/rss.xml` and `/blog/atom.xml`. The extension keeps them out of middleware
   negotiation. Add Content-Type header rules for `application/rss+xml` and
   `application/atom+xml`. Pre-merge posts keep their legacy `guid isPermaLink="false"` and
   Atom `id` (the old `https://www.blogthedata.com/post/<slug>/` URLs), and the Atom feed id is
   unchanged. Remove the recipe post from the feeds. Old `/rss`, `/rss/`, `/atom` and `/atom/`
   get 301s.
7. **CSP.** Keep DST's established split: the header holds resource restrictions plus
   frame-ancestors, and the Astro meta holds default-src plus hashes.
   - Header `img-src` adds exactly `https://d1d7p8ufhgz4ld.cloudfront.net`. The single
     `d33wubrfki0l68.cloudfront.net` reference is handled in content: rewrite it or drop it.
   - BlogLayout calls `Astro.csp.insertDirective` to add `img-src 'self' data:` plus the
     CloudFront host, and `frame-src` for youtube.com, youtube-nocookie.com, viewer.diagrams.net
     and nbviewer.org, on blog pages only.
   - Set `markdown.syntaxHighlight: 'prism'`.
   - Extend `built-csp.test.mjs`: the per-page directives appear on `/blog/**` and nowhere else,
     the header host is exact, and a Playwright check with the header injected fails on any
     `securitypolicyviolation`.
   - S3 bucket `blogthedata` and CloudFront `d1d7p8ufhgz4ld` become documented runtime
     dependencies of jsolly.com and are never retired while posts reference them (**JOHN**: keep
     CloudFront, recommended; alternative is rehosting about 101 MB same-origin).
8. **process-html.**
   - Prerequisite PR on `main`: hydration-safe minify (keep Svelte comment anchors through
     `ignoreCustomComments`, and stop whitespace collapse that breaks hydration), plus a
     Playwright hydration node-reuse test. This fixes the live nav-island re-render.
   - In the port, the heading-id pass skips `dist/blog/**` and `dist/recipes/**`, whose ids are
     owned by the blog pipeline's legacy algorithm, which must not change.
   - Fix the two `#`-only headings at source.
   - Port the heading-fragment contract test.
9. **Middleware.** Prerequisite PR on `main`:
   - `shouldNegotiate` returns false for `/blog/**` and `/recipes/**`;
   - the `.md` branch does not hijack `/recipes/data/`;
   - add unit tests.

   Markdown negotiation for posts is an explicit non-goal of this merge (**JOHN**, recommended
   not now). It is a natural follow-up because posts are already Markdown.
10. **Dependencies.**
    - Set `overrides.yaml` to `"$yaml"` and add the blog dependencies.
    - Drop turndown, @types/turndown, cheerio and @types/node 26.
    - Add `svelte-check` to `check:ts`.
    - Bump astro to ≥ 7.3.5.
11. **Biome.** Full conformance with no scoped rule relaxations. `biome-ignore` is allowed only
    with a reason (precedent: sanitized `set:html` in StructuredData.astro). Exclude generated
    recipe data and the manifest from Biome, or make the generators emit Biome formatting. Gate
    the CSS `@layer` conversion with a visual comparison against live blogthedata.com (desktop
    and mobile) before cutover.
12. **Tests.** Wire every surviving suite into the gate and CI:
    - extend `npm test` to run the ported unit `.mjs` suites;
    - add a `test:built` step after build (adapted astro-contract, search, browse, recipes and
      PWA, heading ids, hydration, CSP, feed ids, internal links, redirect map compile, and
      destination existence);
    - port `verify:cms`, `verify:drafts` and `verify:identities` as built-output tests that
      build once.

    Report expected counts. SRC baseline: test:astro 14, search 3, browse 2, recipes 55 (36 unit,
    5 article generator, 1 migration-rewrites, 13 PWA). DST baseline: `npm test` 18.
13. **History.** Snapshot port without history. Commit messages cite the awesome-blog freeze SHA.
    Drop `.gitleaks.toml` and `.gitleaksignore`.
14. **Infra.** The AWS migration-backups IaC stays frozen in archived awesome-blog (option A),
    with a README line. Revisit after Object Lock retention ends on 2026-11-01 (**JOHN**: retire,
    or move to shared-infra as a separate cross-repo handoff). Nothing infra moves into
    jsolly-website.
15. **PagesCMS.** Keep it. Move `.pages.yml` to the DST root with new paths (media input
    `public/blog/media`, output `/blog/media`). John extends the PagesCMS GitHub App grant to the
    private jsolly-website before the first CMS edit.
16. **Security files.**
    - jsolly.com gets `/.well-known/security.txt` (Contact `https://www.jsolly.com/contact/`,
      Canonical and Encryption on jsolly.com, new Expires) and `/pgp-key.txt`.
    - The old host serves a security.txt (200), because `/.well-known` cannot redirect on Vercel.
    - `/pgp-key.txt` gets a 301.
17. **Privacy.** Merge the blog's privacy statements into jsolly `/privacy/` (recipe localStorage,
    SW cache). The old `/privacy/` gets a 301 there.
18. **Legacy URLs.**
    - The two vercel.json renames go direct to their final destination, never chained.
    - `/post/how-to-leverage-closed-loops/` goes to `/blog/how-to-ask-less-questions/`
      (**JOHN**, fallback `/blog/`).
    - The 4 legacy category slugs get rows (item 3).
    - These stay 404 (no regression, since they 404 today): the 5 deleted posts, `/status/`,
      `/portfolio/`, `/category/portfolio/`, Django account/admin/api routes, `/static/*`,
      legacy `/media/*` upload paths and `/media/post_metaimgs/*` (**JOHN**: may opt in to
      specific rows).
    - Hashed `/_astro/*`, `/404.html`, `/release.json` and `/search-index.json` → 404 or drop
      (state which).
    - `/favicon.ico` → 301 to the jsolly favicon.
    - `/sitemap.xml` → 301 to `https://www.jsolly.com/sitemap-index.xml`.
    - `/robots.txt` is served (200), not redirected.
19. **jsolly-website self-references.** Retarget SiteNavigation, Footer, SiteIntro, socialLinks
    (and JSON-LD sameAs), llms.txt and agent-pages to `/blog/`, and add `/recipes/`. Drop the
    blogthedata logo SVG.
20. **Content rewrites.** In one dedicated content commit:
    - the 57 absolute `/post/` links go to `/blog/<slug>/`;
    - the other absolute self-links go to their jsolly equivalents;
    - fix or remove the 3 dead references;
    - remove the recipe slug from the 3 posts' `related` lists.

    Prose mentions of "blogthedata.com" stay as history unless they claim a location (editorial
    list). The build fails if a `related` slug does not resolve. The link check fails on any
    remaining blogthedata.com link in content.
21. **Recipe PWA cutover.** The kill-switch SWs are served on the old host at
    `/recipe-service-worker.js` and
    `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js` with 200,
    `application/javascript` and no-cache. They:
    1. skipWaiting and claim;
    2. delete the `recipe-*` caches;
    3. unregister;
    4. navigate each client to its mapped jsolly URL.

    Keep them for as long as the redirect host lives. Drop the 2 PWA tests that `git archive` an
    awesome-blog SHA and add a two-origin kill-switch test.
22. **Smoke.** Extend DST's `production-smoke-scenario.mjs` with:
    - a `/blog/` post;
    - `/recipes/` hydration (the runner blocks SWs);
    - the feed content-type.

    Add a separate `scripts/verify-blogthedata-cutover.mjs` (`redirect: 'manual'`) run against
    production over every map row. Do not edit the fleet smoke runner template.
23. **Sitemap and robots.** The sitemap integration filters `/blog/search/`, 404 and 500, and
    serializes lastmod for posts. Include the `/recipes/` pages (**JOHN**, minor). Add
    `Disallow: /blog/search/` to robots.txt.
24. **Integration strategy.**
    - **Phase A.** Behavior-neutral prerequisite PRs to `main` via /ship:
      - the process-html hydration fix;
      - the middleware exemptions;
      - the header img-src host;
      - the test-runner and `test:built` structure;
      - the deps override;
      - the `legacy/blogthedata` redirect project with its map, generator and tests. It is
        inert until John re-points Vercel.
    - **Phase B.** The port lands on integration branch `port/awesome-blog` from `origin/main`.
      Each step is one gate-green commit, reviewed as PRs into the integration branch or as one
      reviewed series. The final PR to `main` is cutover step C1.
    - **Pre-C1 verification.** Local build plus optionally the opt-in `/preview` workflow; John
      authorizes the `/preview` comment.
    - **Phase C.** Every step needs John's explicit approval:
      1. **C0.** Freeze awesome-blog (no merges). Re-sync content and recipes from the freeze
         SHA. Regenerate the URL map from the freeze build.
      2. **C1.** Merge the port PR, so `/blog` and `/recipes` go live. Run DST production
         smoke. The duplicate-content window lasts until C2, so keep C1 and C2 close together.
      3. **C2.** Re-point the `blogthedata` Vercel project to `legacy/blogthedata`, which also
         disconnects awesome-blog so later awesome-blog merges cannot redeploy the full blog.
         Run the verifier over the full map. Then deploy the kill-switch and run the browser
         check.
      4. **C3.** Search Console Change of Address and Bing site move (John), and submit the
         jsolly sitemap.
      5. **C4.** Final awesome-blog README PR pointing to jsolly.com/blog, through /ship in
         awesome-blog after C2 so it cannot redeploy. Close the Dependabot PRs #696, #695 and
         #680. John sets the repo homepage and description and runs `gh repo archive
         jsolly/awesome-blog` himself, since archive is a repo setting and John's step-up.
    - **Rollback.** C1: revert the merge, or use Vercel's previous-deployment rollback. C2:
      reconnect the `blogthedata` project to awesome-blog `main` and redeploy, which is possible
      only before the archive.
25. **Retention and ops.**
    - Keep blogthedata.com registered and renewed indefinitely (John to confirm the registrar
      and expiry), along with the TXT verification record, the `blogthedata` Vercel project and
      the S3/CloudFront media.
    - Do not delete the local awesome-blog checkout: it holds the private `.migration-work`
      receipts.
    - The stale worktrees (`.claude/worktrees/magical-kepler-56e859`,
      `~/.local/share/blogthedata-migration/.../bash-floor`) are John's call.
    - After C4, update AGENTS.md and README in jsolly-website to describe the blog, recipes,
      PagesCMS, `legacy/blogthedata` and the runtime media dependency.

## Amendments after advisor review (these override the positions above where they conflict)

A1. **Phase A is only what is genuinely neutral on main.** Each item is its own /ship PR, and squash produces one commit on main:
  - (a) the process-html hydration-safe minify fix plus the Playwright node-reuse test. The test is the arbiter: the dst-conflicts and spike reports disagree on whether `conservativeCollapse` alone preserves hydration, and only the node-reuse result settles it.
  - (b) middleware exemptions, unit-tested by calling `agentResponse`/`shouldNegotiate` directly. Also fix the adjacent live bug where unlisted static extensions such as `.avif` get 406.
  - (c) header `img-src` adds the CloudFront host, with a built-csp test update.
  - (d) a test-runner restructure: an `npm test` glob that accepts `.mjs` unit suites, and an empty-safe `test:built` step after build in the gate and CI.
  - (e) the `legacy/blogthedata` redirect project, with:
    - the generated `vercel.json`, the kill-switch files, robots, security.txt and 404;
    - the generator `--check`;
    - a compile test with `@vercel/routing-utils`;
    - the knip entry/ignore for `legacy/blogthedata/**`.

    Its destination-existence test (every jsolly.com destination path exists in the built dist) lands in Phase B, once `/blog` and `/recipes` exist. The `legacy` project is inert until John re-points Vercel.

  The `"$yaml"` override and **all dependency additions move to Phase B**, together with the code that uses them. Otherwise knip fails.

A2. **Merge method is squash-only.** Verified: `allow_squash_merge` only; the main ruleset has `required_linear_history`, `allowed_merge_methods: [squash]` and required check `ci`. Consequences:
  - Phase B is a series of small PRs, one step each, squash-merged into integration branch `port/awesome-blog`. That gives one commit per step on that branch. CI runs because the `pull_request` trigger has no branch filter.
  - The final integration PR to main squashes into ONE commit on main. Before merging it, tag the integration head (e.g. `port-awesome-blog-steps`) so the per-step history survives `--delete-branch`.
  - **JOHN** decision: accept the single squashed commit on main (recommended, fleet norm), or temporarily allow rebase-merge for that one PR (a ruleset change, John's step-up).
  - /ship merges into a non-main base have no required check, so merge only on a green `ci` per git-discipline → "Merge a same-repo self PR".

A3. **Two Vercel projects on one repo (C2 risks).**
  - **Smoke trigger.** jsolly-website's `production-smoke.yml` fires on `deployment_status` with `environment == 'Production'`. Once the `blogthedata` project is connected to jsolly-website, Vercel may (a) send that project's deployment events to this repo and (b) rename environments per project, e.g. "Production – jsolly-website". The agent token cannot list deployments (403).
    - C2 must observe the actual environment names, either through John's `gh api repos/jsolly/jsolly-website/deployments --jq '.[].environment' | sort -u` or from the Actions run list.
    - It must then make the smoke filter match only the jsolly project's production environment, preferably via a repo variable as awesome-blog's workflow does with `VERCEL_PRODUCTION_ENVIRONMENT`. A Phase A PR should prepare the variable-driven filter so the C2 change is a variable, not code.
    - Verify /ship's release gate still finds the jsolly smoke run.
  - **Deployment Protection** is enabled on `blogthedata`, so staged deployment URLs return 401 to plain curl. Probe staged deployments with John-run `vercel curl` or the read-only Vercel MCP `web_fetch_vercel_url`. The verifier always uses `redirect: 'manual'`.
  - **Project settings.** The project is currently Astro / Node 24 / `npm ci`. `legacy/blogthedata/vercel.json` must explicitly set framework null, an empty install command, an empty or no-op build command and output directory `.`, or the first deploy runs `npm ci` with no package.json. Write this into the step; the staged deploy is the check.
  - **Rollback window.** On Hobby, Instant Rollback reaches only the previous deployment, and every jsolly-website merge redeploys the legacy project. Hold all jsolly-website merges from C2 promotion until full-map verification completes, or the full-blog rollback target disappears. An optional `ignoreCommand` (skip unless `legacy/blogthedata` changed) must be validated against Vercel's clone depth before relying on it.

A4. **The kill-switch SW has no URL mapping.** Standard pattern:
  1. `install` → `skipWaiting()`.
  2. `activate` → `clients.claim()`, delete all caches (or the `recipe-*` caches), then `self.registration.unregister()`.
  3. For each window client, call `client.navigate(client.url)`.

  The same-origin reload bypasses the uninstalled worker and hits the 301, so the URL map stays the single source of truth.

A5. **Freeze timing.**
  - Code freeze on awesome-blog starts at the port-branch cut, the SHA recorded in the plan.
  - Content-only changes (`src/content/posts/**`, `src/content/categories/**`, `src/components/recipes/recipes.json`, `nutrition-data.json`, `public/media/**`) are allowed until C0 and carried over by a mechanical re-sync script.
  - A check fails on any non-content diff in awesome-blog since the cut SHA.

A6. **New JOHN decision: license and visibility.** Blog source moves from a public MIT repo (29 stars, 11 forks) into private jsolly-website. The archive stays public. New posts' source becomes private.
  - Options: accept (recommended; the site content is public anyway), make jsolly-website public, or keep content public some other way.
  - Also decide the LICENSE text for the ported code in jsolly-website.

A7. **llms.txt promise.** `public/llms.txt` promises an HTTP 404 with a Markdown recovery body for missing paths requested as Markdown.
  - A blanket `/blog/**` exemption would break that promise for `/blog/nonexistent/`. Preferred approach: route-existence awareness. Middleware passes through only real `/blog` and `/recipes` routes, via a build-time route manifest, and keeps the Markdown 404 for unknown paths.
  - Feasibility (whether Vercel bundles `middleware.ts` after the Astro build so a generated manifest exists) is UNVERIFIED and must be proven in the Phase A middleware PR.
  - Fallback: blanket exemption plus an llms.txt wording change. llms.txt itself is updated in Phase B to list the blog, recipes, feeds and Markdown status.

A8. **Review lenses for the plan.** The plan is reviewed by:
  - (1) missed URLs, including the mechanical union check;
  - (2) missed scripts and tests;
  - (3) CSP and build breakage;
  - (4) sequencing and operations: A1–A5, approvals, rollback, John-only steps;
  - (5) completeness against John's 5 required sections.
