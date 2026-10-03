## Ship

Ship profile: `vercel-static`

**Integration: branch → PR → merge on green `CI / ci`.** `/ship` merges per `skills/ship/references/git-discipline.md` → Merge a same-repo self PR (read the installed `/ship` reference). Agents never push to `main`, change rulesets, or admin-merge.

Production URL: <https://www.jsolly.com>

Production verification follows Vercel READY and the public navigation and Markdown behavior smoke.

Local gate before push: `npm run gate`.

## Purpose

Personal website at [jsolly.com](https://www.jsolly.com). Astro static site, seven pages (`index`, `about`, `contact`, `privacy`, `terms`, `404`, `500`), no CMS.

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
Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Dependencies / Assets

**No CDN for app assets.** Runtime CSS/JS (and app fonts) come from npm, local files, or same-origin build output. Do not load jsDelivr, unpkg, cdnjs, or similar CDNs at runtime.

## Commands

```bash
npm run dev                 # Astro dev server (localhost:4321)
npm run build               # astro build + node process-html.mjs
npm run build:maintenance   # Build with MAINTENANCE_MODE=true (renders Maintenance.astro)
npm run preview             # Preview the production build locally
npm run check:fix           # biome check --write
npm run check:ts            # tsc --noEmit
npm run fix                 # check:fix + check:ts (combined)
```

## Worktrees

`npm run worktree:init` runs `npm ci` in a fresh worktree. No `.worktreeinclude` is needed because this app has no required gitignored runtime configuration or local state.

## Architecture

- `src/pages/` — content pages (`index`, `about`, `contact`, `privacy`, `terms`) plus `404` and `500`.
- `src/components/` — `Header`, `Footer`, `ContactMe`, `SocialLinks`, `Maintenance`, plus a `home/` subdir for index-page sections.
- `src/layouts/` — page layout wrappers.
- `src/content/` — Astro content collections (if used).
- `process-html.mjs` — post-build pass that adds slugified `id` attributes to `h2/h3/h4` (for anchor links) and runs `html-minifier`. Runs after every `astro build`.
- `astro.config.ts` — site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod) so the sitemap and absolute links resolve correctly per environment.

## Deploy

Production deploy is owned by **Vercel's GitHub integration** — a merge to `main` triggers the Vercel build and deploy. There is no local `npm run deploy` or CLI deploy step from `/ship`. Branch pushes do **not** create Preview deployments (`vercel.json` `git.deploymentEnabled`).

**Opt-in Preview:** comment `/preview` as the first non-empty line on a same-repo PR (owner/member/collaborator User), or run workflow **Vercel Preview** with the PR number. GitHub runs that workflow from `main`. One-shot: new commits do not rebuild until you ask again. Requires GitHub secret `VERCEL_TOKEN`. Agents must not comment `/preview` unless the user asked.

If a green merge creates no Vercel deployment, verify that the project's Git connection uses the current GitHub repository ID. Recreating a repository under the same name can leave Vercel linked to the old ID. Reconnect the current repository through Vercel's Git settings; the repository name alone does not prove the connection is current.

`npm run build:maintenance` swaps in the maintenance page. To take the site offline temporarily, set `MAINTENANCE_MODE=true` in the Vercel project env (or redeploy from the Vercel dashboard with that env) — not via a local CLI deploy.

## CI (local pre-commit gate)

- `.git-hooks/pre-commit` runs through the installed dotagents hook dispatcher and validates Bash, Biome, YAML, Actions, Markdown, browser contract, Knip, Astro types, unit tests and build. GitHub Actions repeats the gate on the PR; the hook does **not** deploy.

## Conventions

- **Tabs** for indentation (Biome default, also matches `biome.jsonc`).
- **Tailwind utilities** over custom CSS; theme tokens live in `src/styles/`.
- **Heading IDs are auto-generated** by `process-html.mjs` from heading text — don't hand-write `id="..."` on headings unless overriding the generated slug.

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
