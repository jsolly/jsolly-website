# Merge awesome-blog (blogthedata.com) into jsolly-website (jsolly.com)

**What this is.** The implementation plan for moving the blog and the recipes from `jsolly/awesome-blog` (blogthedata.com) into `jsolly/jsolly-website` (jsolly.com). It covers the inventory, the URL map, where the redirects live, verification, the ordered steps and the cutover. It was revised on 2026-10-04 after two adversarial review rounds; every finding and its outcome is in `out/review-disposition.md`.

**Status: APPROVED 2026-10-04 — Phase A done, Phase B in progress.** John approved the plan with every recommended answer J1–J28 (Answer column). Implementation runs with Opus 5.5 at High effort, one agent per step in its own worktree. Phase A landed on `main` as jsolly/jsolly-website#58–#63. John confirmed the awesome-blog code freeze on 2026-10-05; its freeze notice is jsolly/awesome-blog#701, and the freeze Todoist task is 6hh3pQ7FH5Qq5388. Phase B lands on `port/awesome-blog`, which nothing deploys. The plan-approval Todoist tasks exist: X1 6hgwXGgwGFQ8pgrx, J16 6hgwXGj5x4vmXRjQ, J9 6hgwXGfJ9xrqgGH8.

- **Source:** `jsolly/awesome-blog` `origin/main` at `bf1f7ff1cb92faacfdc3b98ba17fb2f93cac59b5`. That SHA is live in production: `/release.json` reports it.
- **Destination:** `jsolly/jsolly-website` `origin/main` at `5694e7680a3ec2f67b035181dc1e6ab9a9ed034b`.
- **Where this plan lives.** Paths under `out/`, `exp/` and `evidence-notes/`, and the root input files (`urls-*.json`, `sitemap-locs.txt`, `served-files.txt`, `inventory-*.json`), are relative to the plan bundle; every other path is relative to the repository it names, jsolly-website by default. Until PA5 merges, the bundle is untracked at `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/`; PA5 commits it to `docs/plans/blogthedata-merge/` in jsolly-website (§1.12). Session scratch under `/private/tmp` is not part of the plan and nothing depends on it.
- **Brief.** The plan follows `evidence-notes/decisions-brief.md` and its amendments, cited as "brief A1"–"brief A8". Phase A steps are named PA1–PA6 so they cannot be confused with those amendments.

## Blocked on John / leftovers

Nothing below is done. Each item names who acts.

1. **Approve the plan, then answer the decisions gating the next step** (table below; first batch: J23 for PA1, J11 for PA3, J6 for PA4, J1/J2/J5/J10/J14/J15/J27 for PA6). Answers go in the Answer column: before PA5 they are edited in place in the untracked bundle (no PR is possible yet), and PA5 commits them; after PA5, by a docs-only `/ship` PR.
2. **Authorize X1 now, at plan approval** (cross-repo, dotagents). It must be merged in dotagents *and* synced into jsolly-website before C0, and the sync needs an idle dotagents plus a fleet rollout lead that only you start. The paste-ready session prompt is in §6 X1.
3. **The bundle lives outside jsolly-website on purpose.** Inside jsolly-website's working tree it turned the local gate red (Biome 35 errors, knip 3 unused files, markdownlint 1,000 issues in the evidence files) and added 7 Tailwind selectors to a local build. So it sits in awesome-blog's gitignored, retained `.migration-work/`, which neither repo's gate or Tailwind scan reads. An empty `/Users/johnsolly/code/jsolly-website/docs/` directory was left behind by the move; git and the tools ignore it, and you can `rmdir` it. After PA5 merges, the agent removes the untracked copy with your OK.
4. **Do not delete or clean `/Users/johnsolly/code/awesome-blog/.migration-work/` before PA5 merges.** Until then `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/` is the only durable copy of this plan and its evidence (that directory also holds the private migration receipts, which awesome-blog's AGENTS.md already says to keep).
5. **Todoist tasks to create at plan approval** (agent, via `/persist-todos-in-todoist`, in the appropriate existing repo project, which the skill verifies before writing): the decision batch, X1 authorization and the fleet-rollout start, the J9 revisit due 2026-11-01, and the registrar check (J16). None exist yet.
6. **Retained resources nobody will watch after the archive:** the AWS stack `blogthedata-migration-backups` (J9) and Heroku release v315 with its database and media (J26).
7. **Verified earlier in the planning session, while `gh` still authenticated:** jsolly-website allows squash merges only (`allow_squash_merge` true, rebase and merge-commit false). Its `main` ruleset has `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request` with `allowed_merge_methods: [squash]`, and required check `ci`. awesome-blog had 3 open PRs, all Dependabot (#696, #695, #680), and issues disabled. **Still unverified, because the agent token then started returning 401** (`Bad credentials`, in the review shells and in the orchestrator's own shell at the end of planning):
   - the `main` ruleset's target and `conditions.ref_name`. If it covers `~ALL` or `port/*`, the merge-commit main syncs into `port/awesome-blog` (§5) are rejected, and Phase B needs another sync strategy. Read it before B00 with `gh api repos/jsolly/jsolly-website/rulesets/24115660 --jq '{target, enforcement, conditions}'`;
   - `delete_branch_on_merge`;
   - the current open awesome-blog PRs and issues (C0 step 1);
   - the real `deployment_status.environment_url` prefix (X1).

   Each is checked at the step that needs it. The 401 itself needs John: the agent `GH_AGENT_TOKEN` appears expired or revoked.
8. **Cross-repo work in awesome-blog** (the B00 freeze notice and the C4 archive PR) runs only in sessions you start or authorize at that step, with cwd `/Users/johnsolly/code/awesome-blog` (§5).

## Live jsolly.com bugs found along the way

These exist in production today, independent of the merge. Their fixes are worth shipping even if the merge is never approved.

- **Islands re-render instead of hydrating.** `process-html.mjs` (`removeComments`, `collapseWhitespace`) strips Svelte's hydration markers, so the nav island throws away its server-rendered DOM on every page: 0 of 16 nodes reused on `/about/` (§1.13). PA2 fixes this.
- **406 on unlisted static extensions.** The middleware returns 406 for, e.g., `.avif` requested with `Accept: application/json` (§1.13 item 4). PA3 fixes this.

## Cross-repo prerequisite X1

Before C0, the production-smoke workflow and `/ship`'s deployment lookup must learn to tell the two Vercel projects apart, because after C2 the legacy project `blogthedata` deploys from jsolly-website too. That change is canon in **dotagents**, not in this repo, so this plan cannot make it. You authorize a separate dotagents session at plan approval; it ships X1 there; you start the fleet rollout lead once dotagents is idle; C0 waits for that rollout's jsolly-website PR to merge. Detail and the session prompt: §6 X1.

## Decisions for John

Nothing runs until the decisions gating that step are answered (see "Decision gates per step" below). The ids J1–J28 are referenced by URL-map rows (`decision_ref`) and by the steps.

| Id | Question | Recommendation | What would flip it | Answer |
| --- | --- | --- | --- | --- |
| J1 | Where do the redirects live? | **Option A′** (brief item 1). Keep the Vercel project `blogthedata` and re-point its Git source to jsolly-website, Root Directory `legacy/blogthedata`. It is the only option with all of: one hop for every slash and `index.html` form, a gate-tested map that survives the archive, and a kill-switch service worker served as a real file. | You want a single Vercel project and accept two hops for slashless URLs: fall back to option B. A Pro upgrade would allow Bulk Redirects, but the service-worker kill-switch would still need a deployed file. | approved 2026-10-04 (recommendation) |
| J2 | What should unmapped paths on the old host return? | **404** from a static `404.html`, with no catch-all. That avoids soft-404s and matches what those paths return today. | You want faster de-indexing via 410. On a static Vercel project that needs `routes`, and the history notes say `routes` cannot coexist with `redirects`/`headers` in vercel.json (not re-verified). | approved 2026-10-04 (recommendation) |
| J3 | Merge method (brief A2). Phase B squashes into one commit on `main`. | **Accept the single squashed commit** (fleet norm). The integration head is tagged `port-awesome-blog-steps` right before the squash, so the step commits stay reachable. | Per-step blame on `main` is worth a temporary ruleset change to allow rebase-merge for one PR. That change is yours. | approved 2026-10-04 (recommendation) |
| J4 | License and visibility (brief A6). Source moves from a public MIT repo (29 stars, 11 forks) into private jsolly-website. | **Accept.** The content is public anyway, and the archive stays public under MIT. Add no LICENSE to jsolly-website: the author check already shows only John Solly in `git log --format=%an bf1f7ff1 -- src scripts/recipes` (12 commits), so the ported code is yours. | You want new post source public. Then make jsolly-website public, or publish the content another way. | approved 2026-10-04 (recommendation) |
| J5 | Where should `/post/how-to-leverage-closed-loops/` go? Today it 308s to `/post/stop-asking-questions-to-save-time/`, which exists in no repo, export or Wayback capture. | **`/blog/how-to-ask-less-questions/`.** That post exists in SRC (`src/content/posts/how-to-ask-less-questions.md`). Row ALI-005. | You name the intended article. Fallback is `/blog/`. | approved 2026-10-04 (recommendation) |
| J6 | Post images: 213 distinct CloudFront URLs across 105 posts. | **Keep S3 bucket `blogthedata` and CloudFront `d1d7p8ufhgz4ld`** as a documented runtime dependency of jsolly.com. The response header `img-src` adds exactly that host, and the page meta adds it only on `/blog/**`. | You want no third-party image host, or plan to retire those AWS resources. Then rehost about 101 MB (1,010 objects) same-origin first. | approved 2026-10-04 (recommendation) |
| J7 | D2: recipe editorial prose that exists only in the dropped generated post (food-safety temperatures, capacity, method, leftovers). | **Archive only.** It was never rendered live: the built HTML has 0 matches, and only `search-index.json` carried it. | You consider it live content or want it indexed. Then port it to `/recipes/guide/`. | approved 2026-10-04 (recommendation) |
| J8 | Feed identity. | **Keep the legacy guid and id text for posts that predate the merge.** RSS `<guid>` text and Atom `<id>` stay the old `https://www.blogthedata.com/post/<slug>/`, and the Atom feed id is unchanged. The RSS guid gains `isPermaLink="false"`, because the old URL is no longer the permalink. The live feed has no attribute, which defaults to true. Readers dedupe on the guid text, which is unchanged. New posts get jsolly ids. | You accept up to 5 items reappearing as new for every subscriber. Or you want byte-identical guids: then omit the attribute. | approved 2026-10-04 (recommendation) |
| J9 | AWS stack `blogthedata-migration-backups` (Object Lock until 2026-11-01). The fleet infra pass skips archived repos (`infra-plan.md:18-19`), so archiving awesome-blog ends the only continuous protection and drift reads of this stack. | **Option A, with recorded final reads.** The IaC stays frozen in the archive. At C4 step 1 the agent runs `check:stack-protection` and `check:infra-drift` in `/Users/johnsolly/code/awesome-blog` through the fleet `gate_with_readonly_aws` helper (exact commands in C4) and records the results in the C4 PR. The C4 README and this row say continuous reads stop at archive. The stack keeps its own termination protection and stack policy. Revisit on 2026-11-01: a Todoist task created at plan approval (D0), so it is never born overdue. | You want continuous reads to continue. Then either gate C4 until J9 is resolved after 2026-11-01, or hand the stack to shared-infra first as a separate handoff. Retiring it is your destructive op. | approved 2026-10-04 (recommendation) |
| J10 | Legacy-URL opt-ins. | **Opt in `/recipes/` → `https://www.jsolly.com/recipes/` (RCP-002) and `/blog/` → `https://www.jsolly.com/blog/` (OTH-001).** Both 404 on the old host today, and `/recipes` even 308s into that 404. Cutover is exactly when people start guessing the new paths. **Leave the rest 404.** That covers the 5 deleted posts, `/status/`, `/portfolio/`, `/category/portfolio/`, `/resume/`, the Django routes, `/static/*`, legacy `/media/*` and `/media/post_metaimgs/*`. It also covers the crawler probes `/sitemap-index.xml` and `/sitemap-0.xml` (candidate destination `/sitemap-index.xml`) and `/atom.xml`, `/feed/`, `/feed.xml` and `/index.xml` (candidates `/blog/atom.xml` and `/blog/rss.xml`). Those six candidate rows carry `decision_ref: "J10"`. `/rss.xml` has no row: no evidence source (build, crawl, history, sitemap) ever saw it, so it simply 404s like any unknown path. | You want the purity rule "only URLs that are 200 today redirect": then revert RCP-002 and OTH-001 to 404. Or Search Console or Vercel logs show real traffic on another candidate after cutover: add a row by PR. That still works after the archive. | approved 2026-10-04 (recommendation) |
| J11 | Markdown negotiation for posts. | **Not part of this merge.** Real `/blog` and `/recipes` routes return HTML for `Accept: text/markdown`. Unknown paths keep the Markdown 404 that llms.txt promises (brief A7). Static `.md` siblings are a natural follow-up. | Agent traffic to the blog matters now. | approved 2026-10-04 (recommendation) |
| J12 | Should the sitemap list `/recipes/` pages? The old sitemap omitted them. | **Yes** (minor). | You want recipes unlisted. | approved 2026-10-04 (recommendation) |
| J13 | localStorage key `blogthedata-recipes-v2`. | **Rename it to `recipes-settings-v1` and accept that preferences reset** on the new origin. They are preferences only. | Feedback shows people relied on saved servings or starch settings. Then add a one-time import from a `?settings=` share link, still not a cross-origin migration page. | approved 2026-10-04 (recommendation) |
| J14 | Blog `/privacy/`. | **Merge** the blog statements (recipe localStorage, SW cache, CloudFront images, YouTube embeds) into jsolly `/privacy/`, and 301 the old URL there (row OTH-002). | You want a separate blog policy at `/blog/privacy/`. | approved 2026-10-04 (recommendation) |
| J15 | security.txt contact. | **`Contact: https://www.jsolly.com/contact/`** on both hosts. blogthedata.com has no MX record, so `john@blogthedata.com` cannot receive mail today, and jsolly.com publishes no email. | You want an email channel. That needs MX on a domain you control. | approved 2026-10-04 (recommendation) |
| J16 | Retention and renewal. | **Keep blogthedata.com registered and auto-renewed indefinitely.** Please confirm the registrar and expiry before C3; neither Vercel nor Cloudflare shows them. Also keep the google-site-verification TXT record, the Vercel project `blogthedata`, S3/CloudFront, and both kill-switch service workers for as long as the host lives. | After at least 2 years, Vercel logs show no human traffic and Search Console shows no impressions for blogthedata.com URLs. Then letting the domain lapse costs only backlinks. | approved 2026-10-04 (recommendation) |
| J17 | Recipe provenance (inventory decision D6). `docs/recipes.md` cites a local 172 KB evidence folder under `~/Documents/Codex/…`. | **Copy the folder into `docs/recipes-evidence/`** verbatim, excluded from Biome so provenance bytes do not change, and fix the paths (B23). The one `.py` file is kept as an inert artifact. | It holds anything you do not want in a repo. Then leave it local and drop the citation. | approved 2026-10-04 (recommendation) |
| J18 | Bio wording. The blog author card says "Enterprise Health Division CTO"; jsolly pages and llms.txt say "Health-IT Division CTO at Leidos". Your agent persona reads "CTO, Enterprise Health, Leidos Digital". | **Use the Enterprise Health wording everywhere,** matching your persona. B19 applies it unless you say otherwise. | Your current title is the jsolly wording. | approved 2026-10-04 (recommendation) |
| J19 | `legacyId` in the post and category zod schemas. Nothing renders it. `legacyImage` and `legacyAuthorId` are already unmanaged frontmatter. | **Drop `legacyId` from both schemas** (rules/code-style.md "Drop unused schema fields") and keep the values as unmanaged frontmatter. B05 adapts the ported parsePost test that asserts `legacyId === 42`. | You want redirects for the numeric `/post/<pk>/` URLs (2020-08 to 2022-02). Then keep it and generate rows from it. | approved 2026-10-04 (recommendation) |
| J20 | `/preview` before C1. Vercel-only behaviour (response headers, middleware, `.xml` Content-Type overrides) is otherwise first seen in production. | **Yes. At C0 step 8, you comment `/preview` on the final PR, then run the destinations verifier against the preview yourself** (`--transport vercel-curl`; the agent prints the exact block with the real preview URL). jsolly-website has Vercel SSO protection on every non-custom domain, so an agent fetch gets 401 and the only agent workaround, a bypass link, is ruled out (SEQ-11). The 4.11 scenario pins `https://www.jsolly.com`, so it first runs at C1 in production. Agents never comment `/preview`. | PA3's offline `vercel build` plus the header-injected browser test (4.4(c)) are judged enough. Then C1 relies on production smoke alone. | approved 2026-10-04 (recommendation) |
| J21 | Adopt awesome-blog's production-smoke hardening (`vercel[bot]` creator check, ancestor-of-main check, environment variable). | **Yes, inside X1.** Fold it into the dotagents template change that C0 needs anyway (X1), so jsolly-website stays template-conformant. | You want X1 minimal. Then do the `environment_url` discriminator only. | approved 2026-10-04 (recommendation) |
| J22 | Stale worktrees: `.claude/worktrees/magical-kepler-56e859` under awesome-blog, and `~/.local/share/blogthedata-migration/.../bash-floor`. | **Keep them until C4. Then the agent reports each one's `git status` and unpushed commits, and removes the clean ones with your OK.** | Either holds unshipped work you still want. Then ship or archive it first. | approved 2026-10-04 (recommendation) |
| J23 | Biome `useTopLevelRegex` for `.mjs` tests. DST exempts `*.test.ts`, and its stated convention is "assertion regexes belong next to the case". | **Keep the brief: hoist the regexes in `.mjs` tests and do not extend the override.** It costs nothing at runtime, and the gate stays one rule set. | You prefer DST's convention. Then PA1 extends the override glob to `*.test.mjs` (a one-line convention alignment, not a relaxation of product code). | approved 2026-10-04 (recommendation) |
| J24 | github-actions Dependabot ecosystem for jsolly-website. | **Out of scope for this merge.** It is a fleet-level choice. | `/optimize-workspaces` flags it as drift. | approved 2026-10-04 (recommendation) |
| J25 | Visual unification of BlogLayout with the portfolio layout. | **Follow-up after C4, not in this merge.** The port aims for parity with live blogthedata.com (4.9). | You want one design system at cutover. Then add a design step before C0 and re-baseline 4.9. | approved 2026-10-04 (recommendation) |
| J26 | Heroku app (release v315), its database and media. SRC `AGENTS.md` (bf1f7ff1, lines 83-85 and 124-125) keeps them for recovery "until separately authorized retirement"; nothing in this merge touches them. | **Retain unchanged through C4.** The C4 README names them as retained, and a D0 Todoist task asks you to decide retirement after the soak ends. Retirement is your destructive op. | You want them retired now: you retire them after C3, from their own runbook, outside this plan. | approved 2026-10-04 (recommendation) |
| J27 | Drop 57 URLs that return 200 today: 55 hashed `/_astro/*` files (HSH-001), `/release.json` (OTH-031) and `/search-index.json` (SRH-002). | **Accept the 404s.** Hashed assets are build artifacts referenced only by the old HTML; `release.json` was the old smoke's release proof; the search index is fetched only by the old search page, and a cross-origin redirect would fail CORS anyway. The generator and test 4.1 pin exactly this ledger. | Vercel logs or Search Console show external hits on these paths (for example hotlinked `/_astro` fonts or a scraper of the search index). Then add serve-200 copies or exact redirects by PR. | approved 2026-10-04 (recommendation) |
| J28 | Double-slash forms (`//post/<slug>/`, `/post/<slug>//`, `//`). Today the platform 308s them to the clean path; on the framework-null legacy project the result is UNVERIFIED until C2 step 5. | **If they 404, accept it and record it:** a follow-up PR adds the probed forms to `url-union.json` with `served_today` and an explicit ledger allowance, so the 4.1 ledger shows the drop. If they 308 then 301, record two hops in §2.3. | Logs show real traffic on double-slash URLs. Then add exact double-slash rows for the affected pages by PR. | approved 2026-10-04 (recommendation) |

**Brief positions changed by review** (primary evidence in `out/review-disposition.md`):

| Brief item | Change | Evidence |
| --- | --- | --- |
| 6 (feeds) | Legacy guid **text** kept; `isPermaLink="false"` is added, not "kept" | Live `/rss/` guids carry no attribute (MU-7) |
| 11 (Biome) | Formatter disabled for `src/content/blog/categories/**` only; linter on. This is formatting ownership, not a rule relaxation | PagesCMS `lib/serialization.ts:100` writes `JSON.stringify(x,null,2)` without a final newline (MST-02) |
| 18 (legacy URLs) | `/recipes/` and `/blog/` opt in to 301 (J10). `/_astro/*`, `/release.json` and `/search-index.json` are labelled "served 200 today → deliberately 404" | MU-6, MU-2 |
| 20 (content) | Only the `/password-reset/` hrefs are fixed. The `local.js` and `carousel.js` "dead references" are code samples and stay byte-identical | The SRC posts at subresource-integrity `:44,48` and Astro migration `:130` are inside `<code>` (COMP-04) |
| 25 (docs timing) | AGENTS.md narrative and invariants land in B23, merging with C1; only post-C2 facts wait for D1 | DST AGENTS.md says "seven pages … no CMS" (COMP-08) |
| A1(a) (minifier) | Settled: candidate 1, `conservativeCollapse` with protected comments, now also protecting `$` and `astro:end` | Real-Chromium node reuse equals the unprocessed build on every page (CSPB evidence) |
| A3 (smoke filter) | The smoke filter is a **required** cross-repo prerequisite, X1, not an optional variable. The staged-deployment probe is John-only; the Vercel MCP `web_fetch_vercel_url` is not read-only and follows redirects | SEQ-01, SEQ-11 |
| A3 (project settings) | `outputDirectory` is `public`. The dashboard overrides are dropped, because vercel.json carries them and a dashboard override would survive a rollback reconnect | SEQ-03 |

**Decision gates per step.** This table is authoritative: a step starts only when every decision on its row (and every earlier row) has an answer. Each PR body cites its answered decisions.

| Step | Needs |
| --- | --- |
| Plan approval | X1 authorization; the Todoist tasks in item 5 above |
| PA1 | J23 |
| PA3 | J11 |
| PA4 | J6 |
| PA6 | J1, J2, J5, J10, J14, J15, J27 |
| B00 | J3, J4 |
| B03 | J7 (excludes the instant-pot post; a flip adds a `/recipes/guide/` step before B23) |
| B05 | J19 |
| B06c | J25 (the first visual comparison sets the parity baseline) |
| B10 | J8 |
| B11 | J12 |
| B12 | J14 |
| B15 | J7 (drops the article generator) |
| B17 | J13 |
| B19 | J18 |
| B23 | J17 |
| C0 | J20; J21 with X1 merged in dotagents and synced into jsolly-website |
| C1 | every J above |
| C2 | J28 (applied only if step 5 sees a 404) |
| C3 | J16 |
| C4 | J9, J22, J26 |

J24 gates nothing; it is out of scope.

**Actions for John, rather than decisions:**

- Authorize the X1 dotagents session at plan approval (it must be merged and synced before C0), then start the fleet rollout lead once dotagents is idle.
- Confirm the awesome-blog code freeze at B00, and start (or authorize) the awesome-blog session for its freeze notice.
- Approve each Phase C step.
- Run the John-only commands in C0 step 8, C2, C3 and C4.
- Handle PagesCMS: remove awesome-blog from the App at C0, then grant jsolly-website after C1 has deleted `port/awesome-blog`, and rehearse.

**Execution record.** Values the steps produce, recorded when they become known: edited in place in the untracked bundle before PA5, by a docs-only `/ship` PR after. Commands never take these from here: the cut and freeze SHAs are read from committed files (B01, C0), and URLs and IDs are read live by the agent.

| Item | Value | Recorded at |
| --- | --- | --- |
| awesome-blog cut SHA | `86bbaf29bfaa60b35ce0cc943dcd4cb46c061adc` (2026-10-05; differs from bf1f7ff1 only by the AGENTS.md freeze notice) | B00 step 3 (also `scripts/port/source.json`, B01) |
| Final port → main PR number | jsolly/jsolly-website#65 (draft) | B01 |
| awesome-blog freeze SHA | pending | C0 step 4 (also `legacy/blogthedata/url-map.json` `meta.freeze_sha`) |
| C1 squash SHA, Production smoke run URL | pending | C1 |
| `blogthedata` rollback deployment ID | pending | C2 step 1 |
| Double-slash outcome (J28), C2 verifier results | pending | C2 step 5 |

## Summary

The blog moves into private jsolly-website as a snapshot port, without history:

- Posts go to `/blog/<slug>/`, with slug case preserved.
- Recipes go to `/recipes/`.
- Each of the 106 posts, 6 categories and 21 recipes keeps a per-path 301 from blogthedata.com, and so do the served `/<page>/index.html` forms. The 105 regular posts 301 to `/blog/<slug>/`; the instant-pot recipe post 301s to `/recipes/`.

**Where the redirects live.** They go in a new static directory, `legacy/blogthedata/`, inside jsolly-website. The existing Vercel project `blogthedata` is re-pointed at that directory (option A′). Its domains, certificates and DNS are untouched.

**How they are tested.** The redirect list is generated from a committed URL map. jsolly-website's gate compiles it with Vercel's own router library, `@vercel/routing-utils`, and tests the result.

**Phases.** The work runs in three phases, plus one cross-repo prerequisite:

- **Phase A:** six port-neutral prerequisite PRs to `main`, landing in the order PA1, PA5, then PA2–PA4, then PA6. They fix the test runner, Tailwind source scanning (and commit this plan bundle), hydration, middleware and the CSP header, and add the inert redirect project. PA2–PA5 change production behaviour; each rolls back by a revert PR.
- **Phase B:** single-commit PRs into the integration branch `port/awesome-blog`, steps B01–B23, with B06 split into three. B00 is a setup step with no jsolly-website commit.
- **Phase C:** cutover steps C0–C4. Each needs John's explicit approval. Every Vercel, GitHub-settings and Search Console action is his.
- **X1, before C0:** the cross-repo prerequisite above. It is gated before C0, not C2, because the C1→C2 window is capped at 24 hours and a fleet sync cannot be scheduled inside it.

**The URL map** has 305 rows:

- 212 redirect with 301.
- 5 serve a file with 200.
- 88 stay 404 deliberately.

The map covers a mechanically checked union of 901 known paths, with 0 unmatched and 0 ambiguous. That union includes every file the freeze build serves. The real Vercel compiler agrees on every path.

Of the 407 paths served with 200 today, exactly 57 become 404 on purpose: 55 hashed `/_astro/*` files, `/release.json` and `/search-index.json` (J27). The generator fails on any other 200→404 drop.

---

## 1. Inventory

### 1.1 Mechanical coverage

`out/check-inventory-coverage.mjs` enumerates `git ls-tree -r bf1f7ff1` (361 files) and resolves every inventory entry, expanding `{a,b}` braces and `ext|ext` alternation. The earlier `check-inventory.mjs` did neither, so it reported 2 false MISSING files and under-counted the multi-listed ones.

Result: **tracked 361, resolved 361, missing 0, unresolved 0, entries matching nothing 0.**

| Inventory | Entries | adapt | move | drop |
| --- | --- | --- | --- | --- |
| `inventory-app.json` | 54 | 40 | 3 | 11 |
| `inventory-recipes.json` | 51 | 39 | 7 | 5 |
| `inventory-ops.json` | 88 | 24 | 3 | 61 |

After the brief's overrides and the post reclassification below, the per-file dispositions are **move 130, adapt 143, drop 88**.

`out/inventory-coverage.json` has the per-file detail, including the reclassification (its `post_reclassification` block). The script reads SRC at the pinned SHA, not `origin/main`, so it reproduces after B00's freeze PR.

**Post reclassification.** 37 posts contain a B04 rewrite candidate. The script derives the set; nothing is hard-coded except the two short lists:

- 34 posts carry an absolute blogthedata.com URL (`git grep` at bf1f7ff1). The dropped instant-pot post is not among them; it has no blogthedata.com URL.
- 3 posts drop the recipe slug from `related`.
- 2 posts get heading fixes.
- 2 posts are in two sets (`gis-job-search-resources` and `optimizing-ahrefs-orphan-pages-duplicate-content`), so the union is 34 + 3 + 2 − 2 = 37.

Those 37 are `adapt`, and so is the posts' `.markdownlint.json`, which is Biome-formatted on import. The B04 dry-run file list is authoritative.

53 files are listed more than once. Each resolves by a stated rule:

- **44 `public/media/recipes/*`:** recipes and ops both say `move`. The recipes inventory owns the target, `public/recipes/media/` (brief item 5).
- **3 posts with a `related` change:** `adapt`.
- **The instant-pot post:** `drop`. Its URL is re-homed at `/recipes/`.
- **`scripts/astro-contract.test.mjs`:** split. Lines 174–201 go to `scripts/built/recipes-built.test.mjs`; the rest goes to blog tests.
- **`src/styles/no-script.css`:** split into a blog part and a recipe part.
- **`src/pages/post/[slug]/index.astro`:** `adapt`. The recipe special case is deleted inside it.
- **`src/styles/recipes-theme.css`:** `adapt`, owned by the recipes inventory.
- **`vercel.json`:** `adapt`, split. Header rules go to DST `vercel.json`; redirect knowledge goes to `legacy/blogthedata/url-map.json`.

Overrides that change a disposition:

- `public/social/*.svg` (5) become `move` to `public/blog/social/` (brief item 4).
- 5 `index.ts` barrels and 10 generated parts that nothing imports become `drop`.
- `.github/workflows/production-smoke.yml` and `.github/dependabot.yml` become `drop`; DST's own copies govern.

Overrides that change only the target:

- `public/media/default.webp` → `public/blog/media/`.
- `.pages.yml` → media `public/blog/media` ↔ `/blog/media`; posts `src/content/blog/posts`.
- `rss`/`atom` pages → `src/pages/blog/{rss,atom}.xml.ts`.
- Privacy page → merged into `src/pages/privacy.astro`.
- `migration-receipt.json` and `redirects.json` → folded into `legacy/blogthedata/url-map.json`.

### 1.2 Inventory by area (all 361 files)

| Area | Files | move / adapt / drop | Target in jsolly-website | Reason |
| --- | --- | --- | --- | --- |
| Posts `src/content/posts/*.md` + `.markdownlint.json` | 107 | 68 / 38 / 1 | `src/content/blog/posts/<slug>.md` (filename = slug, case kept). The dotfile is copied **explicitly** and Biome-formatted, so it is `adapt`. | 37 posts carry B04 rewrites (§1.1). The instant-pot post is generated and never rendered, so it is dropped (J7). |
| Categories | 6 | 6 / 0 / 0 | `src/content/blog/categories/*.json`, kept in PagesCMS's own JSON shape (2-space, no final newline) | `Geodev` keeps its mixed case. PagesCMS owns the formatting (MST-02). |
| `src/content.config.ts` and 3 JSON receipts | 4 | 0 / 3 / 1 | `src/content.config.ts` (without `legacyId`, J19). `redirects.json` and `migration-receipt.json` fold into `legacy/blogthedata/url-map.json`. `intentional-rewrites.json` drops. | The receipts seed the URL map. Mechanical rewrites must never touch them (spike finding 13; pinned by the B01 port-tooling test). |
| Lib `src/lib/*.ts` | 8 | 0 / 8 / 0 | `src/lib/blog/{content,post-loader,html,feeds,search}.ts`. `cards` merges into `content`, `frontmatter` into `post-loader`. The `utils.ts` types go to the existing `src/lib/ui-types.ts`. | DST layout (brief item 4). The heading algorithm (`html.ts:61-75`) does not change. Path rewrites are listed in §1.14. |
| Blog components | 4 | 0 / 4 / 0 | `src/components/blog/{AuthorCard.astro,BlogNavigation.svelte,PostCards.svelte,Search.svelte}` | Avoids name clashes with DST components. |
| Layout `Base.astro` | 1 | 0 / 1 / 0 | `src/layouts/BlogLayout.astro`: standalone; honors `MAINTENANCE_MODE`; no Markdown alternate link; head slot; `section` prop | Keeps blog CSS isolated. DST's `Layout.astro` advertises `.md` alternates that would not exist. |
| Blog pages and endpoints | 14 | 0 / 10 / 4 | `src/pages/blog/{index,all-posts,search,works-cited,category/[slug],[slug]}`, `blog/search-index.json.ts`, `blog/rss.xml.ts`, `blog/atom.xml.ts`. Privacy merges into DST. | Drop `sitemap.xml.ts`, `robots.txt.ts`, `release.json.ts` and `404.astro`; DST's sitemap integration, static robots and 404/500 take over. |
| Styles | 7 | 0 / 7 / 0 | `src/styles/blog/{theme,ui,blog,no-script}.css` (global, article-content and motion merge into `blog.css`); `src/styles/recipes/{recipes-theme,recipes-no-script}.css` | Wrapped in one `@layer blog`. Every blog sheet opens with the same order statement, `properties, theme, base, components, utilities, blog, blog-no-script` (no-script fallback in its own last layer; landed for the blog sheets in B06b, §7.5); the recipe sheets must open with the same statement when B16 ports them. `@source` paths are re-pathed (§1.13, CSPB-1). |
| shadcn ui `src/lib/components/ui/**` | 33 | 0 / 16 / 17 | Flattened to `src/lib/components/ui/<name>.svelte` | §1.4 |
| Recipe components, data and unit tests | 30 | 3 / 27 / 0 | `src/components/recipes/**` (same names) | §1.6 |
| Recipe page `src/pages/recipes/[slug].astro` | 1 | 0 / 1 / 0 | Same path, plus a new `src/pages/recipes/index.astro` | Brief item 5 |
| Recipe scripts and tests | 6 | 0 / 3 / 3 | `scripts/recipes/{pwa-build,sync-assistant-data}.mjs`. The PWA tests split into `scripts/built/recipes-{browse,pwa}.test.mjs`. | The article sync, the generator and its test drop (J7). |
| Recipe public assets | 50 | 47 / 3 / 0 | `public/recipes/media/*` (44), `public/recipes/pwa/*` (4), `public/recipes/data/*` (2, regenerated) | Brief item 5 |
| Blog/site public assets | 11 | 6 / 3 / 2 | §1.8 | Brief items 4, 16 and 18 |
| `verify:*` scripts | 5 | 0 / 3 / 2 | `scripts/built/blog-content-contracts.test.mjs` | §1.7 |
| AWS/infra | 13 | 0 / 0 / 13 | Stays frozen in the archive | J9; §1.9 |
| One-time migration tooling | 6 | 0 / 0 / 6 | Dropped | The one-time import already ran on 2026-10-02. |
| Scripts: tests, gate, smoke | 13 | 0 / 6 / 7 | §1.10. `content-files.mjs` is inlined into B14 (MST-12). | DST's template copies win. |
| Gate, CI, workflows | 9 | 0 / 2 / 7 | Steps merge into DST `.git-hooks/pre-commit` and `ci.yml` | §1.10 |
| Root config | 8 | 0 / 4 / 4 | `astro.config.mjs`, `package.json`, `vercel.json` and `.pages.yml` merge into DST. `svelte.config.js`, `tsconfig.json`, `components.json` and the lockfile drop. | DST has no `svelte.config.js` and needs none: @astrojs/svelte 9 applies no default preprocess, Svelte 5 strips TS natively, and no SRC component uses `<style lang>` or `@apply`. B02 records build and svelte-check passing without it. DST's tsconfig and components.json govern; the lockfile is regenerated. |
| Repo and tool dotfiles | 14 | 0 / 0 / 14 | Dropped | DST has its own. `.gitleaks*` can drop because nothing brings history (§1.12). |
| Docs | 11 | 0 / 4 / 7 | `AGENTS.md`, `README.md`, `docs/publishing.md` and `docs/recipes.md` adapt into their DST counterparts in B23 (§1.12); D1 adds only post-C2 facts | The rest is archive history. |

### 1.3 Content collections

**Loader.** The custom posts loader (`post-loader.ts` plus `frontmatter.ts`) is kept. It parses frontmatter with the `yaml` core schema, so PagesCMS's unquoted ISO timestamps stay strings, and a date without an offset fails the build.

**Schema.** Base paths move to `src/content/blog/{posts,categories}`. `legacyId` is dropped from both schemas (J19).

- Zod's default object strips unknown keys, so `legacyId`, `legacyImage` and `legacyAuthorId` remain in frontmatter as unmanaged PagesCMS data.
- The `image` default becomes `/blog/media/default.webp` (§1.14).

**New `related` check.** The build fails on a `related` slug that does not resolve, tested as a content-contract scenario in B14. Today the page silently drops such a slug, so removing the recipe slug from 3 posts would never have failed.

**Facts:**

- 106 posts, all `draft:false`. The `draft` default stays `true`, so a missing key means a draft.
- 22 slugs are mixed-case, with no case-insensitive duplicates.
- 0 fenced code blocks, 220 inline `style=` attributes in 47 files, and 16 iframes.

**Taxonomy.** There are no tag or author URLs. The schema has no tag field, and `/tag/` and `/author/` 404 today. Categories are the only taxonomy.

### 1.4 Svelte integration and shadcn components

`@astrojs/svelte` 9.0.1 and Svelte 5.57.1 are identical in both repos. DST has one flat `ui/button.svelte`. The blog and recipes reuse it, so SRC's `button/` drops and its 3 import sites are retargeted.

**Kept and flattened** to `src/lib/components/ui/` (16 files):

- `input`
- `checkbox`
- `collapsible`, `collapsible-content`, `collapsible-trigger`
- `dialog`, `dialog-content`, `dialog-description`, `dialog-overlay`, `dialog-portal`, `dialog-title`
- `native-select`
- `popover`, `popover-content`, `popover-portal`, `popover-trigger`

**Dropped** (17 files):

- 6 `index.ts` barrels, including `button/index.ts`. Biome's `noBarrelFile` rejects them, and DST's AGENTS.md says to import the defining files directly.
- `button/button.svelte`.
- 10 generated parts that nothing imports: `dialog-close`, `dialog-footer`, `dialog-header`, `dialog-trigger`, `native-select-opt-group`, `native-select-option`, `popover-close`, `popover-description`, `popover-header`, `popover-title`.

`WithoutChildrenOrChild` joins `WithElementRef` in `src/lib/ui-types.ts`, and every `$lib/utils.js` type import moves there. That fixes svelte-check's error in `ui/input`.

Placement follows each file's first importer. The §5 step file lists are the record, and knip in the gate is the arbiter:

- `input` lands with BlogLayout in B06c.
- The dialog, collapsible, checkbox and native-select files land with the recipe detail pages in B16.
- The popover files land with the recipe landing page in B17.

### 1.5 PagesCMS config

`.pages.yml` moves to the DST root:

| Setting | Value |
| --- | --- |
| `media.input` | `public/blog/media` |
| `media.output` | `/blog/media` |
| posts `path` | `src/content/blog/posts` |
| categories `path` | `src/content/blog/categories` |
| `related.options.collection` | `posts` |
| `image.default` | `/blog/media/default.webp` |
| image pattern | `^(?:/blog/media/\S+\|https://\S+)$` |
| `slug` help text | `/blog/<slug>/` |

It passes `yamllint -s` verbatim. Editorial PRs go through DST's gate and ruleset, which is intended, because post edits are not docs-only under gate-lib.

**Category JSON formatting.** PagesCMS rewrites a whole category file on each save with `JSON.stringify(x, null, 2)` and no final newline (pages-cms `lib/serialization.ts:100`). DST's `biome ci` would reject that. So B03, the first commit containing these files, adds a `biome.jsonc` override that sets `formatter.enabled: false` for `src/content/blog/categories/**` only, keeping the linter on, and copies the 6 files in that same shape. A B13 test writes a category exactly as PagesCMS would and runs `biome ci` on it.

**Grant timing (SEQ-09).**

1. **C0:** John removes awesome-blog from the PagesCMS GitHub App's repository selection.
2. **After C1:** John grants jsolly-website.
3. **Rehearsal:** on a throwaway editorial branch from `main`, save, reopen, upload an image to `public/blog/media`, open a PR, then close it unmerged.

The grant is never made while `port/awesome-blog` exists, because non-default branches have no ruleset protection. C1 step 3 deletes the branch (the tag `port-awesome-blog-steps` keeps its commits) and C1 step 5 checks it is gone before you grant.

### 1.6 Recipe pipeline and tests

**Data.** `recipes.json` (21 recipes: 15 meals, 6 smoothies) and `nutrition-data.json` move with a JSON-aware rewrite of `/media/recipes/` → `/recipes/media/` and `/post/15-minute-dump-and-go-instant-pot-recipes/` → `/recipes/`. The check is `JSON.parse` deep-equality after the mapping, not `sed`. They are Biome-formatted on import.

**Assistant data.** `scripts/recipes/sync-assistant-data.mjs` regenerates `public/recipes/data/recipe-library.{json,md}`; today the two files are 389,731 B and 159,124 B. Regenerating rather than copying means the 84 embedded paths become `/recipes/media/`. `recipes:sync` and `recipes:check` shrink to that one script.

**Dropped (J7):** `sync-recipe-article.mjs`, `article-generator.mjs` with its 5 tests, and the generated post.

**`pwa-build.mjs` changes:**

- Enumerate pages from the `recipes.json` ids plus the landing, meals and smoothies pages. Today `readdir(dist/recipes)` (line 17) crashes on `media/`, `pwa/` and `data/`.
- Use jsdom instead of cheerio.
- Emit a single worker at `/recipes/service-worker.js`, scoped to `/recipes/`.
- Look up the cache with `cache.match(key, {ignoreVary: true})`.
- Run after `process-html.mjs`. Today the cache hash is computed in `astro:build:done`, before the HTML is rewritten (lines 50–52).
- Emit **no** worker when `MAINTENANCE_MODE=true` (CSPB-9). A 404 on the update check leaves installed workers and caches intact, instead of precaching maintenance HTML.
- Delete the legacy second worker and the `recipe-pwa-` prefix swap (lines 78–81).

**Service-worker registration.** `recipe-pwa-client.mjs:13` changes scope from `'/'` to `'/recipes/'`. The manifest `id`, `start_url` and `scope` all become `/recipes/`.

**Landing page.** The old library post rendered `<RecipeExperience />` with its defaults (SRC post page `:32`). `RecipeExperience` passes all 21 recipes to `RecipeLibrary` with the initial collection set to `meal`, so old `#<recipe-id>` links, smoothies included, opened from that page. `/recipes/` therefore renders `<RecipeExperience />` exactly as before. Its h1 carries `id="easy-meals--smoothies"`, so copied heading links from the old post still land on it. B17 adds a deep-link test over all 21 ids plus `#meal-results`.

**Tests:**

- 36 unit tests port as-is: display-units 3, nutrient-filters 9, nutrition 3, recipe-export 3, recipe-logic 13, trn-logic 5.
- PWA: 11 of 13 port and 2 drop (§4.14). B17 takes 6 and B18 takes 5 (MST-01).
- `migration-rewrites.test.mjs` leaves the recipe suite.

### 1.7 verify:* scripts

| Script | What it checks | Disposition |
| --- | --- | --- |
| `verify:cms` (8.1 s) | A PagesCMS-shaped post builds with precision intact (h1, `pre` indentation, `time[datetime]`, JSON-LD author default). Date-only or offset-less timestamps fail the build. | **Port** as 2 tests in `scripts/built/blog-content-contracts.test.mjs` |
| `verify:drafts` (6.4 s) | A draft carrying a sentinel never appears anywhere in `dist`, and its route does not exist. | **Port**, 1 test. It also asserts the sentinel is absent from the generated route manifest (MST-07). |
| `verify:identities` (8.1 s) | Duplicate post or category slug files fail the build with `Duplicate post slug:` or `Duplicate category slug:`. | **Port**, 2 tests |
| `verify:migration` | Compares the build to the private Django dumpdata. One-time; not in `gate:app`; cannot run without `.migration-work`. | **Drop** |
| `verify-media-backup.mjs` | S3 backup inventory against the downloaded media. One-time. | **Drop**; it stays in the archive with J9. |

**Temp copy.** The ported suite never mutates the working tree. Today a crash mid-gate can leave a stray post behind. One shared helper, `scripts/built/temp-copy.mjs`, owns this. PA2 introduces it (the hydration baseline build needs it), and B06c and B14 reuse it (MST-03).

- **Files:** the copy is the `git ls-files -co --exclude-standard` set.
- **Dependencies:** a fresh `node_modules/` directory in the copy symlinks every entry of the real one except `.astro` and `.vite`, so each copy has its own Astro data store and Vite cache (MST-03).
- **Builds:** the positive scenarios share one full build, and each failure scenario aborts at its first error.
- **Serialization:** `serializePost` from `content-files.mjs` is inlined with the same `yaml` options (`lineWidth: 0`, YAML 1.1).
- **Scenarios added:** B14 adds an unknown `related` slug, which must fail the build, and a CMS post whose image is `/blog/media/x.webp`, which must render same-origin (COMP-02).
- **Guard:** the suite asserts that the real tree's `node_modules/.astro/data-store.json` mtime is unchanged.

### 1.8 Public assets

| Asset (SRC `public/`) | Disposition | Target | URL-map row |
| --- | --- | --- | --- |
| `topographic-logo.svg` | adapt (move) | `public/blog/topographic-logo.svg`; BlogLayout's header uses it (SRC `Base.astro:41`) | CHR-008 → `/blog/topographic-logo.svg` |
| `social/{github,linkedin,x,youtube,reddit}Logo.svg` | move | `public/blog/social/`; the author card and share buttons use them (SRC `About.astro:8-11`, post page `:36`) | CHR-003…CHR-007 |
| `media/default.webp` | move | `public/blog/media/default.webp`; also the author-card photo (SRC `About.astro:3`) | MED-001 |
| `logo.webp` | drop | — (unreferenced in SRC `src/`) | CHR-002 → `/blog/topographic-logo.svg`, which is the same artwork (SRC `docs/recipes.md:116`) |
| `favicon.ico` | drop | DST's `public/favicon.ico` wins | CHR-001 → `/favicon.ico` |
| `pgp-key.txt` | adapt | `public/pgp-key.txt` (B11) | SEC-001 → `/pgp-key.txt` |
| `.well-known/security.txt` | adapt | jsolly `public/.well-known/security.txt` (B11); the legacy host gets its own copy, served 200 | SEC-002 (serve-200) |
| `media/recipes/*` (44) | move | `public/recipes/media/` | MED-002…MED-045 (one exact row per file) |
| `recipes-pwa/{manifest.webmanifest, icon-180/192/512.png}` | adapt / move | `public/recipes/pwa/` | PWA-001…PWA-004 (exact) |
| `data/recipe-library.{json,md}` | adapt (regenerated) | `public/recipes/data/` | RDA-001, RDA-002 |

### 1.9 AWS and infra scripts

These 13 files drop:

- `aws/migration-backups/{template.json,stack-policy.json,deploy.sh}`
- `scripts/{protect-stacks.sh,plan-infra.mjs,plan-infra.test.mjs,check-infra-drift.mjs,check-infra-drift.test.mjs,deploy-infra.test.mjs,stack-protection.test.mjs,infra-inputs.json}`
- `.gitattributes`, `.mise.toml`

They stay frozen in the archive (J9). The final protection and drift reads run at C4 step 1 and are recorded in the C4 PR.

The C4 README PR names the stack, the Object Lock date and the runbook. It also states that continuous reads stop at archive.

jsolly-website stays a Vercel-git repo with no IaC. Bucket `blogthedata` and CloudFront `d1d7p8ufhgz4ld` sit outside this IaC and become runtime dependencies of jsolly.com (J6).

### 1.10 Gate checks: SRC vs DST

| Step | SRC | DST | Merged |
| --- | --- | --- | --- |
| gate-lib bootstrap, staged secrets, doc-only fast path, bash floor, node pin | yes | yes | DST, unchanged |
| `biome ci --error-on-warnings` | — | yes | DST. Every ported file conforms (§1.13). |
| YAML | `check-yaml.mjs` | yamllint 1.38.0 | DST's yamllint. SRC's YAML passes it. |
| knip | — | yes | DST. Dependencies land with their first importer. |
| actionlint (+ preview contracts) | yes | yes | DST |
| markdown lint | yes | yes | DST. The posts' `.markdownlint.json` travels with them. |
| smoke scenario contract | yes | yes | DST scenario plus blog, search and recipe steps (B20) |
| route manifest | — | — | **New** `npm run routes` (PA3). It runs before knip, `check:ts`, `npm test` and build. |
| type check | `check:app` | `check:ts` | `check:ts` becomes routes && `astro check` && `svelte-check` (B02) |
| unit tests | `test:astro`, `test:search`, `test:recipes` | `npm test` (`src/lib/*.test.ts`) | `npm test` glob widened, run through the count-checking wrapper (PA1) |
| `recipes:check` | yes | — | **Ported** (B15) |
| `redirects:check` | — | — | **New** (PA6) |
| build (+ `process-html` + built-csp) | `astro build` | yes | DST, plus service-worker generation after `process-html` (B18) |
| built and browser tests | `test:browse`, PWA, `verify:*` | built-csp only | **New** `test:built` (PA1): `node --test --test-concurrency=1` over `scripts/built/*.test.mjs`, through the wrapper that fails below the count recorded in `scripts/test-counts.json` |
| stack protection and infra contracts | yes | — | Dropped (J9) |

`ci.yml` mirrors the gate. It gains `npm run routes`, `redirects:check`, `recipes:check` and `test:built`, and keeps the job name `ci`. CI already runs `playwright install --with-deps chromium` before the smoke contract.

Every added CI step carries the verified-tree guard that each existing step has (`ci.yml:131-161`; dotagents `templates/github/verified-tree-ci.md` wiring rule 3). Without it, a main push that reuses a verified PR tree skips `npm ci` but still runs the new step, and main goes red after every merge. For example, PA1 adds, right after the `npm run build` step:

```yaml
      - run: npm run test:built
        if: steps.verified-tree.outputs.run_full != 'false'
```

### 1.11 Dependencies delta

| Package | SRC | DST today | Action (step) |
| --- | --- | --- | --- |
| `@vercel/routing-utils` | — (bundled inside the `vercel` CLI; not in DST's lockfile) | — | Add as a devDependency pinned to `6.6.0` (resolves from registry.npmjs.org). Add the override `{"@vercel/routing-utils": {"path-to-regexp": ">=6.3.0 <7.0.0"}}`, because the package pins 6.1.0. All 212 sources compile to identical regexes under 6.1.0 and 6.3.0 (review csp-build check), and the sources keep one parameter per segment (PA6). |
| `astro` | 7.3.5 | `~7.3.2` | `~7.3.5` (B02). It must land before `yaml` becomes direct (B05), or npm reports EOVERRIDE. |
| `svelte-check` | 4.7.6 | — | Add; chain into `check:ts` (B02) |
| `yaml` | 2.9.1 | transitive 2.8.3 + override `>=2.8.3` | Change the override to `"$yaml"` and add a direct 2.9.1 dependency (B05) |
| `@astrojs/markdown-satteri` | 0.4.2 | transitive 0.4.1 | Add 0.4.2 directly (B05) |
| `sanitize-html`, `@types/sanitize-html`, `entities` | 2.18.0, 2.16.2, 8.1.0 | — | Add (B05; `html.ts`) |
| `minisearch`, `zod` | 7.2.0, 4.6.5 | zod transitive 4.5.4 | Add (B05; `search.ts`, with `z.config({ jitless: true })`) |
| `bits-ui`, `@lucide/svelte`, `@internationalized/date` | 2.19.5, 1.51.0, ^3.12.4 | — | Add (B16) |
| `cheerio` | 1.2.0 | — | **Do not add.** jsdom replaces it. |
| `turndown`, `@types/turndown`, `@types/node` 26 | dev | — | **Drop** |

The `@fontsource/*`, `tailwind*`, `clsx`, `tailwind-merge`, `shadcn-svelte`, `playwright` and `typescript` versions already match. Every dependency lands in the same commit as its first importer; otherwise knip fails (brief A1).

### 1.12 Docs and repo config

Four SRC docs files adapt in B23:

- `docs/publishing.md` → DST `docs/publishing.md` (PagesCMS on jsolly-website).
- `docs/recipes.md` → DST `docs/recipes.md` (pipeline, PWA, kill-switch).
- `AGENTS.md` → DST `AGENTS.md`: Purpose, Stack and Architecture, plus the blog, recipe and PagesCMS invariants (COMP-08).
- `README.md` → DST `README.md`: a short "Blog and recipes" section (content location, `npm run recipes:sync`, PagesCMS editing). SRC's deployment and AWS narrative stays in the archive.

D1 adds only the post-C2 facts.

**The plan bundle** (CON-04, EX-02, F-04). jsolly-website already reserves `docs/plans/**` for archival planning records: its `.markdownlint-cli2.jsonc` ignores it as "Archival planning/spec records — not active content, not lint-gated".

- **Today:** untracked at `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/` (2.4 MB), in awesome-blog's gitignored, retained migration directory, so neither repo's gate or Tailwind scan sees it. Steps read it by that absolute path until PA5 merges.
- **PA5 commits all of it**, unchanged, to `docs/plans/blogthedata-merge/`: `plan.md`; `out/` (map, appendix, union, destinations, vercel.json preview, check reports, inventory coverage, review disposition, round-1 id map, the generator and the coverage script); `exp/compile-check.mjs`; the generator inputs at the bundle root (`urls-build.json`, `urls-live.json`, `urls-history.json`, `sitemap-locs.txt`, `served-files.txt`, `inventory-{app,recipes,ops}.json`); and `evidence-notes/`. Nothing is left behind as uncommitted evidence.
- **Why PA5, not PA1** (CON-02). Until `source(none)` lands, Tailwind scans every non-gitignored file. Measured on a clean `astro build` of main: the plan alone at a docs path adds `.filter`, `.lowercase`, `.shrink` and `.table` (46,038 B), and the whole bundle adds 7 selectors (46,676 B). Committing the bundle in the same PR that sets `source(none)` keeps jsolly's CSS unaffected by docs and keeps PA5's proof exact.
- **Gate treatment, verified** in a scratch clone of main 5694e76 with PA5's `main.css` change and the bundle at `docs/plans/blogthedata-merge/`:
  - markdownlint: already ignored (`Linting: 3 files`, 0 issues).
  - Biome: `biome.jsonc` `files.includes` gains `"!docs/plans"`, next to `"!.agents"`. It covers archival records only, the same reasoning markdownlint already applies; no product-code rule is relaxed. `biome ci . --error-on-warnings` is then clean (without it: 35 errors in the bundle's 18 checked files).
  - knip: `knip.json` gains `"ignore": ["docs/plans/**"]`, because the bundle's three `.mjs` scripts are not entries. knip 6.37.0 then exits 0 (without it: "Unused files (3)").
  - Tailwind: Layout CSS 45,679 B, with exactly `.visible`, `.fixed`, `.contents` and `.inline` removed.
  - gitleaks 8.24.2: clean (round-2 scan). yamllint, actionlint and `check:ts` have nothing in scope.
- **PA6 retires the generator.** It deletes `out/build-url-map.mjs`, `out/check-inventory-coverage.mjs` and `exp/compile-check.mjs` (superseded by the 4.1 test), and the outputs PA6 commits elsewhere or regenerates: `out/url-map.json` (now `legacy/blogthedata/url-map.json`), `out/url-map-union.json` (now `legacy/blogthedata/url-union.json`), `out/legacy-blogthedata-vercel.json` (now generated by `redirects:write`) and `out/url-map-destinations.json` (now derived by test 4.2). The same commit removes the knip `ignore` entry: with no `.mjs` left, knip reports "Remove from ignore" and `treatConfigHintsAsErrors` fails the gate (verified). From PA6 on, "`out/url-map.json`" in this plan means `legacy/blogthedata/url-map.json`. The deleted files stay in git history at the PA5 commit.
- **Kept until D1:** the plan, the inputs, `url-map.md`, the check reports, the inventory coverage, the disposition and `evidence-notes/`. The plan stays on `main` through C4, because the C0–C4 runbook, the rollback rule and the D0/D1 lists govern steps that run after C1. D1 deletes `docs/plans/blogthedata-merge/` and, if `docs/plans/` then holds nothing else, the `"!docs/plans"` Biome entry.
- **Edits after PA5** (answers, the execution record, C2 results) land by docs-only `/ship` PRs to `main`. During Phase B they reach the port branch through the main syncs (§5).
- **The untracked copy.** After PA5 merges, the agent checks that `diff -r` between the untracked copy and the merged `docs/plans/blogthedata-merge/` shows no difference, then removes the untracked copy with your OK.

These drop:

- `CODE_OF_CONDUCT`, `CONTRIBUTING`, `SECURITY`, `astro-migration.md` and `migration-backups.md`.
- The PR template and 5 issue templates.
- The `.codex/` and `.cursor/` files; DST has fleet copies.
- `.gitleaks.toml` and `.gitleaksignore`.

Dropping the gitleaks files is safe because no history comes across. SRC's working tree scans clean with the default config. The 8 history findings (django_ckeditor_5 sourcemaps) stay in the archive.

### 1.13 Conflicts with jsolly-website

**Biome.** The spike's full transplant under `biome ci --error-on-warnings` produced **1,258 diagnostics** (1,152 errors, 106 warnings) in 113 files.

By rule (the top 18 of about 43 rules):

| Rule | Count |
| --- | --- |
| useLayeredStyles | 428 |
| useTopLevelRegex | 140 |
| noImportantStyles | 99 |
| useUnicodeRegex | 95 |
| format | 72 |
| useConsistentTestIt | 70 |
| organizeImports | 68 |
| noMisplacedAssertion | 49 |
| noAwaitInLoops | 31 |
| useTemplate | 31 |
| noShadow | 22 |
| noConditionalExpect | 17 |
| useNamedCaptureGroup | 17 |
| useImportExtensions | 16 |
| useDomNodeTextContent | 16 |
| noLabelWithoutControl | 12 |
| noSecrets | 11 |
| useAnchorContent | 8 |
| other (about 25 rules with 1–6 each, including useAriaPropsSupportedByRole 4) | 56 |

By area:

| Area | Count |
| --- | --- |
| `src/components/recipes` | 560 |
| `src/styles/blog` | 223 |
| `pwa.test.mjs` | 99 |
| `src/lib/blog` | 66 |
| `astro-contract` | 63 |
| `verify-migration` (dropped) | 28 |
| `article-generator` (dropped) | 24 |
| `src/pages/blog` | 24 |
| `lib/components` | 19 |
| `components/blog` | 12 |

`biome check --write` clears 281 of them, leaving 868 errors and 109 warnings. The rest are fixed by hand:

- **useLayeredStyles (428).** Wrap every formerly unlayered stylesheet and Svelte `<style>` block in a single `@layer blog`, declared last. One layer keeps the relative cascade unchanged.
- **useTopLevelRegex (140).** Hoist and name the regexes; 42 of them are in `html.ts`.
- **Test-shape rules:** noMisplacedAssertion (49), useConsistentTestIt (46 remaining after `--write`), noConditionalExpect (17), noAwaitInLoops (31).
- **Recipe Svelte accessibility:** noLabelWithoutControl (12), useAnchorContent (8), useAriaPropsSupportedByRole (4).
- **noShadow (22).**
- **noImportantStyles (99).** Remove each one the layer order makes unnecessary. Keep the rest behind `/* biome-ignore lint/complexity/noImportantStyles: print output must beat inline style attributes */`, following the precedent of `StructuredData.astro`'s sanitized `set:html`.

**Biome exclusions.** These cover generated or externally owned files only. None is a lint-rule relaxation (brief item 11).

- `!public/recipes/data`: generated. `--write` would reformat `recipe-library.json` and break `recipes:check`.
- `!src/generated`: the route manifest (PA3).
- `!docs/recipes-evidence`: provenance bytes (B23).
- `!docs/plans`: archival planning records, this bundle (PA5); the same reasoning as markdownlint's existing ignore.
- The formatter-only override on `src/content/blog/categories/**`, which PagesCMS owns (§1.5).

There are no scoped rule relaxations. DST's `*.test.ts` override for `useTopLevelRegex` is not extended to `.mjs` (J23).

Biome 2.5.14 does not process `.md`, so the 106 posts are untouched: `--write` changed 0 of them. The legacy `404.html` uses no `<style>` block, because `useLayeredStyles` flags it and the legacy CSP `default-src 'none'` would block it anyway.

**Knip.** In the spike knip reported:

- 15 unused files, all generated shadcn parts (§1.4).
- 4 unused exports: `dailyNutrients` (`nutrition.mjs:3`), `recipeDisclaimer` (`recipe-export.mjs:6`), `feedPosts` (`feeds.ts:4`) and `legacyMedia` (`html.ts:4`). They get un-exported.
- `cheerio`, `yaml` and `turndown` as unlisted dependencies (§1.11).

Knip also forces the Phase B slicing: a component or lib file can land only together with a page or test that imports it.

Knip ignore entries:

- `legacy/blogthedata/public/**` (PA6). It must land in the same commit as those files: with `treatConfigHintsAsErrors`, an ignore entry that matches no files fails the gate.
- `src/generated/**` (PA3).

**CSP.** Browsers enforce both policies and apply their intersection:

- DST's response header (`vercel.json:45`) sets `img-src 'self' data:`.
- Astro's meta tag sets `default-src 'self'` plus script hashes (`astro.config.ts:24-29`).

In Chromium that blocked the CloudFront images: 129 violations on 8 sampled pages, and 105 broken images on `/all-posts/`. With `default-src` set and no `frame-src`, all 16 iframes were blocked too.

The fix (brief item 7):

- **Header (PA4).** Adds exactly `https://d1d7p8ufhgz4ld.cloudfront.net` to `img-src`, plus `form-action 'self'` (CSPB-8). SRC sent `form-action 'self'` in both its header and its meta; DST had none. The blog search forms need the restriction, and `form-action` does not fall back to `default-src`.
- **BlogLayout (B06c).** When `section="blog"`, it guards fail-closed with `if (!Astro.csp) throw …`, because Astro types `Astro.csp` as possibly undefined (CSPB-2). It then calls `Astro.csp.insertDirective` twice:
  - `img-src 'self' data: https://d1d7p8ufhgz4ld.cloudfront.net`
  - `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://viewer.diagrams.net https://nbviewer.org`
- **Syntax highlighting.** `markdown.syntaxHighlight: 'prism'`, because Shiki emits inline styles.
- **Styles.** `styleDirective` keeps DST's `['self','unsafe-inline']`.
- **Search island.** It uses zod 4 on the client, and zod's JIT probe raises a `script-src 'eval'` violation (it happens on live blogthedata.com today). `src/lib/blog/search.ts` calls `z.config({ jitless: true })` before any schema (CSPB-3).

The review verified the design in real Chromium with the planned header injected. The result was 0 violations on 12 pages: 105/105 CloudFront images, all 4 iframe hosts, and the recipe service worker active at scope `/recipes/`. Per-page directives appear on exactly the 115 `/blog/**` pages and nowhere else.

Gaps in `built-csp.test.mjs` today:

- It checks scripts only.
- Script hashes are site-global.
- `is:inline` scripts are not hashed.
- `insertScriptResource` drops `'self'`.

The plan uses neither `is:inline` nor `insertScriptResource`. The test is extended in PA4 and B06c, and a browser test arrives in B08 (§4.4).

The second CloudFront host, `d33wubrfki0l68`, appears once, in an `imageAttribution` string (`Exploring-the-STAC-APIs-with-IPython-Notebooks.md:10`). It renders as plain `<figcaption>` text, so no CSP or content change is needed.

**DST host rule.** DST `vercel.json:14-26` keeps its `jsolly.com` → `www` host redirect even though a domain-level 308 also exists (Vercel MCP read, discovery). The vercel.json rule is the reviewed, versioned copy; dashboard domain state changes without review (COMP-14).

**Middleware.** `middleware.ts` has no matcher, so it runs on every path:

1. **Feeds.** A feed reader sending a strict Accept header gets 406 today. This is moot here: the new feeds are `.xml`, which `STATIC_EXT_RE` already exempts (`accept-negotiate.ts:92-93`).
2. **Static `.md` files.** The `.md` branch runs first (`agent-response.ts:19-25`), so `/recipes/data/recipe-library.md` would return a Markdown 404. Fix: exempt `/recipes/data/` (PA3).
3. **Real blog pages.** `Accept: text/markdown` on a real `/blog/<slug>/` returns a Markdown 404, because `agent-pages.ts` knows only 5 pages. Fix: pass real routes through using a route manifest (PA3, brief A7).
4. **Unlisted static extensions.** These get 406 in production today; for example `/blog/x.avif` with `Accept: application/json` returns 406. Fix: treat any extension other than `.md` as static (PA3).
5. **`Vary: Accept` on recipe HTML.** It disappears once recipe routes are exempt. The service worker's `ignoreVary: true` stays as a second safeguard.

**Route manifest** (PA3). `scripts/route-manifest.mjs` writes a gitignored JS module, `src/generated/route-manifest.js`, which exports `const routes = [...]`. A JS module avoids relying on JSON import-attribute support in the edge bundler and Biome's `useJsonImportAttributes`. The script:

- in PA3, lists DST's static pages only. No dynamic template exists yet, and `parsePost` and `yaml` do not exist in DST until B05 (F-05);
- gains post expansion in B08, together with `src/pages/blog/[slug]/index.astro`. It lists only posts whose parsed frontmatter has `draft === false`, importing `parsePost` from `src/lib/blog/post-loader.ts` (B05), so drafts are filtered exactly as the build filters them (MST-07);
- gains recipe expansion in B16 (`src/pages/recipes/[slug].astro`, ids from `recipes.json`) and the `meals`/`smoothies` entries in B17;
- runs as `node --import ./scripts/register-ts-from-js.mjs --experimental-strip-types scripts/route-manifest.mjs`, the same loader flags `npm test` uses, so it can import TS modules;
- runs first in `npm test`, `check:ts`, `build` and `worktree:init`, so a fresh worktree works. Biome and knip ignore `src/generated/`.

**process-html** (`process-html.mjs:36-40`: `removeComments`, `collapseWhitespace`). Production runs it: live `/about/` is minified with 0 comments.

- **Hydration.** It strips Svelte's hydration markers and collapses whitespace, so every island re-renders instead of hydrating. The spike's node-identity probe:

  | Page | SRC reuse | DST reuse |
  | --- | --- | --- |
  | `/` (blog home) | 77/77 | 0/77 |
  | `/recipes/meals/` | 5019/5019 | 0/5019 |
  | search | 38/39 | 0/39 |
  | `/about/` (DST nav, today) | — | 0/16 |

  **Settled by review (brief A1(a)).** Candidate 1 restores reuse identical to the unprocessed build on every page: `conservativeCollapse: true` plus `ignoreCustomComments: [/^\[/u, /^\]/u, /^$/u, /^\$/u, /^astro:end$/u]`, with built-csp passing. The spike's 0-reuse result came from `collapseWhitespace` without `conservativeCollapse`.
  - Protecting `$` keeps Svelte's `$props.id()` markers, so SSR and client ids match (CSPB-7).
  - Protecting `astro:end` keeps islands from waiting for `DOMContentLoaded`.
  - Search, category and recipe detail pages legitimately replace part of their SSR DOM on mount. For example, search reuses 38/39 even without process-html. Hence the parity bar in 4.5.
- **Whitespace.** 19 of 105 article bodies change, and one inline `<code>` loses its leading space. Candidate 1 removes this.
- **Heading ids.** It adds ids to every id-less h2–h4. That gives 27 pages with duplicate ids versus 3 in SRC, and `id="#"` on two headings. Fixes:
  - The id pass skips `dist/blog/**` and `dist/recipes/**` (B06a).
  - `conventional-commits.md:69` (`## <img…>`) and `optimizing-ahrefs-orphan-pages-duplicate-content.md:99` (`<h2>&nbsp;</h2>`) are fixed at the source (B04).
- **Service-worker hash ordering.** The service worker is generated after `process-html` (B18).

**npm overrides.**

- `npm i yaml@2.9.1` fails with `EOVERRIDE` against the existing `"yaml": ">=2.8.3"` override. Changing the override to `"$yaml"` is verified to work (B05).
- `@vercel/routing-utils` pulls in path-to-regexp 6.1.0, so it gets a per-parent override (PA6).

**Test runner scope.** `npm test` only globs `src/lib/*.test.ts` (18 tests). PA1 widens the glob, adds `test:built` to the gate and CI, and adds a count floor. Without that, the ported suites would never run, and "passing" would mean nothing (§4.14).

**markdownlint dotfile.** The 106 posts lint clean only with `src/content/posts/.markdownlint.json`. It disables **15** rules: MD001, MD009, MD010, MD011, MD012, MD013, MD024, MD026, MD033, MD034, MD036, MD037, MD040, MD041 and MD051. The posts report 0 issues with it and 423 without (MD009 191, MD036 155, MD010 50). Shell globs skip dotfiles, so B03 copies it explicitly.

**Route collisions.**

- `/privacy/`: merge (J14).
- 404 and 500: DST's pages.
- robots: DST's static file plus `Disallow: /blog/search/`.
- Sitemap: `@astrojs/sitemap` with a `filter` (drops `/blog/search/`, 404 and 500) and a `serialize` (post lastmod).
- favicon: DST's.
- `release.json`: dropped.
- `prerenderConflictBehavior: 'error'`: raised nothing.

The B05 config keys (satteri, prism, `trailingSlash: 'always'`, `prerenderConflictBehavior`) leave DST's current output byte-identical (review csp-build check).

**Tailwind auto-source scanning.** In the overlay, DST's `Layout.*.css` grew from 45,779 to 57,836 B (+26%) once blog files existed. PA5 fixes it:

- `@import "tailwindcss" source(none)`.
- `@source` for `../components`, `../layouts`, `../pages` and `../lib`.
- `@source not` for `../components/blog`, `../components/recipes`, `../pages/blog`, `../pages/recipes`, `../lib/blog` and `../lib/components/ui`.
- A file-level `@source "../lib/components/ui/button.svelte"`.

With these exclusions, the review measured DST's Layout CSS at the same file hash as pristine-plus-PA5 (45,679 B) even with the full port present (CSPB-5).

`source(none)` drops exactly 4 selectors that only non-`src` files produced: `.visible`, `.fixed`, `.contents` and `.inline`. Each is unused as a class in DST `src`. Re-measured in round 2 with the whole plan bundle at `docs/plans/blogthedata-merge/`: still 45,679 B and exactly those 4 removed.

`source(none)` scopes only the stylesheet that declares it. SRC's blog stylesheet already imports Tailwind's utilities with `source(none)` and explicit `@source` lines (SRC `src/styles/ui.css:3-7`), so the committed bundle cannot leak into the blog bundle either.

Blog and recipe CSS gets its utilities from its own `@source` lines in `src/styles/blog/ui.css`. Those lines are re-pathed for the new depth (`../../lib/components/ui`, `../../components/blog/BlogNavigation.svelte`, `../../components/blog/Search.svelte`). Tailwind silently ignores missing paths, which the CSS-sources test guards (B06c, CSPB-1).

**Maintenance mode.** `build:maintenance` swaps content only inside `Layout.astro` (lines 17 and 108–127). BlogLayout honors `MAINTENANCE_MODE`, checked by a built test (B06c). `build:maintenance` becomes `MAINTENANCE_MODE=true npm run build`, so it can never drift from `build` (PA3).

**astro, tsconfig, svelte-check.**

- astro moves from 7.3.2 to 7.3.5. The CSP output is unchanged: the review's meta scan was identical and its probe showed 0 violations.
- Two `ts(4111)` errors in `html.ts:57,58` get fixed (B05).
- svelte-check is new (B02). On the proto it reported 2 errors in `html.ts` and 1 `baseUrl` deprecation warning.

**History and gitleaks.** Snapshot port. Squash-only merges and `required_linear_history` rule out a history merge anyway. Commit messages cite the source SHA (brief item 13).

**Repo visibility.** J4.

### 1.14 Code-level path rewrites (COMP-02)

`rewrite-content.mjs` covers posts only. Every hard-coded root path in code changes by hand in the step that ports its file. The list comes from a `git grep` over SRC `src/`, `scripts/recipes` and `public/recipes-pwa`. The 4.3(a) source scan fails on any legacy root path left behind.

| SRC file:line | Today | After | Step |
| --- | --- | --- | --- |
| `src/lib/html.ts:7-8` `imageUrl` | `'/media/default.webp'`; same-origin only if `startsWith('/media/')` | `'/blog/media/default.webp'`; same-origin if `startsWith('/blog/media/')`. Otherwise CMS uploads to `/blog/media` would be rewritten to nonexistent CloudFront URLs. | B05 |
| `src/content.config.ts:12` | `image` default `/media/default.webp` | `/blog/media/default.webp` | B05 |
| `src/components/About.astro:3,8-11` | `/media/default.webp`, `/social/*.svg` | `/blog/media/default.webp`, `/blog/social/*.svg` (as `AuthorCard.astro`) | B07 |
| `src/components/Navigation.svelte:28,29,36,40` | `/all-posts/`, `/rss/`, `/category/<slug>/`, form `/search/` | `/blog/all-posts/`, `/blog/rss.xml`, `/blog/category/<slug>/`, `/blog/search/` (as `BlogNavigation.svelte`) | B06c |
| `src/components/PostCards.svelte:40,44,45,62` | `/post/<slug>/`, `/category/<c>/`, `/all-posts/` | `/blog/<slug>/`, `/blog/category/<c>/`, `/blog/all-posts/` | B07 |
| `src/components/Search.svelte:21,34,40,47` | `fetch('/search-index.json')`, form `/search/`, `/all-posts/` | `/blog/search-index.json`, `/blog/search/`, `/blog/all-posts/` | B09 |
| `src/lib/search.ts` | result URLs `/post/<slug>/` | `/blog/<slug>/` | B05 |
| `src/layouts/Base.astro:16,27,28,48` | default image, `/rss/`, `/atom/`, footer `/`, `/all-posts/`, `/privacy/` | `/blog/media/default.webp`, `/blog/rss.xml`, `/blog/atom.xml`, `/blog/`, `/blog/all-posts/`, `/privacy/` (as `BlogLayout.astro`). Canonical and `site` become jsolly. | B06c; alternates B10 |
| `src/lib/content.ts`, `src/lib/feeds.ts:15` | `site` const blogthedata.com; item links `/post/` | `site` from the Astro config; item `<link>` `https://www.jsolly.com/blog/<slug>/`; guid/id text legacy (J8) | B06c, B10 |
| `src/pages/post/[slug]/index.astro:26,27,34,36` | manifest `/recipes-pwa/…`, breadcrumbs `/`, `/category/`, share `/social/` | recipe branch deleted; `/blog/`, `/blog/category/`, `/blog/social/`; JSON-LD `mainEntityOfPage` jsolly | B08 |
| `src/pages/privacy/index.astro:17` | `/post/how-to-implement-content-security-policy-django/` | `/blog/how-to-implement-content-security-policy-django/` (merged into jsolly privacy) | B12 |
| `src/pages/404.astro`, `sitemap.xml.ts` | `/all-posts/`; path list | dropped (DST 404 and sitemap integration) | — |
| `src/components/recipes/recipe-url.mjs:10,18` | `/recipes/<id>/` | unchanged (same path on jsolly) | B16 |
| `src/components/recipes/RecipePage.svelte:27,31` | `/recipes/<collection>/`, `/recipes/<id>/` | unchanged | B16 |
| `src/components/recipes/RecipeLibrary.svelte:106` | collection links | unchanged; hash deep links target `/recipes/` | B17 |
| `src/pages/recipes/[slug].astro:13` | breadcrumb `/` and `/post/15-minute-dump-and-go-instant-pot-recipes/` | `/recipes/` | B16 |
| `src/styles/article-content.css:8,13,16,24` | `[data-page="/post/15-minute-dump-and-go-instant-pot-recipes/"]` | rules move to recipe styles keyed on `/recipes/` | B16/B17 |
| `scripts/recipes/pwa-build.mjs:6,12,17,37,38` | `recipeRoute`, `/data/*`, `readdir`, `/media/recipes`, `/recipes-pwa` | `/recipes/`, `/recipes/data/*`, ids from `recipes.json`, `/recipes/media`, `/recipes/pwa` | B18 |
| `public/recipes-pwa/manifest.webmanifest:2,6,12,13` | `id`/`start_url` the old post, icons `/recipes-pwa/` | `id`/`start_url`/`scope` `/recipes/`, icons `/recipes/pwa/` | B18 |
| `recipes.json`, `nutrition-data.json`, `recipe-library.*` (84 paths each) | `/media/recipes/…`, old post URL | `/recipes/media/…`, `/recipes/` (JSON-aware rewrite; library regenerated) | B15 |

---

## 2. URL map

Files:

- `out/url-map.json`, which becomes `legacy/blogthedata/url-map.json` in PA6.
- `out/url-map-union.json`, which becomes `legacy/blogthedata/url-union.json`.
- The appendix, `out/url-map.md`.
- The generator, `out/build-url-map.mjs`. It is deterministic, uses only Node built-ins, and reads the bundle-root evidence files plus SRC config via `git show` and `git ls-tree`. Its SRC ref defaults to the pinned `bf1f7ff1…`, so `node out/build-url-map.mjs` reproduces every output byte for byte after awesome-blog `main` moves.
- `out/round1-id-map.json`: the round-1 → current row-id map (62 ids renumbered between rounds, 3 rows removed, 48 added). Round-1 review references resolve through it.

From PA6 on, the committed `url-map.json` is the source of truth. It is edited by hand or by `url-map-sync.mjs`, and `scripts/blogthedata-redirects.mjs` generates `vercel.json` from it. The bundle's generator retires at that point (§1.12).

### 2.1 Summary by class (305 rows)

| Class | Rows | 301 | 200 | 404 |
| --- | --- | --- | --- | --- |
| index (`/`, `/index.html`) | 2 | 2 | 0 | 0 |
| post | 111 | 105 | 0 | 6 |
| category | 7 | 6 | 0 | 1 |
| archive (`/all-posts/`) | 1 | 1 | 0 | 0 |
| search | 2 | 1 | 0 | 1 |
| feed | 2 | 2 | 0 | 0 |
| sitemap | 1 | 1 | 0 | 0 |
| robots | 1 | 0 | 1 | 0 |
| security | 2 | 1 | 1 | 0 |
| recipe-page | 25 | 25 | 0 | 0 |
| recipe-data | 2 | 2 | 0 | 0 |
| recipe-pwa | 4 | 4 | 0 | 0 |
| service-worker | 2 | 0 | 2 | 0 |
| asset-chrome | 8 | 8 | 0 | 0 |
| asset-media | 45 | 45 | 0 | 0 |
| asset-hashed (`/_astro/:file`) | 1 | 0 | 0 | 1 |
| legacy-alias | 7 | 6 | 0 | 1 |
| legacy-django | 36 | 0 | 0 | 36 |
| legacy-media | 5 | 0 | 0 | 5 |
| legacy-static | 1 | 0 | 0 | 1 |
| other | 40 | 3 | 1 | 36 |
| **Total** | **305** | **212** | **5** | **88** |

- 287 rows are exact and 18 are patterns. Every pattern row is a stays-404 row, written in Vercel's path-to-regexp form (for example `/_astro/:file`). No redirect uses a pattern, so an unknown filename can never 301 to a jsolly.com 404.
- The rows resolve to 202 distinct jsolly.com destination paths, listed in `out/url-map-destinations.json`.
- That makes 212 vercel.json redirect entries, against a limit of 2,048.
- Row ids were generated in class order. They are **frozen as of this revision**: round 2 added `decision_ref` values without changing any id (0 of 305), and every later change appends rows rather than renumbering.

### 2.2 Key mappings

**Posts.** `/post/<slug>/` → `https://www.jsolly.com/blog/<slug>/` for the 105 regular posts. Each row also covers the slashless, `/index.html` and `/index.html/` forms.

**Special case.** `/post/15-minute-dump-and-go-instant-pot-recipes/` → `https://www.jsolly.com/recipes/` (RCP-001). Old `#<recipe-id>` and `#meal-results` links keep working because the landing page renders the full library (§1.6).

**Index pages.**

- `/` and `/index.html` → `/blog/`
- `/all-posts/` → `/blog/all-posts/`
- `/search/` → `/blog/search/`; `?searched=` passes through
- `/works-cited/` → `/blog/works-cited/`
- `/privacy/` → jsolly `/privacy/` (J14, OTH-002)

**Categories.**

- The 6 current slugs map `/category/<slug>/` → `/blog/category/<slug>/`.
- Legacy slugs: `geodev` → `Geodev`, `devtools` → `dev-tools`, `webdev` → `web-dev`, `web-development` → `web-dev`.
- No tag or author URLs exist (§1.3).

**Renames** go straight to their final URL, never chained:

- `sollys-favorite-youtube-channels-and-podcasts` → `/blog/my-favorite-youtube-channels-podcasts-newsletters/`
- `how-to-leverage-closed-loops` → `/blog/how-to-ask-less-questions/` (J5)
- The dead old target, `/post/stop-asking-questions-to-save-time/`, stays 404.

**Feeds and site files.**

- `/rss/` → `/blog/rss.xml`; `/atom/` → `/blog/atom.xml`
- `/sitemap.xml` → `/sitemap-index.xml`
- `/pgp-key.txt` → `/pgp-key.txt`
- `/favicon.ico` → jsolly `/favicon.ico`

**Chrome assets and media.**

- `/topographic-logo.svg` and `/social/*.svg` → the same names under `/blog/`
- `/logo.webp` → `/blog/topographic-logo.svg`
- `/media/default.webp` → `/blog/media/default.webp`

**Recipes.**

- `/recipes/{meals,smoothies,<21 ids>}/` keep their paths; `?servings=&starch=` passes through.
- `/recipes/` → `/recipes/` (J10 opt-in, RCP-002).
- `/data/recipe-library.{json,md}` → `/recipes/data/…`.
- The 44 `/media/recipes/<file>` → `/recipes/media/<file>` and the 4 `/recipes-pwa/<file>` → `/recipes/pwa/<file>` are exact rows, one per tracked file (MU-4).

**Blog home on the old host.** `/blog/` → `https://www.jsolly.com/blog/` (J10 opt-in, OTH-001).

**Served with 200 by the legacy project:**

- Both kill-switch service workers.
- `/robots.txt`, permissive.
- `/.well-known/security.txt`, because Vercel cannot redirect `/.well-known`.
- `/404.html`, the project's own 404 page. Vercel serves output files directly; `/404.html` is also 200 today.

**Served 200 today → deliberately 404 (57 paths, pinned ledger).**

| Path | Count | Why it is dropped |
| --- | --- | --- |
| `/_astro/*` hashed assets (HSH-001, J27) | 55 | Content-hashed; the new site emits new hashes. All 55 are in the freeze dist; the crawl saw 53 of them at 200. |
| `/release.json` (OTH-031, J27) | 1 | The old smoke's release proof; no release is served from this host any more. |
| `/search-index.json` (SRH-002, J27) | 1 | Fetched only by the old search page; a cross-origin redirect would fail CORS anyway. |

You decide this drop as J27. The generator fails on any other 200→404 drop, and test 4.1 asserts the same ledger.

**Already 404 today, staying 404 (J10 and J2).** This covers 2 historical `/_astro` hashes, the 5 deleted posts, `/404/`, `/status/`, `/portfolio/`, `/category/portfolio/` and `/resume/`. It also covers the Django routes, `/static/*`, legacy `/media/*` uploads, `/media/post_metaimgs/*`, the crawler probes, and the lowercase variant probe PST-108.

### 2.3 Hop budget, case, query, fragments

**Hops.**

- https on either host: exactly one 301, straight to the final `https://www.jsolly.com/…` URL.
- http: Vercel's HTTPS-upgrade 308 comes first, then the 301.
- The project has no `trailingSlash` key. Page sources are emitted as `<base>{/index.html}?{/}?`, compiled to `^<base>(?:\/index\.html)?(?:\/)?$`. So slashless, slash, `/index.html` and `/index.html/` all take one hop. Today slashless takes 2–3 hops.
- That source does not match `<base>/service-worker.js` or `<base>index.html` (compile check).
- **Double slashes** (`//post/<slug>/`, `/post/<slug>//`) get a 308 to the clean path today, from the platform rather than from routing-utils. On a framework-null project without `trailingSlash`, the behaviour is **UNVERIFIED**: it is either 308 then 301 (two hops), or 404. The C2 step 5 verifier probes it, and the result goes in the execution record at the top of this plan. If it is 404, J28 applies: a follow-up PR adds the probed forms to `url-union.json` with `served_today` and an explicit allowance, so the 4.1 ledger records the drop.

**Hosts.** No row has a `has` condition. blogthedata.com, `www.blogthedata.com` and `blogthedata.vercel.app` therefore all redirect, which also ends `blogthedata.vercel.app` as a duplicate host serving the full blog. Today, apex blogthedata.com 308s to www through SRC's vercel.json host rule, not at domain level. After C2 every host takes one hop.

**Case.** Matching is case-sensitive, and sources and destinations keep their exact case. Evidence:

- `@vercel/routing-utils` `sourceToRegex` compiles with `sensitive: true`.
- **Production:** the existing renamed-post redirect returns 308 for the exact case and 404 for two case variants (review missed-urls probe).

Lowercase variants of mixed-case slugs are not rows, so they stay 404 as today. PST-108, `/post/find-your-dream-job-with-linkedin-boolean-search/`, is the explicit negative probe.

**Query.** Vercel appends the query string to redirect destinations. This is verified live on the existing rules: `?servings=6&starch=a:b` survived a 308.

**Fragments.** Browsers re-apply the fragment across a Location header that has none. Every old deep link survives only if the new page carries the same id:

- 467 content heading ids across 105 posts;
- the h1 `headingId(title)` id on every post;
- recipe-detail `id={recipe.id}` sections;
- `#meal-results` and `#<recipe-id>` on `/recipes/`.

The spike port preserved all of them (0 of 467 lost). They are pinned against the freeze build by `scripts/built/legacy-fragments.test.mjs` (B06c, MU-3).

### 2.4 Union check (`out/url-map-check.txt`)

**Inputs:**

- `urls-build.json`: 265 served files, normalized to slash form.
- `served-files.txt`: the same 265 files un-normalized, which adds the 138 `/<page>/index.html` forms (MU-1).
- `urls-live.json`: 803 rows, both hosts.
- `urls-history.json`: 655 paths.
- `sitemap-locs.txt`: 116 locations.
- SRC `vercel.json` and `redirects.json`: 5 entries.

**Normalization:** strip scheme, host and port; drop the fragment; split off the query into its own field; percent-decode each segment; keep case.

**Results:**

| Measure | Count |
| --- | --- |
| \|U\| | **901** (885 paths, 15 Django route templates, 1 host-scope element) |
| matched by exact row | **443** |
| matched by pattern | **442** |
| Django templates matched by pattern | **15** (instantiated with fixed sample values) |
| host-scope element (the old apex→www rule) | **1**, satisfied by an executable assertion that 0 rows carry `has` |
| **UNMATCHED** | **0** |
| **AMBIGUOUS** | **0** |
| served today (dist file or live 200) | 407 |
| served today → 404 (pinned ledger) | 57 (55 `/_astro`, `/release.json`, `/search-index.json`) |

The generator also enforces:

- No row lacks evidence.
- No redirect is chained.
- No serve-200 or stays-404 path is shadowed by a redirect.
- The served-today ledger matches its allowed set exactly.
- All 202 destination paths fall inside the expected merged layout of 220 paths. That layout comes from SRC `ls-tree` (posts, categories, recipe ids, recipe media, PWA files), the brief's route list, and DST `git ls-files` (`favicon.ico`, `privacy.astro`).

**Real-compiler cross-check** (`exp/compile-check.mjs` with `@vercel/routing-utils` 6.6.0; output in `out/compile-check.txt`). `out/legacy-blogthedata-vercel.json` compiles to 215 routes: 212 × 301 plus 3 header rules. The compiler is installed outside any repo and passed by environment variable; the script exits 2 with the install command if it is unset, missing or not 6.6.0:

```bash
RU_DIR="$(mktemp -d)" && npm i --prefix "$RU_DIR" @vercel/routing-utils@6.6.0
ROUTING_UTILS_DIR="$RU_DIR" node /Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/exp/compile-check.mjs
```

The install directory is a throwaway temp directory; the block is cwd-independent. After PA5 the script path is `docs/plans/blogthedata-merge/exp/compile-check.mjs`; PA6 retires it.

| Check | Result |
| --- | --- |
| Elements on redirect rows: exactly one compiled 301 with the exact Location | 362 |
| Elements on serve-200 or stays-404 rows: no compiled redirect | 538 |
| Exact redirect rows × every form (slash, slashless, `/index.html`, `/index.html/`): 301 with the right Location | 659 |
| Near-miss probes (`…commitsindex.html`, `…/index.htm`, `…/service-worker.js`, `…/index.html/x`, unknown recipe media and PWA file, `/recipes`, `/recipes/index.html/`) | 8/8 as expected |
| Lowercase negatives not redirected | 26 |
| Elements matched by more than one compiled route | 0 |
| Problems | **0** |

---

## 3. Where the redirects live

### 3.1 Option A′ in detail

**Directory**, added in PA6:

```text
legacy/blogthedata/
  vercel.json          generated from url-map.json by scripts/blogthedata-redirects.mjs (--check in the gate)
  url-map.json         the map (305 rows), source of truth
  url-union.json       the 901 known paths with row ids, evidence tags, hosts, sample queries and served_today,
                       so the test catches an edit that orphans a known URL and the map stays re-auditable
  fragment-ids.json    non-chrome id set per old page from the freeze build (added in B06c, refreshed at C0)
  public/              the ONLY served directory (outputDirectory "public")
    404.html           minimal, unstyled, noindex, links to https://www.jsolly.com/blog/
    robots.txt         "User-agent: *" / "Allow: /", with no Disallow, so crawlers can follow the 301s
    .well-known/security.txt
                       Contact https://www.jsolly.com/contact/ (J15)
                       Canonical https://www.blogthedata.com/.well-known/security.txt
                       Expires < 365 days out (RFC 9116)
    recipe-service-worker.js
                       kill-switch
    post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js
                       identical bytes
```

The write path runs `biome format --write` over the JSON files, so `biome ci` and `--check` never disagree.

**`vercel.json` shape.** The full preview is `out/legacy-blogthedata-vercel.json`; the real file has all 212 redirect entries.

```json
{
 "$schema": "https://openapi.vercel.sh/vercel.json",
 "framework": null,
 "installCommand": "",
 "buildCommand": "",
 "outputDirectory": "public",
 "git": { "deploymentEnabled": { "main": true, "*": false, "*/*": false, "*/*/*": false, "*/*/*/*": false, "**": false } },
 "headers": [
  { "source": "/(.*)", "headers": [ { "key": "X-Content-Type-Options", "value": "nosniff" }, { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }, { "key": "X-Frame-Options", "value": "DENY" }, { "key": "Content-Security-Policy", "value": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } ] },
  { "source": "/recipe-service-worker.js", "headers": [ { "key": "Content-Type", "value": "application/javascript; charset=utf-8" }, { "key": "Cache-Control", "value": "no-cache" } ] },
  { "source": "/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js", "headers": [ { "key": "Content-Type", "value": "application/javascript; charset=utf-8" }, { "key": "Cache-Control", "value": "no-cache" } ] }
 ],
 "redirects": [
  { "source": "/post/Adding-views-likes-to-posts{/index.html}?{/}?", "destination": "https://www.jsolly.com/blog/Adding-views-likes-to-posts/", "statusCode": 301 },
  { "source": "/media/recipes/chicken-posole-960.webp", "destination": "https://www.jsolly.com/recipes/media/chicken-posole-960.webp", "statusCode": 301 }
 ]
}
```

The file has no `trailingSlash`, no catch-all, no `has` and no `permanent`, which would yield 308. `outputDirectory` is `public` rather than brief A3's `.` (§7.4).

**Kill-switch service worker** (brief A4):

- `install`: `skipWaiting()`.
- `activate`, in order:
  1. `clients.claim()`;
  2. delete all caches (only `recipe-pages-pwa-*` and `recipe-pwa-*` exist);
  3. `registration.unregister()`;
  4. `client.navigate(client.url)` for every window client.
- No fetch handler.

The same-origin reload then hits the per-path 301, so the URL map stays the single source of truth. The code uses `Promise.all` rather than `await` in loops, to pass Biome.

**Project settings.** `legacy/blogthedata/vercel.json` sets framework null, an empty install command, an empty build command and output `public`. Those values override the dashboard's Astro, `npm ci` and `dist` settings.

John changes exactly three dashboard settings on project `blogthedata`, all in C2:

- **Auto-assign Custom Production Domains**, under Settings → Environments → Production: off at C2 step 2, back on at the end of the soak (C2 step 9);
- the **Git connection**, under Settings → Git: awesome-blog → jsolly-website (C2 step 3);
- the **Root Directory** (`legacy/blogthedata`), under Settings → Build and Deployment (C2 step 3).

Leaving the dashboard's own build settings untouched means a rollback reconnect to awesome-blog still builds correctly (SEQ-03). The staged deploy in C2 is the proof that the vercel.json values took.

**Why it survives the archive.** After C2 the project's Git source is jsolly-website, so archiving awesome-blog changes nothing. Even with no new deployments, an aliased production deployment is exempt from retention on every plan.

**Editing redirects later:**

1. Edit `legacy/blogthedata/url-map.json` in a jsolly-website PR (and `url-union.json` if the edit adds a known path).
2. Run `npm run redirects:write`; the gate checks the result.
3. Merge. Every jsolly-website merge creates a new legacy deployment.
   - **During the soak** (auto-assign off, C2 step 9 to the end of the soak), that deployment is staged and not served. John runs the staged verification and promotes it by hand.
   - **After the soak,** auto-assign is back on and it goes live directly.
4. Run `node scripts/verify-blogthedata-cutover.mjs --production`. The `legacy-redirects.yml` workflow (C2 step 8) also checks a fixed sample daily and after every `blogthedata` deployment.

`ignoreCommand` is not used; whether it works at Vercel's clone depth is UNVERIFIED.

### 3.2 Rejected options

- **A (frozen final awesome-blog deployment):** cannot be edited after the archive, and the map is not gate-tested.
- **B (attach the domains to jsolly-website), the fallback:**
  - jsolly's required `trailingSlash: true` compiles a 308 ahead of every redirect, giving 2 hops for slashless URLs.
  - Unmatched blogthedata paths would serve jsolly pages.
  - The domains would be coupled to jsolly's CSP and middleware.
- **C (Bulk Redirects):** Pro or Enterprise only, and cannot serve the service-worker files.
- **D (domain-level redirect):** blanket and path-blind, and it would redirect the service-worker scripts too.
- **E (Cloudflare rules):** needs proxying (your step-up), sits outside the gate, and the Free plan caps rules at 10.
- **F (a new repo):** the same as A′, plus one more repo to maintain.

### 3.3 Retention and Hobby constraints

**Keep indefinitely (J16):**

- The blogthedata.com registration.
- Cloudflare DNS, DNS-only: apex and www both CNAME to `37a94d917290a1e8.vercel-dns-016.com`. Cloudflare flattens the apex, so `dig` shows A 216.150.16.193 and 216.150.1.193 for both names (re-checked 2026-10-04; an earlier discovery note recorded `.129`).
- The google-site-verification TXT record.
- Vercel project `blogthedata` (`prj_QxSNy3z51xOp295HUvPfDa1JY9h8`).
- S3 bucket `blogthedata` and CloudFront `d1d7p8ufhgz4ld`.
- Both kill-switch service workers.
- Annual security.txt `Expires` bumps on both hosts (RFC 9116 recommends less than a year; this plan uses < 365 days everywhere). This is a recurring Todoist task (D0); the daily workflow warns 30 days ahead.

**Hobby constraints:**

- No Bulk Redirects.
- Instant Rollback reaches only the immediately previous deployment, hence the soak in C2.
- 100 deployments per day.
- 2,048 vercel.json redirects (212 used).
- The Auto-assign toggle and Promote have no documented plan restriction (UNVERIFIED until C2).

---

## 4. Verification plan

| # | Check | How | When | Pass |
| --- | --- | --- | --- | --- |
| 4.1 | Static redirect coverage | `scripts/unit/blogthedata-redirects.test.mjs` in `npm test`, 9 tests (detail below the table) | Gate and CI, from PA6 | All green. The prototype `exp/compile-check.mjs` already passes on this map (`problems: 0`, re-run in round 2). |
| 4.2 | Destination existence | `scripts/built/blogthedata-destinations.test.mjs`. Every 301 destination must exist in `dist/`: `/x/` → `x/index.html`, otherwise the file itself. That includes all 48 recipe media and PWA files by exact name. | Gate, from B22 | 202/202 exist |
| 4.3 | Internal links | `scripts/built/internal-links.test.mjs`, 4 tests (detail below the table) | Gate, from B22 | 0 failures in each |
| 4.4 | CSP | **(a)** PA4: the header's `img-src` token set is exactly `'self' data: https://d1d7p8ufhgz4ld.cloudfront.net`, and `form-action 'self'` is present. **(b)** B06c, static: the CloudFront `img-src` and the 4-host `frame-src` appear in the meta of every `dist/blog/**` page and of no other page. **(c)** B08, browser: `scripts/built/csp-browser.test.mjs` serves `dist` with the real `vercel.json` header injected and fails on any `securitypolicyviolation`. Pages: `/blog/`, a YouTube post, the nbviewer post, the diagrams.net post and `/about/`; from B09 on, also `/blog/search/?searched=django` (zod jitless); from B17 on, also `/recipes/`, `/recipes/meals/` and one recipe detail page. Third-party network is blocked; violations fire before any request. | Gate | 0 violations |
| 4.5 | Hydration node reuse | `scripts/built/hydration.test.mjs`, using the spike's node-identity method. It keeps references to every element inside `astro-island[ssr]` at `DOMContentLoaded`, then counts how many are still connected after hydration and network idle. Pages: `/` and `/about/` (PA2), `/blog/` (B07), `/blog/search/` (B09), a recipe detail page (B16), `/recipes/meals/` (B17). The baseline is an `astro build` without process-html, run once per test file in a `temp-copy.mjs` copy (§1.7), so the real `dist/` and data store are untouched. | Gate | **Parity:** each page's reuse in the shipped build equals its reuse in that pre-process-html build. In addition, 100% on `/`, `/about/`, `/blog/` and `/recipes/meals/`. |
| 4.6 | Heading-id and fragment contract | The ported "article rendering preserves legacy fragments" unit test (B05) pins `html.ts:61-75`. A built test (B06a) checks that ids under `dist/blog/**` and `dist/recipes/**` are byte-identical before and after `process-html`, with no `id="#"` and no empty ids. `legacy-fragments.test.mjs` (B06c) asserts that every non-chrome id of each old page, per `legacy/blogthedata/fragment-ids.json`, exists on its mapped page. | Gate | Unchanged; 0 missing ids |
| 4.7 | Feed legacy ids | B10. Each pre-merge post in `/blog/rss.xml` has `<guid isPermaLink="false">` whose text is exactly the old `https://www.blogthedata.com/post/<slug>/`. Its `<link>` is `https://www.jsolly.com/blog/<slug>/`. Atom `<id>` values keep the old text, and the Atom feed `<id>` is unchanged. The recipe post is absent. Content-Type header rules for both feeds exist in `vercel.json`. Readers dedupe on guid text, which is unchanged. | Gate | Exact equality |
| 4.8 | Kill-switch across two origins | `scripts/built/blogthedata-killswitch.test.mjs` (PA6, Playwright). Origin A (`127.0.0.1:<p1>`) first serves a cache-first fixture worker that mimics the old ones: same URLs, same scopes (`/` and the post path), same cache prefixes. It precaches a page. Origin A then switches to serving `legacy/blogthedata/public`, with redirects compiled to origin B (`127.0.0.1:<p2>`). Trigger `registration.update()` or a navigation, then assert the caches are empty, there are no registrations, and the tab lands on origin B's mapped URL. | Gate (PA6); C2 production fetch | 2/2 |
| 4.9 | Visual comparison with live | `scripts/port/visual-compare.mjs` (Playwright and sharp), writing under `os.tmpdir()`. Local `astro preview` against live `www.blogthedata.com`, at 1280×800 and 390×844. Pages: home, a code post, a YouTube post, a category, all-posts, search, works-cited, `/recipes/meals/` (shuffled cards masked) and a recipe detail. Header and footer link targets are masked. | After B06c, B07 and B08, and in C0 | ≤ 0.5% differing pixels per page outside masks. Anything over is reviewed and recorded in the PR body. |
| 4.10 | Live cutover verifier | `scripts/verify-blogthedata-cutover.mjs` (B21) with `redirect: 'manual'`, 2 unit tests against a stub server (detail below the table) | C0 step 8 (destinations, on the preview, John), C1 (destinations), C2, then daily and per `blogthedata` deployment from C2 step 8 | 0 failures |
| 4.11 | Production smoke | B20 adds to `scripts/production-smoke-scenario.mjs`: (1) `/blog/` → first post, with h1 and body present, checked by `verifyHttp`; (2) GET search round trip on `/blog/search/?searched=<that post's title>`, which must list the post (this exercises the `/blog/search-index.json` fetch under production CSP and middleware); (3) the `/recipes/` island hydrates, with service workers blocked by the runner; (4) the feeds return `application/rss+xml` and `application/atom+xml`; (5) `Accept: text/markdown` on a real post returns HTML 200. The fleet runner template is not edited. | Every production deploy from C1 on | The run for the release SHA succeeds |
| 4.12 | PagesCMS and content contracts | Ported "CMS fields cover…", plus a new `.pages.yml` paths test and a PagesCMS-shaped category JSON passing `biome ci` (unit, B13). `blog-content-contracts.test.mjs` (B14) in a temp copy: a CMS post builds; a draft never leaks into `dist` or the route manifest; invalid timestamps fail; a duplicate post or category slug fails; an unknown `related` slug fails; a CMS image under `/blog/media/` renders same-origin. | Gate | 3/3 unit, 7/7 built |
| 4.13 | Middleware | PA3 adds 6 cases to `src/lib/accept-negotiate.test.ts`: a real route passes through; unknown `/blog/nope/` keeps the Markdown 404; `/recipes/data/*.md` passes through; `.avif` and `.mp4` never get 406; `.xml` feeds are untouched; exempt routes get no `Vary: Accept`. A built test also checks that the route manifest equals the built routes. | Gate | All green |
| 4.14 | Test count ledger | See below. Enforced mechanically: `scripts/run-tests.mjs` fails `npm test` or `test:built` when the node:test summary reports fewer tests than `scripts/test-counts.json`. | — | — |

**4.1 detail.** The 9 tests in `scripts/unit/blogthedata-redirects.test.mjs`:

- Compile `legacy/blogthedata/vercel.json` with `getTransformedRoutes`: no error, ≤ 2,048 entries.
- Every redirect row, in **every** form (exact; and for page rows slashless, slash, `/index.html`, `/index.html/`), hits exactly one route with status **301** and the exact `Location`. Rows are host-agnostic, so the test asserts there is no `has`.
- serve-200 rows: unmatched by any redirect, the file exists, and the service-worker headers are correct.
- stays-404 rows, their samples and the near-miss negatives: unmatched.
- Lowercase negatives: unmatched.
- Every `url-union.json` path matches exactly one row.
- **Served-today ledger:** union paths with `served_today` whose row is stays-404 equal exactly the `/_astro/:file` samples plus `/release.json` and `/search-index.json`, so any future 200→404 drop fails.
- `redirects:check` passes; robots has no `Disallow`; security.txt is RFC 9116-valid with `Expires` less than 365 days after the date of the commit under test (`git log -1 --format=%cI`). That check depends only on the tree and its commit, so it is hermetic. The future-date check runs daily in `legacy-redirects.yml`, not in the gate.
- The kill-switch has no `fetch` listener and calls `unregister`, `claim` and `caches.delete`.

**4.3 detail.** The 4 tests in `scripts/built/internal-links.test.mjs`:

- **(a)** Every same-origin `href`, `src`, `srcset`, manifest and icon in `dist/**/*.html` resolves. A `#fragment` must name an id that exists on its target page; this covers the 2 `#directives` cross-post links.
- **(b)** Rendered content has no links to `blogthedata.com`; bare-text prose mentions are allowlisted.
- **(c)** Every link to a mixed-case slug (22 posts and `Geodev`) uses the exact case.
- **(d)** No legacy root path (`/post/`, `/category/`, `/all-posts/`, `/search/`, `/search-index.json`, `/rss/`, `/atom/`, `/media/`, `/data/`, `/recipes-pwa/`, `/social/`) appears in `src/**` code or in `dist/**/*.{js,json,xml,webmanifest}`, where the HTML check cannot see URLs built in JS or JSON. Matches are **root-anchored**: the path must start a URL value, so it is preceded by a quote, `(`, `=`, whitespace, a backtick or an origin (`blogthedata.com`, `jsolly.com`), for example `` (?<=["'`(=\s]|blogthedata\.com|jsolly\.com)/(?:post|category|all-posts|search|rss|atom|media|data|recipes-pwa|social)(?:/|\.json) ``. The new paths (`/blog/media/x.webp`, `/blog/category/…`, `/recipes/data/…`) never match, and a negative fixture asserts that. Allowlisted: escaped code samples in posts, and the legacy guid text.

**4.10 detail.** The verifier runs every map row against 3 hosts (blogthedata.com, `www.blogthedata.com`, blogthedata.vercel.app) × https and http × every form (slashless, slash, and for page rows `/index.html` and `/index.html/`), plus every served `index.html` form in `url-union.json`, derived from the file rather than hard-coded (140 today: 139 `/<page>/index.html` plus `/index.html`; MU-1 added 138 of them).

- **https:** 301 with the exact Location.
- **http:** 308 to https, then that 301.
- **Queries:** the probes `?servings=6&starch=a:b`, `?searched=django` and `?utm_source=x` must be preserved.
- **serve-200 rows:** 200 and the right content type, with service-worker bodies byte-equal to the repo.
- **stays-404 rows,** including the lowercase negatives: 404.
- **Destinations:** each 301 destination must return 200 on jsolly.com.
- **Double slashes:** the forms `//post/<slug>/`, `/post/<slug>//` and `//` are probed, and the result is recorded (§2.3).
- **Fragments:** recorded, but they cannot be tested server-side.

Modes:

- `--base-url <deployment URL> --transport vercel-curl`: John only, for SSO-protected deployments (the staged legacy deployment at C2 step 5, the jsolly preview at C0 step 8). It runs `vercel curl --scope jsollys-projects --cwd "$(mktemp -d)"`, so the CLI never links or prompts inside a checkout (flag behaviour UNVERIFIED until C0 step 8), with `-sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-redirs 0`. The agent prints the block with the real URL filled in.
- `--production`.
- `--production --sample`: the `legacy-redirects.yml` workflow.
- `--destinations-only --base-url <url>`: C1 (production) and, with `--transport vercel-curl`, C0 step 8 (the preview).

### 4.14 Test count ledger

**SRC baseline: 131.**

| Suite | Tests |
| --- | --- |
| test:astro | 14 |
| test:search | 3 |
| test:browse | 2 |
| test:recipes | 55 (36 unit, 5 article-generator, 1 migration-rewrites, 13 PWA) |
| smoke contract | 5 |
| test:stack-protection | 4 |
| test:infra | 43 (plan-infra 24, check-infra-drift 14, deploy-infra 5) |
| verify:* scenarios | 5 |

**Ported: 67.**

| Suite | Ported | Where they go |
| --- | --- | --- |
| test:astro | 7 | Blog unit (B05): CMS timestamps (adapted for J19), legacy fragments. Blog built (B08): published URLs and drafts (re-sourced from `url-map.json` rows), related cards. Blog built (B10): feeds. Unit (B13): "CMS fields cover…". `recipes-built` (B17): "Recipe route shares…". |
| search | 3 | B05 |
| browse | 2 | B07, re-pathed to `/blog/` |
| recipes | 47 | 36 unit tests (B15) and 11 PWA tests: B17 6 (details 2, filters 2, collections 2, with the snapshot assertion stripped), B18 5 (snapshot assertion re-added) |
| smoke contract | 3 | B20: "article page with no body fails", "public article, GET search, feeds and mobile navigation are read-only", "feed smoke rejects HTML in place of XML" |
| verify | 5 | B14 |

**Dropped: 64, each named.**

- **test:astro (7):**
  - "import preserves body, slug case…" and "invalid or ambiguous exports fail…": `import-legacy` is gone.
  - "historical redirects … matching Vercel rules": superseded by 4.1.
  - "static CSP permits emitted hydration scripts by hash…": DST's `built-csp.test.mjs` asserts the same on every page.
  - "source signatures detect…": `source-signature.mjs` is gone.
  - "all builds record an exact release SHA": `release.json` is dropped.
  - "backup verification fails…": `verify-media-backup` is gone.
- **test:recipes (8):**
  - The 5 article-generator tests ("canonical title changes…", "editorial HTML tables…", "comparison table ownership…", "missing, duplicate and inverted boundaries…", "nested and crossing editor markers…"): the generator is gone (J7).
  - "rewrite pins source and replacement…": a migration verifier.
  - "Legacy and root workers update independently…" and "Previous shipped article snapshot migrates…": both `git archive d6adba53`, a SHA DST does not have. 4.8 replaces them.
- **smoke contract (2):**
  - "release readiness rejects stale builds…": there is no `release.json`.
  - "canonical route smoke rejects broken and misdirected historical links": moved to 4.10 and the daily `legacy-redirects.yml` sample.
- **infra (47):** every test in the four infra files. They stay in the archive (J9); titles are in Appendix A.

67 + 64 = 131.

**DST baseline: 20** (`npm test` 18, smoke contract 1, built-csp 1).

**New tests: 49 that survive, plus 6 temporary.**

| Phase | Count | Steps |
| --- | --- | --- |
| A | 24 | PA1 1 (count wrapper); PA2 3 (2 hydration, 1 comment kinds); PA3 7 (6 unit, 1 manifest); PA4 1; PA5 1 (Layout selector set); PA6 11 (9 unit, 2 browser) |
| B | 25 | B06a 1 (id ownership); B06c 4 (per-page CSP, maintenance, legacy fragments, CSS sources); B07 1; B08 1; B09 1; B10 1; B11 1 (built: `scripts/built/blog-site-files.test.mjs`); B13 2 (paths, PagesCMS JSON); B14 2 (unknown `related`, CMS image); B16 1; B17 2 (hydration, deep links); B20 1; B21 2; B22 5 (destinations 1, internal links 4) |
| Temporary | 6 | B01 `scripts/unit/port-tooling.test.mjs`, deleted with `scripts/port/` at C0 |

**Expected totals.**

| Point | Total | npm test | Smoke contract | build-chained built-csp | test:built |
| --- | --- | --- | --- | --- | --- |
| After Phase A | **44** (= 20 + 24) | 34 | 1 | 2 | 7 |
| During Phase B, at B23 (B01's temporary 6 still present) | **142** | 86 | 5 | 3 | 48 |
| At C1, after C0 deletes `scripts/port/` | **136** (= 20 + 67 + 49) | 80 | 5 | 3 | 48 |

Every step's PR body states its before and after counts and updates `scripts/test-counts.json`. A count that drops without naming the dropped test fails the gate.

---

## 5. Ordered implementation steps

### Conventions

**Commits and merges.**

- Each step from PA1 through B23 is one commit, and each lands green through `/ship` with a local semantic review. B00 is a setup step: it makes no jsolly-website commit.
- Phase A targets `main`: each step is its own PR, squash-merged. **Landing order:** PA1, then PA5 (it commits this plan bundle and must precede any other tracked non-`src` file), then PA2, PA3 and PA4 in any order, then PA6.
- Phase B targets `port/awesome-blog` and lands **strictly in numeric order** (B06a, B06b, B06c in sequence). A non-main base has no required check, so merge only on a green `ci` (brief A2).
- Commit messages cite `awesome-blog@<cut SHA>`, read from `scripts/port/source.json` (B01).

**Worktrees, never the primary checkout** (EX-03). Every step runs in a fresh worktree; nothing is implemented in `/Users/johnsolly/code/jsolly-website` itself (fleet norm; keeps John's checkout free for his own work). Until PA5 merges, steps read the bundle by absolute path, `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/`; afterwards they read `docs/plans/blogthedata-merge/` inside their own worktree.

```bash
# Phase A step (example: PA1). cwd-independent.
git -C /Users/johnsolly/code/jsolly-website fetch origin
git -C /Users/johnsolly/code/jsolly-website worktree add -b pa1-test-runner /Users/johnsolly/code/jsolly-website/.claude/worktrees/pa1 origin/main
```

```bash
# Phase B step (example: B03). Branch names are flat (port-bNN-<slug>): a ref under
# port/awesome-blog/ would collide with the existing port/awesome-blog branch.
git -C /Users/johnsolly/code/jsolly-website fetch origin
git -C /Users/johnsolly/code/jsolly-website worktree add -b port-b03-content /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-b03 origin/port/awesome-blog
```

`.claude/worktrees/` is gitignored in jsolly-website. After a step merges, `/ship` removes its worktree per its local-resource cleanup.

**`/ship` for Phase B** (SEQ-07, EX-05). `/ship`'s defaults assume `main`; Phase B overrides them:

- A step branch is created from `origin/port/awesome-blog` (above) and is only ever synced with `origin/port/awesome-blog`. Never merge or rebase `origin/main` into a step branch: a step PR would then squash main's changes into the port.
- Run the review as `review-diff.sh "$CHECKOUT" origin/port/awesome-blog`.
- Run the merge check against base `port/awesome-blog`. It reports false, so never arm auto-merge.
- Record `deploy: none (non-default base)`.
- Never run `follow-production-smoke` for a port SHA.
- **Auto-fix stays off** on the final `port/awesome-blog` → `main` PR and on every step PR (`set_monitor` with `auto_fix: false`). `/ship` enables it by default on private repos (`integrate.md` → Auto-fix), and a long-lived draft would otherwise take fix pushes outside step review.

**Syncing `main` into the port** (SEQ-02, EX-05). Main reaches `port/awesome-blog` only through real merge commits, never a squash "sync main" PR: a squash does not advance the merge base, so every later sync would re-conflict. The repo's merge settings allow only squash merges for PRs, so the merge commit is pushed directly to `port/awesome-blog`, which is the head branch of the open final PR:

```bash
# Sync worktree; cwd-independent.
git -C /Users/johnsolly/code/jsolly-website fetch origin
git -C /Users/johnsolly/code/jsolly-website worktree add -b port-sync /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-sync origin/port/awesome-blog
git -C /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-sync merge --no-ff origin/main
```

Then run the full gate in that worktree and push through `/ship`'s push-to-an-open-PR path (`git push origin HEAD:port/awesome-blog`, reviewed against `origin/port/awesome-blog`), waiting for `ci` on the final PR's new head with a fresh `SINCE`.

- **When:** after B05, before B16, and at C0 step 7 (the last sync; merges to `main` freeze from there until C1), plus whenever the final PR reports a conflict.
- **UNVERIFIED (gh 401 in review):** that no ruleset or branch protection blocks a direct push to `port/awesome-blog`. Check it at the first sync with a read of `gh api repos/jsolly/jsolly-website/rulesets`. If a push is refused, stop and ask John; changing rulesets is his.
- Each step PR body records the `freeze-check` result (SEQ-12).

**CI steps.** Every step that adds a `ci.yml` step (PA1, PA3, PA6, B15) gives it `if: steps.verified-tree.outputs.run_full != 'false'`, like every existing step (§1.10).

**Cross-repo sessions** (EX-10). Steps that change awesome-blog (B00 step 2, C4 steps 1–3) run in a separate session with cwd `/Users/johnsolly/code/awesome-blog`, started or explicitly authorized by John at that step; a jsolly-website session never pushes, opens or merges PRs in awesome-blog. Read-only awesome-blog reads (C0 steps 1 and 3) may run from any session.

**Hook blobs.** When a step changes `.git-hooks/pre-commit` (PA1, PA3, PA6, B15), the dispatcher refuses the new bytes. The agent approves its own edit with the printed command. John is involved only if the blob was not authored in that PR.

**Biome.** Every file lands already conformant, because the gate forbids otherwise. Conformance work sits inside each slice, budgeted from the spike's per-area counts in §1.13.

**Gate legend.** G is the full DST gate: routes, biome, yaml, knip, actionlint, md, smoke contract, `check:ts`, `npm test`, build with built-csp, and `test:built`. `+R` adds `redirects:check` (from PA6). `+C` adds `recipes:check` (from B15).

**Sizes.** XS is under 50 lines, S under 300, M under 1k, L over 1k or many files.

### Phase A: port-neutral prerequisites to `main`

These PRs prepare `main` for the port without porting anything. PA2, PA3, PA4 and PA5 change production behaviour on `main` (hydration, middleware, the CSP header, 4 unused CSS selectors); PA1 and PA6 do not. Each rolls back by a `/ship` revert PR. Landing order: PA1, PA5, PA2–PA4, PA6.

**PA1. Test-runner structure** (brief A1(d)). S. Depends on: none. Gate: J23.

- `package.json`:
  - `test` = `node scripts/run-tests.mjs unit`, which runs `node --import ./scripts/register-ts-from-js.mjs --experimental-strip-types --test "src/**/*.test.ts" "src/**/*.test.mjs" "scripts/unit/*.test.mjs"`.
  - `test:built` = `node scripts/run-tests.mjs built`, which runs `node --test --test-concurrency=1 "scripts/built/*.test.mjs"`.
- `scripts/run-tests.mjs` and `scripts/test-counts.json` (`{ "unit": 19, "built": 0 }`). The wrapper parses the node:test summary and fails when the count is below the ledger (MST-10). It gets one unit test, `scripts/unit/run-tests.test.mjs`.
- `.git-hooks/pre-commit`: add `run_step "built tests" npm run test:built` after build (approve the blob).
- `.github/workflows/ci.yml`: add the `test:built` step after build, with the verified-tree guard (YAML in §1.10).
- `knip.json`: entry `src/**/*.test.{ts,mjs}` (a verified no-op today).
- `AGENTS.md`: Commands table.
- The plan bundle is **not** in PA1; PA5 commits it (§1.12, CON-02).
- Tests: +1. Gate G; the empty `test:built` passes at count 0.

**PA2. Hydration-safe process-html** (brief A1(a)). S. Depends on: PA1.

- `process-html.mjs`: `conservativeCollapse: true` and `ignoreCustomComments: [/^\[/u, /^\]/u, /^$/u, /^\$/u, /^astro:end$/u]`. This is candidate 1, settled by review. If node identity still fails, fall back to the same options with `collapseWhitespace: false`.
- `scripts/built/temp-copy.mjs` (new shared helper, §1.7): copies the `git ls-files -co --exclude-standard` set to a temp directory, gives it a private `node_modules/` that symlinks every entry except `.astro` and `.vite`, and asserts afterwards that the real tree's `node_modules/.astro/data-store.json` mtime is unchanged. B06c and B14 reuse it.
- `scripts/built/hydration.test.mjs`: a `node:http` static server over `dist/`, driven by Playwright, with the parity bar (4.5). Its baseline is an `astro build` without process-html inside a `temp-copy.mjs` copy.
- `scripts/built/process-html-comments.test.mjs`: the set of island comment kinds (`[`, `]`, empty, `$`, `astro:end`) is unchanged by process-html (CSPB-7).
- Record the size delta in the PR.
- Tests: +3. Gate G. This fixes today's nav-island re-render in production.

**PA3. Middleware exemptions and route manifest** (brief A1(b) and A7). M. Depends on: PA1. Gate: J11.

- `src/lib/accept-negotiate.ts`: any extension other than `.md` counts as static, which fixes the `.avif` 406.
- `src/lib/agent-response.ts`: the `.md` branch skips `/recipes/data/`, and real `/blog/**` and `/recipes/**` routes listed in the manifest pass through.
- `scripts/route-manifest.mjs` (new): writes the gitignored JS module `src/generated/route-manifest.js` (§1.13).
  - In PA3 it lists DST's static pages only. Post expansion (with the `draft === false` filter through `parsePost`) arrives in B08 and recipe expansion in B16, each with its template, because `parsePost` and `yaml` exist only from B05 (F-05).
  - Unit tests inject the manifest, so `npm test` does not depend on the generated file.
- `package.json`:
  - a `routes` script, `node --import ./scripts/register-ts-from-js.mjs --experimental-strip-types scripts/route-manifest.mjs`, which `build`, `check:ts`, `test` and `worktree:init` run first;
  - `build:maintenance` = `MAINTENANCE_MODE=true npm run build` (MST-08).
- `biome.jsonc` and `knip.json`: ignore `src/generated`.
- Also touched: `.gitignore`, `.git-hooks/pre-commit` (routes runs before knip; approve the blob), `ci.yml`, `src/lib/accept-negotiate.test.ts`, `scripts/built/route-manifest.test.mjs` and `AGENTS.md`.
- **Feasibility proof** (brief A7). In a scratch clone with a hand-written `.vercel/project.json` (projectId, orgId, settings `{framework:'astro', buildCommand:'npm run build', outputDirectory:'dist'}`), run `npx vercel build --prod --yes` offline. Never use `vercel link`, `vercel pull` or John's token. Pass when:
  1. the build log shows the `routes` script running before the middleware compile;
  2. `.vercel/output/functions/middleware.func/src/generated/route-manifest.js` exists and equals the built route list.

  The review already showed the order with a JSON manifest (`vercel build` exit 0; static build ranked before `@vercel/node`). The known warning that `middleware.ts` uses the deprecated `edge` runtime is recorded in the PR.
- **Fallback** if the proof fails: a blanket exemption for `/blog/**` and `/recipes/**`. In that case PA3 itself ships the llms.txt wording that Markdown variants exist only for the five portfolio pages, so `main` never contradicts llms.txt. The PR states which path was taken.
- Tests: +6 unit, +1 built. Gate G.

**PA4. CSP header image host and form-action** (brief A1(c)). XS. Depends on: PA1. Gate: J6.

- `vercel.json`: `img-src 'self' data: https://d1d7p8ufhgz4ld.cloudfront.net` and `form-action 'self'`.
- `scripts/built-csp.test.mjs`: one more test for the exact tokens.
- Tests: +1. Gate G. Neutral: the meta still restricts every current page to `'self'`, and DST has no forms.

**PA5. Tailwind explicit sources and the plan bundle.** S (the bundle is a verbatim copy). Depends on: PA1. Lands second. This is a new Phase A item (§7.4).

- `src/styles/main.css`: `@import "tailwindcss" source(none);` plus the `@source` and `@source not` lines in §1.13.
- `scripts/built/layout-css.test.mjs`: pins DST's Layout CSS selector set, which must stay fixed through all of Phase B.
- `docs/plans/blogthedata-merge/`: the whole bundle, copied from `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/` (§1.12).
- `biome.jsonc`: `"!docs/plans"` in `files.includes`. `knip.json`: `"ignore": ["docs/plans/**"]`.
- **Proof in the PR:** a selector-set diff of `dist/_astro/Layout.*.css` between `origin/main` and the PR head, both built in `/ship` worktrees (which carry no untracked bundle). The removed selectors must be exactly `.visible`, `.fixed`, `.contents` and `.inline`, each shown unused as a class by `git grep` over `src`, and none may be added. Size goes from 45,779 to 45,679 B. Round 2 reproduced exactly this with the bundle present, plus a clean `biome ci . --error-on-warnings`, knip exit 0 and markdownlint 0 issues (§1.12).
- **Review of the bundle.** The 2.4 MB bundle is the John-approved plan, copied verbatim; `diff -r` against the untracked copy proves it and the review records that result. The `/ship` review lenses cover `main.css`, `biome.jsonc`, `knip.json` and the layout test, not the evidence JSON.
- After merge: the agent compares the untracked copy with the merged one (`diff -r`) and, with John's OK, removes the untracked copy from awesome-blog's `.migration-work/`.
- Tests: +1. Gate G.
- Why it lands before every other non-`src` file: Tailwind's automatic scanning reads every non-gitignored file, so the bundle (CON-02) and PA6's tracked files (`static` in `url-map.json`) would otherwise change jsolly's CSS.

**PA6. The `legacy/blogthedata` redirect project** (brief A1(e)). M. Depends on: PA1, PA5. Gate: J1, J2, J5, J10, J14, J15.

- `legacy/blogthedata/{vercel.json,url-map.json,url-union.json}`, all Biome-formatted, copied from the bundle's `out/url-map.json` and `out/url-map-union.json`. These are the persisted map and evidence (COMP-01).
- Retires the bundle's generator (§1.12): deletes `docs/plans/blogthedata-merge/out/{build-url-map.mjs,check-inventory-coverage.mjs,url-map.json,url-map-union.json,legacy-blogthedata-vercel.json,url-map-destinations.json}` and `docs/plans/blogthedata-merge/exp/compile-check.mjs`, and removes the `docs/plans/**` knip ignore in the same commit.
- `legacy/blogthedata/public/{404.html,robots.txt,.well-known/security.txt,recipe-service-worker.js,post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js}`.
- `scripts/blogthedata-redirects.mjs`: `--write` generates `vercel.json` (page rows as `<base>{/index.html}?{/}?`) and formats the JSON; `--check` compares parsed output.
- `scripts/unit/blogthedata-redirects.test.mjs` (9) and `scripts/built/blogthedata-killswitch.test.mjs` (2).
- `package.json`: devDependency `@vercel/routing-utils` `6.6.0`, the path-to-regexp override, and `redirects:write` / `redirects:check`.
- `legacy/blogthedata/url-map.json` `meta` gains a `freeze_sha` key (null until C0), which `url-map-sync.mjs` fills at C0 and the C2 rollback reads after `scripts/port/` is gone.
- `knip.json`: ignore `legacy/blogthedata/public/**` in the same commit as the files.
- Hook (approve the blob) and `ci.yml`: add `redirects:check`.
- `AGENTS.md`: ownership note.
- The PR shows the PA5 Layout selector test still green.
- Tests: +11. Gate G+R.
- Stays inert until John re-points Vercel at C2. The dependency lands here because this is its first importer (§7.4).

### Phase B: the port on `port/awesome-blog`

One PR per step (B01–B23), squash-merged into the branch, in numeric order.

**B00. Cut the branch and freeze** (setup; no jsolly-website commit). Depends on: PA1–PA6 merged. Gate: J3, J4.

1. John confirms the awesome-blog code freeze.
2. **awesome-blog session** (John starts or authorizes it; cwd `/Users/johnsolly/code/awesome-blog`), via `/ship`: a docs-only PR adding a one-line freeze notice to `AGENTS.md`. The notice says code is frozen and the blog is moving to jsolly-website; content-only edits are allowed until C0; do not drain Dependabot.
3. After that PR merges, record awesome-blog's `origin/main` as the **cut SHA** in the execution record (docs-only PR to `main`), and B01 commits it to `scripts/port/source.json`:

   ```bash
   git -C /Users/johnsolly/code/awesome-blog fetch origin
   git -C /Users/johnsolly/code/awesome-blog rev-parse origin/main
   ```

4. Agent: a Todoist task via `/persist-todos-in-todoist` saying awesome-blog is code-frozen and excluded from drains until C4.
5. Create `port/awesome-blog` at `origin/main` through `/ship`'s ref-only push path (`integrate.md` → Ref-only pushes: no PR, verified with `git ls-remote`):

   ```bash
   git -C /Users/johnsolly/code/jsolly-website fetch origin
   git -C /Users/johnsolly/code/jsolly-website push origin origin/main:refs/heads/port/awesome-blog
   git -C /Users/johnsolly/code/jsolly-website ls-remote --heads origin port/awesome-blog
   ```

The final `port/awesome-blog` → `main` PR cannot exist yet: GitHub refuses a PR whose head has no commit beyond its base. B01 opens it.

Content-only edits stay allowed until C0 (brief A5).

**Remedy for a non-content diff** reported by `freeze-check`, before the C0 re-sync:

- port it as an extra B-step, designed and reviewed when it arises. That step must: pin one awesome-blog SHA and read every changed file from it, never from a moving `origin/main`; port only the paths in `git diff --name-status` from `cut_sha` to that SHA, including deletions and renames; keep the port's own hand edits (for example B04's two heading fixes), which an area `--overwrite` import would replace; and advance `cut_sha` in `scripts/port/source.json` (and the execution record) to the pinned SHA, so `freeze-check` and C0's `--resync` measure from it. Do not run `import --resync` for this: it is C0-only, refuses any non-content change, and sets `freeze_sha`; or
- revert it in awesome-blog, with John's OK.

**B01. Port tooling.** S. Depends on: B00. Every script lives in `scripts/port/`:

- `source.json`: `{ "cut_sha": "<the B00 cut SHA>", "freeze_sha": null }`, written with the real value. Every port script reads its SHAs from here, so no command takes a SHA argument.
- `import-awesome-blog.mjs`: reads SRC only through `git -C … archive` or `show <sha>`. It applies the §1 path map, keeps categories in PagesCMS shape, Biome-formats `recipes.json`, `nutrition-data.json` and `.markdownlint.json`, imports one area at a time (`<area>...`, at `freeze_sha ?? cut_sha`, refusing to replace a target that already differs from SRC unless `--overwrite` is passed), and has a `--resync` mode for C0. `--resync` takes no SHA: it reads awesome-blog's `origin/main`, refuses any non-content change before writing, and records that SHA as `freeze_sha`.
- `rewrite-content.mjs`: the deterministic, idempotent rewrites used in B04. It never touches `<code>` or `<pre>` content, or the receipts.
- `url-map-sync.mjs`: adds rows (and `url-union.json` paths) for posts, categories, recipes and media that exist at a given SHA but are missing from the map. For each new page it also adds the served `/<page>/index.html` form to `url-union.json`, so the verifier probes it; the row already covers it. It never removes rows, and it skips drafts.
- `freeze-check.mjs`: fails on any non-content diff between `cut_sha` and awesome-blog `origin/main`.
- `fragment-ids.mjs`: generates `legacy/blogthedata/fragment-ids.json` from a SRC build at a given SHA.
- `visual-compare.mjs`: check 4.9, writing under `os.tmpdir()`.
- `scripts/unit/port-tooling.test.mjs`, 6 tests (MST-06):
  1. rewrite-content run twice gives no diff;
  2. receipts and `url-map.json` stay byte-identical;
  3. url-map-sync never removes rows and skips draft or missing-draft posts;
  4. freeze-check exits non-zero on a `src/lib` change and zero on a content-only change;
  5. import applies the path map, including the explicit `.markdownlint.json` copy;
  6. code spans and blocks are byte-identical after rewriting.

Gate G+R. Tests: +6 temporary. These scripts and the test are removed in C0.

**After B01 merges into the port:** open the final `port/awesome-blog` → `main` PR as a **draft** through `/ship`, with Auto-fix off, and record its number in the execution record. It carries the main syncs (§5 Conventions).

**B02. astro 7.3.5 and svelte-check.** XS. Depends on: B00.

- `package.json`: `astro ~7.3.5`, `svelte-check` 4.7.6, and `check:ts` gains `svelte-check --tsconfig ./tsconfig.json`.
- Lockfile, plus `tsconfig.json` if needed for the `baseUrl` deprecation.
- The PR records that build and svelte-check pass with no `svelte.config.js`.
- Gate G+R.

**B03. Content snapshot.** L, mechanical. Depends on: B01. Gate: J7.

- `src/content/blog/posts/*.md`: 105 posts, verbatim; the instant-pot post is excluded.
- `src/content/blog/posts/.markdownlint.json`: copied explicitly, Biome-formatted.
- `src/content/blog/categories/*.json`: 6, in PagesCMS shape. The formatter override for this directory lands here, because B03 is the first commit containing these files; B13 adds its test.
- The route manifest does not expand posts yet (no template), so its built test stays green.
- Gate G+R. markdownlint reports 0 issues on the 105 posts. The J4 author check is already done (J4).

**B04. Content rewrites.** S, one dedicated commit. Depends on: B03. `rewrite-content.mjs` runs over `src/content/blog/posts/`:

- The 57 absolute `/post/` links (31 files, 32 targets, apex and www) become `/blog/<slug>/`, keeping any `#fragment`.
- Other self-links become their jsolly equivalents: `/all-posts/`, `/pgp-key.txt`, `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt`, and the bare root → `/blog/`.
- The `/password-reset/` hrefs in `how-to-send-email-with-python-the-hard-way.md` become plain text.
- The escaped `local.js` and `carousel.js` code samples stay byte-identical (COMP-04).
- The recipe slug leaves `related` in `UI-enhancement-leads-to-major-architecture-changes`, `compress-minify-assets-69-percent-faster-page-load` and `gis-job-search-resources`.
- `conventional-commits.md:69` and `optimizing-ahrefs-orphan-pages-duplicate-content.md:99` are fixed.
- Prose mentions of "blogthedata.com" stay; the editorial list goes in the PR body, along with the dry-run file list (the §1.1 adapt count).
- Gate G+R.

**B05. Collections and the core blog lib.** L. Depends on: B04. Gate: J19.

- `src/content.config.ts`: no `legacyId`; `image` default `/blog/media/default.webp`.
- `src/lib/blog/post-loader.ts`, with `frontmatter.ts` merged in.
- `src/lib/blog/html.ts`: hoisted, named regexes; `ts(4111)` fixes; `legacyMedia` un-exported; `imageUrl` per §1.14.
- `src/lib/blog/search.ts`: `z.config({ jitless: true })`; result URLs `/blog/<slug>/`.
- Tests, all under `npm test`: `src/lib/blog/post-loader.test.ts` (CMS timestamps, `legacyId` assertion adapted, 1), `src/lib/blog/html.test.ts` (article rendering preserves legacy fragments, 1) and `src/lib/blog/search.test.ts` (3).
- `astro.config.ts`:
  - `markdown: { processor: satteri({features:{smartPunctuation:false,gfm:false}}), syntaxHighlight: 'prism' }`
  - `trailingSlash: 'always'`
  - `prerenderConflictBehavior: 'error'`
- `package.json`: overrides `"yaml": "$yaml"`; dependencies `yaml`, `@astrojs/markdown-satteri`, `sanitize-html`, `@types/sanitize-html`, `entities`, `minisearch` and `zod`.
- Ordering: `content.ts` and `feeds.ts` wait for their first importers (B06c, B10), because knip forbids an unimported file.
- Tests: 5 ported. Gate G+R.

**B06a. process-html id ownership.** S. Depends on: B05.

- `process-html.mjs`: the id pass skips `dist/blog/**` and `dist/recipes/**`.
- `scripts/built/process-html-ids.test.mjs`: runs the id pass over a fixture `dist` tree. It asserts that ids under `blog/` and `recipes/` are byte-identical, that there is no `id="#"` and no empty id, and that DST pages still get their ids.
- Tests: +1. Gate G+R.

**B06b. Blog styles.** M. Depends on: B06a, PA5.

- `src/styles/blog/{theme,ui,blog,no-script}.css` in `@layer blog`, with the layer order declared. They are Biome-conformant (223 diagnostics budgeted) and not yet imported.
- `ui.css` `@source` lines are re-pathed to `../../lib/components/ui` and `../../components/blog/BlogNavigation.svelte`. The `Search.svelte` line is added in B09, with its file.
- Gate G+R. Knip does gate CSS here (its tailwind plugin reports unimported `.css`), so B06b carried a temporary `knip.json` ignore for the four sheets, which B06c's import forced out (§7.5).

**B06c. BlogLayout, navigation, first route.** L. Depends on: B06b.

- `src/layouts/BlogLayout.astro`:
  - honors `MAINTENANCE_MODE`;
  - emits no Markdown alternate;
  - has a head slot;
  - takes `section: "blog" | "recipes"`, which gates `insertDirective` behind the fail-closed `Astro.csp` guard;
  - points canonical URLs at jsolly.
- Components and lib:
  - `src/components/blog/BlogNavigation.svelte`, with the GitHub link → `https://github.com/jsolly` and paths per §1.14;
  - `src/lib/components/ui/input.svelte`;
  - `src/lib/ui-types.ts` (`WithoutChildrenOrChild`);
  - `src/lib/blog/content.ts`, with `cards` merged in and `site` read from the Astro config.
- Public: `public/blog/{topographic-logo.svg,social/*.svg,media/default.webp}`.
- Route: `src/pages/blog/works-cited/index.astro`.
- `legacy/blogthedata/fragment-ids.json`, generated by `fragment-ids.mjs` from the cut SHA.
- Tests:
  - `scripts/built-csp.test.mjs` gets the per-page directives test.
  - `scripts/built/blog-maintenance.test.mjs`: `build:maintenance` in a temp copy renders maintenance markup on every page and no post text.
  - `scripts/built/legacy-fragments.test.mjs`: 4.6, active for each page as its route lands.
  - `scripts/built/blog-css-sources.test.mjs`: every `@source` path exists, and the BlogLayout bundle contains the pinned selector sample.
- Tests: +4. Gate G+R. Run the first visual comparison.

**B07. Blog index, archive, categories.** L. Depends on: B06c.

- Components: `src/components/blog/{PostCards.svelte,AuthorCard.astro}` (paths per §1.14).
- Pages: `src/pages/blog/{index,all-posts/index,category/[slug]/index}.astro`.
- Tests: `scripts/built/blog-browse.test.mjs` (2 ported) and hydration +1 (`/blog/`).
- Gate G+R. Run the visual comparison.

**B08. Post page.** L. Depends on: B07.

- `src/pages/blog/[slug]/index.astro`. The recipe branch goes. Kept: related cards, share buttons with jsolly URLs, and JSON-LD `mainEntityOfPage` pointing at jsolly.
- `scripts/route-manifest.mjs` gains post expansion: it imports `parsePost` from `src/lib/blog/post-loader.ts` and lists only `draft === false` posts (§1.13). **Proof step:** `npm run routes` must run outside Astro with the TS loader flags, even though `post-loader.ts` imports `astro/markdown`. If that import cannot load outside Astro, `route-manifest.mjs` parses frontmatter with `yaml` using the same core-schema options, and `scripts/built/route-manifest.test.mjs` asserts that its draft set equals the build's on all posts. The PR states which path was taken.
- Tests:
  - `scripts/built/blog-contract.test.mjs` gets related cards and published URLs/drafts (2 ported; expected URLs come from `legacy/blogthedata/url-map.json` post and category rows).
  - `scripts/built/csp-browser.test.mjs` is new (+1).
- Gate G+R. Run the visual comparison.

**B09. Search.** M. Depends on: B08.

- `src/pages/blog/search/index.astro`: noindex, keeps `?searched=`.
- `src/pages/blog/search-index.json.ts`.
- `src/components/blog/Search.svelte`: fetches `/blog/search-index.json`. The `ui.css` `@source` line for it is added here.
- Tests: hydration +1 (`/blog/search/`, parity bar). `/blog/search/?searched=django` joins the CSP browser test.
- Gate G+R.

**B10. Feeds.** S. Depends on: B09. Gate: J8.

- `src/lib/blog/feeds.ts`: legacy guid and id text with `isPermaLink="false"` (J8); `<link>` on jsolly; `feedPosts` un-exported.
- `src/pages/blog/{rss,atom}.xml.ts`: the recipe post is excluded.
- `vercel.json`: Content-Type rules for both feeds.
- BlogLayout: alternate links.
- Tests: `scripts/built/blog-feeds.test.mjs`, with feeds (ported) and legacy ids (+1). Gate G+R.

**B11. Sitemap, robots, security files.** S. Depends on: B10.

- `astro.config.ts` sitemap: `filter` and `serialize` (lastmod from `updated`).
- `public/robots.txt`: `Disallow: /blog/search/`.
- `public/.well-known/security.txt` (J15) and `public/pgp-key.txt`.
- Tests: `scripts/built/blog-site-files.test.mjs` under `test:built` (+1): the built sitemap, robots and security.txt syntax, with `Expires` less than 365 days after the commit date. Gate G+R.

**B12. Privacy merge.** XS. Depends on: B11. Gate: J14.

- `src/pages/privacy.astro` and `src/content/agent-pages.ts` (privacy Markdown) get the merged statements (J14), including the §1.14 link.
- Gate G+R.

**B13. PagesCMS.** S. Depends on: B12.

- `.pages.yml` (§1.5).
- `src/lib/blog/pages-config.test.ts`: "CMS fields cover…" (ported), the paths test (+1), and the PagesCMS-shaped category JSON passing `biome ci` (+1).
- Gate G+R.

**B14. Content contracts (porting verify:*).** M. Depends on: B13.

- `scripts/built/blog-content-contracts.test.mjs`: 5 ported scenarios, plus the unknown-`related` build failure (+1) and the CMS `/blog/media` image scenario (+1). It runs in the §1.7 temp copy, with `serializePost` inlined.
- Gate G+R. Expect roughly +25 s.

**B15. Recipe data and the assistant-data pipeline.** M. Depends on: B14. Gate: J7.

- Data: `src/components/recipes/{recipes.json,nutrition-data.json}`, using the JSON-aware path rewrite and Biome formatting.
- Modules: `src/components/recipes/{recipe-logic,display-units,nutrition,nutrient-filters,recipe-export,trn-logic}.mjs` with their 6 `*.test.mjs` files (36 tests). `dailyNutrients` and `recipeDisclaimer` are un-exported.
- `scripts/recipes/sync-assistant-data.mjs`, which regenerates `public/recipes/data/recipe-library.{json,md}`.
- `public/recipes/media/*` (44 files).
- `package.json`: `recipes:sync`, `recipes:check`.
- `biome.jsonc`: `!public/recipes/data`.
- Hook (approve the blob) and `ci.yml`: add `recipes:check`, with the verified-tree guard.
- The route manifest does not expand recipe ids yet (no template).
- Tests: 36 ported. Gate G+R+C.

**B16. Recipe detail pages.** L. Depends on: B15.

- `src/pages/recipes/[slug].astro`: the 21 ids only, rendered with `BlogLayout section="recipes"`, as the pages used `Base.astro` in SRC. Breadcrumbs per §1.14.
- `scripts/route-manifest.mjs` gains the 21 recipe ids from `recipes.json`.
- Components: `src/components/recipes/{RecipePage,RecipeBody,RecipeFlow,RecipePrint,ShareRecipe,ApplianceIcon,NutrientDisclosure}.svelte`.
- Modules: `{recipe-url,ingredient-icon,recipe-print-session}.mjs`.
- UI: `dialog`, `dialog-content`, `dialog-description`, `dialog-overlay`, `dialog-portal`, `dialog-title`, `collapsible` ×3, `checkbox` and `native-select`.
- Styles: `src/styles/recipes/{recipes-theme,recipes-no-script}.css` in `@layer blog`, imported by recipe pages only.
- `package.json`: `bits-ui`, `@lucide/svelte`, `@internationalized/date`.
- Tests: hydration +1 (a recipe detail page, parity bar). No ported PWA tests: they need the landing page (MST-01).
- Gate G+R+C.

**B17. Recipe landing and collections.** L. Depends on: B16. Gate: J13.

- `src/pages/recipes/index.astro`: `<RecipeExperience />` with defaults (the full library, initial `meal` collection), plus the h1 with `id="easy-meals--smoothies"`.
- `src/pages/recipes/[slug].astro` gains the `meals` and `smoothies` entries, and the route manifest lists them.
- Components: `src/components/recipes/{RecipeExperience.astro,RecipeLibrary.svelte,FilterMultiSelect.svelte,NutritionHelp.svelte}`. The localStorage key becomes `recipes-settings-v1` (J13).
- UI: `popover`, `popover-content`, `popover-portal`, `popover-trigger`.
- Tests:
  - `scripts/built/recipes-built.test.mjs`: ported from astro-contract lines 174–201.
  - `scripts/built/recipes-browse.test.mjs`: details-without-JS and share (2), Easy Meals filters (2) and collections (2). The collections tests have the `pwa.test.mjs:376` snapshot assertion stripped.
  - `scripts/built/recipes-deep-links.test.mjs` (+1): each of `/recipes/#<id>` for all 21 ids, plus `#meal-results`, opens its target.
  - Hydration +1 (`/recipes/meals/`).
  - `/recipes/`, `/recipes/meals/` and one recipe detail page join the CSP browser test.
- Tests: 7 ported, +2 new. Gate G+R+C.

**B18. Recipe PWA.** M. Depends on: B17.

- `scripts/recipes/pwa-build.mjs` (§1.6). It runs in `build` after `process-html` and emits no worker in maintenance mode.
- `src/components/recipes/{RecipePwa.astro,recipe-pwa-client.mjs}`: scope `/recipes/`; added to the recipe pages' head slot.
- `public/recipes/pwa/{manifest.webmanifest,icon-180.png,icon-192.png,icon-512.png}`.
- `vercel.json`: `no-cache` for `/recipes/service-worker.js`.
- Tests: `scripts/built/recipes-pwa.test.mjs` (5 ported). The offline-snapshot assertion that the snapshot includes the no-JS stylesheet is re-added inside "Recipe PWA installs…". The fixture sends `Vary: Accept` and uses no `git archive`. The `PWA_SCREENSHOTS` branch is deleted. `blog-maintenance.test.mjs` gains the assertion that there is no `dist/recipes/service-worker.js`.
- Gate G+R+C.

**B19. jsolly self-references.** S. Depends on: B18. Gate: J18.

- `src/components/SiteNavigation.svelte`: Blog → `/blog/` in the same tab; add Recipes.
- `src/components/Footer.astro`.
- `src/components/home/SiteIntro.astro`: drop "writing lives on Blogthedata, not here".
- `src/content/socialLinks.ts`: drop the entry, which also drops it from `sameAs`.
- Delete `src/images/social/blogthedataLogo.svg`.
- `src/content/agent-pages.ts`.
- `public/llms.txt`: blog, recipes, feeds, and Markdown status per PA3.
- Apply the J18 wording.
- Gate G+R+C.

**B20. Smoke scenario.** S. Depends on: B19.

- `scripts/production-smoke-scenario.mjs` and `.test.mjs`: 3 ported and +1 (§4.11, including the search round trip).
- Gate G+R+C.

**B21. Cutover verifier.** M. Depends on: B20.

- `scripts/verify-blogthedata-cutover.mjs` (§4.10, including the `--sample` mode and the double-slash probes) and `scripts/unit/verify-blogthedata-cutover.test.mjs` (+2).
- Gate G+R+C.

**B22. Destination existence and link check.** S. Depends on: B04, B09, B10, B11, B12, B18, B19.

- `scripts/built/blogthedata-destinations.test.mjs` (+1) and `scripts/built/internal-links.test.mjs` (+4, §4.3).
- Gate G+R+C.

**B23. Docs and AGENTS invariants that ship with the code.** S. Depends on: B22. Gate: J17.

- `docs/publishing.md`: PagesCMS on jsolly-website, including the grant timing and rehearsal.
- `docs/recipes.md`: pipeline, PWA and kill-switch.
- `docs/recipes-evidence/` (J17). `biome.jsonc` gains `"!docs/recipes-evidence"`.
- `AGENTS.md`, rewritten to cover:
  - Purpose: the site is no longer "seven pages … no CMS";
  - Stack and Architecture;
  - the commands, test layout and gate steps that Phase B added;
  - the invariants: the heading-fragment algorithm must not change; slugs are case-sensitive and stable; PagesCMS timestamp and WYSIWYG rules, and its ownership of category JSON formatting; the CloudFront runtime dependency; legacy feed ids; the kill-switch is never removed; `legacy/blogthedata` ownership and the edit flow (COMP-08).
- `README.md`: the "Blog and recipes" section (§1.12).
- The plan bundle stays: `docs/plans/blogthedata-merge/` remains on `main` until D1, because C0–C4, the rollback rule and D0/D1 run after C1.
- Gate G+R+C.

**Final integration PR (C1).** `port/awesome-blog` → `main`, opened as a draft right after B01, with Auto-fix off.

- The PR body links every step PR. It includes the test ledger, the visual-comparison results, J1–J28 as answered, and the `freeze-check` result.
- Before merge, the head must contain the current `origin/main` (merged in, never squashed), with green `ci` on that head. Merges to `main` freeze from that last sync until C1.
- Immediately before the squash, `/ship` pushes the tag `port-awesome-blog-steps` at the final head.
- Squash into one commit on `main` (J3).

---

## 6. Cutover

Every step needs John's explicit approval. Each command block names its cwd or is cwd-independent (`git -C`, `gh --repo`). Agent commands that need the port scripts run in the C0 port worktree, `/Users/johnsolly/code/jsolly-website/.claude/worktrees/port-c0`, created from `origin/port/awesome-blog` as in §5. No block contains a placeholder: SHAs come from committed files, and URLs and IDs are read by the agent before it prints a block.

**Rollback ordering rule** (SEQ-05). Once C2 is promoted, any C1 rollback first rolls back C2, then reverts or rolls back jsolly-website. Reverting C1 alone would point every blogthedata 301 at a 404, and would redeploy the legacy project with a stale map.

After any Instant Rollback, Vercel turns auto-assign off for that project. John uses "Undo Rollback" (or Promote) once the fix lands.

### X1. Cross-repo prerequisite: project-discriminating production smoke (before C0)

Needs John's authorization, at plan approval, for a separate dotagents session. This plan does not make the change itself: cross-repo canon lives in dotagents, and jsolly-website's `AGENTS.md` forbids starting a fleet rollout from here.

**Why.** Today, Vercel project `blogthedata` posts GitHub deployments with environment `Production` (17 by `vercel[bot]`). Once it is connected to jsolly-website, its deployments can:

- trigger jsolly's Production smoke, which filters only on `environment == 'Production'` (`production-smoke.yml:28`);
- be picked by `/ship`'s `.[0]` deployment lookup.

The legacy deployment is READY in seconds, so a smoke it triggers can test the previous jsolly release.

**Change, in dotagents:**

- `templates/github/production-smoke.yml`: gate on `github.event.deployment_status.environment_url` (or `target_url`) starting with the jsolly project's deployment host prefix. Accept `Production` and a project-qualified `Production – jsolly-website`. Adopt SRC's hardening (J21): `vercel[bot]` creator, and the deployment SHA must be an ancestor of `main`.
- `skills/ship/references/deploy-verify.md`: select the jsolly deployment by project, never a bare `.[0]`, when two projects post the same environment and SHA.

**Substitution point.** Today the template's only knob is the environment literal. The per-project deployment-host prefix needs a new template substitution point (for example `REPLACE_PRODUCTION_URL_PREFIX`), so jsolly-website sets its own prefix and stays template-conformant. The candidate value for jsolly-website is `https://jsolly-website-`: the latest production deployment host read through the Vercel MCP is `jsolly-website-54j7gov4t-jsollys-projects.vercel.app`. It is a candidate to confirm against a real `deployment_status.environment_url` payload in the X1 session, not a fact (gh returned 401 in review).

**The chain, all John-started:**

1. At plan approval, John starts a dotagents session with this prompt:

   > In /Users/johnsolly/code/dotagents, implement X1 from the blogthedata merge plan (`/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/plan.md` §6 X1, or `docs/plans/blogthedata-merge/plan.md` on jsolly-website main after PA5). Add a project-discriminating filter to templates/github/production-smoke.yml through a new substitution point for the deployment-host prefix, confirming the prefix against a real deployment_status payload; adopt awesome-blog's vercel[bot]-creator and ancestor-of-main hardening; make skills/ship/references/deploy-verify.md select the deployment by project. Ship it via /ship, then link the merged PR on the open dotagents fleet-rollout Todoist task. Do not change any other repository.

2. Once dotagents is idle (`fleet-sync.md`), John starts the fleet rollout lead (`/persist-todos-in-todoist` → Fleet rollout). It walks every fleet repo, one `/ship` PR each.
3. C0 waits for the rollout's jsolly-website PR to merge. Only that PR gates this plan. After C2, the legacy project's deployments must start no jsolly smoke run.

### C0. Freeze and re-sync

**Preconditions:**

- B23 is merged.
- Every J-decision gated through C0 is answered (gate table).
- X1 is merged in dotagents and synced into jsolly-website.
- The final PR is green.

**Actions:**

1. Agent (read-only): list awesome-blog's open PRs and issues, its branches and any armed auto-merge. John merges or abandons each PR, and any arm is disarmed (SEQ-09). A comment on someone else's PR or issue is third-party outbound: it follows the outbound-identity rule, including the 15-minute hold.

   ```bash
   gh pr list --repo jsolly/awesome-blog --state open --json number,title,author,headRefName,autoMergeRequest
   gh issue list --repo jsolly/awesome-blog --state open --json number,title,author
   git -C /Users/johnsolly/code/awesome-blog ls-remote --heads origin
   ```

2. John: stop merging awesome-blog PRs, and remove awesome-blog from the PagesCMS GitHub App's repository selection.
3. Agent: create the C0 port worktree, fetch awesome-blog and run the freeze check. It reads `cut_sha` from `scripts/port/source.json` and must report no non-content diff since the cut; otherwise apply the B00 remedy.

   ```bash
   git -C /Users/johnsolly/code/jsolly-website fetch origin
   git -C /Users/johnsolly/code/jsolly-website worktree add -b port-c0-resync /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-c0 origin/port/awesome-blog
   git -C /Users/johnsolly/code/awesome-blog fetch origin
   cd /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-c0 && npm ci && node scripts/port/freeze-check.mjs
   ```

   Then list the content changes since the cut:

   ```bash
   cd /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-c0 && git -C /Users/johnsolly/code/awesome-blog diff --name-only "$(node -p "require('./scripts/port/source.json').cut_sha")"..origin/main -- src/content/posts src/content/categories src/components/recipes/recipes.json src/components/recipes/nutrition-data.json public/media
   ```

4. Agent, in a PR into port from that worktree: re-sync. The full gate must be green, including the 4.1 union and ledger tests.
   - `node scripts/port/import-awesome-blog.mjs --resync`. It records awesome-blog's current `origin/main` as `freeze_sha` in `scripts/port/source.json`, keeps categories in PagesCMS shape and Biome-formats `recipes.json`, `nutrition-data.json` and `.markdownlint.json`.
   - `node scripts/port/rewrite-content.mjs`
   - `npm run recipes:sync`
   - `node scripts/port/url-map-sync.mjs` (it reads `freeze_sha` and writes it to `legacy/blogthedata/url-map.json` `meta.freeze_sha`)
   - `node scripts/port/fragment-ids.mjs` (at `freeze_sha`)
   - `npm run redirects:write`
   - The execution record gets the freeze SHA by a docs-only PR to `main`.
5. Agent: run the visual comparison (4.9) with `scripts/port/visual-compare.mjs`.
6. Agent, in a PR into port: delete `scripts/port/` and `scripts/unit/port-tooling.test.mjs`. Update `scripts/test-counts.json` to `{ "unit": 80, "built": 48 }` (136 tests in total with smoke 5 and built-csp 3).
7. Agent: the last main sync (§5 Conventions). From here until C1, merges to `main` freeze, so the head John previews in step 8 is the head C1 merges.
8. John (J20): comment `/preview` on the final PR. The agent reads the preview URL from the Vercel Preview workflow's PR comment (or the read-only Vercel MCP `list_deployments` for project `jsolly-website`, target preview, for the final PR's head SHA) and prints this block with `PREVIEW_URL` filled in; John runs it in the C0 worktree. As written here the variable is empty, and the guard line stops the block.

   ```bash
   PREVIEW_URL=""
   : "${PREVIEW_URL:?the agent fills in the preview URL before printing this block}"
   cd /Users/johnsolly/code/jsolly-website/.claude/worktrees/port-c0 && git fetch origin && git switch --detach origin/port/awesome-blog && npm ci && node scripts/verify-blogthedata-cutover.mjs --destinations-only --transport vercel-curl --base-url "$PREVIEW_URL"
   ```

   **Pass:** every 301 destination returns 200 on the preview, and both feeds return their XML Content-Types. The 4.11 scenario does not run here: it pins `https://www.jsolly.com` and first runs at C1.

**Approval gate:** "C0 done; approve C1?"

**Rollback:** none needed; nothing is deployed.

### C1. Deploy the merged site

**Preconditions:**

- C0 is approved.
- The final head contains the current `origin/main` with green `ci`.
- No other jsolly-website PR is in flight.
- John's C2 dashboard session is scheduled within 24 hours.

**Actions:**

1. Agent, via `/ship`: mark the final PR ready, push the tag `port-awesome-blog-steps` at its head, then squash-merge on a green `ci`. The PR number comes from the execution record.

   ```bash
   gh pr ready "$(gh pr list --repo jsolly/jsolly-website --head port/awesome-blog --state open --json number --jq '.[0].number')" --repo jsolly/jsolly-website
   ```

2. Agent: wait for Vercel to report READY, then for the Production smoke run for that exact SHA. Record its URL in the execution record. A missing, cancelled or failed run is not success.
3. Agent, through `/ship`'s ref-only path: delete `port/awesome-blog` (the tag keeps every step commit), unless the repo already deleted it on merge.

   ```bash
   git -C /Users/johnsolly/code/jsolly-website push origin --delete port/awesome-blog
   ```

4. Agent: check that every 301 destination returns 200 and the feeds return the right Content-Types.

   ```bash
   cd /Users/johnsolly/code/jsolly-website && git pull --ff-only && node scripts/verify-blogthedata-cutover.mjs --destinations-only --base-url https://www.jsolly.com
   ```

5. Agent: confirm the port branch is gone (the command prints nothing). Then John grants the PagesCMS GitHub App access to jsolly-website and runs the rehearsal in §1.5. The rehearsal PR is closed unmerged.

   ```bash
   git -C /Users/johnsolly/code/jsolly-website ls-remote --heads origin port/awesome-blog
   ```

**Duplicate content window.** blogthedata.com still serves the full blog, so duplicate content is live from here until C2. The maximum window is 24 hours. If C2 cannot start within it, John decides explicitly: revert C1, or accept the delay.

**Approval gate:** "C1 verified; approve C2?"

**Rollback:** a revert PR via `/ship`, or Instant Rollback on project `jsolly-website` (John, in the dashboard; then "Undo Rollback" once fixed).

### C2. Switch blogthedata.com to redirect-only

**Preconditions:**

- C1 is verified.
- X1 is in jsolly-website (a C0 precondition).
- `legacy/blogthedata` on `main` is current.
- No legacy deployment has been made yet.

**Actions:**

0. Agent: hold all merges into jsolly-website, Dependabot drains included, until step 8 lifts the hold.
1. Agent: record the current awesome-blog production deployment ID of project `blogthedata` (`prj_QxSNy3z51xOp295HUvPfDa1JY9h8`) with the read-only Vercel MCP `list_deployments`, in the execution record. It is the exact rollback target.
2. John, in the dashboard for project `blogthedata`: Settings → Environments → Production, turn **off** Auto-assign Custom Production Domains. Change no Framework, Install, Build or Output settings; `legacy/blogthedata/vercel.json` carries them.
3. John: Settings → Git. Disconnect `jsolly/awesome-blog` and connect `jsolly/jsolly-website` with Production Branch `main`. Then Settings → Build and Deployment → Root Directory: `legacy/blogthedata`.
4. John: Deployments → Create Deployment from `main`. It is staged rather than assigned, because auto-assign is off.
5. John: verify the staged deployment. The agent does not probe staged deployments: the Vercel MCP fetch tool creates bypass links and follows redirects (SEQ-11). The agent reads the staged deployment's URL with the read-only Vercel MCP `list_deployments` (project `blogthedata`, newest READY, not aliased) and prints this block with `STAGED_URL` filled in. As written here the variable is empty, and the guard line stops the block.

   ```bash
   STAGED_URL=""
   : "${STAGED_URL:?the agent fills in the staged deployment URL before printing this block}"
   cd /Users/johnsolly/code/jsolly-website && git pull --ff-only && npm ci && node scripts/verify-blogthedata-cutover.mjs --transport vercel-curl --base-url "$STAGED_URL"
   ```

   `vercel curl` may create a project automation-bypass secret. If its flags differ (UNVERIFIED), the fallback is a Protection Bypass for Automation secret that stays in John's shell, passed as `--bypass-env VERCEL_AUTOMATION_BYPASS_SECRET`.

   **Pass:** 0 failures, with both service-worker URLs returning 200. The double-slash results go in the execution record (§2.3, J28).
6. John: Promote the staged deployment. No rebuild.
7. Agent: run the full production check, then compare the production kill-switch bodies against the repo bytes. Optionally, John opens an installed old recipe PWA and confirms it lands on `https://www.jsolly.com/recipes/`.

   ```bash
   cd /Users/johnsolly/code/jsolly-website && node scripts/verify-blogthedata-cutover.mjs --production
   ```

8. Deployment-discrimination check, the monitoring workflow, and lifting the hold:
   1. John revokes any automation-bypass secret that step 5 created.
   2. Agent: one `/ship` PR adding `.github/workflows/legacy-redirects.yml`. It runs `node scripts/verify-blogthedata-cutover.mjs --production --sample` daily on a schedule, on `workflow_dispatch`, and on `deployment_status` events whose `environment_url` starts with the legacy project's host prefix (candidate `https://blogthedata-`, confirmed against the real `environment_url` of the C2 step 4 deployment, read with the read-only Vercel MCP `list_deployments`; the same kind of discriminator X1 uses), with a short retry so a just-promoted deployment is probed. The sample: a mixed-case post, a category, the instant-pot → `/recipes/` row, `/rss/`, both service-worker URLs at 200, one stays-404 row, and both hosts' security.txt (valid, `Expires` more than 30 days out). The repo is private, so the schedule is not auto-disabled for inactivity.
   3. That merge is the discrimination probe. It must show exactly one jsolly Production smoke run for the merge SHA, with `/ship`'s release gate finding it, and no smoke run for the staged `blogthedata` deployment the merge also creates.
      - **If it fails** (a smoke run for the `blogthedata` deployment, or `/ship` picking the wrong deployment): keep the merge hold, record the run URLs, and ask John to authorize an X1 fix in dotagents plus its jsolly-website sync; re-run this probe with a trivial follow-up PR after the sync. Until then, `/ship` identifies the jsolly deployment by project through the read-only Vercel MCP `list_deployments`.
   4. John, after that merge: open the Instant Rollback dialog on `blogthedata`, confirm it still offers the awesome-blog deployment from step 1, then cancel. This checks the SEQ-04 assumption that a staged, unpromoted deployment does not displace the rollback target. If the dialog no longer offers it, the rollback path is the manual reconnect, and the soak still applies.
   5. Agent: lift the merge hold.
9. **Soak.** Auto-assign on `blogthedata` stays **off** through C3 plus 14 days of Vercel 404 and Search Console review. During the soak, new legacy deployments are staged only. A redirect edit is verified on its staged URL and promoted by John. At the end of the soak, with John's approval, John re-enables Auto-assign (Todoist, D0).

**Approval gate:** "C2 verified; approve C3?"

**Rollback,** possible only before C4. Apply the ordering rule first. Either:

- Instant Rollback to the step-1 deployment, while the dialog still offers it; or
- Reconnect by hand:
  1. Settings → Git: disconnect `jsolly/jsolly-website`.
  2. Settings → Build and Deployment: set Root Directory empty, and confirm that no Install, Build or Output override is set.
  3. Connect `jsolly/awesome-blog` with Production Branch `main`.
  4. Create a deployment from the freeze SHA and promote it. The freeze SHA is printed by:

     ```bash
     cd /Users/johnsolly/code/jsolly-website && git pull --ff-only && node -p "require('./legacy/blogthedata/url-map.json').meta.freeze_sha"
     ```

### C3. Search engines

**Preconditions:**

- C2 verified with 0 failures.
- John confirms that blogthedata.com and jsolly.com are verified in Bing Webmaster Tools (GSC import or DNS CNAME).
- John confirms the registrar, auto-renew, and an expiry at least 1 year out (J16).

**Actions,** all John:

1. Search Console: confirm both domain properties exist under one account (UNVERIFIED). Then Change of Address from blogthedata.com to jsolly.com.
2. Search Console: submit `https://www.jsolly.com/sitemap-index.xml`.
3. Bing Webmaster Tools: Site Move.
4. Keep the TXT verification record.

**Approval gate:** "C3 done; approve C4?"

**Rollback:** cancel the Change of Address.

### C4. Archive awesome-blog

**Preconditions:**

- C3 is done.
- No redirect fixes are pending.
- J9, J22 and J26 are answered.

**Actions:**

1. **awesome-blog session** (John starts or authorizes it; cwd `/Users/johnsolly/code/awesome-blog`).
   - First, the final J9 reads, under the read-only AWS boundary. They need awesome-blog's `node_modules` (present today; run `npm ci` first if not):

     ```bash
     cd /Users/johnsolly/code/awesome-blog && git fetch origin && git switch main && git pull --ff-only
     bash -c 'source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" && gate_with_readonly_aws npm run --silent check:stack-protection'
     bash -c 'source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" && gate_with_readonly_aws npm run --silent check:infra-drift -- --json --warn-only'
     ```

   - Then one `/ship` PR in awesome-blog:
     - **README:**
       - The blog now lives at `https://www.jsolly.com/blog/`, and recipes at `/recipes/`.
       - The source is private.
       - The AWS `blogthedata-migration-backups` stack stays frozen here (J9). The README gives its Object Lock date (2026-11-01), refreshing the wording if C4 lands after it. It also says continuous protection and drift reads stopped at archive, and includes the two read results above.
       - S3/CloudFront serve images for jsolly.com.
       - Heroku release v315, its database and media are retained for recovery until separately authorized retirement (J26).
     - **`AGENTS.md` "Ship and release":** `Ship profile: gate-only` (no deploy entry); Vercel project `blogthedata` is re-pointed to `jsolly-website/legacy/blogthedata`; never reconnect it.
     - **Banners:** pointer banners on `docs/publishing.md` and `docs/recipes.md`.
     - **Shipping:** the `/ship` run records `deploy: none` (profile `gate-only`), and the PR body says not to dispatch Production smoke.
2. Same session, with John's OK at this step: close the open Dependabot PRs without a comment. The README carries the notice.

   ```bash
   gh pr list --repo jsolly/awesome-blog --author app/dependabot --state open --json number --jq '.[].number' | xargs -n1 -I{} gh pr close {} --repo jsolly/awesome-blog
   ```

3. Agent: report `git status` and unpushed commits for each J22 worktree; remove the clean ones with John's OK.
4. John: update the repo homepage and description, then archive. The agent token has no Administration write, so this block uses a transient login of John's own. It is cwd-independent.

   ```bash
   gh auth login
   gh repo edit jsolly/awesome-blog --homepage https://www.jsolly.com/blog/ --description "Archived: blogthedata.com now lives at jsolly.com/blog"
   gh repo archive jsolly/awesome-blog --yes
   gh auth logout
   ```

**Rollback:** John, cwd-independent:

```bash
gh auth login
gh repo unarchive jsolly/awesome-blog --yes
gh auth logout
```

### D0. Durable reminders

Agent, via `/persist-todos-in-todoist`, with real dates, in the appropriate existing repo project.

**At plan approval** (so none is born overdue):

- the decision batch, X1 authorization and the fleet-rollout start (Blocked list items 1, 2 and 5);
- J9 revisit, due 2026-11-01;
- registrar confirmation (J16), due before C3.

**At B00:** the awesome-blog code freeze (B00 step 4).

**With C2:**

- recurring security.txt `Expires` bump on both hosts, due at Expires minus 30 days;
- Search Console 404 and coverage review, due C2 + 30 days;
- end of the auto-assign soak, due C3 + 14 days;
- Heroku retirement decision (J26), due at the end of the soak;
- follow-ups: Markdown siblings (J11), visual unification (J25), and rehosting before any AWS retirement (J6).

### D1. After C4

One `/ship` PR to jsolly-website `main`:

- records the post-C2 facts in `AGENTS.md` and `README.md`: the legacy project is live from `legacy/blogthedata`; the archive link; the re-pointed Vercel project, the auto-assign state and the `legacy-redirects.yml` workflow; the C2 results from the execution record (double-slash outcome, rollback deployment ID, smoke run URL);
- deletes `docs/plans/blogthedata-merge/` (git history keeps it) and, if `docs/plans/` then holds nothing else, the `"!docs/plans"` Biome entry.

---

## 7. Risks, open questions, leftovers

### 7.1 Verification status

| Item | Status and how it gets verified |
| --- | --- |
| Case-sensitive matching in production | **Verified** on the live renamed-post redirect: exact case gives 308, two case variants give 404 (review missed-urls). Re-checked by the lowercase negatives at C2. |
| `statusCode: 301` honored in production | Compiles to 301; checked in the C2 staged run |
| Query strings pass through the new rules | Verified on the old rules only; checked by the 4.10 query probes |
| Old service workers in real browsers | 4.8; C2 fetch; optionally a real device |
| Minifier configuration that keeps hydration | **Settled:** candidate 1 matches unprocessed-build reuse on every page (review csp-build); PA2 pins it |
| Vercel bundles middleware after `npm run build` | **Order verified** in an offline `vercel build` (review csp-build). PA3 re-proves it with the JS manifest. Edge deploy-time bundling stays UNVERIFIED until the first production deploy. The deprecated `edge` runtime warning is known. |
| Frames and images under per-page CSP | **Verified** in Chromium with the header injected: 0 violations on 12 pages (review csp-build); pinned by 4.4(c) |
| `.xml` feed Content-Type override on Vercel | UNVERIFIED; checked on the `/preview` deployment by John at C0 step 8 (J20) and by the C1 smoke |
| How GitHub names environments when two projects share one repo | X1 makes it irrelevant; confirmed by the C2 step 8 probe, which has a failure branch |
| Double-slash forms on the legacy project | UNVERIFIED; probed at C2 step 5. A 404 is handled by J28: recorded in the ledger by a follow-up PR. |
| `vercel curl` flags against a protected staged deployment | C2 step 5 fallback |
| `framework: null`, empty install/build and `outputDirectory: public` overriding the dashboard | C2 staged deploy |
| The Auto-assign toggle and Promote on Hobby | C2 steps 2 and 6 |
| Staged deployments do not displace the Hobby Instant Rollback target | **Plausible only** (SEQ-04); John checks the dialog in C2 step 8 |
| Maintenance deploys poisoning the recipe PWA cache | **Plausible only** (CSPB-9); prevented by design (no worker under `MAINTENANCE_MODE`) and asserted in B18 |
| External consumers of `/data/recipe-library.*`, and the installed-PWA population | Covered by the 301s and the kill-switch. Optional read-only Vercel Observability before C2. |
| Visual fidelity after the `@layer blog` conversion | 4.9 |
| Tailwind `source(none)` CSS change | Exactly 4 unused selectors dropped (review csp-build; re-measured in round 2 with the plan bundle at `docs/plans/blogthedata-merge/`); pinned by the PA5 test |
| Registrar and expiry; Search Console property types; Bing verification; Hobby fair use if the blog ever carries ads | John (J16, C3 preconditions) |
| `ignoreCommand` at Vercel's clone depth | Not used |
| A direct merge-commit push to `port/awesome-blog` (no ruleset on non-default branches) | UNVERIFIED (gh 401 in review); read at the first main sync, stop and ask John if refused (§5) |
| `delete_branch_on_merge` on jsolly-website | UNVERIFIED; C1 step 3 deletes the port branch explicitly either way |
| Open issues and PRs on public awesome-blog | UNVERIFIED; listed at C0 step 1 |
| `route-manifest.mjs` importing `post-loader.ts` (which imports `astro/markdown`) outside Astro | UNVERIFIED; proved or replaced by the yaml fallback in B08 |

### 7.2 Cross-repo leftovers

- **dotagents (required, X1).** A project-discriminating Production smoke filter plus SRC's hardening in `templates/github/production-smoke.yml`, and a project-aware lookup in `skills/ship/references/deploy-verify.md`. John authorizes it as a separate dotagents session **at plan approval**, then starts the fleet rollout lead once dotagents is idle; the rollout's jsolly-website PR must merge before C0 (a new template substitution point carries the deployment-host prefix). Only the jsolly-website sync gates this plan.
- **Infra.** Archiving awesome-blog stops the fleet's continuous protection and drift reads of `blogthedata-migration-backups` (MST-05). If J9 becomes "move to shared-infra", that is a separate shared-infra handoff, tracked via `/persist-todos-in-todoist`.
- **jsolly-website template drift (separate PR, not this port).** DST's `scripts/lint-md.sh` falls back to `markdownlint-cli2@0.22.1` while package.json pins `^0.23.2`. It should be re-synced from the dotagents template through `/optimize-workspaces`.
- **Heroku (J26).** Release v315, its database and media stay for recovery. After the archive, their only record is the archived awesome-blog `AGENTS.md` and the C4 README; a D0 Todoist task asks John to decide retirement.
- **Out of scope:** the github-actions Dependabot ecosystem (J24).

### 7.3 Local resources

- **Keep the awesome-blog checkout.** Do not delete `/Users/johnsolly/code/awesome-blog`: the private `.migration-work/` receipts live only there.
- **Stale worktrees:** J22, handled at C4.
- **The plan bundle:** untracked at `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/` until PA5 commits it to `docs/plans/blogthedata-merge/`; then the untracked copy is removed with John's OK. Nothing in this plan depends on session scratch under `/private/tmp`, which can be deleted at any time.

### 7.4 Where this plan departs from the brief, with evidence

1. **`/404.html` is served with 200, not 404 or dropped.** Vercel serves output files directly. `/404.html` returns 200 live today, and the brief itself puts a `404.html` in the legacy project.
2. **The `d33wubrfki0l68` reference needs no rewrite.** It is a plain-text `<figcaption>` credit (`Exploring-the-STAC-APIs-with-IPython-Notebooks.md:10`), not an image load.
3. **`@vercel/routing-utils` lands in PA6, not Phase B.** Brief A1 moves dependencies to Phase B, but its own rationale is that a dependency lands with its first importer, and PA6's compile test imports this package.
4. **The smoke filter is a required dotagents prerequisite (X1), not a C2 literal edit or a Phase A PR.** Two projects can post `Production` for the same SHA. The template's only knob, the environment literal, cannot discriminate them (SEQ-01).
5. **`outputDirectory` is `public`, not `.`.** With `.`, `/url-map.json` and `/vercel.json` would become URLs on blogthedata.com. The dashboard overrides are dropped, because vercel.json carries them (SEQ-03).
6. **New Phase A item PA5 (Tailwind explicit sources), which also commits this plan bundle and lands right after PA1.** Without it, the bundle and PA6's tracked files would change jsolly's CSS through automatic source scanning (the bundle adds 7 selectors; `url-map.json` contains `static`). Its proof is a selector-set diff, not byte identity.
7. **The landing page renders the full library, not only meals.** The old post rendered `<RecipeExperience />` with all 21 recipes, so smoothie deep links must keep working.
8. **The `related`-slug check is a content-contract scenario, not a unit test.** `content.ts` imports `astro:content`, which plain `node --test` cannot load.
9. **The merge hold lifts at C2 step 8, and auto-assign stays off through a soak.** Brief A3 tied the hold to verification. Re-enabling auto-assign is what exposes the full-blog rollback target to replacement (SEQ-04).
10. **Plus the review-driven changes** in "Brief positions changed by review" under Decisions.

### 7.5 Where Phase B departed from this plan, as implemented

Recorded while porting (each step's PR body on `port/awesome-blog` has the detail; the final PR jsolly/jsolly-website#65 lists the steps):

1. **Route manifest.** Phase A generates it in the `routeManifest` Astro integration from `astro:build:done`, so there is no `scripts/route-manifest.mjs` and no `npm run routes`; the B08/B16/B17 "expansion" bullets need no code.
2. **Flat pages.** Pages are flat files where routing allows (`blog/works-cited.astro`, `blog/all-posts.astro`, `blog/search.astro`, `blog/[slug].astro`); `blog/category/[slug].astro` keeps its folder because Astro routing requires it.
3. **Test placement.** B06a's id test lives in `scripts/unit/` (it never reads `dist/`), and every suite's absolute totals in §4.14 shift accordingly; each step PR states its before and after counts. The `built` suite runs with the same TS loader flags as `unit` (B08), and the `unit` glob includes `src/**/*.test.mjs` (B15).
4. **Layer order and knip.** See the §1.2 Styles row and the B06b bullet above.
5. **security.txt has no `Encryption` field on either host** (both files changed on `port/awesome-blog` in B11; they reach `main` with C1). `public/pgp-key.txt` (key 257BD207…) expired on 2023-05-08 and its only UID cannot receive mail; the file stays because legacy row SEC-001 and two posts link it. Re-add the field only after John publishes a current key (B11).
6. **Recipe data counts.** `recipe-library.json` holds 84 image values (123 path occurrences); `recipe-library.md` holds none. Three exports are un-exported in B15 (`dailyNutrients`, `recipeDisclaimer`, `applianceChoices`), and recipe constants live in `src/components/recipes/constants.mjs`.
7. **Unknown `related` slugs fail the build** in `publishedContent` (a unit test and a B14 built scenario), drafts included; a slug naming a draft still builds without a card.
8. **Cutover verifier (B21).** `--transport vercel-curl` writes out the status and the Location, Content-Type and Cache-Control headers, and saves served files to a temp file instead of `-o /dev/null`, because the §4.10 serve-200 checks need the type and the bytes that `%{http_code} %{redirect_url}` cannot give. One serial `curl -v` warm-up lets the CLI find or create the deployment's bypass secret and reads it from the request headers; every later call passes it as `VERCEL_AUTOMATION_BYPASS_SECRET`, so a run creates at most one secret and the CLI asks the API only once. A request is retried once, with a warning, only on a transient transport error (fetch network error or timeout, curl exit 6, 7 or 28). Any flag combination outside the four modes exits 2, and `--base-url` must be an https origin. `--base-url` probes only that origin's own scheme; the http → https 308 is a custom-domain behaviour that `--production` checks. In full `--base-url` mode the destinations are still checked on `https://www.jsolly.com` with fetch. The `--sample` rows are derived by fixed rules written in the script header (PST-002, CAT-001, RCP-001, FED-002, both service workers, PST-108 and SEC-002 today), and "both hosts' security.txt" covers the legacy hosts and jsolly.com.

---

## Appendix A: dropped infra test titles (47)

**`stack-protection.test.mjs` (4):**

- every resource is classified, retained and protected from replacement/removal
- recovery storage remains private, versioned, encrypted and retained for 30 days
- wrapper pins the stack and owner, propagates check failures and never calls apply during check
- protection contracts run locally and in exact-tree PR CI

**`plan-infra.test.mjs` (24):**

- plans with one UPDATE change set from the committed template, then deletes it
- reports a replacement and what causes it…
- reads an empty change set as no changes and still deletes it
- waits for a change set that is still creating
- reports an unreadable or malformed change set as an error…
- gives up on a change set that never settles…
- reports a denied create once…
- deletes a change set whose create failed after it landed
- fails the plan when the change set cannot be confirmed deleted
- waits out an in-flight delete…
- stops before creating anything when interrupted…
- an interrupt while polling still deletes the change set
- only the fleet read-only role in the fleet account may plan
- accepts --json and --out <file> in either order…
- plans as agent-readonly, drops static credentials…
- the command writes exactly one receipt object to --out…
- the command prints the receipt on stdout without --out
- the command still plans when it is started through a symlinked path
- the command exits 1 with an error receipt when the create is denied…
- the command deletes its change set when it is terminated mid-plan
- the command refuses any identity but agent-readonly…
- the command fails loudly on a bad argument or an unwritable receipt path
- the manifest names one stack whose template fleet discovery finds
- the infra scripts are wired at the package root, in the gate, and in CI

**`check-infra-drift.test.mjs` (14):**

- is clean when the tag carries main's infra…
- stays pending after a code-only merge lands on top of an unapplied template merge
- counts every manifest input…
- is clean when an infra change was reverted before deploy:infra
- is pending, with deploy:infra as the fix, for a stack that carries no usable tag
- errors, never clean or pending, when it cannot decide
- treats a created and an updated stack as settled
- errors when an infra input no longer exists at main's tip
- errors when origin's main moved past this clone…
- errors when this checkout's input list differs from main's
- errors when origin is unreachable or a flag is unknown
- reads as agent-readonly unless the caller already chose credentials
- without --json it prints the ordered hand-off…
- .gitattributes marks exactly the manifest inputs…

**`deploy-infra.test.mjs` (5):**

- deploys the landed commit to the existing stack and stamps it with that commit
- refuses before any deploy call when a precondition fails
- fails when the deploy exits 0 but the stack does not carry the new stamp
- fails when the deploy itself fails, without claiming the tag
- the manifest lists the deploy script as an infra input…

## Appendix B: artifacts

All paths are relative to the plan bundle: `/Users/johnsolly/code/awesome-blog/.migration-work/merge-plan-2026-10-04/` until PA5, then `docs/plans/blogthedata-merge/` in jsolly-website. "Retires" is when the file is deleted from `main` (git history keeps it).

| File | What it is | Retires |
| --- | --- | --- |
| `plan.md` | This plan | D1 |
| `out/build-url-map.mjs` | Generator for the map, appendix, union check, served-today ledger, destinations, vercel.json preview and union file. Exits 1 on any unmatched, ambiguous, ledger or structural failure. Defaults to the pinned SRC SHA. | PA6 |
| `out/url-map.json` | The URL map (305 rows), copied to `legacy/blogthedata/url-map.json` | PA6 |
| `out/url-map-union.json` | The 901 known paths with row ids, evidence and `served_today`, copied to `legacy/blogthedata/url-union.json` | PA6 |
| `out/url-map-destinations.json` | The 202 destination paths | PA6 |
| `out/legacy-blogthedata-vercel.json` | Preview of the legacy project's vercel.json (212 redirects) | PA6 |
| `out/url-map.md` | The human-readable appendix | D1 |
| `out/url-map-check.txt` | Union-check report, including the served-today ledger | D1 |
| `out/compile-check.txt` | Real-compiler cross-check output | D1 |
| `exp/compile-check.mjs` | The real-compiler cross-check; needs `ROUTING_UTILS_DIR` (§2.4) | PA6 |
| `out/check-inventory-coverage.mjs`, `out/inventory-coverage.json` | Inventory resolver (pinned SHA, with the post reclassification) and per-file dispositions | PA6 (script), D1 (JSON) |
| `out/review-disposition.md` | Every review finding (rounds 1 and 2), its outcome and what changed | D1 |
| `out/round1-id-map.json` | Round-1 → current URL-map row ids | D1 |
| `urls-build.json`, `urls-live.json`, `urls-history.json`, `sitemap-locs.txt`, `served-files.txt` | Generator inputs; `served-files.txt` is the 265 files the bf1f7ff1 dist serves, un-normalized | D1 |
| `inventory-app.json`, `inventory-recipes.json`, `inventory-ops.json` | Inventory inputs | D1 |
| `evidence-notes/` | The decisions brief, discovery and review digests, and per-agent discovery notes | D1 |
