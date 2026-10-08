# Recipes

The recipe library lives under `/recipes/`: the landing page `/recipes/`, the
collection pages `/recipes/meals/` and `/recipes/smoothies/`, and one page per
recipe at `/recipes/<recipe-id>/`. It comes from blogthedata.com's Easy Meals &
Smoothies post, which will 301 to `/recipes/` once the old host is re-pointed at
cutover step C2. The code map, test layout and
invariants are in `AGENTS.md`; this file covers the data, the pipeline, the
offline app and the old host's kill-switch.

## Data contract

The canonical data is `src/components/recipes/recipes.json` (15 meals and 6
smoothies, pinned by `scripts/unit/recipe-data.test.mjs`) and `src/components/recipes/nutrition-data.json` (the
Daily Value nutrients and each recipe's per-ingredient nutrient rows). Recipe
ids are stable: each is a page slug (`/recipes/<id>/`) and a fragment id
(`/recipes/#<id>` opens it in the library dialog), and old links use both.
Images are files under `public/recipes/media/`, referenced as `/recipes/media/...`.

All ingredient amounts describe the reviewed four-adult base, except
`familyOptions`, which describe one non-keto adult's starch. Canonical units
distinguish mass, volume, count and spoon measures; source-specific US measures
describe the same food quantity. Pesto and pressure liquid stay weighed or
measured in grams and mL in both display modes, because generic spoon
conversions would be misleading.

Linear ingredient scaling supports 2, 4, 6 and 8 adults (`SERVING_CHOICES`).
Pressure liquid has a minimum matching the named Duo 6 QT manual; its
small-batch per-serving nutrient difference is recalculated from the model's
all-broth-counted contribution. Higher minima for another cooker are outside the
estimate and noted. Time, safe endpoints, cut size, patty geometry and capacity
do not scale linearly. Six or eight servings need capacity checks or batches;
the frittata uses two matching dishes. Fractional turkey eggs are beaten and
weighed.

Family controls use one valid option per shared recipe. A missing or invalid
option id falls back to the recipe's first choice, in the detail and the
nutrition alike. Neither generic feta nor generic Parmesan is certified
vegetarian; those recipes are plant-forward, with label guidance. Package guides
calculate purchases from scaled ingredient weights; purchased brands can differ,
so weigh drained food.

`midCookActions` counts scheduled starts, shakes, flips and ingredient additions
to the main cooking appliances. Cold-side preparation and family-starch heating
are active work outside that count. Terminal temperature checks and food finish
checks always remain; optional oven rack swaps are disclosed.

Nutrition objects copy the unrounded ingredient model at four servings; the
display rounds. `servingNutrition` adjusts fixed minimums for smaller batches.
Family nutrition adds a measured starch to one base serving and leaves keto
servings unchanged. Extended nutrition (`nutrition.mjs`) covers 23 vitamins,
minerals and choline plus total fat, saturated fat and cholesterol, against FDA
Daily Values, using USDA profiles on the same ingredient weights as the macro
model. Values apply no cooking-retention factors. A nutrient total with a missing
ingredient observation is omitted from the display. These are product
estimates, not a medical nutrition prescription, and no cooking, tasting or
stopwatch testing is claimed.

Ingredients with a scaled mass of at least 1 g display grams. Canonical
`gramsPerUnit` and `massSource` fields keep source-backed weights for spoon
measures and eggs without changing the nutrition model; finishing ingredients
marked `displayMeasure: "spoon"` keep spoon quantities below 1 g. Fine salt uses
the USDA table-salt mass of 6 g per teaspoon.

`flow` stores the Tabular Recipe Notation operation tree: ingredient leaves with
fractional allocations that sum to 1 (or a paired salt pinch and remainder),
operations with children, and preparation rows. `trn-logic.mjs` validates every
ingredient, compacts successive actions on the same input, and computes
non-overlapping rowspan and colspan cells. Family starch stays outside the base
tree.

Maintain `recipes.json` and its unit, allergen and family metadata together. Do
not make protein-critical yogurt or Parmesan optional without recalculating, and
do not substitute frozen, raw or dry food states or sauce brands without
reviewing the method and the nutrition.

### Evidence

The original recipe formulas, the USDA records, the label evidence, the review
notes and the cooking-adaptation boundaries are kept in
[`docs/recipes-evidence/`](recipes-evidence/) (decision J17), copied byte for
byte from the handoff package they were recorded in. Biome and markdownlint
skip that folder so its bytes never change. The whole folder, including
`recompute-nutrition.py`, is an inert record under J17: nothing in the build or
the gate runs it. The script needs Python 3 and, if run, rewrites
`nutrition-calculations.json` from its sibling files. Recipe source links and
modelled limits are also in `recipes.json` itself.

## Pipeline

```bash
npm run recipes:sync    # rewrite public/recipes/data/recipe-library.{json,md}
npm run recipes:check   # fail when they differ from what recipes.json generates
npm run gate
```

`scripts/recipes/sync-assistant-data.mjs` regenerates the two assistant
downloads from `recipes.json`. Their settings are fixed: four adults, US units,
no family starch selected, with each shared recipe's per-person starch options
listed. The JSON uses `schemaVersion: 1` and holds stable recipe ids, readable
quantities, food states, dependency cells, steps, sources, restrictions and
estimates; the Markdown is the same documents as text. Print and these files use one `recipeDocument` from `recipe-export.mjs`. The files are committed, and Biome and markdownlint skip
`public/recipes/data/` so their bytes stay exactly what the script writes. The
gate's `recipes:check` fails on drift, so run `recipes:sync` after every edit to
`recipes.json` and commit the result with it.

There is no generated article: the pages render straight from `recipes.json`
(`src/pages/recipes/`), so nothing else needs regenerating.

## Pages and settings

Each recipe page server-renders one recipe body at four servings with the
default family side. JavaScript then adds scaling, the side choice, the cooking
checks and share links (`?servings=` and `?starch=<id>:<side>`). Without
JavaScript, native ingredient checkboxes and nutrient disclosures still work,
and the collection pages show only the collection links and the cards.

The library saves `{ servings, filters, appliancesOnHand, familyChoice }` in
`localStorage` under `recipes-settings-v1` (J13). The old blogthedata.com key is
on another origin and is not read, so preferences reset once for returning
visitors. Every saved key is validated on load; anything that no longer fits is
reset.

## Offline recipe app

Every page under `/recipes/` is also an installable app: `public/recipes/pwa/`
holds the manifest (`id`, `start_url` and `scope` all `/recipes/`) and the
icons, and `RecipeLayout` links them. Safari users choose Share → Add to Home
Screen; supported desktop and Android browsers offer installation in their menu.

There is one service worker, `/recipes/service-worker.js`, registered by
`recipe-pwa-client.mjs` with scope `/recipes/`, so it can never control the
portfolio or the blog. `scripts/recipes/pwa-build.mjs` writes it in
`npm run build`, after `process-html.mjs`, so the snapshot holds the HTML as
served. It precaches one complete snapshot: every file under `dist/recipes/`
(the pages, the media, the manifest and icons, the two downloads) and every
file those pages load (scripts, styles, fonts, images, the favicon and the
`<noscript>` stylesheets). The cache name is a hash of the snapshot, so any
change to a precached file gives a new snapshot.

The recipe status is visible while offline and hidden when the connection returns.
It describes the cached snapshot and reminds readers that external links need a connection.

- **Serving.** A precached path is answered cache-first; a page only for a
  navigation to its exact `/…/` path. Other blog pages and external recipe
  sources need a connection.
- **Updates.** A new snapshot downloads on a connected visit and waits until
  every recipe tab and app window has closed, then takes over on reopening and
  deletes the older caches. Nothing reloads mid-recipe. A failed download leaves
  the previous snapshot in place and the page reports the failure; it never
  claims offline readiness it does not have.
- **Maintenance builds.** A `MAINTENANCE_MODE=true` build writes no worker, and
  RecipeLayout links no app manifest. An installed worker's update check then gets
  a 404, which leaves it and its cache as they were, so offline cooking keeps
  working through the maintenance window instead of precaching the maintenance
  page. Any other build whose `/recipes/` page links no manifest fails.
- **`ignoreVary`.** The worker looks pages up with `ignoreVary: true`. Real
  recipe routes are HTML only and send no `Vary: Accept`, and both the precache
  and the lookup use bare URLs, so this is a second safeguard should either side
  ever carry an `Accept`. No test exercises it; do not rely on it alone.
- **Headers.** `vercel.json` serves the worker with `Cache-Control: no-cache`, so
  update checks always reach the network.

The worker exists only in a production build: the client does nothing under
`astro dev`. Verify offline behaviour with `npm run build && npm run preview`, or
through `scripts/built/recipes-pwa.test.mjs`, which covers install, offline use,
updates, failed downloads, a maintenance deploy and hydration with service
workers blocked.

## Old-host kill-switch

blogthedata.com registered two cache-first recipe workers: `/recipe-service-worker.js`
(scope `/`) and `/post/15-minute-dump-and-go-instant-pot-recipes/service-worker.js`
(scope that post). Browsers that installed them keep running them until an
update check replaces them. The redirect-only legacy project therefore serves
two byte-identical kill-switch workers at those exact paths, from
`legacy/blogthedata/public/`. On the next update check the kill-switch takes
over, deletes every cache, unregisters itself and reloads each open tab, so the
reload reaches the network and follows the 301 to `https://www.jsolly.com/`. It
has no fetch handler. Their `url-map.json` rows have class `service-worker`,
which adds `Content-Type: application/javascript` and `Cache-Control: no-cache`.

The kill-switch files are never removed while the old host is served: a browser
that has not yet made its update check would otherwise keep serving the old
cached recipe pages. `scripts/built/blogthedata-killswitch.test.mjs` proves both
retirements in Chromium across two origins. Visitors who had the old app
installed install the new one from `/recipes/`.
