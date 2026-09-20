## Ship

Ship profile: `vercel-static`

Integration: `pr-auto-merge`

CI owner: `local`

Production URL: <https://www.jsolly.com>

**Prod verify:** `/ship` requires `x-release-id` to match `origin/main` (12-char). HTTP 200 alone is insufficient.

```bash
curl -sSIL https://www.jsolly.com/ | rg -i '^x-release-id:'
```

## Purpose

Personal website at [jsolly.com](https://www.jsolly.com). Astro static site, seven pages (`index`, `about`, `contact`, `privacy`, `terms`, `404`, `500`), no CMS.

## Stack

Astro 6, Tailwind CSS 4 (via `@tailwindcss/vite`), TypeScript, Biome 2 for lint/format, `@astrojs/sitemap` for generated sitemap. Inter + Poppins fonts via `@fontsource`. Node version pinned in `.nvmrc`.

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

- `.git-hooks/pre-commit` (wired via `core.hooksPath=.git-hooks`) runs the quality battery on every commit: Biome → Astro/TypeScript checks → `npm run build`. GitHub Actions repeats the gate on the PR; the hook does **not** deploy.
- The auto-merge bot waits for this repo's `ci` check because Free private repos cannot set required checks.

## Conventions

- **Tabs** for indentation (Biome default, also matches `biome.jsonc`).
- **Tailwind utilities** over custom CSS; theme tokens live in `src/styles/`.
- **Heading IDs are auto-generated** by `process-html.mjs` from heading text — don't hand-write `id="..."` on headings unless overriding the generated slug.

## Local UI verification

No auth — public UI only. Follow `rules/frontend-verification.md` (fleet smoke: desktop + mobile screenshots, console clean).

- **Dev server:** `npm run dev` → <http://localhost:4321>
- **Auth:** none — public pages only. No `DEFAULT_USER` / `DEFAULT_PASSWORD`.

## Verified-tree CI

PRs run the full CI suite. Post-merge CI reuses a successful PR run only when
its recorded checkout tree exactly matches the landed tree, using
`scripts/ci-verified-tree.sh` from dotagents. Missing proof runs full CI;
manual runs always validate. Job names and deployment triggers stay intact.
Canonical contract: `~/code/dotagents/templates/github/verified-tree-ci.md`.

## Dependabot CI

Ordinary Dependabot PR events allocate no validation runners. A manually invoked
`/optimize-workspace` requests full PR checks with `deps:ci:<full-head-SHA>`.
Deferred checks cannot satisfy the real `ci` requirement. New commits need a new
request; skipped or absent checks never authorize a dependency merge. See the
canonical `dotagents/skills/optimize-workspace/references/dependencies.md`.
