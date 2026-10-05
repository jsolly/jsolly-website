# Review disposition

Disposition of every finding from the five review lenses (missed-urls, missed-scripts-tests, csp-build, sequencing-ops, completeness) against the plan (then in session scratch; now `plan.md` in this bundle), the URL map and its generator. Each finding was re-checked against primary evidence before it was accepted. Round 1 had **68** findings (MU 7, MST 16, CSPB 9, SEQ 18, COMP 18); earlier text that said 66 was a miscount (F-19). The pre-revision copies were kept only in session scratch and are not part of this bundle; `out/round1-id-map.json` maps every pre-revision URL-map row id to its current id. Rows marked **Superseded in round 2** describe the round-1 fix; the Round 2 section at the end describes the plan as it now stands.

Outcomes:
- **Accepted:** the finding is correct and the plan, map or generator changed.
- **Accepted with correction:** the finding is right in substance, but part of its premise or its fix was adjusted on evidence.
- **Rejected:** none. No finding was contradicted by primary evidence.

Duplicates share one fix and are cross-referenced:
- MU-1 / COMP-17
- MU-2 / COMP-03
- MST-11 / SEQ-15 / COMP-07 (the expiry part)
- SEQ-01 / COMP-11
- SEQ-06 / COMP-09
- SEQ-12 / COMP-10
- MST-07 / SEQ-10 / CSPB-6 / MST-13 (route manifest and PA3 proof)

## Mechanical results after the fixes

**`node out/build-url-map.mjs`** (exit 0):
- |U| = **901**: 885 paths, 15 Django templates and 1 host-scope element.
- Matched: 443 exact, 442 by pattern, 15 templates.
- **UNMATCHED 0, AMBIGUOUS 0.**
- Rows: 305 (212 redirect-301, 5 serve-200, 88 stays-404); 287 exact and 18 patterns; 212 vercel.json redirect entries.
- Destinations: 202 paths, all inside the 220-path expected layout.
- Served-today ledger: 407 paths are served 200 today. 57 of them become 404 deliberately: 55 `/_astro/*`, `/release.json` and `/search-index.json`. Any other 200→404 drop fails the generator.

**`node exp/compile-check.mjs`** (`@vercel/routing-utils` 6.6.0, exit 0):
- 215 compiled routes.
- 362 union elements get exactly one 301 with the expected Location.
- 538 elements get no redirect.
- 659 forms (slash, slashless, `/index.html`, `/index.html/`) on every exact redirect row redirect correctly.
- 8/8 near-miss negatives behave correctly.
- 26 lowercase negatives are not redirected.
- 0 elements match more than one compiled route; 0 problems.

## Findings

| Id | Outcome | What changed, or why |
| --- | --- | --- |
| MU-1 | Accepted | **Generator:** reads a new evidence file, `served-files.txt` (the 265 files of the bf1f7ff1 dist, un-normalized). The 138 `/<page>/index.html` forms (verified: dist minus union is exactly 138, all index.html) are now in U. Exact redirect rows ending in `/` emit `<base>{/index.html}?{/}?`, and the matcher models it. The old PST-091 index.html row is deleted; IDX-002 stays. **Real-compiler check:** covers all 4 forms on every page row, and confirms that `service-worker.js` and `…commitsindex.html` are not matched. **Plan:** §2.3, §2.4, 4.1 (4 forms) and 4.10 (probe set) are updated. Entry count is unchanged by the source shape. |
| MU-2 | Accepted | **Generator:** builds a pinned served-today → 404 ledger (dist file or live 200 → stays-404 row). It allows only `/_astro/:file`, `/release.json` and `/search-index.json`, and anything else fails the run. **Rows:** HSH-001, OTH-031 and SRH-002 are relabelled "SERVED 200 TODAY → deliberately 404". **Plan:** §2.2 separates "already 404" from "served today, dropped". 4.1 asserts the ledger. The 57-vs-53 discrepancy is explained: union `/_astro` = 57 (55 in the freeze dist plus 2 historical hashes that 404 today). The crawl saw 53 of the 55 at 200; the ledger is dist ∪ live-200 = 55. |
| MU-3 | Accepted | **New B06c built test:** `scripts/built/legacy-fragments.test.mjs`. Its fixture `legacy/blogthedata/fragment-ids.json` holds the non-chrome id set per old page from the freeze build, regenerated at C0. Every id must exist on the mapped page (`/blog/<slug>/`, `/recipes/<id>/`, and `/recipes/` for the recipe post plus `meal-results`). 4.3(a) now fails same-origin `#fragment` links whose target id is missing. `/recipes/` h1 gets `id="easy-meals--smoothies"` (B17). |
| MU-4 | Accepted | **Generator:** the `/media/recipes/:file` and `/recipes-pwa/:file` patterns are replaced by 48 exact rows from `git ls-tree` (MED-002…MED-045, PWA-001…PWA-004). Union `/media/recipes/*` is exactly the 44 tracked files, so nothing goes unmatched. Unknown names stay 404, which the compile check verifies with negatives. Entries rise from 165 to 212 (≤ 2,048). |
| MU-5 | Accepted | Plan only. The double-slash probes (`//post/<slug>/`, `/post/<slug>//`, `//`) are added to the 4.10 verifier and run at C2 step 5. The behaviour is recorded in §2.3 as UNVERIFIED until then. If they 404, that is accepted explicitly in the served-today ledger as platform-level forms (§7.1). **Superseded in round 2 (F-12):** a 404 is decided as J28 and recorded in the ledger by a follow-up PR. |
| MU-6 | Accepted | **Map:** `/recipes/` (RCP-002) and `/blog/` (OTH-001) are now 301 opt-ins under J10. J10 lists the remaining candidates with destinations (sitemap-index, sitemap-0 and the feed probes) and recommends leaving those 404, with a flip condition. |
| MU-7 | Accepted | J8 and 4.7 reworded: keep the legacy guid **text** and add `isPermaLink="false"`, because the old URL is no longer the permalink. The live `/rss/` has no attribute (default true). Readers dedupe on guid text, which is unchanged. Recorded under "Brief positions changed by review" (brief item 6). |
| MST-01 | Accepted | Verified at `pwa.test.mjs:311-313` (the `recipeRoute` card count) and `:376` (`snapshots[0]` from `buildRecipePwa`). Placement is now: B16 has 0 ported tests (+1 hydration); B17 has 7 ported (recipes-built 1, details 2, filters 2, collections 2, with the snapshot assertion stripped); B18 has 5 ported and re-adds the snapshot assertion. Phase totals are unchanged. |
| MST-02 | Accepted with correction | `.pages.yml` confirms that categories are PagesCMS `format: json`; recipes.json is not CMS-edited. **Fix:** a `biome.jsonc` override with the formatter disabled for `src/content/blog/categories/**` only, landing in B03 (the first commit with those files). The linter stays on, so this is formatting ownership, not a rule relaxation; it is recorded as a brief item 11 clarification. B03 copies the categories in PagesCMS's shape, not Biome-formatted, so the first CMS save does not rewrite all 6 files. **New B13 test:** a category written as `JSON.stringify(x,null,2)` with no final newline passes `biome ci`. **Resync:** `import-awesome-blog --resync` Biome-formats `recipes.json`, `nutrition-data.json` and the posts `.markdownlint.json`, and that formatting is listed in C0. |
| MST-03 | Accepted | Temp copies get their own `node_modules/` directory, with every entry symlinked except `.astro` and `.vite`. `test:built` runs with `--test-concurrency=1`. B14 asserts that the real tree's `node_modules/.astro/data-store.json` mtime is unchanged (§1.7, PA1, B14). |
| MST-04 | Accepted | 4.11 gains the GET search round trip on `/blog/search/?searched=<title>`. **New automated legacy probe:** `.github/workflows/legacy-redirects.yml` (daily schedule plus dispatch) runs `verify-blogthedata-cutover.mjs --production --sample`. The sample is a mixed-case post, a category, the instant-pot → `/recipes/` row, `/rss/`, both service-worker URLs at 200, one stays-404 row, and security.txt on both hosts. It lands in a post-C2 PR (C2 step 10), so it never runs against the un-switched host. |
| MST-05 | Accepted | Verified: `infra-plan.md:18-19` skips archived repos. J9 now presents the choice, recommending (b): before C4, run and record a final `check:stack-protection` and `check:infra-drift` through the fleet helper; the C4 README and J9 say that continuous reads stop at archive. The flip goes to (a), gate C4 after 2026-11-01, or (c), hand off to shared-infra. §7.2 lists the consequence. **Superseded in round 2 (CON-17, F-14):** the plan's J9 labels the recommendation "Option A, with recorded final reads"; the reads run at C4 step 1 with exact commands, not at C0; the 2026-11-01 reminder is created at plan approval. |
| MST-06 | Accepted | **B01 adds `scripts/unit/port-tooling.test.mjs`** with 6 tests: idempotence; receipt and `url-map.json` immunity; url-map-sync never removes rows and skips drafts; freeze-check exit codes; the import path map including `.markdownlint.json`; and code spans and blocks byte-identical (COMP-04). These tests are deleted with `scripts/port/` at C0, and the ledger states both points. |
| MST-07 | Accepted | The route manifest includes only posts whose parsed frontmatter has `draft === false`, using the same `parsePost`. The B14 draft scenario asserts that the sentinel slug is absent from the generated manifest. |
| MST-08 | Accepted | The temp copy is defined as the `git ls-files -co --exclude-standard` set plus the MST-03 node_modules dir. `build:maintenance` becomes `MAINTENANCE_MODE=true npm run build` in PA3, so it can never drift from `build`. |
| MST-09 | Accepted | B23 adds `"!docs/recipes-evidence"` to Biome `files.includes`, keeping provenance bytes verbatim. The `.py` file is kept as an inert artifact; nothing runs it. |
| MST-10 | Accepted | **PA1 adds `scripts/run-tests.mjs`,** a wrapper for `npm test` and `test:built` that parses the node:test summary and fails when the count is below `scripts/test-counts.json`. Each step updates that ledger file, so a glob typo can no longer pass silently. +1 unit test. |
| MST-11 | Accepted | The gate keeps only hermetic checks: RFC 9116 syntax, and Expires ≤ 400 days out (that check cannot start failing as time passes). **Superseded in round 2 (CON-14):** the bound is < 365 days after the commit date everywhere. The "Expires is in the future, with 30 days' warning" check moves to the daily `legacy-redirects.yml` workflow (MST-04) for both hosts. A recurring Todoist task is added (COMP-07). |
| MST-12 | Accepted | **B08:** "all published legacy URLs exist…" re-sources from the post and category rows of `legacy/blogthedata/url-map.json` instead of `migration-receipt.json`. **B14:** inlines `serializePost` (`yaml` stringify `lineWidth: 0`, `version: '1.1'`), and `content-files.mjs` is listed. |
| MST-13 | Accepted | Merged into the PA3 proof rewrite (CSPB-6). The scratch clone uses a hand-written `.vercel/project.json` (projectId, orgId, settings framework astro / buildCommand `npm run build` / outputDirectory `dist`). It never uses `vercel link` or `vercel pull`, and never John's token. |
| MST-14 | Accepted | B18 deletes the `PWA_SCREENSHOTS` branch. `visual-compare.mjs` writes under `os.tmpdir()`. |
| MST-15 | Accepted | The §1.2 rationale is corrected. DST has no `svelte.config.js`, and none is needed: @astrojs/svelte 9 applies no default preprocess, Svelte 5 strips TS natively, and no SRC component uses `<style lang>` or `@apply`. B02 records that build and svelte-check pass without it. |
| MST-16 | Accepted | Verified: DST `lint-md.sh` falls back to `markdownlint-cli2@0.22.1` while package.json has `^0.23.2`. Added to §7.2 as an `/optimize-workspaces` drift item, a separate PR outside this port. |
| CSPB-1 | Accepted | Verified at SRC `ui.css:5-7`. B06b rewrites the `@source` lines to `../../lib/components/ui`, `../../components/blog/BlogNavigation.svelte` and `../../components/blog/Search.svelte`. **New B06c built test** `blog-css-sources`: every `@source` path in `src/styles/**/*.css` exists, and the BlogLayout bundle contains a pinned selector sample (`data-checked\:bg-primary`, `file\:text-foreground`, nav menu classes). Search.svelte lands in B09, so its `@source` line is added in B09 (Tailwind tolerates a missing path, but the existence test would not). |
| CSPB-2 | Accepted | B06c guards fail-closed: `if (!Astro.csp) throw new Error(...)` before `insertDirective`. `check:ts` covers it. |
| CSPB-3 | Accepted | B05: `z.config({ jitless: true })` in `src/lib/blog/search.ts` before any schema runs (this fixes a live violation on blogthedata.com today). The 4.4(c) page list gains `/blog/search/?searched=django`, `/recipes/` and one recipe detail page. |
| CSPB-4 | Accepted | 4.5's pass bar is now parity: per-page reuse in the processed build equals reuse in the same build before process-html (raw dist saved first). The 100% bar is kept only for `/`, `/about/`, `/blog/` and `/recipes/meals/`. |
| CSPB-5 | Accepted | PA5's proof is now a selector-set diff: exactly `.visible .fixed .contents .inline` are removed, each shown unused by `git grep`. It adds `@source not` for `../components/blog`, `../components/recipes`, `../pages/blog`, `../pages/recipes`, `../lib/blog` and `../lib/components/ui`, plus a file-level `@source "../lib/components/ui/button.svelte"`. **New PA5 built test** pins DST's Layout selector set across Phase B. |
| CSPB-6 | Accepted | **PA3 proof rewritten.** (a) The vercel build log shows `routes` running before the middleware compile. (b) `.vercel/output/functions/middleware.func/src/generated/route-manifest.js` exists and equals the built route list. The manifest is a JS module, `src/generated/route-manifest.js`, which is gitignored and ignored by Biome and knip. `npm test`, `check:ts`, `build` and `worktree:init` run `npm run routes` first. The edge-runtime deprecation warning is recorded as known (§7.1). |
| CSPB-7 | Accepted | PA2 candidate 1 adds `/^\$/u` and `/^astro:end$/u` to `ignoreCustomComments`. **New PA2 built test:** the set of comment kinds `[`, `]`, empty, `$` and `astro:end` in island markup is unchanged by process-html. |
| CSPB-8 | Accepted | PA4 adds `form-action 'self'` to the DST header, and the exact-token test asserts it. |
| CSPB-9 | Accepted (plausible) | `pwa-build` emits no worker when `MAINTENANCE_MODE=true`. B18 adds an assertion to the maintenance test that there is no `dist/recipes/service-worker.js`. `build:maintenance` is `npm run build` under the env (MST-08), so it runs the same chain. |
| SEQ-01 | Accepted | Now a **hard cross-repo prerequisite, X1**, gated before C0, because the C1→C2 window is capped at 24 h. It needs a new template substitution point for the deployment-host prefix; fleet adoption beyond jsolly-website is John's rollout. The dotagents `templates/github/production-smoke.yml` gates on `deployment_status.environment_url` starting with `https://jsolly-website-` and accepts `Production` or `Production – jsolly-website`. It also adopts SRC's hardening: `vercel[bot]` creator and the ancestor-of-main check (COMP-05(b)). `skills/ship/references/deploy-verify.md` stops taking a bare `.[0]`. The change is synced to jsolly-website. John authorizes it as a separate dotagents session; this plan does not make it. In C2, a trivial jsolly-website merge with auto-assign still off must show exactly one jsolly smoke run and none for the blogthedata deployment. §7.2 is no longer "none required", and §7.4#4 is rewritten. |
| SEQ-02 | Accepted | The final `port/awesome-blog → main` PR is opened as a draft at B00. Syncs are real merge commits (`git merge origin/main`) through that PR's `/ship` Babysit step 3, never squash sync PRs. **Superseded in round 2 (CON-10, EX-04, EX-05):** the draft opens after B01 (a zero-commit head cannot form a PR), and syncs run at fixed points as merge commits pushed directly to the port branch, not through Babysit step 3, which fires only on conflict. Before C1, the head must contain the current `origin/main` with green `ci`, and main merges freeze from that sync. The tag is pushed once, at the final head, right before the C1 squash. |
| SEQ-03 | Accepted | C2 step 2 no longer sets dashboard Framework, Install, Build or Output overrides; `legacy/blogthedata/vercel.json` carries them. John changes only the Root Directory and Git. Rollback path 2 is written out as exact dashboard steps, and the current awesome-blog production deployment ID is recorded before step 3 with a read-only Vercel MCP `list_deployments`. |
| SEQ-04 | Accepted (plausible) | Auto-assign on `blogthedata` stays off through a soak: C3 plus 14 days of Vercel 404 and Search Console review. **Superseded in round 2 (CON-17):** the hold lifts at C2 step 8.5, after the step 8 discrimination probe and the dialog check. Round-1 text: the jsolly-website merge hold lifts after C2 step 7, once John has opened the Instant Rollback dialog and confirmed it still offers the awesome-blog deployment. Re-enabling auto-assign is a John-approved step at the end of the soak. The dialog check runs after the C2 step 8 trivial merge, so it observes the case it is meant to test. §3.1 "Editing redirects later" now says a soak-period edit is promoted by hand after a staged verification. |
| SEQ-05 | Accepted | **New rollback ordering rule:** once C2 is promoted, C2 rolls back before C1. After an Instant Rollback, John uses "Undo Rollback" once the fix lands. Phase A PRs roll back by `/ship` revert PR. |
| SEQ-06 | Accepted | Merged with COMP-09. The C4 PR also rewrites awesome-blog's AGENTS.md "Ship and release" section to say: no deploy; the Vercel project is re-pointed to `jsolly-website/legacy/blogthedata`; `deploy: none`; do not reconnect. It adds pointer banners to `docs/publishing.md` and `docs/recipes.md`. Its `/ship` records `deploy: none`, the PR body says not to dispatch the Production smoke, and the README date wording is refreshed if C4 lands after 2026-11-01. |
| SEQ-07 | Accepted | Phase B conventions: `review-diff.sh "$CHECKOUT" origin/port/awesome-blog`; the merge check runs against base `port/awesome-blog` and auto-merge is never armed; each step records `deploy: none (non-default base)`; `follow-production-smoke` never runs for a port SHA. |
| SEQ-08 | Accepted | New "Decision gates per step" table: PA3–J11, PA4–J6, PA6–J1/J2/J5/J10/J14/J15, B00–J3/J4, B05–J19, B10–J8, B12–J14, B17–J13, B19–J18, B23–J7/J17, C1–J20. Each PR body cites the answered decision. |
| SEQ-09 | Accepted | **C0, before the re-sync:** list open non-Dependabot PRs and branches plus armed auto-merges in awesome-blog; merge or abandon each, and disarm any arm. John removes awesome-blog from the PagesCMS App selection. **After C1:** John grants jsolly-website, then rehearses on a throwaway editorial branch from main (save, reopen, image upload to `public/blog/media`, PR closed unmerged). The grant is never made while `port/awesome-blog` exists. |
| SEQ-10 | Accepted | Merged with MST-07 and CSPB-6. A dynamic route expands only when its page template exists (`src/pages/blog/[slug]/index.astro`, `src/pages/recipes/[slug].astro`), so B03 and B15 stay green. Notes added to B03 and B15. |
| SEQ-11 | Accepted | The agent MCP spot-check is removed from C2 step 5. Staged verification is John-only, through `vercel curl` with `-sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-redirs 0`. John revokes any automation-bypass secret it created, after step 7. Brief A3's "read-only MCP" wording is corrected under "Brief positions changed by review". |
| SEQ-12 | Accepted | Merged with COMP-10. At B00, John confirms the freeze. A Todoist task records that awesome-blog is code-frozen and excluded from drains until C4. A one-line freeze notice is added to awesome-blog's AGENTS.md by a docs PR that merges before the cut SHA is recorded. Freeze-check runs in every B-step PR body. **Remedy for a non-content diff:** either a new B-step that ports it, or a revert in awesome-blog with John's OK, before the re-sync. |
| SEQ-13 | Accepted | At C4, open Dependabot PRs are listed with `gh pr list --repo jsolly/awesome-blog --author app/dependabot --state open --json number` and closed without a comment; the README carries the notice. |
| SEQ-14 | Accepted | C3 preconditions: John confirms both domains are verified in Bing (GSC import or DNS CNAME), and confirms registrar, auto-renew and expiry ≥ 1 year out. |
| SEQ-15 | Accepted | Merged with MST-11. |
| SEQ-16 | Accepted | B22 depends on B09, B10, B11, B12, B18, B19 and B04. The conventions also say Phase B lands strictly in numeric order. |
| SEQ-17 | Accepted | If PA3's fallback is taken, PA3 itself ships the llms.txt wording change. The feasibility build uses a hand-written `.vercel/project.json` only. |
| SEQ-18 | Accepted | The C1→C2 window is capped at 24 h. John's C2 dashboard session is pre-scheduled with the C1 merge. If C2 cannot start in time, John decides explicitly whether to revert C1 or accept the delay. |
| COMP-01 | Accepted | **PA6 commits:** `legacy/blogthedata/url-map.json` (the hand-edited source of truth from PA6 on; `build-url-map.mjs` retires); `url-union.json`, now carrying evidence tags, hosts, sample queries and `served_today` per path; and `fragment-ids.json` (B06c). **PA1 commits** this plan as `docs/blogthedata-merge-plan.md`; DST has no native plan location, since `git ls-files` shows no `docs/`. B23 folds it into `docs/publishing.md` and `docs/recipes.md` and deletes it. §7.3: nothing in scratch is deleted before C4. B-step file lists in §5 are the slice record, and knip in the gate is the arbiter, so `exp/import-graph.mjs` is not needed at execution time. **Superseded in round 2 (CON-02/03/04, F-01/02/04, EX-01/02/03):** PA5, not PA1, commits the whole bundle to `docs/plans/blogthedata-merge/` (DST already reserves `docs/plans/**` for archival plans); it stays on `main` until D1; nothing depends on session scratch; `exp/import-graph.mjs` is deleted. |
| COMP-02 | Accepted | §1.14 adds a per-file code-rewrite table from the `git grep` of SRC code (html.ts `imageUrl`, the content.config default, About/AuthorCard, Navigation, PostCards, Search, Base → BlogLayout, the post page, recipe-url, RecipePage, RecipeLibrary, recipes `[slug]` breadcrumbs, article-content.css `data-page` selectors, pwa-build, the manifest, sitemap, 404 and privacy). 4.3 gains (a) a scan of `src/**` and `dist/**/*.{js,json,xml,webmanifest}` for legacy root paths, (b) feed `<link>` equality to `https://www.jsolly.com/blog/<slug>/`, and (c) a B14 scenario where a CMS post with image `/blog/media/x.webp` renders same-origin. |
| COMP-03 | Accepted | Merged with MU-2. |
| COMP-04 | Accepted | Verified: `local.js` (subresource-integrity post, lines 44 and 48) and `carousel.js` (Astro migration post, line 130) sit inside `<code>`. B04 fixes only the `/password-reset/` hrefs, and the port-tooling test pins code spans and blocks as byte-identical. This overrides brief item 20 ("3 dead references") and is recorded. |
| COMP-05 | Accepted with correction | New J19–J25. (a) Only `legacyId` is in the schema; `legacyImage` and `legacyAuthorId` are already unmanaged. Recommendation: drop `legacyId` from both schemas and keep it as unmanaged frontmatter. The ported parsePost test that asserts `legacyId === 42` is adapted. (b) Fold SRC's smoke hardening into X1. (c) Stale worktrees. (d) Biome test-regex convention. (e) Require `/preview` before C1. (f) The github-actions Dependabot ecosystem stays out of scope. (g) Visual unification is a post-C4 follow-up. |
| COMP-06 | Accepted | J18 now cites the persona string "CTO, Enterprise Health, Leidos Digital" and defaults to the blog's "Enterprise Health" wording unless John says otherwise. J13 and J16 get real flip conditions. |
| COMP-07 | Accepted | **New step D0:** Todoist tasks created through `/persist-todos-in-todoist` with dates: Expires bump (recurring, Expires minus 30 days), J9 on 2026-11-01, Search Console review at C2+30 d, registrar confirmation before C3, end-of-soak auto-assign. The expiry time bomb is removed from the gate (MST-11). |
| COMP-08 | Accepted | B23 now carries AGENTS.md Purpose, Stack and Architecture, plus the blog, recipe and PagesCMS invariants (heading-fragment algorithm, case-sensitive stable slugs, CMS timestamp rules, CloudFront dependency, legacy feed ids, never removing the kill-switch). DST AGENTS.md currently says "seven pages … no CMS". D1 shrinks to post-C2 facts. This overrides brief item 25's timing and is recorded. |
| COMP-09 | Accepted | Merged with SEQ-06. |
| COMP-10 | Accepted | Merged with SEQ-12. |
| COMP-11 | Accepted | Merged with SEQ-01. |
| COMP-12 | Accepted | Verified: 15 rules are disabled. §1.13 is corrected and lists them. |
| COMP-13 | Accepted | Hook-blob approval is removed from John's action list. It is an agent action in each step (PA1, PA3, PA6, B15) for the agent's own edit. |
| COMP-14 | Accepted with correction | The finding allows recording a reason to keep the rule. Discovery (Vercel MCP, read-only) already shows the domain-level 308 on `jsolly.com`. The vercel.json host rule is kept on purpose, because it is the reviewed, versioned copy, while dashboard domain state changes without review. The reason is recorded in §1.13. |
| COMP-15 | Accepted | Posts are recomputed by `git grep`: 37 posts contain a B04 rewrite candidate (34 with absolute blogthedata URLs, minus the recipe post, plus the 3 `related` and 2 heading fixes). Posts row: move 69 (68 posts + dotfile) / adapt 37 / drop 1. Totals: move 131, adapt 142, drop 88 = 361. The B04 dry-run list is authoritative. **Superseded in round 2 (CON-07, F-15):** the instant-pot post has no blogthedata URL; the set is 34 + 3 + 2 − 2 overlaps = 37; the dotfile is `adapt`. Posts 68 / 38 / 1; totals move 130, adapt 143, drop 88, now computed by `check-inventory-coverage.mjs` itself. |
| COMP-16 | Accepted | §2.2 now states there are no tag or author URLs; categories are the only taxonomy. |
| COMP-17 | Accepted | Merged with MU-1. A pattern row was not needed: each page row's source covers its own index.html form, so unknown slugs still 404. |
| COMP-18 | Accepted | B06 is split into B06a (process-html id-skip plus id-ownership test), B06b (blog CSS in `@layer blog`, unimported, Biome-conformant, `@source` re-pathed) and B06c (BlogLayout, nav, `ui/input`, works-cited route, CSP, maintenance, fragments, CSS sources). B16 and B17 are not split: knip forces each component to land with its first importing page, and the styles import only from those pages. |

## Round 2

Three lenses (consistency, fix-landing, executability) reviewed the revised plan. Their 56 findings (CON 20, F 23, EX 13) are below. Each was re-checked against primary evidence before acceptance. **Rejected: none.** Four were accepted with a different fix than proposed, as noted.

### Mechanical results after the round-2 fixes

- `node out/build-url-map.mjs` (exit 0): |U| 901, UNMATCHED 0, AMBIGUOUS 0, structural failures 0; rows 305 (212 / 5 / 88); served-today ledger 57. The SRC ref now defaults to the pinned bf1f7ff1. Row ids are unchanged (0 of 305) after adding `decision_ref` J27 to HSH-001, OTH-031 and SRH-002 and J10 to the six J10 candidate rows.
- `ROUTING_UTILS_DIR=<dir> node exp/compile-check.mjs` (exit 0): 215 routes; 362 / 538 / 659; 8/8 near-misses; 26 lowercase negatives; 0 multi-match; `problems: 0`. Output byte-identical to the round-1 `compile-check.txt`. Unset or missing `ROUTING_UTILS_DIR` exits 2 with the install command.
- `node out/check-inventory-coverage.mjs` (exit 0): tracked 361, resolved 361, missing 0, unresolved 0, multi-listed 53, dead entries 0; move 130, adapt 143, drop 88; post reclassification 34 + 3 + 2 − 2 = 37.
- Bundle placement, measured in a scratch clone of main 5694e76 with PA5's `main.css` and the bundle at `docs/plans/blogthedata-merge/`: Layout CSS 45,779 → 45,679 B, removed exactly `.visible`, `.fixed`, `.contents`, `.inline`, none added; `biome ci . --error-on-warnings` clean with `"!docs/plans"`; knip 6.37.0 exit 0 with `"ignore": ["docs/plans/**"]` (and "Remove from ignore", exit 1, once no `.mjs` remains); markdownlint 0 issues (`docs/plans/**` already ignored).
- `plan.md` passes DST markdownlint on its own (`markdownlint-cli2 docs/blogthedata-merge/plan.md`: 0 issues).
- Vercel MCP `get_project jsolly-website` (read-only): `ssoProtection` enabled, `all_except_custom_domains`.

### Findings

| Id | Outcome | What changed, or why |
| --- | --- | --- |
| CON-01 | Accepted | `plan.md` is lint-clean under DST config (MD032 auto-fixed, JSON fence re-indented with spaces, bare hosts backticked). It is also committed under `docs/plans/`, which DST's markdownlint already ignores. |
| CON-02 | Accepted with a different fix | Option (a) variant: the plan bundle is committed in **PA5** itself, which lands right after PA1, so `source(none)` and the docs arrive together and PA5's 4-selector proof holds. Re-measured with the bundle present. |
| CON-03 | Accepted | B23 no longer deletes the plan; it stays on `main` until D1, which deletes `docs/plans/blogthedata-merge/`. |
| CON-04 | Accepted | One home, `docs/plans/blogthedata-merge/` (DST already reserves `docs/plans/**`; COMP-01's "no native plan location" was wrong). §1.12 lists every committed file, the Biome and knip treatment (verified), and when each file retires. |
| CON-05 | Accepted | X1 is authorized at plan approval; Actions, J21 and the gate table say so. |
| CON-06 | Accepted | The gate table is authoritative and matches the step bodies: J23 at PA1, J7 at B03 and B15, J25 at B06c, J12 at B11, J20/J21 at C0, J16 at C3, J9/J22/J26 at C4; C0 needs only decisions gated through C0. |
| CON-07 | Accepted | §1.1 derivation fixed (34 + 3 + 2 − 2 = 37; the instant-pot post has no blogthedata URL); the dotfile is `adapt`; totals 130 / 143 / 88; the coverage script now computes the reclassification. |
| CON-08 | Accepted | `compile-check.mjs` resolves the compiler from `ROUTING_UTILS_DIR`, asserts 6.6.0 and fails with the install command; `exp/import-graph.mjs` deleted. Re-run: `problems: 0`. |
| CON-09 | Accepted | Every scratch path removed from the plan and this file; Appendix B rewritten relative to the bundle; `decisions-brief.md` cited at `evidence-notes/`; `generated_by` is path-neutral. |
| CON-10 | Accepted | B00 is a setup step with no commit; the branch is created by a ref-only push; the draft final PR opens after B01. |
| CON-11 | Accepted | Every C-step block names its cwd or is cwd-independent; SHAs come from `scripts/port/source.json` and `url-map.json` `meta.freeze_sha`; runtime URLs use a guarded variable the agent fills before printing. |
| CON-12 | Accepted | B11's test is `scripts/built/blog-site-files.test.mjs` under `test:built`; the ledger (unit 80, built 48) is unchanged. |
| CON-13 | Accepted | Phase A is "port-neutral prerequisites"; PA2–PA5 are stated to change production. |
| CON-14 | Accepted | One bound everywhere: `Expires` < 365 days (after the commit date in the hermetic test). |
| CON-15 | Accepted | 4.10 probes `/index.html/` too and derives the served `index.html` set from `url-union.json` (140 today). |
| CON-16 | Accepted | §3.1 lists all three dashboard changes; Root Directory is always under Settings → Build and Deployment. |
| CON-17 | Accepted | SEQ-04, MU-5, MST-05 (and MST-11, SEQ-02, COMP-01, COMP-15) are marked superseded; the coverage override note is rewritten and regenerated. |
| CON-18 | Accepted | §1.12 lists the four adapt docs including `README.md`, which B23 adapts into a DST README section. |
| CON-19 | Accepted | 4.4(c) adds search "from B09"; the rule table is labelled top 18 with an "other … 56" row. |
| CON-20 | Accepted | J9 and registrar reminders at plan approval; awesome-blog work runs in John-started sessions; C1 deletes and checks the port branch before the PagesCMS grant. |
| F-01 | Accepted | Same as CON-09 and CON-04. |
| F-02 | Accepted | Same as CON-03. |
| F-03 | Accepted | Same as CON-01. |
| F-04 | Accepted | Blocked-on-John items 3 and 4 name the red local gate and the `git clean` risk; §5 forbids implementing in the primary checkout; PA5 removes the untracked copy after a `diff -r`. |
| F-05 | Accepted | PA3's manifest lists static pages only; post expansion with `parsePost` moves to B08 (with a proof step and a yaml fallback), recipes to B16/B17; the `routes` script uses the TS loader flags. |
| F-06 | Accepted | Same as EX-07; SSO protection confirmed by a read-only `get_project`. |
| F-07 | Accepted | New J27 for the 57 served-today drops; HSH-001, OTH-031, SRH-002 carry `decision_ref: "J27"`; J27 gates PA6. |
| F-08 | Accepted | Same as CON-05. |
| F-09 | Accepted | Same as CON-10. |
| F-10 | Accepted | C2 step 8.3 has a failure branch: keep the hold, record runs, John authorizes an X1 fix and sync, re-probe; meanwhile `/ship` picks the deployment by project. |
| F-11 | Accepted | C1 step 3 deletes `port/awesome-blog` (tag keeps the commits); step 5 checks it is gone before the grant. |
| F-12 | Accepted | J28: a double-slash 404 is recorded in the ledger by a follow-up PR. |
| F-13 | Accepted with a different fix | No J row: `legacy-redirects.yml` also triggers on `deployment_status` for legacy-project deployments (candidate prefix `https://blogthedata-`, confirmed at C2 step 4), plus daily and `workflow_dispatch`. |
| F-14 | Accepted | J9 reminder at plan approval; final J9 reads at C4 step 1 with exact `gate_with_readonly_aws` commands in `/Users/johnsolly/code/awesome-blog`. |
| F-15 | Accepted | Same as CON-07. |
| F-16 | Accepted | Same as CON-13. |
| F-17 | Accepted | Same as CON-06. |
| F-18 | Accepted | Ids frozen from this revision (0 changed in round 2); `out/round1-id-map.json` maps 62 renumbered, 3 removed and 48 added rows. |
| F-19 | Accepted | Count corrected to 68 here and annotated in `evidence-notes/review-digest.md`. |
| F-20 | Accepted | 4.3(d) matches root-anchored paths only, with a regex and a negative fixture. |
| F-21 | Accepted | Same as CON-11; the Dependabot close is one pipeline. |
| F-22 | Accepted with a correction | The shared `scripts/built/temp-copy.mjs` is introduced in **PA2** (its hydration baseline build needs it), not B06c; B06c and B14 reuse it. |
| F-23 | Accepted | The six J10 candidate rows carry `decision_ref: "J10"`; J10 explains why `/rss.xml` has no row (no evidence source saw it). |
| EX-01 | Accepted | Same as CON-03. |
| EX-02 | Accepted | Same as CON-04/CON-09; the generator and coverage script default to bf1f7ff1, so they reproduce after awesome-blog `main` moves. |
| EX-03 | Accepted | §5 Conventions: every step runs in a fresh worktree with exact commands; the bundle is read by absolute path until PA5. |
| EX-04 | Accepted | Draft final PR after B01; Auto-fix off on it and on step PRs (verified `integrate.md` → Auto-fix enables it by default on private repos); C1 step 1 marks it ready. |
| EX-05 | Accepted with a caveat | Step branches come from `origin/port/awesome-blog` with flat names and never take `origin/main`; main syncs are merge commits pushed directly to the port branch at fixed points. Whether a ruleset blocks that push is UNVERIFIED (gh 401); checked at the first sync, stop and ask John if refused. |
| EX-06 | Accepted | X1 chain spelled out as John's actions with a paste-ready dotagents prompt; prefix `https://jsolly-website-` recorded as a candidate to confirm. |
| EX-07 | Accepted | J20 preview check is John-run through `--transport vercel-curl`; the 4.11 scenario is dropped from the preview (it pins production); the port-tooling deletion and last main sync now precede the preview. |
| EX-08 | Accepted | Every added CI step carries the verified-tree guard; exact YAML in §1.10. |
| EX-09 | Accepted | Same as CON-11; port commands run in a named C0 worktree. |
| EX-10 | Accepted | awesome-blog steps run in John-started sessions with cwd `/Users/johnsolly/code/awesome-blog`; the C4 PR sets `Ship profile: gate-only`. |
| EX-11 | Accepted | Answer column in the decisions table; an execution record; Todoist tasks at plan approval in the appropriate existing repo project. |
| EX-12 | Accepted | New J26 (Heroku retained through C4; retirement is John's); in the Blocked list, §7.2, the C4 README and D0. Verified in SRC `AGENTS.md` at bf1f7ff1, lines 83-85 and 124-125. |
| EX-13 | Accepted | (a) gate rows added; (b) test files named for B05, B10, B11, B17; (c) PA2 baseline via `temp-copy.mjs`; (d) Blocked list first, wording fixed; (e) John's `gh` blocks wrap a transient `gh auth login`/`logout` and are cwd-independent; (f) `vercel curl` gets `--scope jsollys-projects` and a temp `--cwd` (UNVERIFIED flags); (g) the C2 workflow PR is the discrimination probe; (h) C0 step 1 lists issues and notes the outbound-identity rule. |
