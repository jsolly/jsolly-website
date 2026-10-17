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

The 125 publisher adaptations retain their source URLs, attribution, nutrition basis and limitations in `sourceRecipe`, including in JSON downloads. Unmeasured cooking spray used only to prepare cookware belongs in flow preparation directions, including any optional use or device-manual conditions, rather than ingredient rows. Measured oil-or-spray alternatives remain ingredients. Every food ingredient has a positive measured quantity. Missing and to-taste source amounts have reviewed measured defaults, with the original source retained in measurement provenance. Missing nutrition and times display as "Not provided". The 72 recipes that previously lacked complete macros now carry labeled nutrition estimates used by the same base-recipe dietary classification. Every publisher adaptation has an ingredient nutrient model. Missing nutrient observations do not qualify for nutrient filters. Prep time is distinguished from household active time. The browser keeps concise source attribution and cooking instructions; provenance and nutrition assumptions remain in canonical data and assistant downloads. Cooking guidance from source limitations belongs in the flow. Mobile renders the same ingredient allocation tree vertically, preserving branch joins and shared cooking checks; desktop and print retain the table.

Every recipe has a first-party illustration under the [image contract](recipe-images.md), with illustration provenance retained in its image metadata and downloads.

Household ingredient amounts describe the reviewed four-adult base, except
`familyOptions`, which describe one adult's optional side. Canonical units
distinguish mass, volume, count and spoon measures; source-specific US measures
describe the same food quantity. Pressure-liquid minima always retain their required mL volume in every display
mode. A generic broth density cannot establish a cooker's safe liquid minimum.

Publisher adaptations use four portions and preserve their method limits and original source quantities in provenance. Whole-bird recipes round up to complete batches for 2, 4, 6 and 8 portions. Measured defaults complete missing publisher quantities in cooking instructions. Nutrition models use the corresponding edible weights and reviewed product profiles; defaults and nutrient estimates are adaptations rather than publisher claims.

Linear ingredient scaling supports 2, 4, 6 and 8 adults (`SERVING_CHOICES`).
Pressure liquid has a minimum matching the named Duo 6 QT manual; its
small-batch per-serving nutrient difference is recalculated from the model's
all-broth-counted contribution. Higher minima for another cooker are outside the
estimate and noted. Time, safe endpoints, cut size, patty geometry and capacity
do not scale linearly. Six or eight servings need capacity checks or batches;
the frittata uses two matching dishes. Fractional turkey eggs are beaten and
weighed.

Optional side controls default to None. Only an explicitly selected valid option is included in cooking or downloads; a missing or invalid choice means no side. Neither generic feta nor generic Parmesan is certified
vegetarian; those recipes are plant-forward, with label guidance. Package guides
calculate purchases from scaled ingredient weights; purchased brands can differ,
so weigh drained food.

`midCookActions` counts scheduled starts, shakes, flips and ingredient additions
to the main cooking appliances. Cold-side preparation and optional-side heating
are active work outside that count. Terminal temperature checks and food finish
checks always remain; optional oven rack swaps are disclosed.

Household nutrition objects and newly estimated publisher macros copy the
unrounded ingredient model at four servings; supported existing publisher
macros are retained separately. The display rounds. Library cards always show the same per-serving value from that
four-serving model (or per 8 fl oz smoothie glass), independent of batch size.
Recipe time summaries use the upper end of a recorded range without a plus sign;
capacity and cooking endpoint notes still apply. `servingNutrition` adjusts fixed minimums for smaller batches.
Optional side nutrition is displayed separately per person; base nutrition and dietary classification exclude the side. Keto means at most 12.5 g net carbohydrates per base serving (four-serving meal model or 8 fl oz smoothie glass); every other recipe is Not keto. The filter, card and recipe use this same derived classification, independent of selected batch size. Extended nutrition (`nutrition.mjs`) covers 23 vitamins,
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

- **Grams** uses grams for every ingredient, including liquids, counts and packages.
- **US imperial** uses pounds or mass ounces for weights, fluid ounces for mL,
  and reviewed source US cups/spoons and counts for other quantities.
- **Metric** uses grams for solids and mL for liquids.

Ingredient rows use explicit `weightRef` identities in `ingredient-weights.json`.
Each reference records the food state, portion observation, gram weight, source
and review. Direct observed units take priority; volume interpolation requires
an explicit reviewed basis. Counts, package sizes, alternatives and unusual
packing have their own portion decisions. Runtime matching never infers food
identity from an ingredient name or note. Invalid or unresolved quantities fail
validation instead of rendering a fallback.

The display contains only the selected quantity and unit. Conversion evidence
and editorial default decisions remain in canonical data and the developer
audit, without conversion explanations or source-quantity echoes in cooking
documents. Nutrition uses edible weight; bone-in cooking purchase weight remains
distinct. Pressure cooking retains its scaled required mL volume in the cooking
preparation in every mode; the grams ingredient amount cannot replace that rule.

Conversions start from the unrounded canonical amount after linear, fixed,
minimum or whole-batch scaling. Display rounding never replaces canonical data
or changes nutrition. Positive amounts below ordinary display precision retain
positive numeric precision rather than rounding to zero. Explicit cooking
quantity references share the ingredient resolver; shopping labels and nutrient
concentrations retain their own meaning. Cooking
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
non-overlapping rowspan and colspan cells. Optional sides stay outside the base
tree.

Every recipe owns its `starches` categories in `recipes.json`; the library filter
uses that metadata for main ingredients and available optional sides.
Maintain `recipes.json` and its unit, allergen and family metadata together. Do
not make protein-critical yogurt or Parmesan optional without recalculating, and
do not substitute frozen, raw or dry food states or sauce brands without
reviewing the method and the nutrition.

### Nutrition estimates

All 146 recipes have calories, protein, total fat, total carbohydrate, fiber and net carbohydrate.
Total fat appears with the main macros and in Markdown and JSON downloads. Meals
identify a serving as one fraction of the selected prepared batch; smoothies
identify an estimated 8 fl oz (237 mL) glass. A meal fraction is not a measured
cooked weight: cooking losses and final batch yield have not been measured.
Every recipe has ingredient rows in `nutrition-data.json`, with stable
`ingredientId` links, edible grams, food-record descriptions, source URLs and
per-100-g observations. Family options have separate per-diner profiles.
`sourceRecipe.nutritionEstimate` records the current cooking-quantity model;
`preMeasurementNutritionEstimate` preserves the previous model, including the
72 macro sets originally completed during import. Original publisher nutrition
is retained separately. Some brand profiles lack observations for a full new
total; `publisherBaselineFields` identifies fields using the publisher baseline
plus known ingredient corrections. Unknown changed contributions fail reconciliation.

The additional records use USDA's static SR Legacy April 2018 CSV release,
retrieved 2026-10-10, with archive SHA-256
`b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`.
Coconut flour and xanthan gum use Bob's Red Mill label observations instead;
label rounding and unlisted micronutrients remain limitations. Their source URLs
are stored with the rows. No build or test calls a nutrition API. Each ingredient row and publisher model
stores a snapshot of its canonical ingredient inputs; the unit suite rejects stale
snapshots after a recipe edit. To revise a model, review its food record and edible
gram assumptions, update the recorded per-100-g observations/grams and snapshots,
then run `scripts/recipes/reconcile-nutrition.mjs` with the reviewed public FDC
response cache and an output path for the reconciled recipe metadata. Its output
keeps cooking data separate from the nutrition metadata merge. Complete fields
sum `macros[field] × grams / 100` across rows and divide by four; incomplete
profiles retain their recorded baseline and known corrections. Net carbohydrate
is total carbohydrate minus fiber and explicitly recorded erythritol, floored at zero. No other sugar alcohol or undisclosed allulose is deducted. Mark an assumed value in
`assumedMacroFields` rather than presenting it as a USDA observation.
Regenerate the assistant downloads and run the gate.

Cooking weight and edible nutrient weight have separate bases. Counts, packages
and measured defaults now use reviewed cooking amounts; nutrient rows account
for bones, refuse and drained yields separately. Every nutrient contribution
follows its ingredient's linear, fixed, minimum or whole-batch scaling, with a
separate per-glass smoothie denominator. Each recipe lists its actual food
profile choices, including generic mustard, marinade and spice proxies. Cajun/Old Bay/steak seasoning uses
a disclosed generic mix of 50% salt, 20% paprika, 10% garlic powder, 10% onion
powder and 10% black pepper by mass; garam masala uses a curry-powder proxy.
The ranch-chicken estimate uses the complete measured ingredient model and the
reviewed dry ranch proxy described below; its unobserved micronutrients remain
missing. Balsamic vinegar's unreported fiber is
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

### Fat and calorie audit

`node scripts/recipes/audit-nutrition.mjs` reads all 146 recipes and every supported
serving count. Its JSON report includes ingredient coverage, fat sources, serving
units, displayed macros and the difference from general Atwater energy,
4 kcal/g protein + 4 kcal/g total carbohydrate + 9 kcal/g fat. A difference over
both 10% and 25 kcal requires review. This is a discrepancy screen, not a claim
that every food has the same energy factors. USDA specific Atwater factors,
fiber, alcohol, sugar alcohols, organic acids and rounded labels can differ.
The unit suite requires every recipe and supported portion to pass this screen.
Fat is never calculated as the remaining calories divided by nine.

The 2026-10-15 review added 21 missing ingredient fat observations across nine
recipes. Chicken Posole uses the already reviewed USDA food matches and the
Old El Paso manufacturer label. Other missing observations use G Hughes,
Hidden Valley and Swerve manufacturer fat labels. Unspecified brown monkfruit
sweetener blends have an explicit editorial zero-fat assumption; their other
missing observations remain missing. A label zero is rounded, not proof that
analytical fat is absent. Each decision retains its source and limitation in
`fatReview`; `assumedNutrientFields` distinguishes the monkfruit assumption.

Eight recipes previously mixed incomplete branded profiles with retained publisher
macro baselines. They now use complete ingredient models for calories, protein,
carbohydrate, fiber and total fat at the same measured edible weights. All measured
oils are counted. `scripts/recipes/complete-macro-models.mjs` records the reviewed
migration, with `preCompleteIngredientNutritionEstimate` preserving the former
model and `sourceRecipe.sourceNutrition` preserving the original publisher facts.
No calorie value or fat value is inferred from the other as a residual.

G Hughes honey mustard uses its manufacturer label. Dry ranch seasoning uses
USDA FDC 2248025, Our Family dry ranch dressing mix, as an explicit brand proxy;
its rounded values and differences from Hidden Valley remain limitations.
Five incompletely specified brown sweetener rows use a clearly labeled Lakanto
Brown erythritol/monkfruit proxy. Its label has 8 g total carbohydrate and 8 g
erythritol per 8 g, with 0 g fat/protein and 0 kcal. Original Swerve or unspecified
brown monkfruit ingredient identities remain in cooking data and provenance.
Actual Swerve's erythritol/allulose blend differs from this proxy. The model does
not infer undisclosed allulose grams or subtract them from net carbohydrates.
Allulose would require its own measured observation and energy factor; the
[FDA recommends 0.4 kcal/g](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-declaration-allulose-and-calories-allulose-nutrition-and-supplement-facts-labels).
Label rounding and trace ingredients such as glycerin remain limitations.

The gnocchi recipe uses DeLallo's label fat alongside DeLallo's macro profile,
replacing a prepared-food USDA fat proxy that disagreed with those brand macros.
`nutrientSources` preserves that label override during API refreshes. Other
micronutrients retain their recorded generic-food proxies. The audit independently
sums every fat contribution and rejects any displayed total below a single
ingredient's fat, so a coherent-looking calorie equation cannot hide omitted oil.
Its energy screen subtracts only explicitly recorded erythritol before comparing
with 4/4/9. JSON and Markdown include model assumptions and brand limitations.

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
and validates reviewed SR Legacy/FNDDS identity or an explicitly marked reviewed Branded profile, nutrient IDs, units and finite nonnegative
amounts before writing either canonical data file. It never searches or rematches
foods. `nutrition-data.json`'s `apiRefresh` receipt records the earliest cached
retrieval time, matched IDs, row coverage and retained brand/composite profiles.

The 2026-10-13 API check covered 149 distinct reviewed FDC records (148 SR Legacy
records and the existing FNDDS gnocchi proxy), refreshing 1,474 ingredient rows
across all 146 recipes. The remaining 36 rows retained reviewed brand, composite
or hybrid profiles. All observed nutrient and macro values agreed with the
existing snapshots, so this check changed provenance rather than nutritional
totals. Explicit null observations remain missing.

The 2026-10-15 refresh used the stored AWS USDA key to verify 163 distinct reviewed
FDC records, refreshing 1,698 ingredient rows across all 146 recipes and retaining
38 reviewed brand, composite or hybrid rows. The new Chicken Posole records and
the explicitly reviewed dry ranch brand proxy account for the additional IDs. All observed values agreed with their
reviewed snapshots; the DeLallo fat label override stayed in place. The
`apiRefresh` receipt records the current IDs, row coverage and retrieval time.

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
no optional side selected, with each recipe's per-person side choices
listed. The JSON uses `schemaVersion: 2` and holds stable recipe ids, readable
quantities, food states, dependency cells, steps, sources, restrictions and
estimates; the Markdown is the same documents as text. Data access is discoverable
in recipe page head metadata and `/llms.txt`, with no human-facing download controls.
Each page advertises its smaller canonical `.md` sibling and related complete-library
JSON. Agents select a JSON recipe by its stable `recipeId`. The static endpoints
keep the fixed defaults above, as do canonical `.md` pages; browser settings and
query parameters do not alter them.
Version 2 replaces the old `group` field with the derived `dietaryClassification`
and replaces combined family nutrition with separate `sideDiners`, `sideIngredient`,
`sideOptions` and `sideNutritionPerDiner`. Base `nutrition` always excludes the
optional side. A missing, stale or None choice has no side; side nutrition is one
canonical portion, independent of the selected batch or side diner count. JSON
consumers of version 1 must migrate to these fields rather than treating the new
side values as a combined meal total. The complete-library JSON uses the version 2 envelope.

These files use one `recipeDocument` from `recipe-export.mjs`. Screen and print cooking content share `RecipeContent.svelte`. The files are committed, and Biome and markdownlint skip
`public/recipes/data/` so their bytes stay exactly what the script writes. The
gate's `recipes:check` fails on drift, so run `recipes:sync` after every edit to
`recipes.json` and commit the result with it.

There is no generated article: the pages render straight from `recipes.json`
(`src/pages/recipes/`), so nothing else needs regenerating.

## Pages and settings

Ingredient units offers US imperial, Metric and Grams only.
Ingredient and nutrition provenance remains in the canonical data and assistant downloads. There are no public assumptions pages or links. Print recipe uses a filled button with a
printer icon. Machine-readable formats remain available through metadata and direct URLs.

Search recipes searches the current collection alongside the existing filters.
Names and ingredients rank highest; equipment, cooking instructions, family
sides and nutrition highlights are searchable too. MiniSearch runs locally
with accent-insensitive matching, prefixes and limited typo tolerance. Clearing
search restores the current card order. Queries are not saved.

Each library card has a Print recipe action using the current servings, units
and optional side. It prints only that recipe without opening the detail dialog.

On iPhone and iPad Home Screen apps, **Print recipe** offers **Open in Safari**
instead of calling the installed app's unreliable print API. The link opens the
individual recipe on the current host with the selected servings, units and
optional side; tap **Print recipe** again in Safari. A selectable HTTPS link is
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
no optional side. While JavaScript resolves saved and URL settings, the enhanced recipe body remains hidden; then JavaScript enables
scaling, the side choice, the cooking checks and share links
(`?servings=`, `?units=` and `?starch=<id>:<side>`). Native fallbacks live in `<noscript>`,
so hydration never replaces a disclosure or cooking check in use. Without
JavaScript, native ingredient checkboxes and nutrient disclosures still work,
and collection pages offer native filter/search forms and card links.

Cards start in canonical source order (search uses relevance order). Shuffle meals
and Shuffle smoothies randomize card order while preserving the selected filters.
With JavaScript, the shuffle applies to the current visit and reload restores the
default order. Without JavaScript, native GET forms submit `browse=1`, search,
filters and an optional shuffle seed on the collection URL.
Apply filters reloads results; Shuffle chooses a fresh server seed. Subsequent
submissions retain that order until shuffled again or reset.

`api/recipe-browse.mjs` reads this deployment's bundled static collection HTML,
uses the existing recipe filtering/search modules and parses the HTML to select
and order its existing cards. It exposes native forms and removes only the
recipe-library island's hydration, so saved browser filters cannot overwrite
submitted results. Other islands retain their ordinary behavior. Submitted
views stay native even when JavaScript is later enabled; Reset filters returns
to the ordinary collection page. Responses are no-store and noindex, with the
original collection canonical. Markdown negotiation and plain collection URLs
retain their static representations. The function reads no external service or
user data and writes no persisted state. This online form flow needs a network
connection; the offline app keeps its default static snapshot.

Default card links point directly to the canonical recipe URL, keeping every
recipe discoverable through ordinary internal links. Selected servings, units
and sides travel in the card URL when they differ from the defaults. Share and
Safari print handoff links always carry explicit settings so the recipient's
saved preferences cannot change the shared recipe.

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
The generated worker carries each file's SHA-256 body digest and expected decoded
byte count, and validates both before installation can complete. Downloads and
cache validation run at most eight files at once, with a 15-second limit per file.
An oversized stream stops when it exceeds that file's build size; a failed batch
aborts and settles its remaining requests before cleanup or retry. A deployment changing during the
batch cannot silently mix old HTML with newer data or assets: mismatches fail the
install and preserve the active snapshot. A rollback reuses an already-active
matching cache only after validation, without overwriting its live clients' data.

The recipe status is visible while offline, when an update is ready, or when saving
or applying an update fails. It describes the cached snapshot and reminds readers
that external links need a connection.

- **Serving.** Native `browse=1` HTML submissions bypass the worker and require the network, so cached defaults cannot masquerade as filtered results. Precached paths are otherwise answered cache-first. GET and HEAD requests
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
- **Updates.** A new snapshot downloads on a connected visit or a throttled visible, online
  check on focus, reconnection or the five-minute timer. An **Update available**
  notice offers **Update and reload**, which activates the downloaded worker and
  reloads the requesting tab after the new worker controls it. The ready snapshot
  can be applied offline. Other open recipe tabs retain their cooking view and show
  a notice with the same button to reload when ready. **Later** collapses the
  actions; **Show update** reopens them. A distinct release restores the notice.
  Actual unsaved cooking checks require confirmation; cancelling preserves them
  and focus. Reload resets those checks in that tab; saved preferences and URL
  settings survive. Without a click,
  the worker still waits until every recipe tab and app window closes. First install
  never reloads. Before activation and after control changes, a bounded
  MessageChannel handshake verifies the intended full release SHA. Activation
  requests are release-specific and accepted only from recipe WindowClients.
  A newer candidate requires a fresh choice. Previous snapshots retain per-client
  ownership for deferred assets and mutable downloads while older recipe documents
  stay open, including across worker restarts. Persisted activation generations
  retain the correct predecessor through rollbacks independently of cache creation
  order. The separate `recipe-pages-pwa-ownership` cache records active and waiting
  snapshot ownership across worker restarts. Short browser locks protect those
  records and retirement; downloads run outside the lock. A waiting rollback
  snapshot stays owned even when its last historical document closes. Snapshots
  retire only after no live document, active worker or waiting candidate needs
  them and a current-release client reports readiness. A failed download keeps the
  previous snapshot; a failed activation reports a retryable error rather than
  leaving a disabled button indefinitely. Existing clients from before this notice
  was introduced need one close-and-reopen cycle to receive its code.
- **Maintenance builds.** A `MAINTENANCE_MODE=true` build writes no worker, and
  RecipeLayout links no app manifest. An installed worker's update check then gets
  a 404, which leaves it and its cache as they were, so offline cooking keeps
  working through the maintenance window instead of precaching the maintenance
  page. Any other build whose `/recipes/` page links no manifest fails.
- **Headers.** `vercel.json` serves the worker with `Cache-Control: no-cache`, so
  update checks always reach the network. `/release.json` has `Cache-Control:
  no-store` and is excluded from worker responses.

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
preferences are independent Keto and Vegetarian checkboxes. Selecting both requires both conditions. Vegetarian uses the canonical verified vegetarian flag;
meat and unverified cheese recipes are excluded. No current meal is verified
vegan. Vegetarian and plant-forward are not protein choices. Saved settings and native GET forms use `mealKetoOnly` and `vegetarianOnly` booleans (`=1` in URLs). Older saved `mealStyle` values are ignored, resetting these two checks to unchecked. Carbs clears by
unticking choices; other multi-choice filters disable Clear selections when empty.

Recipe pages print their on-screen cooking content directly. Card and collection
print packets use the same RecipeContent renderer. Print changes layout and hides
controls, photos and nutrition information, including nutrition highlights; it adds no separate method, ingredient list, background
notes or disclaimers. Measurement provenance remains in Markdown/JSON downloads.

Back to meals/smoothies uses the matching same-tab collection history entry
when available. Collection history restores the scroll position, search and
shuffle order after hydration; direct recipe links return to the collection top.

Heat-bearing ingredients include short adjustment guidance in their canonical notes,
shared by cooking views, print and downloads. Blend, canned chili and sausage
notes preserve the measured quantity and suggest a milder or hotter version.
Nutrition estimates still describe the recorded ingredients and amounts.

Dump and go identifies recipes that load the cooker and start without separate
browning or mid-cook additions. Preparation and finishing can still be needed.
The flag is explicitly reviewed recipe metadata, not inferred from elapsed time
or a zero mid-cook action count.
