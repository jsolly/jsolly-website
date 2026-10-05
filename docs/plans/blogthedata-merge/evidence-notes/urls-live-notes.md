# blogthedata.com live URL surface (probed 2026-10-04, ~20:30-21:00 UTC)

Machine-readable table: `urls-live.json` (792 rows). Supporting raw data in `crawl/` (recs.json, refs.json, external.json, wayback-probe.json, cloudfront-probe.json), `matrix.txt` (full redirect chains), `raw/` (headers + bodies of the fixed probes), `sitemap-locs.txt`.
Each row: url, host, path, status, location, content_type, cache_control, source (primary), sources (all), cls, notes, inbound_links. `source` enum used: sitemap|rss|atom|robots|well-known|probe|crawl|redirect-config. Wayback-only historical URLs are tagged `probe` with `sources:["wayback"]`.

## 1. Deploy drift
`/release.json` -> `{"sha":"bf1f7ff1cb92faacfdc3b98ba17fb2f93cac59b5"}` == SRC `origin/main` bf1f7ff1. **No drift**: the repo state we are planning against is what is live. (`cache-control: no-store`, header set by vercel.json.)

## 2. Fixed probes (www.blogthedata.com)
| path | status | content-type | cache-control |
|---|---|---|---|
| /robots.txt | 200 | text/plain | public, max-age=0, must-revalidate |
| /sitemap.xml | 200 | application/xml | same |
| /sitemap-index.xml, /sitemap-0.xml | 404 | html | (not generated; single hand-built sitemap, no index) |
| /rss/ | 200 | application/rss+xml | same; **latest 5 items only** (sorted by `updated`) |
| /atom/ | 200 | application/atom+xml | same; latest 5 |
| /rss, /atom (no slash) | 308 -> /rss/, /atom/ | text/plain | trailingSlash normalisation |
| /feed, /feed/, /rss.xml, /atom.xml, /index.xml, /feed.xml | 308->/feed/ then 404, rest 404 | - | not served |
| /search-index.json | 200 | application/json | 552 KB; consumed by /search/ island |
| /.well-known/security.txt | 200 | text/plain | Contact is `mailto:john@blogthedata.com`; Expires 2027-10-02; Encryption + Canonical point at blogthedata.com |
| /pgp-key.txt | 200 | text/plain | referenced by security.txt Encryption: field and by a post |
| /favicon.ico | 200 | image/vnd.microsoft.icon | |
| /logo.webp | 200 | image/webp | |
| /data/recipe-library.json (390 KB) and .md (159 KB) | 200 | application/json / text/markdown | "assistant data" |
| /recipes-pwa/manifest.webmanifest | 200 | application/manifest+json | `id`/`start_url` = `/post/15-minute-dump-and-go-instant-pot-recipes/`, `scope` = `/` |
| /recipes-pwa/icon-180|192|512.png | 200 | image/png | |
| /post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js | 200 | application/javascript | **no-cache** (vercel.json header) - legacy-scope SW |
| /recipe-service-worker.js | 200 | application/javascript | max-age=0 - **scope `/` SW; not in the task's probe list, found via source** |
| random path /zz-random-xyz/ | 404 | text/html (Astro 404 page, 12.5 KB) | same; /404.html also directly served 200, /404/ 404 |
| /release.json | 200 | application/json | no-store |
| /search/ | 200 | html | `noindex, follow`; robots.txt `Disallow: /search/`; not in sitemap |

## 3. Crawl results (seeded with sitemap + fixed probes, followed same-origin hrefs/src/srcset/og:image/manifest/icons/redirect Locations, www and apex hosts)
- Sitemap: 116 URLs = `/`, `/all-posts/`, `/privacy/`, `/works-cited/` + 6 `/category/<slug>/` + 106 `/post/<slug>/`. All 116 return 200. No `/recipes/*`, `/search/`, assets or feeds in sitemap. No pagination anywhere (`/all-posts/` lists everything; `?page=2` just returns the same page).
- 106 post slugs; **22 contain uppercase** (e.g. `Find-Your-Dream-Job-With-LinkedIn-Boolean-Search`, `Adding-views-likes-to-posts`, `I-made-my-code-async-its-388-percent-faster`). Paths are case-sensitive on prod: lowercase variant 404s. Category `Geodev` is also mixed case (`/category/geodev/` 404). Redirect sources must preserve case exactly and the redirect test must assert the case-exact form.
- 6 categories: dev-tools, Geodev, productivity, resources, uncategorized, web-dev. No `/tag/*`, `/author/*`, `/post/`, `/category/`, `/blog/`, `/recipes/` (index) pages exist (all 404).
- **Not in sitemap but live and linked (must be in the URL map):** 23 recipe pages `/recipes/meals/`, `/recipes/smoothies/`, + 21 `/recipes/<recipe-id>/` (15 meal ids incl. `chicken-posole` and `pan-fried-greek-turkey-patties`, 6 smoothie ids; full list in json, `cls=recipe-page`; ids from `src/components/recipes/recipes.json`), each also linked as `?servings=4` (21 query-bearing variants). Entry point is the post `/post/15-minute-dump-and-go-instant-pot-recipes/` (also in RSS). `/recipes/<id>/` breadcrumb links back to that post.
- `/search/` and `/404.html` are live but non-indexable.
- Counts of the 278 www 200-responses that are part of the real surface: 106 posts, 44 recipe-page URLs (23 + 21 ?servings), 44 `/_astro/*` hashed assets (fonts, css, js - 22 woff/woff2 pairs etc.; hashed, ignore for redirects), 44 `/media/recipes/*` images (webp 480/960/1440 + svg), 9 other static assets (social/*.svg, logo.webp, topographic-logo.svg, favicon.ico, media/default.webp), 6 categories, 6 pages, 6 meta files, 4 PWA files, 2 feeds, 2 recipe-data.
- **Post images are NOT on blogthedata.com.** 213 distinct image URLs inside post bodies/frontmatter point at `https://d1d7p8ufhgz4ld.cloudfront.net/media/{post_imgs,post_metaimgs}/...` (212 return 200; 1 is an artifact of a space in the extracted URL). The only first-party media paths are `/media/default.webp` and `/media/recipes/*`. Consequence: the CloudFront bucket is a runtime dependency that survives the blogthedata.com redirect-only switch; jsolly.com's CSP `img-src 'self' data:` would BLOCK it (blog CSP uses `img-src 'self' https: data:`).
- External refs: ~1,423 distinct external URLs (en.wikipedia 371, cloudfront 212, linkedin 112, reddit 110, twitter 107, github 83, youtube 58...). No other `*.blogthedata.com` host is referenced.
- **Apex-host absolute links inside post bodies (36 distinct):** posts link to `https://blogthedata.com/post/<slug>/`, `https://blogthedata.com/all-posts/`, `/robots.txt`, `/pgp-key.txt`, `/password-reset/` (without www; each resolves via an extra 308 hop). All must be rewritten to the new `/blog/<slug>/` form during content import, and the internal-link checker must treat the apex host as internal.
- **Dead references inside posts (404 today):** `/src/scripts/carousel.js` (from `migrating-portfolio-from-django-to-astro-js`), `/post/how-to-implement-subresource-integrity-django/local.js` (relative link in SRI post), `/password-reset/` (from `how-to-send-email-with-python-the-hard-way`). Decide: drop/ fix at import, not carry as broken links.

## 4. Host / scheme matrix (full chains in `matrix.txt`)
All hops are **308**, never 301. (Vercel `permanent:true` emits 308; to emit a literal 301 the rule needs `"statusCode": 301`.)
- `https://www.` -> 200 direct.
- `http://www.X` -> 308 `https://www.X` (1 hop).
- `https://blogthedata.com/X` -> 308 `https://www.blogthedata.com/X` (vercel.json host rule `/(.*)` has host `blogthedata.com`).
- `http://blogthedata.com/X` -> 308 `https://blogthedata.com/X` -> 308 `https://www.blogthedata.com/X` (2 hops).
- No-slash paths add a trailingSlash hop first: `https://blogthedata.com/post/x` -> 308 `/post/x/` (relative) -> 308 `https://www.blogthedata.com/post/x/` (apex+no-slash = 2 hops; http+apex+no-slash = 3). Same for `/rss`, `/atom`, `/privacy`, `/works-cited`, `/all-posts`, `/search`.
- Query strings are preserved by the apex->www rule (verified: `https://blogthedata.com/search/?q=django&x=1` -> 308 same query on www; also `/recipes/chicken-posole/?servings=4`). Whether the NEW per-path rules preserve query is untested and belongs in the redirect test.

## 5. Existing redirect config and chains
Source: `vercel.json` (read at origin/main) has exactly 3 redirects: 2 legacy renames (permanent) and the apex->www host rule. `src/content/redirects.json` (2 entries, legacyId 1 and 3; source `.../how-to-leverage-closed-loops` has NO trailing slash there) and `src/content/intentional-rewrites.json` are NOT applied at runtime by any code: `git grep` shows they are only read by `scripts/astro-contract.test.mjs`, `scripts/verify-migration.mjs`, `scripts/production-smoke-scenario.mjs(.test)` (asserting a matching vercel.json rule exists). `intentional-rewrites.json` is a hash receipt (slug `15-minute-dump-and-go-instant-pot-recipes`, user-authorized rewrite of that post on 2026-10-02) used by verify-migration only. The Astro config has no `redirects` map.

| legacy source | live response | chain to final |
|---|---|---|
| `/post/sollys-favorite-youtube-channels-and-podcasts/` | 308 -> `/post/my-favorite-youtube-channels-podcasts-newsletters/` | 200 (target is a real post, in sitemap). Final jsolly URL: `/blog/my-favorite-youtube-channels-podcasts-newsletters/` |
| `/post/how-to-leverage-closed-loops/` (and no-slash) | 308 -> `/post/stop-asking-questions-to-save-time/` | **404 (dead end)** |

**FINDING (high):** `stop-asking-questions-to-save-time` exists neither in `src/content/posts` (106 files), nor in the private legacy export (106 `blog.post` records; the redirect row pointed at a slug that was never a post there either), nor in the sitemap. The existing production redirect `how-to-leverage-closed-loops` therefore ends in a 404 today. The URL map must not blindly chain it. Needs a decision from John: 301 to `/blog/` (closest live destination), or a 410/404, or locate the intended article. Do not carry the broken destination forward.
Direct-final-target entries for the plan (apply "no chains" rule): both legacy sources (with and without trailing slash) should point straight at their final jsolly.com URL, not via blogthedata.com.

## 6. Historical / indexed-elsewhere URLs (Wayback CDX, `statuscode:200`, domain match; 564 paths -> probed on www)
Not "live" but plausibly still indexed or linked externally from the Django era: 366 `/media/*` and `/static/*` (Django media/static; **all 404 on prod now**, apart from `/media/default.webp` which exists), 5 post URLs that 404 now (`/post/geoasteroids/`, `/post/web-mapping-gallery/`, `/post/blogthedata-open-source-blog-portfolio/`, `/post/family-constitution-outlines-principles-values/`, `/post/part-1-adding-SEO/`), 4 category aliases that 404 (`/category/devtools|geodev|webdev|portfolio/`), `/login/`, `/register/`, `/admin/*`, `/status/`, `/portfolio/` (404), `/resume`, `/leaflet-map` etc. (308 to slash then 404), and `/cdn-cgi/*` (Cloudflare artifacts). These are already 404 on blogthedata.com, so they are NOT a regression risk of the merge; recommend explicit policy (leave 404 or add a few per-path redirects for the 5 dead posts/4 categories if mappable) - decision for John, evidence in `crawl/wayback-probe.json`.

## 7. Service-worker / PWA risk (important for cutover)
Two registered service workers exist on blogthedata.com for installed/previously-visited recipe users: `/recipe-service-worker.js` (scope `/`, `updateViaCache:none`) and legacy `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js` (scope that post route). Both are cache-first for the recipe route and its asset list (`cache.match(key) || fetch`), and the manifest `start_url` is the post route. After blogthedata.com becomes redirect-only, a cross-origin 3xx on the SW script makes update checks fail (browsers reject redirected service-worker scripts), so those clients keep serving the cached shell and never see the redirect. Cutover plan needs a kill-switch: keep serving a 200 self-unregistering SW (clear caches, `registration.unregister()`, navigate clients) at both script URLs on blogthedata.com, excluded from the redirect rules, and keep them there indefinitely. The same applies to the manifest/icons (can redirect) but NOT the two SW scripts. UNVERIFIED: no real-browser test done here.

## 8. DNS (dig, 2026-10-04)
- Registrar/NS: Cloudflare (`amanda.ns.cloudflare.com`, `vin.ns.cloudflare.com` - the **same NS pair as jsolly.com**, so likely the same Cloudflare account/zone owner; not verified via MCP).
- `blogthedata.com` A = 216.150.16.129, 216.150.1.129 (Vercel); no AAAA, no CNAME.
- `www.blogthedata.com` CNAME `37a94d917290a1e8.vercel-dns-016.com` (A 216.150.1.193, 216.150.16.193). DNS-only (not Cloudflare-proxied: IPs are Vercel's).
- Subdomains media, static, cdn, api, status, mail, blog, assets, img, images, docs: **no A/CNAME records**. No MX. No `_dmarc`, no DKIM CNAMEs at the common selectors. TXT: one `google-site-verification` record (value not captured). So **`john@blogthedata.com` in security.txt has no MX to receive mail**; the security contact is effectively dead (finding; fix when security.txt moves, or point at a working address).
- For comparison jsolly.com: apex A 76.76.21.21 (Vercel), www CNAME `cname.vercel-dns.com`; vercel.json redirect apex->www; CSP header `img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'` (+ Astro meta CSP `default-src 'self'`).

## 9. Collisions with jsolly.com found while probing (inputs for the URL map)
- `/privacy/` exists on both (blog privacy page vs jsolly /privacy): blog `/privacy/` needs a destination decision (jsolly.com/privacy/ vs `/blog/privacy/`).
- `jsolly.com/robots.txt` is a static file pointing to `/sitemap-index.xml`; blog `/sitemap.xml` has no equivalent -> map to `https://www.jsolly.com/sitemap-index.xml`.
- jsolly.com has `/.well-known/security.txt` 404, `/pgp-key.txt` 404, `/rss/` 404, `/blog/` 404, `/recipes/` 404 today (clean namespaces), `middleware.ts` (Accept negotiation; Vercel Routing Middleware matches all paths -> recipe `/data/*.json|md`, SW scripts and feed content-types must be verified not to be altered by middleware).
- jsolly.com already hard-links `https://www.blogthedata.com/` in Footer, SiteNavigation, SiteIntro, socialLinks, `llms.txt`, `agent-pages.ts`, JSON-LD `sameAs`: all need updating to `/blog/` as part of the merge (otherwise a post-cutover redirect loop-free but stale link; and `sameAs` points at a redirect-only domain).

## 10. Counts (urls-live.json, 792 rows)
- Status: 200 x317, 404 x408, 308 x66, 403 x1 (`/wp-login.php`, Vercel firewall).
- Primary source: probe 487, crawl 175, sitemap 116, redirect-config 8, robots 3, rss 1, atom 1, well-known 1. (`sources` holds the full membership; `rss`/`atom` membership = the 5 newest posts each.)
- Class: post 142 (106 canonical www + apex/404 variants), recipe-page 44, recipe-image 44, astro-asset 44, historical-media 183, historical-static 183, historical-other 71, category 9, static-asset 9, meta 8, page 7, other 30, host-matrix 10, pwa 4, feed 2, recipe-data 2.
- Hosts: www.blogthedata.com 750 (200 x317, 404 x408, 308 x24, 403 x1), blogthedata.com 42 (all 308).

## 11. Addendum (reviewer-requested gaps closed)
- **JS bundles:** the attribute crawl missed Astro island JS (`component-url`/`renderer-url`). Both SW scripts embed the same 135-entry `ASSETS` precache (`crawl/sw-assets.json`: 9 JS, 4 CSS, 40 woff/woff2, recipe pages/images/data, manifest, icons, the post route). 11 missing rows added to `urls-live.json` (final count 803 rows: 200x328, 404x408, 308x66, 403x1; by primary source probe 487, crawl 186, sitemap 116, redirect-config 8, robots 3, rss 1, atom 1, well-known 1). Hashed, need no redirects; they define what installed PWA clients have cached (old JS keeps running offline after cutover unless the SW kill-switch is in place).
- **Where redirects live today (Vercel MCP, read-only):** team `jsollys-projects`; project `blogthedata` (prj_QxSNy3z51xOp295HUvPfDa1JY9h8) owns `blogthedata.com`, `www.blogthedata.com` and `blogthedata.vercel.app`, all with `redirect: null`, i.e. **no domain-level redirect exists**; apex->www is purely the `vercel.json` host rule. Project routes: 0; bulk redirects: 0. So all redirect behaviour is in the repo's vercel.json, which disappears if the project is deleted or its repo archived/unlinked (archiving a GitHub repo does not stop Vercel serving the last production deployment, but the project must keep its Git link/deployment intact). By contrast jsolly.com apex has a domain-level 308 -> www.jsolly.com in addition to the vercel.json host rule (redundant).
- **`blogthedata.vercel.app` is a live duplicate host:** `/` and `/post/solly-agent-rules-markdown/` both 200 (canonical tags point at www). After cutover it keeps serving the old site unless the project is switched to redirect-only for all hosts; include it in the coverage test or accept as non-indexed.
- **Iframes (CSP):** 13 post files embed `<iframe>`: `www.youtube.com` x13, `nbviewer.org` x2, `viewer.diagrams.net` x1 (sanitizer allows also youtube-nocookie). Blog CSP `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://viewer.diagrams.net https://nbviewer.org`; jsolly.com's `default-src 'self'` (no frame-src) would block all of them. Together with `img-src` (213 CloudFront images in posts) these are the CSP breaks that Astro `security.csp` directives on jsolly must accommodate.
- **Wayback for the dead redirect target:** CDX prefix queries for `/post/stop-asking-questions-to-save-time/` and `/post/how-to-leverage-closed-loops/(no slash)` return zero captures, and the availability API returns none: the intended target cannot be recovered from the archive. Do not assume `how-to-ask-questions-like-a-senior-engineer` is the target (not evidenced).
