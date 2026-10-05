## Ship

Ship profile: `vercel-static`

**Integration: branch → PR → merge on green `CI / ci`.** `/ship` merges per `skills/ship/references/git-discipline.md` → Merge a same-repo self PR (read the installed `/ship` reference). Agents never push to `main`, change rulesets, or admin-merge.

Production URL: <https://www.jsolly.com>

Production verification follows Vercel READY and the public navigation and Markdown behavior smoke.

Local gate before push: `npm run gate`.

## Purpose

Personal website at [jsolly.com](https://www.jsolly.com). Astro static site: the portfolio pages (`index`, `about`, `contact`, `privacy`, `terms`, `404`, `500`) plus the blog under `/blog/`, which is being ported from awesome-blog (`docs/plans/blogthedata-merge/`; B23 rewrites this section).

## Stack

Astro 7 with Svelte 5 islands, Tailwind CSS 4 (via `@tailwindcss/vite`), TypeScript, Biome 2 for lint/format, `@astrojs/sitemap` for generated sitemap. Inter + Poppins fonts via `@fontsource`. Node version pinned in `.nvmrc`.

## Frontend stack

Astro owns static pages; Svelte + shadcn-svelte owns interactive product UI.
Use the installed generated controls for new or replaced standard controls,
loading `/shadcn-svelte`. Navigation uses a hydrated Svelte island and the
hero/contact calls to action use server-rendered Button anchors. Preserve
native link semantics, first-party assets, the portfolio palette and focus.
`components.json` configures the pinned local CLI and existing Tailwind styles.
Reuse `src/lib/components/ui`; import defining component files directly.
The blog and recipe ports keep their awesome-blog native controls (the
`<details>` categories menu and the toggle/inert mobile disclosure, which work
without JavaScript through `no-script.css`, and the post cards' "Load more
posts" link, which `no-script.css` hides so the noscript archive link is the
way on, and the post page's "Print this post" button, share links, "Back to
home" link and heading-link copy script) for parity with live blogthedata.com under the approved merge plan
(J25), until the post-C4 visual unification follow-up; new blog and recipe
controls use shadcn-svelte.
Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Dependencies / Assets

**No CDN for app assets.** Runtime CSS/JS (and app fonts) come from npm, local files, or same-origin build output. Do not load jsDelivr, unpkg, cdnjs, or similar CDNs at runtime.

## Commands

```bash
npm run dev                 # Astro dev server (localhost:4321)
npm run build               # astro build (writes the route manifest) + node process-html.mjs + built-CSP test (csp suite)
npm run build:maintenance   # MAINTENANCE_MODE=true npm run build (renders Maintenance.astro)
npm run preview             # Preview the production build locally
npm run check:fix           # biome check --write
npm run check:ts            # astro check + svelte-check (errors only)
npm run fix                 # check:fix + check:ts (combined)
npm test                    # unit tests: src/**/*.test.ts and scripts/unit/*.test.mjs
npm run test:built          # built-output tests: scripts/built/*.test.mjs against dist/ (run after build)
npm run redirects:write     # regenerate legacy/blogthedata/vercel.json from url-map.json
npm run redirects:check     # fail when legacy/blogthedata/vercel.json differs from what url-map.json generates
```

Every suite runs through `scripts/run-tests.mjs`: `npm test` (`unit`), `npm run test:built` (`built`), the built-CSP check at the end of `npm run build` (`csp`) and `npm run smoke:scenario-contract` (`smoke`). It fails a suite when its passing-test count differs from `scripts/test-counts.json`. Update the count in the commit that adds tests; lower it only in a commit that names each dropped test.

A built test that needs its own build uses a `scripts/built/temp-copy.mjs` copy of the working tree, never the real tree; that file's header describes the isolation.

## Worktrees

`npm run worktree:init` runs `npm ci` in a fresh worktree. No `.worktreeinclude` is needed: the only gitignored source file, `src/generated/route-manifest.js`, is written by `npm run build`, and nothing before a build needs it. There is no gitignored runtime configuration or local state.

## Architecture

- `src/pages/` — content pages (`index`, `about`, `contact`, `privacy`, `terms`) plus `404` and `500`, and the `blog/` routes, which render with `BlogLayout`: `/blog/`, `/blog/all-posts/`, `/blog/category/<slug>/` (slug case kept, e.g. `Geodev`; the `category/` folder is Astro's routing layout), `/blog/works-cited/` and one page per published post, `/blog/<slug>/` (`blog/[slug].astro`, slug case kept: breadcrumbs, related cards, share links and BlogPosting JSON-LD on jsolly.com URLs).
- `src/components/` — `Header`, `Footer`, `ContactMe`, `SocialLinks`, `Maintenance`, plus a `home/` subdir for index-page sections and a `blog/` subdir for the blog chrome (`BlogNavigation`) and browse components (`PostCards`, the post card list with its load-more island, and `AuthorCard`, whose `h2#about-author` is a legacy fragment id).
- `src/layouts/` — page layout wrappers: `Layout.astro` for the portfolio, `BlogLayout.astro` for the blog and recipes. BlogLayout is standalone (no Markdown alternate), honors `MAINTENANCE_MODE`, and with `section="blog"` adds the per-page `img-src` (CloudFront) and `frame-src` (YouTube, diagrams.net, nbviewer) CSP directives, failing the build when `Astro.csp` is unavailable.
- `src/styles/blog/` — the blog stylesheets BlogLayout imports (`theme`, `ui`, `blog`, and `no-script` through `?url`), each opening with the same `@layer` order so the `blog` and `blog-no-script` layers stay last.
- `src/content/` — Astro content collections, defined in `src/content.config.ts`.
- `src/lib/blog/` — blog lib: `post-loader.ts` (PagesCMS frontmatter loader), `schemas.ts` (post and category schemas, plus `publishedContent` and `categoryCounts`, the pure checks, draft filter, orderings and category names over the loaded collections), `content.ts` (only the `getCollection` wiring: `blogContent` and `blogNavigation`), `cards.ts` (`cards`, the pure post card data `PostCards` renders: UTC date labels, the same-day updated rule, reading time; plus `dateLabel`), `urls.ts` (the blog URL builders `postHref` and `categoryHref`, slug case kept; dependency-free so client islands can import them without the sanitizer), `types.ts` (`Card`, `CardPost`), `html.ts` (article sanitizer and heading ids), `search.ts` (search index parse and MiniSearch) and `constants.ts`.
- `process-html.mjs` — post-build pass that adds slugified `id` attributes to id-less `h2/h3/h4` (for anchor links), except under `dist/blog/` and `dist/recipes/`, and runs `html-minifier`. Runs after every `astro build`. The minifier keeps the Svelte and Astro hydration comments and collapses whitespace conservatively, so islands hydrate in place instead of re-rendering; `scripts/built/hydration.test.mjs` pins that contract.
- `middleware.ts` — Vercel routing middleware (every path; no matcher). The same URL serves HTML or Markdown by `Accept` (`src/lib/accept-negotiate.ts`, `src/lib/agent-response.ts`, pages in `src/content/agent-pages.ts`): the five portfolio pages have Markdown variants and `.md` siblings, and any other path asked for as Markdown gets the Markdown 404 that `public/llms.txt` promises. Any path ending in a file extension other than `.md` is static and never negotiated or answered 406, and files under `/recipes/data/` are served as they are, `.md` included (an extensionless miss there keeps the Markdown 404). Real routes under `/blog/` and `/recipes/` serve HTML only (J11 in the merge plan), with no `Vary: Accept`; the percent-decoded path is looked up in the route manifest, and unknown paths there keep the Markdown 404.
- Route manifest — the `routeManifest` integration in `astro.config.ts` writes the gitignored `src/generated/route-manifest.js` from Astro's own `astro:build:done` page list (`export const routes = [...]`, one `/path/` per built page, `/` for the index, error pages excluded). `middleware.ts` imports it to tell real routes from unknown paths, and Vercel bundles the middleware after `npm run build`, so it ships that build's list. The tracked `route-manifest.d.ts` types the import, so `check:ts` and knip pass before any build. The lib functions take the route set as a parameter, so unit tests inject their own and never need the generated file.
- `legacy/blogthedata/` — the redirect-only static project for the old blog host (blogthedata.com, `www.blogthedata.com`, `blogthedata.vercel.app`), owned by this repo. It is the Root Directory of the separate Vercel project `blogthedata`, not part of jsolly.com's build, and stays inert until John re-points that project here at cutover step C2 of the merge plan (decisions J1, J2). `url-map.json` is the source of truth: each row of known old paths 301s to `https://www.jsolly.com/...`, serves a file from `public/`, or stays 404 (the static `public/404.html`; no catch-all); rows of class `service-worker` also get the no-cache JavaScript headers. `url-union.json` records every known old path, its evidence and whether it is served 200 today. `vercel.json` is generated: edit `url-map.json` (and `url-union.json` when the edit adds a known path), run `npm run redirects:write`, and commit all three; the gate's `redirects:check` fails on drift. `public/` holds only `404.html`, `robots.txt`, `.well-known/security.txt` and the two byte-identical kill-switch service workers (`recipe-service-worker.js` and `post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js`), which retire the old recipe workers and must stay as long as the host lives. `scripts/unit/blogthedata-redirects.test.mjs` compiles `vercel.json` with Vercel's `@vercel/routing-utils` and routes every row form and known path through it, including the ledger of paths served today that deliberately become 404 (decision J27), whose only home is that test's constants; `scripts/built/blogthedata-killswitch.test.mjs` proves the kill-switch in Chromium across two origins. security.txt `Expires` must fall after HEAD's commit date and less than 365 days after it (in the pre-commit hook HEAD is the parent of the commit being made), so bump it yearly. `meta.freeze_sha` stays null until merge step C0 records the awesome-blog freeze SHA. `fragment-ids.json` holds the fragment ids each old page offered, generated from the awesome-blog build by `scripts/port/fragment-ids.mjs` (refreshed at C0); `scripts/built/legacy-fragments.test.mjs` checks that each page's 301 destination keeps them once its route is built.
- `docs/plans/` — archival planning records (the blogthedata merge plan bundle lives in `docs/plans/blogthedata-merge/`). Biome and markdownlint ignore it, and Tailwind does not scan it.
- `astro.config.ts` — site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod) so the sitemap and absolute links resolve correctly per environment. It sets `trailingSlash: "always"` and `prerenderConflictBehavior: "error"`, and renders Markdown with the satteri processor and Prism highlighting (Shiki emits inline styles under the CSP).

## Deploy

Production deploy is owned by **Vercel's GitHub integration** — a merge to `main` triggers the Vercel build and deploy. There is no local `npm run deploy` or CLI deploy step from `/ship`. Branch pushes do **not** create Preview deployments (`vercel.json` `git.deploymentEnabled`).

**Opt-in Preview:** comment `/preview` as the first non-empty line on a same-repo PR (owner/member/collaborator User), or run workflow **Vercel Preview** with the PR number. GitHub runs that workflow from `main`. One-shot: new commits do not rebuild until you ask again. Requires GitHub secret `VERCEL_TOKEN`. Agents must not comment `/preview` unless the user asked.

If a green merge creates no Vercel deployment, verify that the project's Git connection uses the current GitHub repository ID. Recreating a repository under the same name can leave Vercel linked to the old ID. Reconnect the current repository through Vercel's Git settings; the repository name alone does not prove the connection is current.

`npm run build:maintenance` swaps in the maintenance page. To take the site offline temporarily, set `MAINTENANCE_MODE=true` in the Vercel project env (or redeploy from the Vercel dashboard with that env) — not via a local CLI deploy.

## CI (local pre-commit gate)

- `.git-hooks/pre-commit` runs through the installed dotagents hook dispatcher and validates Bash, Biome, YAML, Actions, Markdown, browser contract, Knip, the legacy redirect config (`redirects:check`), Astro and Svelte types (`check:ts`), unit tests, build and built-output tests. GitHub Actions repeats the gate on the PR; the hook does **not** deploy.

## Conventions

- **Tabs** for indentation (Biome default, also matches `biome.jsonc`).
- **Tailwind utilities** over custom CSS; theme tokens live in `src/styles/`.
- **Tailwind sources are explicit.** `src/styles/main.css` imports Tailwind with `source(none)` and lists its `@source` / `@source not` paths, so docs, data and blog or recipe code never change the portfolio bundle; Tailwind class strings must live in `src/components`, `src/layouts`, `src/pages` or `src/lib`. The blog paths (`lib/blog`, `components/blog`, `pages/blog`, `layouts/BlogLayout.astro`) and the shadcn-svelte parts in `lib/components/ui` are excluded from the portfolio sources, with `ui/button.svelte` re-included because the portfolio uses it. `scripts/unit/tailwind-sources.test.mjs` asks Tailwind's own scanner which files feed `main.css` and fails on any file outside those four roots or under an excluded path. The blog and recipes have their own Tailwind entry, `src/styles/blog/ui.css`, with its own `source(none)` and `@source` list; each page loads one entry stylesheet, portfolio or blog, never both. `scripts/built/blog-css-sources.test.mjs` fails when a blog `@source` path is missing (Tailwind ignores it silently), when a blog or recipes stylesheet does not open with the shared `@layer` statement, or when the built BlogLayout bundle loses a pinned selector or loads the portfolio stylesheet.
- **Heading IDs are auto-generated** by `process-html.mjs` from heading text — don't hand-write `id="..."` on headings unless overriding the generated slug. Blog and recipe pages are excluded from that pass: `src/lib/blog/html.ts` owns their article heading ids, and `scripts/unit/process-html-ids.test.mjs` pins the exclusion.

## Local UI verification

No auth — public UI only. Follow `rules/frontend-verification.md` (fleet smoke: desktop + mobile screenshots, console clean).

- **Dev server:** `npm run dev` → <http://localhost:4321>
- **Auth:** none — public pages only. No `DEFAULT_USER` / `DEFAULT_PASSWORD`.

## Production smoke

The **Production smoke** workflow is a separate post-deployment gate. It waits
for the intended production release and verifies the public browser flow with
`npm run smoke:production`. The URL is pinned in
`scripts/production-smoke-scenario.mjs`; the workflow uses no deployment secrets.
Vercel Git deployment and the existing PR CI checks remain unchanged.

`/ship` must wait for the exact release's Production smoke run to succeed and
record its URL. Missing, failed, cancelled, skipped or timed-out runs are not
success. If the automatic trigger is missing, dispatch the workflow on `main`
with the full expected release SHA and a unique request ID, then follow that
specific run. Preserve `production-smoke-artifacts/` diagnostics when a check fails.

## Verified-tree CI

PRs run the full CI suite. Post-merge CI reuses a successful PR run only when
its recorded checkout tree exactly matches the landed tree, using
`scripts/ci-verified-tree.sh` from dotagents. Missing proof runs full CI;
manual runs always validate. Job names and deployment triggers stay intact.
Canonical contract: `~/code/dotagents/templates/github/verified-tree-ci.md`.

## Dependabot CI

Dependabot PR events allocate no validation runners until a manually invoked
`/optimize-workspaces drain` applies the `ow-ci` label. Only the `labeled`
event adding `ow-ci` runs the real `ci` check; later Dependabot pushes defer
again until a drain re-kicks the new head (remove, then re-add). Deferred runs
report `ci-deferred` and cannot satisfy the required `ci` check. Skipped or
absent checks never authorize a dependency merge. See the Dependabot CI kick in
the canonical `dotagents/skills/optimize-workspaces/references/pr-drain.md`.

## Git hooks

`core.hooksPath` is the dotagents dispatcher `~/.local/share/dotagents/hooks`, installed and set by the dotagents installers. Never point it at `.git-hooks` or set it from a package script. The dispatcher runs this repo’s tracked pre-commit hook only when its bytes match a version on `origin/main` or your approved hook blob. Approve only your own edits using the command printed by the refusal. Review fork and third-party PR heads using `gh pr diff`; never check them out here. Canon: dotagents `rules/agent-cloud-access.md` → GitHub.

## Fleet rollout

Changes inside this repo ship normally. For changes other repos must adopt, link the merged PR on the existing dotagents Todoist fleet-rollout task. Do not start that rollout or spawn per-repo chips, PRs or tasks from here. John authorizes one lead to walk the fleet after canon settles. Follow the installed `persist-todos-in-todoist` skill → Fleet rollout.

## Content Security Policy

Astro `security.csp` emits per-page hashes for the island bootstrap and owns
`default-src`/`script-src`. Vercel keeps the other resource restrictions and
`frame-ancestors` in its response header. Do not add a conflicting header
`script-src` or `default-src`, or allow arbitrary inline scripts. Verify built
pages with both policies; Astro dev/preview alone does not apply Vercel headers.

The header's `img-src` also allows `https://d1d7p8ufhgz4ld.cloudfront.net`,
the retained blogthedata S3/CloudFront host that serves legacy blog post images
(a runtime dependency, decision J6 in `docs/plans/blogthedata-merge/plan.md`), and `form-action 'self'`, which does not
fall back to `default-src`. Browsers enforce the intersection, so the Astro meta
still limits images on every page to `'self'` until a page adds its own
`img-src` directive.
`scripts/unit/vercel-csp-header.test.mjs` pins the full header directive map,
and the build-time `csp` suite checks every built `<img>` and `<source srcset>` URL against both policies.
`scripts/built/csp-browser.test.mjs` loads `/blog/`, posts with YouTube,
nbviewer and diagrams.net embeds, and `/about/` in Chromium with the header
served on every response, and fails on any `securitypolicyviolation`.
Astro lists every inline script hash of the build in each page's meta policy,
so an inline `<script>` on a blog page also adds its hash to the portfolio pages.
