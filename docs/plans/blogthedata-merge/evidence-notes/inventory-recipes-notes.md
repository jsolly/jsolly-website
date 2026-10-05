# Recipes subsystem inventory notes (awesome-blog bf1f7ff1 -> jsolly-website 5694e76)

Companion to `inventory-recipes.json` (51 entries; all 45 assigned tracked files appear once, plus 6 recipe-owned files outside my globs flagged for other inventories). Dispositions: 39 adapt, 7 move, 5 drop.

## 1. Pipeline (evidence)

```
src/components/recipes/recipes.json  (21 recipes: 15 meals + 6 smoothies; canonical)
   |-- scripts/recipes/sync-recipe-article.mjs -> rewrites keyed regions in
   |      src/content/posts/15-minute-dump-and-go-instant-pot-recipes.md
   |      markers: <!-- recipe-generated:recipe:<id>:begin/end -->, <!-- recipe-generated:table:{overview,nutrition,family}:begin/end -->
   |      also rewrites the post's `excerpt:` line (article-generator.mjs:41)
   |-- scripts/recipes/sync-assistant-data.mjs -> public/data/recipe-library.json (389,731 B) + recipe-library.md (159,124 B)
   |      built from recipe-export.mjs recipeBundle(recipes,{servings:4,units:'us',familyDiners:0})
   `-- runtime: RecipeLibrary / RecipePage / RecipePrint import recipes.json + recipe-export.mjs (print model)
```

- `npm run recipes:sync` = article sync && assistant sync. `recipes:check` = both with `--check` (byte compare). `recipes:check` is the first step of `gate:app`. Verified in scratch clone: `recipes:check` passes at bf1f7ff1.
- The generated markdown article is NOT user-visible: `src/pages/post/[slug]/index.astro:14,32` renders `<RecipeExperience/>` for this slug instead of `post.html`; built `dist/post/15-minute-.../index.html` has 0 matches for editorial prose ("Read this once before cooking"); only `dist/search-index.json` carries it (1 match). So the article, `sync-recipe-article.mjs`, `article-generator.mjs` (+ its 5 tests) can be dropped with no live-content loss. Editorial prose that exists ONLY in that markdown (food-safety temps, preheat/capacity notes, nutrition method, leftovers, rotation) is the one thing to decide on (Decision D2).
- Consumers of `recipe-library.json/.md`: nothing in-repo links it (no page, docs, robots, llms.txt). `git grep -I -i -E "recipe-library|blogthedata|recipes-pwa|recipe-service-worker"` across every repo under ~/code (awesome-blog worktrees excluded): hits only in awesome-blog itself, dotagents (unrelated: seo skill account note, production-smoke template), jsolly-website (links TO blogthedata.com: footer, nav, SiteIntro, socialLinks, llms.txt, agent-pages.ts). No dotagents skill, no ~/.local/share/dotagents/memory reference. Grok Bot / external assistants fetching `https://www.blogthedata.com/data/recipe-library.{json,md}` are UNVERIFIABLE locally. Both URLs are live today (curl: 200, application/json and text/markdown).
- recipe-library.json contains 84 relative `/media/recipes/...` paths, no absolute blogthedata URLs. After the move the regenerated file embeds `/recipes/media/...`.

## 2. Scripts and tests (counts measured in scratch clone `clones/inv-recipes/awesome-blog`)

`npm ci` ok; `npm run build` ok (141 pages); `npm run recipes:check` ok; `npm run test:recipes`: **55 pass, 0 fail** (25.7 s). Breakdown: display-units 3, nutrient-filters 9, nutrition 3, recipe-export 3, recipe-logic 13, trn-logic 5 (=36 unit); scripts/recipes/article-generator.test 5; scripts/migration-rewrites.test 1 (not a recipe test; belongs to migration verifiers, dropped with them); scripts/recipes/pwa.test 13 (Playwright Chromium, needs `dist/`).

Other coverage: `scripts/astro-contract.test.mjs` lines 174-201 (recipe route, grids, each of 21 recipe pages, srcset files exist, assistant JSON ids, .md exists) via `npm run test:astro`; `npm run recipes:check` in gate.

Port disposition of tests: 36 unit tests port as-is; pwa.test ports 11 of 13 (installs offline desktop/mobile 2, filters persistence 2, snapshot update 1, failed replacement 1, failed first download 1, details-without-JS+share 2, collection-pages-without-JS 2; the two LEGACY tests "Legacy and root workers update independently" and "Previous shipped article snapshot migrates" are dropped). New tests to add: tombstone upgrade path (section 4) and redirect/CSP tests (other agents). Dropped: article-generator (5), migration-rewrites (1).

pwa.test `before()` runs `git archive d6adba53` (previous release) and builds it: impossible in jsolly-website (SHA not in history) -> rewrite the fixture.

## 3. Conflicts with jsolly-website setup (measured/read)

1. **Biome**: scratch copy (39 files, jsolly biome.jsonc, `biome ci --error-on-warnings`): 646 errors + 88 warnings. Biggest: `useLayeredStyles` 245, `useUnicodeRegex` 92, `noImportantStyles` 85, `useTopLevelRegex` 59, `useConsistentTestIt` 50, `useTemplate` 31, format 26, `organizeImports` 26, `useDomNodeTextContent` 15, `noShadow` 15, `noLabelWithoutControl` 12, `noAwaitInLoops` 9, `noSecrets` 8. Biome DOES lint `.svelte` (RecipeLibrary 135 errors). Data JSON also fails format (recipes.json, nutrition-data.json, generated recipe-library.json). Recommendation: `biome check --write` for auto-fixes; a narrowly scoped `overrides` block in biome.jsonc for `src/components/recipes/**`, `src/styles/recipes-theme.css` turning off `useLayeredStyles` and `noImportantStyles` (wrapping print CSS in @layer would invert cascade vs unlayered rules); hand-fix the rest. Generated `public/recipes/data/**` excluded from Biome format or emitted tab-indented.
2. **Knip** (scratch run): unused files = shadcn barrels/unused parts (`index.ts` x6, dialog-close/footer/header/trigger, native-select-option(-opt-group), popover-close/description/header/title); unlisted dependency `cheerio` (pwa-build); unused exports `dailyNutrients` (nutrition.mjs), `recipeDisclaimer` (recipe-export.mjs). `recipes-theme.css` unused until imported. Fix: copy only shadcn files actually imported (`button/button.svelte`, `checkbox/checkbox.svelte`, `collapsible/*` 3, `dialog/{dialog,dialog-content,dialog-title,dialog-description}` + overlay/portal as imported by content, `native-select/native-select.svelte`, `popover/{popover,popover-trigger,popover-content}` + portal), no barrels (Biome `noBarrelFile` is on); use jsdom instead of cheerio.
3. **New dependencies** (jsolly lacks them): `bits-ui@2.19.5` (18 ui files import it), `@lucide/svelte@1.51.0` (checkbox, dialog-content, native-select), `@internationalized/date@3.12.4` (bits-ui peer; resolved transitively in awesome-blog and listed explicitly). jsolly already has clsx, tailwind-merge, tailwind-variants, svelte, playwright 1.63.0, jsdom, globby, html-minifier-terser. `src/lib/utils.ts` in jsolly lacks `WithElementRef`/`WithoutChildrenOrChild` exports that generated shadcn components import from `$lib/utils.js` (jsolly keeps `WithElementRef` in `ui-types.ts`); add exports or regenerate via the shadcn CLI. jsolly has a FLAT `ui/button.svelte` while recipe imports use `ui/button/button.svelte`: two Buttons. Pick one (recommend jsolly's existing flat Button after confirming it covers variant outline/ghost/type/onclick used by recipes: it does support href + button modes) and retarget 5 recipe imports.
4. **CSP post-build check** (`scripts/built-csp.test.mjs`): requires `<meta http-equiv=content-security-policy>` with `default-src 'self'` on every dist HTML, no `'unsafe-inline'`/`'unsafe-eval'` in script-src, and every inline JS `<script>` hash present AFTER `process-html.mjs`. Recipes add no inline scripts (RecipePwa `<script>import ...</script>` bundles to an external `/_astro` module; island bootstraps are Astro-hashed). jsolly built meta (verified from scratch build of 5694e76): `default-src 'self'; script-src 'self' <7 hashes>; style-src 'self' 'unsafe-inline'` -> allows same-origin SW registration (worker-src falls back to script-src 'self'), inline `<style>`, style attributes (bits-ui floating positioning). jsolly response header: `img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (no default/script/connect-src, as the test requires). Both policies are enforced; recipes need only same-origin images/fonts/fetch/workers/manifest, no blob:, no workers other than the SW, no data: URLs (grep of recipe sources: none), no iframes. **No recipe CSP blocker.** Note for the BLOG half (other agents): jsolly header `img-src 'self' data:` blocks https remote images and default-src blocks YouTube/diagrams/nbviewer iframes that awesome-blog's meta CSP allowed (`img-src 'self' https: data:`, `frame-src ...`).
5. **process-html.mjs** (JSDOM re-serialize + html-minifier collapseWhitespace on all dist HTML; adds slug ids to id-less h2/h3/h4): will touch recipe pages (3 pages of ~600 KB each because the full recipes.json is serialized into the island `props`). Risks: duplicate generated ids (many "Ingredients"/"Method"-style headings? each recipe page has one recipe, grids use h3 titles: low), build time (UNVERIFIED), and SW hash computed before it runs (fix by ordering).
6. **Middleware** (`middleware.ts` -> `agent-response.ts`): (a) any path ending `.md` is answered from `PAGES` (5 entries) -> a static `public/recipes/data/recipe-library.md` is intercepted and served as a 404 Markdown body in production. (b) `Accept: text/markdown` requests to any `/recipes/**` HTML URL get the 404 Markdown. (c) Layout advertises `<link rel="alternate" type="text/markdown" href="/recipes/<slug>.md">` on every non-noindex page. `.json`, `.js`, `.webmanifest`, images are in `STATIC_EXT_RE` and pass. Fix in code + unit test (`src/lib/*.test.ts` is what `npm test` runs): exempt `/recipes/data/` prefix; add Markdown entries or suppress the alternate link for recipe pages.
7. **Layout** (`src/layouts/Layout.astro`): no head slot, one hard-coded manifest link, no noscript stylesheet link, max-w-4xl container, no dark mode (recipes-theme.css has a `prefers-color-scheme: dark` block -> dark recipe panels in light chrome), print CSS hides awesome-blog classes that do not exist here, fonts via var(--font-heading/--font-body) (jsolly names them --font-family-heading/--font-family-body: map or alias), `var(--border)` undefined.
8. **astro.config.ts**: `trailingSlash` not set in Astro (jsolly vercel.json `trailingSlash:true` only); awesome-blog sets `trailingSlash:'always'` and recipe code assumes trailing slashes everywhere (`/recipes/${id}/`, SW keys). Add `trailingSlash:'always'` when ported (cross-cutting; blog agent likely owns). Integration order: keep `svelte()`; the SW generator should be a post-process step, not an astro:build:done integration.
9. **Gate ordering**: jsolly pre-commit runs `npm test` before `npm run build`; ported pwa.test and the extracted built-recipes test need `dist/`, so wire them after build (`npm run build` already chains `node --test scripts/built-csp.test.mjs`; add `test:recipes-built`). CI already runs `playwright install --with-deps chromium`.
10. **Tests glob**: jsolly `npm test` = `node --import ./scripts/register-ts-from-js.mjs --experimental-strip-types --test src/lib/*.test.ts` (TS only); recipe `.mjs` tests need their own script (e.g. `test:recipes`) added to `npm test`/gate.
11. **svelte-check**: awesome-blog `check:app` runs `svelte-check`; jsolly gate has only `astro check` (does not type-check Svelte). Recipe Svelte is untyped JS, so no new type failures, but svelte-check coverage is lost unless added (flag to gate-checks agent).
12. **Markdown lint**: `lint-md.sh` globs `**/*.md`; generated `recipe-library.md` and `docs/recipes.md` fall under it.

13. **process-html strips Svelte 5 hydration anchors.** Its minifier call uses `removeComments: true` with no `ignoreCustomComments`. Verified with jsolly's own html-minifier-terser: `<!--[--><p>a</p><!--]--><!---->` becomes `<p>a</p>`; adding `ignoreCustomComments:[/^\[/,/^\]/,/^$/]` preserves them. awesome-blog's un-minified `dist/recipes/meals/index.html` carries 1,443 `<!--[` + 1,443 `<!--]-->` markers (3,074 comments total; chicken-posole page 160/160); jsolly's existing dist has 0 comments (its tiny SiteNavigation island works without them). Svelte 5 client hydration walks these anchors; stripping them on the 600 KB recipe islands risks hydration mismatch and full client re-render (flash, lost "render before hydration" benefit, possible `[data-hydrated]` timing change that the browser tests wait on). Browser effect UNVERIFIED. Fix: preserve Svelte anchors in process-html (`ignoreCustomComments`) or skip `/recipes/**`; add a built test asserting markers survive in `dist/recipes/meals/index.html`.
14. **`Vary: Accept` from jsolly middleware on recipe HTML.** `shouldNegotiate` is true for `/recipes/**` HTML, so `appendVaryAccept` adds `Vary: Accept` (awesome-blog never sent it). Cache Storage `match()` honors Vary. Today's worker looks up with a STRING key (`cache.match(key)`), and `cache.addAll` stores requests built from strings, so both sides carry no Accept header and should match; this is UNVERIFIED and fragile. The existing pwa.test fixture server sends no Vary, so ported tests would stay green even if production offline mode silently fell through to the network. Fix: `cache.match(key,{ignoreVary:true})` in the generated worker and make the test server emit `Vary: Accept` on HTML (and add an offline assertion against it).

## 4. PWA: what exists today and what happens at cutover

### What awesome-blog ships (production verified by HEAD, sizes match dist)

| Item | Value |
| --- | --- |
| Root worker URL | `/recipe-service-worker.js` (7,228 B), registered by `recipe-pwa-client.mjs:13` with `{scope:'/', updateViaCache:'none'}` since #694 (commit 2026-10-03 22:40 -0400) |
| Legacy worker URL | `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js` (7,216 B), scope `/post/15-minute-dump-and-go-instant-pot-recipes/`, registered by every release from #689 (2026-10-03 11:18 -0400) through #693 (d6adba53); file still emitted and still served (`Cache-Control: no-cache`) "for installed-app updates" |
| Cache names | root: `recipe-pages-pwa-<20 hex>`; legacy: `recipe-pwa-<20 hex>` (same worker text with prefix swapped, pwa-build.mjs:81) |
| Precache | 135 URLs: 53 `/_astro/*`, 44 `/media/recipes/*`(+default), 23 recipe pages (post route, 2 grids, 21 recipes -> `/recipes/<x>/`), `/data/recipe-library.json|md`, `/favicon.ico`, 3 icons + manifest, 5 `/social/*.svg`, `/topographic-logo.svg` |
| Fetch handling | cache-first ONLY for pathnames in ASSETS; navigations only when the key ends with `/` (pwa-build.mjs:67-76). Query strings ignored (keyed on pathname). No skipWaiting: update waits for all clients to close. |
| Manifest | `/recipes-pwa/manifest.webmanifest`: id and start_url `/post/15-minute-.../`, scope `/`, standalone; icons `/recipes-pwa/icon-192|512.png`; linked only from the post route head |
| Registered when | any visit to the post route or `/recipes/**` (RecipePwa on both), not in DEV |

Installed base is probably tiny (PWA is ~1 day old at 2026-10-04; household recipe site) but unmeasurable here: Vercel Observability request counts for the two worker URLs (read-only MCP) would estimate it before cutover.

### What happens to returning users if `/post/15-minute-.../` simply becomes a 301

1. A browser with the root registration navigates to `/post/15-minute-.../` or `/recipes/<x>/`: those pathnames are in ASSETS, so the worker answers from cache. The redirect is never consulted; the user keeps seeing the stale old recipe site (and works offline) indefinitely. Same for the installed home-screen app (start_url is in ASSETS).
2. Update check: navigation to an in-scope page triggers a script update fetch (web.dev lifecycle article: update on in-scope navigation; byte comparison). Per the Service Worker spec text (`w3c/ServiceWorker` index.bs line 2823) the top-level script fetch sets `redirect mode` to `error`. A 301 on `/recipe-service-worker.js` is therefore a network error -> update fails -> old worker stays. A 404/removed script also just fails the update; auto-unregister-on-404 behavior is UNVERIFIED and must not be relied on.
3. Legacy-scope registration behaves the same for `/post/15-minute-.../`.
4. Therefore both worker URLs must stay 200 (not redirected, not 404) and carry a tombstone. They must also be excluded from every redirect rule on blogthedata.com (precedence: vercel.json redirects are evaluated before static files; `statusCode`/`permanent` rules would shadow them).
5. Origin change: an app installed from blogthedata.com is a different app identity from jsolly.com; the tombstone cannot migrate the installation. After the tombstone cleans up, the home-screen icon opens `blogthedata.com/post/15-minute-.../` -> 301 -> `https://www.jsolly.com/recipes/` (out of the installed app scope, shown in browser UI). Users re-install from jsolly.com.

### Tombstone worker (serve identical bytes at BOTH old script URLs, 200, `Content-Type: application/javascript`, `Cache-Control: no-cache`)

```js
// Final blogthedata.com deployment only. Never delete: it is what lets old installs leave the cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim(); // WindowClient.navigate() requires this worker to be the client's active worker (spec index.bs L1338)
    for (const key of await caches.keys()) await caches.delete(key);
    const windows = await self.clients.matchAll({ type: 'window' });
    // same-origin reload: the network now answers with the per-path 301 to jsolly.com
    await Promise.all(windows.map(client => client.navigate(client.url).catch(() => {})));
    await self.registration.unregister();
  })());
});
// no fetch handler: nothing is intercepted
```

Notes: navigating to the old same-origin URL (instead of `https://www.jsolly.com/recipes/`) reuses the redirect map, keeping query and fragment behavior in one place. MDN/spec: cross-origin `navigate()` resolves null (the navigation still occurs), so the same-origin form is the dependable one. The scope-`/` worker will reload every open blogthedata.com tab, which after cutover redirects to the jsolly equivalent (acceptable; restrict to recipe URLs if you prefer). Delete ALL caches on that origin (only the two prefixes exist). Keep serving the tombstone for at least 12 months, longer if Observability still shows hits.

Verification of the tombstone must be a real-browser test (Playwright, two local origins on different ports): register the two OLD worker builds, serve the cutover deployment, trigger `registration.update()` / navigate, assert caches empty, registrations gone, navigation ends at the second origin's `/recipes/`. Browser verification of redirects without clearing SW state yields false greens/reds; use curl and a fresh profile for the URL map, and a separate stateful test for the SW path.

Hosting consequence for the redirect-location agent: tombstones are static JS files, so the blogthedata.com host must keep serving a static deployment (the existing `blogthedata` Vercel project's final production deployment from awesome-blog with `public/` reduced to the two tombstones + redirect `vercel.json`), not a pure domain-level redirect. An archived GitHub repo keeps its last production deployment live (Vercel Git integration cannot build new commits, which is fine), but the project must not be deleted and the domain must stay assigned.

### New SW on jsolly.com

- Script `/recipes/service-worker.js`, scope `/recipes/` (default scope = script directory; no Service-Worker-Allowed header needed), `updateViaCache:'none'`; header rule `Cache-Control: no-cache` for that path. ROUTE `/recipes/`.
- Manifest `/recipes/pwa/manifest.webmanifest`: `id:"/recipes/"`, `start_url:"/recipes/"`, `scope:"/recipes/"`, standalone, icons `/recipes/pwa/icon-192.png`, `/recipes/pwa/icon-512.png`; apple-touch-icon `/recipes/pwa/icon-180.png`; linked from `/recipes/**` pages only via Layout head slot (replaces the site manifest on those pages).
- The scope `/recipes/` controls only `/recipes/**` pages; their subrequests (`/_astro/*`, `/recipes/media/*`, favicon, header images) are intercepted by ASSETS allowlist even though they live outside scope.
- Drop the second legacy worker, the `recipe-pwa-` prefix swap, and `clients.claim` interplay tests: jsolly.com has no installed base.
- Page enumeration must change (see JSON entry for pwa-build.mjs: readdir of dist/recipes would hit `media/`, `pwa/`, `data/` dirs and crash on missing index.html).

## 5. Shared links, print/export, origin state

- Share URL (ShareRecipe.svelte:8, recipe-url.mjs:14-19): `new URL('/recipes/<id>/?servings=<2|4|6|8>[&starch=<id>:<sideId>]', window.location.origin)`; `navigator.share` -> clipboard -> visible link. Reader (`readRecipeURL`) also accepts `#<id>` and `/recipes/<id>/` pathname. Always relative; no absolute site string in data or code (grep: 0 blogthedata refs in recipes.json, nutrition-data.json, recipe-library.*). So no URL rewrite in code.
- Links in the wild that must keep working via per-path 301 (path+query+fragment): `/post/15-minute-dump-and-go-instant-pot-recipes/` (+ `#<recipe-id>` anchors from the original article; older share links `?servings=..&starch=..#id` from #692/#693) -> `https://www.jsolly.com/recipes/` (landing must keep hash-open and query parsing, which RecipeLibrary already does); `/recipes/meals/`, `/recipes/smoothies/`, `/recipes/<id>/` (21, created 2026-10-03/04) -> same path on jsolly.com; `/data/recipe-library.json|md` -> `/recipes/data/...`; `/media/recipes/<file>` (44) -> `/recipes/media/<file>`; `/recipes-pwa/*` (4 files; low value); SW files are NOT redirected (tombstone). Fragments survive redirects in browsers (RFC 9110 Location semantics). Query pass-through VERIFIED for vercel.json `redirects` on the live blogthedata.com project: `curl -sI 'https://www.blogthedata.com/post/sollys-favorite-youtube-channels-and-podcasts/?servings=6&starch=a:b'` -> `HTTP/2 308`, `location: /post/my-favorite-youtube-channels-podcasts-newsletters/?servings=6&starch=a%3Ab` (query kept, colon percent-encoded; `URLSearchParams` in recipe-url.mjs decodes it). This also shows the existing awesome-blog redirects are 308, not 301. `preserveQueryParams` default false applies to Vercel BULK redirects only; if the plan uses bulk redirects, set it true.
- Print: `window.print()` after `data-recipe-print` is set; RecipePrint hidden `.print-output`; CSS in recipes-theme.css + component styles. Export/download UI was removed (docs); `recipe-export.mjs` remains for print + sync. No new window/popup, no blob:, no a[download].
- Origin-scoped state: ONE localStorage key `blogthedata-recipes-v2` (servings, familyDiners, units, familyChoice, immuneSupport, ironRich, omega3, proteinChoice, carbChoice, smoothieKetoOnly, starchChoice, ingredientChoice, appliancesOnHand, collection). Not transferable across origins; users start from defaults on jsolly.com. No sessionStorage/IndexedDB/cookies. SW caches (Cache Storage) are the other origin state, cleaned by the tombstone. Recommend accepting the loss (preferences only) and renaming the key (e.g. `recipes-settings-v1`); a cross-origin migration page is not worth it.
- Shuffle: card order reshuffles on every page load (client-side; SSR renders source order).

## 6. CSP needs of recipe pages (summary)

Same-origin scripts (hydration modules, SW), inline `<style>` and style attributes (Svelte scoped styles, bits-ui floating positioning) -> jsolly `style-src 'self' 'unsafe-inline'` already allows; images same-origin only (webp/svg files; `img-src 'self' data:` sufficient); fonts via @fontsource same-origin; `connect-src` fallback `default-src 'self'` (SW cache.addAll/fetch are same-origin); manifest same-origin; no workers besides the SW; no blob:, no data: URLs in recipe code. awesome-blog's meta CSP additionally allowed `img-src https:` and YouTube/diagrams frames for blog posts, which the recipes do not need.

## 7. Content freeze and final re-sync

Recent recipe commits: #699 (chicken-posole restored, 2026-10-04 14:10), #700 (keto-zuppa-toscana, 15:00) after #692-#694/#697 (2026-10-03). Plan:
1. Record baseline `BASE=bf1f7ff1` (or newer) and per-file hashes: `git rev-parse BASE:public/media/recipes`, sha256 of recipes.json/nutrition-data.json, `git show BASE:public/data/recipe-library.json | sha256sum`.
2. Port with a path-mapping script (JSON-aware image path rewrite, then `biome check --write`). Equality check is semantic: `JSON.parse` deepEqual after applying the mapping; media tree compared by file list + sha256.
3. Until cutover recipe edits continue only in awesome-blog (or declare a freeze); before the "deploy merged site" step run `git -C awesome-blog diff BASE..origin/main --stat -- src/components/recipes scripts/recipes public/data public/recipes-pwa public/media/recipes docs/recipes.md`. Empty = nothing to re-sync; otherwise re-port the patch, rerun `npm run recipes:sync` + `recipes:check` + `test:recipes` in jsolly-website, and compare the regenerated `recipe-library.json` (modulo image prefix) with awesome-blog's.
4. Immediately before switching blogthedata.com to redirect-only: freeze awesome-blog's recipe files (no more commits to those paths); the final awesome-blog deployment contains only redirects + tombstones, so any later recipe edit lands in jsolly-website.
5. Cross-cutting: jsolly-website `main` deploys to production on merge (Vercel Git integration). Porting commits therefore must NOT reach `main` before John approves the "deploy merged site" step, or `/recipes` goes live early (and its sitemap entries and SW). Stage on a long-lived integration branch/PR chain, verify with the opt-in `/preview` (John-authorized), merge at the approved step.

## 8. Proposed target layout (jsolly-website)

```
src/pages/recipes/index.astro          NEW  landing = RecipeExperience (meal collection) + h1; replaces /post/15-minute-... special case
src/pages/recipes/[slug].astro         meals, smoothies, 21 recipe pages
src/components/recipes/**              as-is (30 files), imports retargeted to $lib/components/ui/*
src/lib/components/ui/{checkbox,collapsible,dialog,native-select,popover}/...   NEW shadcn (only imported files)
src/styles/recipes-theme.css, recipes-no-script.css
scripts/recipes/{pwa-build.mjs,pwa.test.mjs,sync-assistant-data.mjs}   (article generator + sync dropped)
scripts/recipes/built-recipes.test.mjs NEW (extracted from astro-contract)
public/recipes/data/recipe-library.{json,md}
public/recipes/pwa/{manifest.webmanifest,icon-180.png,icon-192.png,icon-512.png}
public/recipes/media/*  (44 files)
dist/recipes/service-worker.js         generated, scope /recipes/
docs/recipes.md (+ docs/recipes-evidence/ copy of the 172 KB provenance folder)
```
URLs: `/recipes/`, `/recipes/meals/`, `/recipes/smoothies/`, `/recipes/<id>/`, `/recipes/data/recipe-library.{json,md}`, `/recipes/pwa/*`, `/recipes/media/*`, `/recipes/service-worker.js`. package.json: `recipes:sync` = `node scripts/recipes/sync-assistant-data.mjs`; `recipes:check` = same with `--check`; `test:recipes` = unit tests; `test:recipes-built` after build.

## 9. Decisions for John

- D1 Recipe images/data/PWA path: move media to `/recipes/media/` (recommended; one JSON-aware rewrite, per-path redirect pattern) vs keep `/media/recipes/` (no data rewrite but pollutes jsolly root).
- D2 Editorial prose in the dropped post (food-safety temps, preheat/capacity notes, nutrition method, leftovers, rotation): archive in awesome-blog history only (recommended; it is not on the live site today) vs port to `/recipes/guide/`.
- D3 Biome: scoped overrides for `useLayeredStyles`/`noImportantStyles` on the ported recipe tree (recommended) vs rewriting ~245+85 style sites.
- D4 Dark theme for recipes: drop dark block to match light-only site (recommended) vs add site-wide dark mode.
- D5 `.md` handling: exempt `/recipes/data/` in middleware (recommended) vs rename file extension.
- D6 Provenance evidence: copy 172 KB folder into repo (recommended).

## 10. UNVERIFIED

- Vercel BULK redirects (not vercel.json) query handling; `statusCode:301` behavior (docs verified, not exercised).
- Svelte 5 hydration behavior when `process-html.mjs` strips anchor comments (library behavior verified, browser consequence not).
- Whether `Vary: Accept` actually breaks `cache.match()` offline hits (see conflict 14).
- Production-level effect of the middleware `.md` interception (read from code; not requested in prod since the page is not deployed).
- Full merged build (`astro build` + `process-html.mjs` + built-csp test) with recipes added: I started a scratch spike (copied recipe tree into a scratch jsolly clone, ran Biome and Knip, which gave the numbers above) but the build step of that spike was blocked by the auto-mode permission classifier, so I stopped; no build/CSP result for the merged tree exists.
- Browser behavior of tombstone upgrade and of auto-unregister-on-404.
- Installed-user population; external consumers of the assistant data; Vercel dashboard state (not queried).
- `astro check` result on ported code.
