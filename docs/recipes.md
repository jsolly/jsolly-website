# Recipes

The recipe library lives under `/recipes/`: the landing page `/recipes/`, the
collection pages `/recipes/meals/` and `/recipes/smoothies/`, and one page per
recipe at `/recipes/<recipe-id>/`. It comes from blogthedata.com's Easy Meals &
Smoothies post, which redirects to `/recipes/` through the legacy host.
The code map, test layout and
invariants are in `AGENTS.md`; this file covers the data, the pipeline, the
offline app and the old host's kill-switch.

## Preview recipe changes

Keep UI work in a draft pull request and add the `preview` label. The Vercel
Preview workflow deploys each pushed commit and updates one Preview comment on
the pull request. Remove the label to stop automatic redeployments.

The Preview comment links to one protected URL for the project and pull request,
plus the immutable URL for that build. Reload the stable URL after a deployment
finishes to see the new commit. Preview builds do not register the offline
worker, so its cache cannot hide changes. Production keeps the offline app's
normal update behavior and changes only after the pull request merges.

Draft PRs carrying `preview` use the separate **UI preview checks** workflow
(lint, types and unit tests); the long built-site suite waits until full CI is
requested. The Preview deployment stays independent, so UI iteration does not
wait for full CI. Before marking ready or merging, run the full local gate and
wait for required `ci` on the current head. Marking ready or removing `preview`
starts full CI. A skipped `ci-deferred` or passing `ci-preview` cannot authorize
merging.

For explicitly authorized UI-only local publication, verify the live same-repo
draft PR has `preview` and the expected head, then `npm run gate:preview` uses the scope guard and quick
checks. Only added/modified Svelte components and stylesheets qualify; other
changes still require `npm run gate`. The full gate always disables preview mode.

## Data contract

The canonical data is `src/components/recipes/recipes.json` (140 meals and 6
smoothies, pinned by `scripts/unit/recipe-data.test.mjs`) and `src/components/recipes/nutrition-data.json` (the
Daily Value nutrients and each recipe's per-ingredient nutrient rows). Recipe
ids are stable: each is a page slug (`/recipes/<id>/`) and a fragment id
(`/recipes/#<id>` opens it in the library dialog), and old links use both.
Images are files under `public/recipes/media/`, referenced as `/recipes/media/...`.

The 125 publisher adaptations retain their source URLs, attribution, nutrition basis and limitations in `sourceRecipe`, including in JSON downloads. Unmeasured cooking spray used only to prepare cookware belongs in flow preparation directions, including any optional use or device-manual conditions, rather than ingredient rows. Measured oil-or-spray alternatives remain ingredients. Missing food ingredient quantities display as "Not specified"; missing nutrition and times display as "Not provided". The 72 recipes that previously lacked complete macros now carry labeled nutrition estimates and remain separate from keto eligibility. Every publisher adaptation has an ingredient nutrient model. Missing nutrient observations do not qualify for nutrient filters. Prep time is distinguished from household active time. The browser keeps concise source attribution and cooking instructions; provenance and nutrition assumptions remain in canonical data and assistant downloads. Cooking guidance from source limitations belongs in the flow. Mobile renders the same ingredient allocation tree vertically, preserving branch joins and shared cooking checks; desktop and print retain the table.

Every recipe has a first-party illustration under the [image contract](recipe-images.md), with illustration provenance retained in its image metadata and downloads.

Household ingredient amounts describe the reviewed four-adult base, except
`familyOptions`, which describe one non-keto adult's starch. Canonical units
distinguish mass, volume, count and spoon measures; source-specific US measures
describe the same food quantity. Pressure-liquid minima always retain their required mL volume in every display
mode. A generic broth density cannot establish a cooker's safe liquid minimum.

Publisher adaptations use four portions and preserve their stated quantities and method limits. Whole-bird recipes round up to complete batches for 2, 4, 6 and 8 portions. Missing publisher quantities stay missing in cooking instructions. Nutrition models may use explicitly disclosed standard count weights, generic-food substitutes and excluded unmeasured additions; these are estimates rather than publisher claims.

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

Household nutrition objects and newly estimated publisher macros copy the
unrounded ingredient model at four servings; supported existing publisher
macros are retained separately. The display rounds. Library cards always show the same per-serving value from that
four-serving model (or per 8 fl oz smoothie glass), independent of batch size.
Recipe time summaries use the upper end of a recorded range without a plus sign;
capacity and cooking endpoint notes still apply. `servingNutrition` adjusts fixed minimums for smaller batches.
Family nutrition adds a measured starch to one base serving and leaves keto
servings unchanged. Extended nutrition (`nutrition.mjs`) covers 23 vitamins,
minerals and choline plus total fat, saturated fat and cholesterol, against FDA
Daily Values, using USDA profiles on the same ingredient weights as the macro
model. Values apply no cooking-retention factors. A nutrient total with a missing
ingredient observation is omitted from the display. These are product
estimates, not a medical nutrition prescription, and no cooking, tasting or
stopwatch testing is claimed.

### Ingredient units

Choose **Grams**, **US imperial** or **Metric** on a recipe, in the library or in
its recipe dialog. The choice persists under the existing settings key. A shared
link carries `?units=grams|us|metric`; an explicit URL choice takes priority over
the saved preference. Old links and saved settings default to US imperial.
US imperial means US customary cups and spoons, not British Imperial volumes.
`oz` is mass and `fl oz` is volume.

- **Grams** converts known mass and supported volume/count weights to grams.
  Unsupported counts, packages, mixed ingredients and undefined measures retain
  their source amount with "weight unavailable". Missing quantities stay missing;
  to-taste ingredients stay to taste.
- **US imperial** uses pounds or mass ounces for weights, fluid ounces for mL,
  and the source US cups/spoons and counts for other quantities. Required pressure-liquid
  minima retain mL in every mode.
- **Metric** uses grams for mass and supported dry portions, mL for liquids and
  other known volumes. An unresolved dry volume explicitly says "mL volume" and
  retains the original cup/spoon quantity. Counts and undefined measures retain
  their original amount when no reliable weight is available.

Volume/count weights are approximate, prefixed with `~`, and retain the source
measure. Source-backed `gramsPerUnit` and `massSource` remain eligible. Additional
observations live in `ingredient-weights.json`, with exact ingredient-name matches,
USDA food descriptions, portion descriptions and gram weights, source URLs and
the retrieved archive hash. Alternatives, packed/heaping measures and whipped
states stay unresolved. They are cooking references, independent of nutrition
estimates. No generic cup-to-gram ratio, nutrition-only package assumption, seasoning
blend proxy or automatic fuzzy food match enters cooking quantities. Review the
food state and packing before adding a match. The original spoon/count measure
remains the practical fallback for scales that cannot resolve tiny quantities.

Conversions start from the unrounded canonical amount after linear, fixed,
minimum or whole-batch scaling. Display rounding never replaces canonical data
or changes nutrition. Positive amounts below display precision say `<0.01` rather
than zero. Source method/package notes keep their original quantities; cooking
settings in Grams and Metric also show metric equivalents with the original
settings and safe endpoints retained.

[`recipe-units-audit.json`](recipe-units-audit.json) lists every base ingredient
and family option, its canonical state, source-backed weight if available, and
its four-serving display and unresolved status in all three modes. Regenerate
from this repository root after editing recipes or conversion references:

```bash
node scripts/recipes/audit-units.mjs --write
```

The unit suite rejects stale audit bytes and checks all recipes at every supported
serving count in all three modes. `node scripts/recipes/audit-units.mjs` also checks
the audit without writing it.

`flow` stores the Tabular Recipe Notation operation tree: ingredient leaves with
fractional allocations that sum to 1 (or a paired salt pinch and remainder),
operations with children, and preparation rows. `trn-logic.mjs` validates every
ingredient, compacts successive actions on the same input, and computes
non-overlapping rowspan and colspan cells. Family starch stays outside the base
tree.

Every recipe owns its `starches` categories in `recipes.json`; the library filter
uses that metadata for main ingredients and available family sides.
Maintain `recipes.json` and its unit, allergen and family metadata together. Do
not make protein-critical yogurt or Parmesan optional without recalculating, and
do not substitute frozen, raw or dry food states or sauce brands without
reviewing the method and the nutrition.

### Nutrition estimates

All 146 recipes have calories, protein, total carbohydrate, fiber and net carbohydrate.
The 125 publisher adaptations also have ingredient rows in `nutrition-data.json`,
with edible grams, the USDA FDC record ID/description, source URL and per-100-g
observations. Existing publisher macros with a supported serving basis remain;
72 previously incomplete macro sets are filled from these ingredient models.
`sourceRecipe.nutritionEstimate.estimatedMacroFields` identifies the fields that
were filled. The model's assumptions remain in canonical data and assistant downloads.
Original source nutrition is retained separately.

The additional records use USDA's static SR Legacy April 2018 CSV release,
retrieved 2026-10-10, with archive SHA-256
`b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`.
Coconut flour and xanthan gum use Bob's Red Mill label observations instead;
label rounding and unlisted micronutrients remain limitations. Their source URLs
are stored with the rows. No build or test calls a nutrition API. Each ingredient row and publisher model
stores a snapshot of its canonical ingredient inputs; the unit suite rejects stale
snapshots after a recipe edit. To revise a model, review its food record and edible
gram assumptions, update the recorded per-100-g observations/grams and snapshots,
then recompute only the fields named in `estimatedMacroFields`: sum
`macros[field] × grams / 100` across its rows and divide by four. Net carbohydrate
is total carbohydrate minus fiber, floored at zero. Preserve supported publisher
macros. Mark an assumed value in `assumedMacroFields` rather than presenting it
as a USDA observation. Regenerate the assistant downloads and run the gate.

Nutrition-only assumptions include standard edible weights for count-based meat,
vegetables and packages; generic sauces/seasoning blends; a disclosed stated
alternative; all measured oil/sauce counted; and unmeasured garnish/to-taste
additions excluded. The cooking ingredient quantities are unchanged. Each recipe
lists its actual choices, including generic mustard, marinade and spice proxies. Cajun/Old Bay/steak seasoning uses
a disclosed generic mix of 50% salt, 20% paprika, 10% garlic powder, 10% onion
powder and 10% black pepper by mass; garam masala uses a curry-powder proxy.
The ranch-chicken estimate retains publisher macros and estimates missing fiber
from the measured ingredients, assuming no fiber from the ranch mix; its
unobserved micronutrients remain missing. Balsamic vinegar's unreported fiber is
explicitly assumed zero. These estimates can differ from specific brands and
actual edible weights. Nutrients with an unobserved contributing value remain
unreported, rather than being filled with zero.

A 2026-10-10 audit checked all canonical recipes and refreshed publisher sources.
Eatwell101 exposes calories in structured data and a text-parsing calculator for
other nutrition. Its calculator was rejected: it returned implausible totals and
failed to recognize some main ingredients. The site uses the traceable ingredient
models above instead.

Qualifying recipes show Immune support, Iron-rich and High in Omega-3s pills on
library cards, in the recipe dialog and on individual pages. Pills use the same
nutrient eligibility checks and selected serving count as the library filters.
Recipes with missing observations do not gain a pill from those observations.

### USDA API lookups

The maintenance-only `recipes:usda` command searches FoodData Central or fetches
an identified food record. It reads the standard SecureString
`/shared/nutrition/usda-api-key` in AWS account `730335616323`, `us-east-1`, using
the existing `agent-readonly` identity. It uses the AWS SDK to avoid CLI
history, verifies that identity and the returned
parameter ARN/type, keeps the key in memory and sends it in `X-Api-Key`, never a
URL. Errors omit provider bodies and credential-bearing diagnostics. The command
does not modify recipe data or run during builds, tests or browser requests.

From this repo's root:

```bash
npm run recipes:usda -- search "spinach raw"
```

Fetch a selected FDC record from the same cwd:

```bash
npm run recipes:usda -- food 168462
```

Refresh the already reviewed ingredient matches from this repo's root:

```bash
node scripts/recipes/refresh-nutrition.mjs --cache /private/tmp/jsolly-usda-refresh-20261013
```

The cache contains public USDA responses and their retrieval timestamps, never the
key. `--delay-ms 0` permits a finite refresh without the default delay when
the remaining request count is known to fit the hourly quota. Reusing it reproduces the same refresh without another API call; choose a
new absolute directory outside the repository for a fresh snapshot. The script
deduplicates the existing FDC IDs, respects the [USDA API quota](https://fdc.nal.usda.gov/api-guide/#rate-limits)
with a default delay of four seconds per new record,
and validates reviewed SR Legacy/FNDDS identity, nutrient IDs, units and finite nonnegative
amounts before writing either canonical data file. It never searches or rematches
foods. `nutrition-data.json`'s `apiRefresh` receipt records the earliest cached
retrieval time, matched IDs, row coverage and retained brand/composite profiles.

The 2026-10-13 API check covered 149 distinct reviewed FDC records (148 SR Legacy
records and the existing FNDDS gnocchi proxy), refreshing 1,474 ingredient rows
across all 146 recipes. The remaining 36 rows retained reviewed brand, composite
or hybrid profiles. All observed nutrient and macro values agreed with the
existing snapshots, so this check changed provenance rather than nutritional
totals. Explicit null observations remain missing.

Only the reviewed nutrient observation set is refreshed, preserving deliberate
omissions such as the sausage proxy's outlier iron. An observation absent from the
API is omitted, never replaced with zero. Fortified yeast's hybrid label/USDA
profile, brand labels, composite seasonings, omega-3 observations, edible weights
and explicit macro assumptions stay as reviewed. Only publisher macro fields
listed in `estimatedMacroFields` are recalculated; supported publisher macros and
household macro formulas retain their existing evidence. Run `recipes:sync` and
the gate after refreshing. Neither routine builds nor visitors call this API.

Review the food state, brand, portions and nutrient units before updating a model.
Search results are candidates, not automatic ingredient matches. Food records
retain USDA's nutrient values and units; missing observations stay missing. The
existing ingredient-weight, assumption, source-snapshot and download-regeneration
requirements still apply. Public lookup output may be saved as review evidence;
never save the credential response or enable credential-bearing SDK diagnostics.

Ownership: `shared-infra/aws/template.yaml` owns the exact IAM exception and
`shared-infra/docs/identity.md` owns John's provisioning/deployment commands.
The SecureString value is entered by John outside CloudFormation; neither repo
contains the key or a secret placeholder. This repository owns its access
guidance and optional `.cursor/aws-oidc-login.sh` bootstrap. The standard AWS SDK
credential chain must already resolve an approved agent identity: local Claude/Codex/Cursor use the separate agent SSO session;
Cursor Cloud can run the existing `.cursor/aws-oidc-login.sh`. Cloud Claude/Codex
still need an approved AWS authentication path; this command does not create one.
The shared role's USDA permission applies across repos using that role. It becomes
available only after John's manual shared-infra deployment and key provisioning.
No Vercel secret or site runtime access is needed.

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
estimates; the Markdown is the same documents as text. The browser's Download Markdown and Download JSON controls export the current collection or
recipe with the selected servings, units and family side, including offline. The
static endpoints keep the fixed defaults above, as do canonical `.md` pages.
These files use one `recipeDocument` from `recipe-export.mjs`. Screen and print cooking content share `RecipeContent.svelte`. The files are committed, and Biome and markdownlint skip
`public/recipes/data/` so their bytes stay exactly what the script writes. The
gate's `recipes:check` fails on drift, so run `recipes:sync` after every edit to
`recipes.json` and commit the result with it.

There is no generated article: the pages render straight from `recipes.json`
(`src/pages/recipes/`), so nothing else needs regenerating.

## Pages and settings

The information link beside Ingredient units opens `/recipes/assumptions/`,
which explains approximate conversions and the unit modes. Recipe browsing
keeps this explanation off the cooking view; assistant downloads
retain the full measurement policy. Print recipe uses a filled button with a
printer icon, and download actions label their document-format icons.

Search recipes searches the current collection alongside the existing filters.
Names and ingredients rank highest; equipment, cooking instructions, family
sides and nutrition highlights are searchable too. MiniSearch runs locally
with accent-insensitive matching, prefixes and limited typo tolerance. Clearing
search restores the current card order. Queries are not saved.

Each library card has a Print recipe action using the current servings, units
and family side. It prints only that recipe without opening the detail dialog.

On iPhone and iPad Home Screen apps, **Print recipe** offers **Open in Safari**
instead of calling the installed app's unreliable print API. The link opens the
individual recipe on the current host with the selected servings, units and
family side; tap **Print recipe** again in Safari. A selectable HTTPS link is
also shown for manual copy/paste if the Safari application scheme is unavailable.
Safari needs a network connection and, on a protected Preview, its own authorized
session. Browser tabs and Mac Dock apps retain their existing print flow.
This handoff covers individual recipe pages, library cards and the library's recipe dialog;
**Print all meals/smoothies** retains the existing browser printing flow.
The direct iOS application handoff needs real-device verification; Chromium
standalone emulation verifies detection, link settings and browser restoration,
not iOS print-sheet presentation.

The library renders its print packet when printing starts, including browser-menu printing, and removes it when printing ends. If preparing the packet or opening the print dialog fails, it restores the previous print mode, shows a failure message and logs the cause in the browser console. Browsing pages share bundled recipe data instead of embedding the full dataset in each page’s island props; the server-rendered collection cards still work without JavaScript.

Each recipe page server-renders one recipe body at four servings with the
default family side. Enhanced controls render disabled, then JavaScript enables
scaling, the side choice, the cooking checks and share links
(`?servings=`, `?units=` and `?starch=<id>:<side>`). Native fallbacks live in `<noscript>`,
so hydration never replaces a disclosure or cooking check in use. Without
JavaScript, native ingredient checkboxes and nutrient disclosures still work,
and the collection pages show only the collection links and the cards.

Cards start in canonical source order (search uses relevance order). Shuffle
recipes randomizes the card order for this visit while preserving all search,
filter and cooking settings. Reload restores the default order.

The library saves `{ servings, units, filters, appliancesOnHand, familyChoice }` in
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
`npm run build`, after `process-html.mjs` and `markdown-build.mjs`, so the snapshot holds the HTML and Markdown as
served. It precaches one complete snapshot: every file under `dist/recipes/`
(the pages, the media, the manifest and icons, the two downloads) and every
file those pages load (scripts, styles, fonts, images, the favicon and the
`<noscript>` stylesheets). The cache name hashes the snapshot and bundled worker
policy, so changing a precached file or its serving logic gives a new snapshot.

The recipe status is visible while offline and hidden when the connection returns.
It describes the cached snapshot and reminds readers that external links need a connection.

- **Serving.** Precached paths are answered cache-first. GET and HEAD requests
  for known recipe pages select HTML or Markdown using the shared Accept
  negotiation helper. Explicit `.md` siblings always serve Markdown. HEAD keeps
  the selected status and headers with no body; an unsupported page Accept
  returns 406 with `Vary: Accept`. Query controls do not change canonical
  four-serving Markdown. Static assistant downloads retain their own bodies and
  MIME types regardless of the page Accept header. Other blog pages and external
  recipe sources need a connection.
- **Representation keys.** Install and lookup use the same explicit Accept
  keys: HTML for `/…/` pages, Markdown for `.md` files, and `*/*` for other
  assets. Cache lookup respects Vary; it never uses `ignoreVary`. The root
  `/recipes.md` sibling is precached for controlled recipe clients, but it lies
  outside the `/recipes/` scope: opening that URL directly does not give it an
  offline service-worker controller.
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
- **Headers.** `vercel.json` serves the worker with `Cache-Control: no-cache`, so
  update checks always reach the network.

The worker exists only in a production build: the client does nothing under
`astro dev`. Verify offline behaviour with `npm run build && npm run preview`, or
through `scripts/built/recipes-pwa.test.mjs`, which covers install, offline use,
updates, failed downloads, negotiated offline representations, a maintenance
deploy and hydration with service workers blocked. Maintenance builds replace
new Markdown backing files with maintenance text; live direct and negotiated
Markdown requests return 503 while an already installed cooking snapshot stays
available offline.

Production smoke first verifies the exact release and ordinary page behavior
with service workers blocked. It then uses a separate fresh browser context to
verify that `/recipes/service-worker.js` activates at scope `/recipes/` and
controls the recipe page after reload. Its receipt records activation and
control; this does not replace installed-app offline verification.

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

The library places search after its settings, next to the results. Dietary
preference includes Vegetarian using the canonical verified vegetarian flag;
meat and unverified cheese recipes are excluded. No current meal is verified
vegan. Vegetarian and plant-forward are not protein choices. The saved
`mealStyle` key also stores the vegetarian dietary preference. Carbs clears by
unticking choices; other multi-choice filters disable Clear selections when empty.

Recipe pages print their on-screen cooking content directly. Card and collection
print packets use the same RecipeContent renderer. Print changes layout and hides
controls and photos; it adds no separate method, ingredient list, background
notes or disclaimers. Measurement assumptions remain on their linked page and
in Markdown/JSON downloads.
