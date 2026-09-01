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

Personal website at [jsolly.com](https://www.jsolly.com). Astro static site, six pages (`index`, `about`, `contact`, `privacy`, `404`, `500`), no CMS.

## Stack

Astro 6, Tailwind CSS 4 (via `@tailwindcss/vite`), TypeScript, Biome 2 for lint/format, `@astrojs/sitemap` for generated sitemap. Inter + Poppins fonts via `@fontsource`. Node version pinned in `.nvmrc`.

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

- `src/pages/` — four `.astro` pages.
- `src/components/` — `Header`, `Footer`, `ContactMe`, `SocialLinks`, `Maintenance`, plus a `home/` subdir for index-page sections.
- `src/layouts/` — page layout wrappers.
- `src/content/` — Astro content collections (if used).
- `process-html.mjs` — post-build pass that adds slugified `id` attributes to `h2/h3/h4` (for anchor links) and runs `html-minifier`. Runs after every `astro build`.
- `astro.config.ts` — site URL flips between `localhost:4321` (dev) and `https://www.jsolly.com` (prod) so the sitemap and absolute links resolve correctly per environment.

## Deploy

Production deploy is owned by **Vercel's GitHub integration** — a merge to `main` triggers the Vercel build and deploy. There is no local `npm run deploy` or CLI deploy step.

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
