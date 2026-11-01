# Recipes

The Keto meals & smoothies library lives under `/recipes/`: the landing page
`/recipes/`, the collection pages `/recipes/meals/` and `/recipes/smoothies/`, and
one canonical page per recipe at `/recipes/<recipe-id>/`. It comes from
blogthedata.com's Easy Meals & Smoothies post, which redirects to `/recipes/`
through the legacy host.
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

The canonical data is `src/components/recipes/recipes.json` (136 keto meals and 4
keto smoothies, pinned by `tests/unit/recipe-data.test.mjs`) and `src/components/recipes/nutrition-data.json` (the
Daily Value nutrients and each recipe's per-ingredient nutrient rows). Recipe
ids are stable: each is a page slug (`/recipes/<id>/`) and a legacy fragment id.
Old blogthedata.com links use both. To accommodate those legacy links,
`/recipes/#<id>` (on any collection page) redirects client-side to the recipe's
page with the reader's saved servings, units and side; the library does not
render recipes itself.
Images are files under `public/recipes/media/`, referenced as `/recipes/media/...`.

Published recipe pages include `Recipe` JSON-LD built from the same default
four-portion cooking document as their initial render. Ingredients, preparation,
instructions, illustration metadata and base nutrition exclude optional sides.
Smoothie yield and nutrition use the displayed estimated eight-fluid-ounce glass.
Missing times and time ranges stay unreported as exact ISO durations, and active
cooking time is not relabeled preparation time. Publisher source URLs remain in
`isBasedOn` and citations; source author strings that mix people and brands do not
become invented author identities. The keyword `keto` does not assert a nonexistent
schema.org `KetogenicDiet` value. Retired recipe notices have no `Recipe` markup.

Online collection browsing downloads one release-named static library from
`/recipes/data/summaries/`. It contains card summaries and compact filter facts,
without cooking instructions or nutrient calculation registries. A nonempty
search lazily downloads release-named prebuilt indexes from `/recipes/data/search/`;
plain browsing, filters and shuffle never request them. Search, filter changes, shuffle and further card batches then run
locally. Vercel caches the immutable URL for one year, and production HTML pins
its request to the deployment. A mismatched or unavailable version offers an
update instead of mixing releases. Native no-JavaScript forms still use the
no-store browse function, which reads the same build artifact and pre-rendered
card fragments without loading the canonical nutrient tables. Saved browsing
continues to use individually saved recipe records offline.

The 124 publisher adaptations retain their source URLs, attribution, nutrition basis and limitations in `sourceRecipe`, including in JSON downloads. Unmeasured cooking spray used only to prepare cookware belongs in flow preparation directions, including any optional use or device-manual conditions, rather than ingredient rows. Measured oil-or-spray alternatives remain ingredients. Every food ingredient has a positive measured quantity. Missing and to-taste source amounts have reviewed measured defaults, with the original source retained in measurement provenance. Missing nutrition and times display as "Not provided". The 71 retained recipes that previously lacked complete macros now carry labeled nutrition estimates used by the same base-recipe dietary classification. Every publisher adaptation has an ingredient nutrient model. Missing nutrient observations do not qualify for nutrient filters. Prep time is distinguished from household active time. The browser keeps concise source attribution and cooking instructions; provenance and nutrition assumptions remain in canonical data and assistant downloads. Cooking guidance from source limitations belongs in the flow. Mobile renders the same ingredient allocation tree vertically, preserving branch joins and shared cooking checks; desktop and print retain the table.

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
Optional side nutrition is displayed separately per person; base nutrition and dietary classification exclude the side. Every published recipe has at most 12.5 g net carbohydrates per base serving, using the four-serving meal model or estimated 8 fl oz smoothie glass. The data boundary rejects non-keto recipes and missing shared-table guidance. Cards and cooking pages use the same derived classification, independent of selected batch size. Keto is the collection's default, so neither collection has a keto filter. Extended nutrition (`nutrition.mjs`) covers 23 vitamins,
minerals and choline plus total fat, saturated fat and cholesterol, against FDA
Daily Values, using USDA profiles on the same ingredient weights as the macro
model. Values apply no cooking-retention factors. A nutrient total with a missing
ingredient observation is omitted from the display. These are product
estimates, not a medical nutrition prescription, and no cooking, tasting or
stopwatch testing is claimed.

### Keto collection and shared tables

The collection contains 140 recipes, including keto fried calamari and 15 reviewed
adaptations. The eight excluded original recipes have noindex HTML and Markdown
retirement notices at their existing URLs. Their IDs are in
`src/components/recipes/retired-recipes.json`; original recipe, nutrient and weight
registries are frozen under `docs/recipes-archive/keto-2026-10-23/`. Retired IDs
are excluded from collection results, exports, packs, sitemap and new offline
manifests. Legacy recipe fragments use the same client-side navigation as
published recipes, replacing the collection URL with the canonical retirement
page.

`sharedTable` supplies a recipe-specific serving suggestion on each canonical
recipe page and in its print view, Markdown document and JSON export. Card print
packets use the same cooking renderer. These suggestions are searchable and
travel with offline saves. Carby additions stay in separate
serving dishes or individual portions. Smoothies pour the keto glasses before
higher-carbohydrate additions are blended into the remaining mixture. Optional
extras are outside the recorded base nutrition.

Measured `familyOptions` retain separate per-diner nutrition. Their selected
`familyDiners` count can differ from total servings and ranges from zero to the
selected batch size. Quantities scale only to diners choosing that side. Side
instructions come from the option's own note, including separately roasted
potatoes and optional balsamic glaze. A selected side with zero diners prepares
none. Recipe-page controls update the saved preferences and current URL. Links
use `sideDiners` for the count, separate from `servings` for the base batch.
Shared links carry explicit settings including `starch=` for None so recipients'
preferences cannot change the meal. Ordinary recipe visits can restore validated
saved side choices and their diner count.

Older immutable offline bundles keep their original cooking data. Saved browsing
uses each bundle's actual original nutrition and hides retired or non-keto
records without deleting them. Direct older saved documents display a version
notice and keep HTML and Markdown negotiation, including unsupported-Accept 406s.
A shell update never relabels an old non-keto bundle or refreshes its ingredients.

`node src/components/recipes/tools/migrate-keto-collection.mjs` reproduces the migration from
the frozen baseline and reviewed calamari source data. Original publisher
nutrition remains in provenance. Ingredient models, measured changes, food-state
matches and conservative counted-oil/coating assumptions describe the current
adaptations. Recipe-specific safety endpoints distinguish whole pork cuts,
ground meat, sausage and seafood. The adaptations have not been kitchen-tested.

### Ingredient units

Ingredient rows show up to three useful equivalents together, separated by
slashes: a familiar household portion where supported, whole grams, and a
US mass or liquid measure. Eggs, cloves, heads, slices and fractions of a
known can, jar or butter stick use their reviewed portion weights. Counts
and package sizes are approximate guides; products and produce vary.
Unsupported equivalents are omitted instead of inferred from food names.
There is no ingredient-units selector. Older `?units=grams|us|metric` links
and saved preferences remain valid for cooking temperatures and dimensions;
they do not hide ingredient equivalents. `oz` remains mass and `fl oz` volume.

Ingredient rows use explicit `weightRef` identities in `ingredient-weights.json`.
Each reference records the food state, portion observation, gram weight, source
and review. Direct observed units take priority; volume interpolation requires
an explicit reviewed basis. Counts, package sizes, alternatives and unusual
packing have their own portion decisions. Runtime matching never infers food
identity from an ingredient name or note. Invalid or unresolved quantities fail
validation instead of rendering a fallback.

All displays start from the unrounded canonical amount after linear, fixed,
minimum or whole-batch scaling. Gram labels round to whole grams; a positive
amount below one gram is described as "A pinch". These are display choices
only: canonical quantities, nutrition and allocation calculations retain their
precision. Required pressure-liquid minima retain their mL volume in cooking
preparation and never rely on a rounded mass or household estimate.

Ingredient-facing text omits organic and conventional production labels.
Cooking modes such as a conventional oven remain explicit. Conversion evidence,
source labels and editorial decisions stay in canonical provenance and audits.
Explicit cooking quantity references share the ingredient resolver; shopping
labels and nutrient concentrations retain their own meaning.

[`recipe-units-audit.json`](recipe-units-audit.json) lists every base ingredient
and family option, its canonical state, source-backed weight if available, and
its four-serving combined display and resolution status. Regenerate
from this repository root after editing recipes or conversion references:

```bash
node src/components/recipes/tools/audit-units.mjs --write
```

The unit suite rejects stale audit bytes and checks all recipes at every supported
serving count, including legacy unit-preference compatibility. `node src/components/recipes/tools/audit-units.mjs` also checks
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

All 140 published recipes have calories, protein, total fat, total carbohydrate, fiber and net carbohydrate.
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
then run `src/components/recipes/tools/reconcile-nutrition.mjs` with the reviewed public FDC
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
library cards and on individual pages. Pills use the same
nutrient eligibility checks and selected serving count as the library filters.
Recipes with missing observations do not gain a pill from those observations.

### Fat and calorie audit

`node src/components/recipes/tools/audit-nutrition.mjs` reads all 140 published recipes and every supported
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
oils are counted. `src/components/recipes/tools/complete-macro-models.mjs` records the reviewed
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

The human-operated `recipes:usda` command searches FoodData Central or fetches
an identified food record. It accepts one API key through stdin, keeps it in
memory and sends it only in the fixed USDA origin's `X-Api-Key` header. It does
not resolve AWS credentials, read AWS configuration or retrieve secrets. Empty,
malformed, oversized or failed input stops before a USDA request. Errors omit
input contents and credential-bearing diagnostics. The command does not modify
recipe data or run during builds, tests or browser requests.

John runs the following steps in his own terminal. Agents do not run the human
secret-read command or borrow human credentials. AgentMcp intentionally cannot
read secret values. Agents can research public FoodData Central records or use
public response caches John supplies. Keep AWS Core knowledge tools available.

First verify the named production human session, cwd-independent:

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN aws sts get-caller-identity --profile prod-admin --region us-east-1
```

Expect account `730335616323` and John's `AdministratorAccess` session. Stop on
another identity or a failed call. Use that same named profile and static-key
exclusions for retrieval. [AWS credential precedence](https://docs.aws.amazon.com/cli/latest/topic/config-vars.html#credentials)
means `AWS_PROFILE` alone is insufficient when static environment keys exist.
Human sign-in and profile maintenance remain John's; the repository creates no
login, default profile or credential export.

John searches from `/Users/johnsolly/code/jsolly-website`:

```bash
set -o pipefail
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN aws ssm get-parameter --profile prod-admin --name arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key --with-decryption --region us-east-1 --query Parameter.Value --output text | npm run recipes:usda -- search "spinach raw"
```

Fetch a selected FDC record from the same cwd:

```bash
set -o pipefail
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN aws ssm get-parameter --profile prod-admin --name arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key --with-decryption --region us-east-1 --query Parameter.Value --output text | npm run recipes:usda -- food 168462
```

Refresh reviewed ingredient matches from the same cwd:

```bash
set -o pipefail
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN aws ssm get-parameter --profile prod-admin --name arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key --with-decryption --region us-east-1 --query Parameter.Value --output text | node src/components/recipes/tools/refresh-nutrition.mjs --cache /private/tmp/jsolly-usda-refresh-20261028
```

The pipe carries the key directly to the process. Never use `tee`, shell tracing,
a key argument, an environment variable or a saved key file. The reader accepts
one 16–256 character key with an optional final LF/CRLF. `pipefail` reports a
producer failure; it cannot retract already emitted bytes or prevent concurrent
consumer work. Empty or malformed stdin and stream errors fail before HTTP.
A complete public cache needs no key or AWS call; run the refresh command without
the secret-producing pipe when replaying that cache. Missing records require
John's human procedure and acquire the stdin key once for the entire refresh.

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

Ownership: shared-infra owns `/shared/nutrition/usda-api-key` in account
`730335616323`, `us-east-1`, and its human provisioning/rotation procedure. John
enters the SecureString value outside CloudFormation. Neither repository stores
the key or a placeholder. This source migration removes the website's agent
credential consumer; it does not remove the historical IAM exception, installed
helpers, cached sessions or saved cloud environments. Shared-trust retirement
requires the separate dependency and native-acceptance evidence. No AgentMcp
secret exception, local credential bridge or new Vercel secret is introduced.
The retained CloudFront/S3 image hosting is unrelated and remains required.

#### Recover a maintenance lookup

A missing or invalid stdin key requires John to check his named human identity
and protected parameter using the procedure above. Stop if identity or access is
wrong; do not retry with agent SSO, a default profile or broader grants. The
consumer cannot classify AWS login, network or permission errors because it makes
no AWS call. A human producer failure must be diagnosed in that human session.

For a USDA lookup failure, check API availability, quota and network connectivity
without printing headers, key bytes, provider payloads or credential diagnostics.
Do not change recipe data until public records and nutritional assumptions are
reviewed. Source merge does not prove a live key read, human recovery or refresh.

Offline tests exercise real bounded stdin streams, partial-stream errors,
credential redaction, inherited-provider nonuse and fixed-origin HTTP behavior.
The actual refresh CLI runs against synthetic data and a fake HTTP boundary to
prove a complete cache touches neither stdin nor HTTP, and multiple misses read
one key and fetch only missing records. These fixtures never read real AWS
configuration/caches, retrieve a key, call USDA or rewrite canonical nutrition.

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

`src/components/recipes/tools/sync-assistant-data.mjs` regenerates the two assistant
downloads from `recipes.json`. Their settings are fixed: four adults, US units,
simultaneous ingredient equivalents and no optional side selected, with each recipe's per-person side choices
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

Ingredient quantities show the supported equivalents together, without a unit selector.
Ingredient and nutrition provenance remains in the canonical data and assistant downloads. There are no public assumptions pages or links. Print recipe uses a filled button with a
printer icon. Machine-readable formats remain available through metadata and direct URLs.

Search recipes searches the current collection alongside the existing filters.
Names and ingredients rank highest; equipment, cooking instructions, family
sides and nutrition highlights are searchable too. Online search uses the downloaded prebuilt index over the entire collection, with accent-insensitive matching, prefixes and limited typo tolerance. Offline search covers saved recipes only. Clearing search restores the current seeded order. Queries are not saved as preferences.

The library's **Filters** section holds the protein and carb choices (ingredients
on smoothies) above the nutrition checks; appliances on hand sit above it as the
reader's kitchen, not a filter. Because filters persist, the interactive library
shows each active filter and the search as a removable chip under the results
heading (`active-filters.mjs`), with **Clear all**, which removes every shown
chip. Chips count only filters the browse applies, so meal choices kept while
viewing smoothies stay saved, and appliances are never cleared. Removing a
chip moves keyboard focus to the chip now in its place (the new last chip when
the last one is removed), or to the results heading when none remain. Without
JavaScript, the native form's Reset filters link clears the URL instead.

Each library card has a Print recipe action using the current servings, units,
optional side and side-diner count. It loads and prints only that recipe without leaving the library. Individual printing also requests an offline save when the worker is available.

On iPhone and iPad Home Screen apps, **Print recipe** offers **Open in Safari**
instead of calling the installed app's unreliable print API. The link opens the
individual recipe on the current host with the selected servings, units,
optional side and side-diner count; tap **Print recipe** again in Safari. A selectable HTTPS link is
also shown for manual copy/paste if the Safari application scheme is unavailable.
Safari needs a network connection and, on a protected Preview, its own authorized
session. Browser tabs and Mac Dock apps retain their existing print flow.
This handoff covers individual recipe pages and library cards. There is no whole-collection print action.
The direct iOS application handoff needs real-device verification; Chromium
standalone emulation verifies detection, link settings and browser restoration,
not iOS print-sheet presentation.

The library loads an individual recipe and its print renderer only on a card's Print recipe. Browser-menu printing on a collection prints only the currently rendered cards. It removes prepared print content when printing ends and restores prior print state after failures.

Performance budgets and local measurement settings are recorded in [recipe-performance.md](recipe-performance.md).

Collection pages server-render six summaries and hydrate the same six. Additional summary batches load ahead of scrolling; spare connection time fetches remaining summaries without mounting them or loading their images. Hidden tabs, Data Saver and slow connections pause speculative summary work. Images load within 300 px of the viewport. Hovering or focusing a card downloads nothing; a recipe pack loads only when its card's Print recipe is chosen, and repeated prints reuse that download.

Per-recipe packs under `/recipes/data/packs/<id>.json` carry the selected recipe, calculation references and release identity. Browser calculation modules import no complete nutrition or ingredient-weight registry. Standalone pages embed only their own calculation context. Full assistant downloads remain deliberate links and are excluded from automatic offline caching.

Each recipe page server-renders one recipe body at four servings with
no optional side. While JavaScript resolves saved and URL settings, the enhanced recipe body remains hidden; then JavaScript enables
scaling, the side choice and diner count, the cooking checks and share links
(`?servings=`, `?units=`, `?starch=<id>:<side>` and `?sideDiners=`). Native fallbacks live in `<noscript>`,
so hydration never replaces a disclosure or cooking check in use. Without
JavaScript, native ingredient checkboxes and nutrient disclosures still work,
and collection pages offer native filter/search forms and card links.

Cards start in canonical source order; search uses relevance order. Shuffle is available before all summaries arrive: the server orders matching recipe IDs with a fresh seed and returns six summaries. Later batches retain that seed. The seed orders the full ID set, so search and filter subsets keep their relative order. Once all matching summaries are downloaded, shuffle runs locally with the same ordering algorithm and a fresh seed. Filters persist and successful shuffle returns to the results heading. History restores the visit's order, rendered cards and scroll position. Offline shuffle uses saved recipes only.

Without JavaScript, GET forms submit `browse=1`, search, filters and the optional seed. Apply filters reloads the first page; native Next/Previous links preserve selections and the generated seed without repeating `shuffle=1`. Responses are no-store and noindex with the original collection canonical. Plain collection URLs and Markdown negotiation retain their static representations.

`api/recipe-browse.mjs` serves six-card JSON batches or native HTML from this deployment. Native responses use private build-time card fragments in `.recipe-browse/`, never a full collection embedded in the initial HTML. Search and filter calculations use the full canonical library on the server. The `/api/` namespace handles its own response format outside HTML/Markdown page negotiation. JSON requests carry the expected release and receive 409 if deployment identity changes; maintenance and rendering failures return 503. Failed requests retain existing cards and offer Retry.

Default card links point directly to the canonical recipe URL, keeping every
recipe discoverable through ordinary internal links. Selecting a card navigates
to that page; there is no in-library recipe view. Selected servings, units,
sides and their diner count travel in the card URL when they differ from the defaults. Share and
Safari print handoff links always carry explicit settings so the recipient's
saved preferences cannot change the shared recipe.

The library saves `{ servings, units, filters, appliancesOnHand, familyChoice, familyDiners }` in
`localStorage` under `recipes-settings-v1` (J13). The old blogthedata.com key is
on another origin and is not read, so preferences reset once for returning
visitors. Every saved key is validated on load; anything that no longer fits is
reset. Recipe pages read and update the same record. Servings, units, side and
side-diner changes on a page are saved there and replace the matching URL
settings. A page link without `servings`, `units`, `starch` or `sideDiners` uses
the saved side and count. A link carrying explicit recipe settings, such as a share or non-default
card link, decides the side itself.

A reader can tick **I made this** on a recipe page. It records the local date in
`localStorage` under `recipes-made-v1`, a separate record mapping recipe ids to
`YYYY-MM-DD` (`recipe-made.mjs`); unticking removes that recipe. The page shows
the last-made date and a **Made it today** button once that date is in the past,
and cards in the interactive library show a green-check "Made it!" badge (server-rendered
browse results do not). Both pages re-read the record when another tab changes
it, Back restores the page, or the tab becomes visible again. The mark stays on
that browser only: it does not sync between devices, and clearing site data
removes it. Entries that are not real dates are dropped when read.

## Offline recipe app

Every page under `/recipes/` is installable. The manifest and icons live in
`public/recipes/pwa/`; Safari uses Share → Add to Home Screen, and supported
browsers offer Install or Add to Home Screen in their menu.

`/recipes/service-worker.js` controls only `/recipes/`. The production build
writes it after HTML and Markdown generation. Installation saves the landing
page, the Saved recipes page, their static scripts and styles, fonts, app icons,
and the small saved-registry helper. It does not download individual recipes,
recipe illustrations, detail packs, or the complete assistant exports.

The worker carries only a digest and byte count for each small per-recipe
integrity manifest under `/recipes/data/offline/`. The manifest downloads and
validates when that recipe is saved, so installation never transfers the full
library resource lists. Saved-search and deferred print code travel with
individual recipe bundles. Fonts use WOFF2 without a duplicate WOFF fallback.

Opening a recipe page (from a card or directly) or individually printing one
from a card requests an offline save. Rendering, hovering and scrolling cards
do not save recipes. Each save downloads a release-specific bundle containing
canonical HTML and Markdown, its detail pack, the full cooking-runtime dependency
closure and one illustration. Responsive image requests use that saved cooking
illustration offline. Each response must match its built SHA-256 digest and
byte count. Downloads have bounded concurrency, body size and duration.
Only after every file validates does one registry write expose the recipe as
saved. A failed or interrupted save preserves the previous saved version and
never exposes a partial replacement.

The saved registry and immutable recipe bundles have a separate lifetime from
the installed app shell. They survive closing every tab, worker restarts,
browser restarts and shell updates, subject to browser storage eviction.
Listing saved recipes checks that every bundle resource remains present.
`/recipes/saved/` is noindex and excluded from the sitemap. Its search, filters
and shuffle use only saved recipes on that device. An unsaved offline recipe or
collection navigation goes to this saved view. External source links and other
blog pages still need a connection.

Connected canonical recipe navigation loads the current page and can save its
new version. Offline navigation uses the last complete saved version. The worker
persists the resulting document's bundle ownership so its deferred scripts,
styles and detail pack stay on that release, even after the worker restarts.
A saved recipe from an older release opens its own canonical document rather
than mixing its data with the new shell's cooking renderer. Complete legacy
library caches and prior shell caches remain read-only; they are never copied
into the saved registry, mass-refreshed, or implicitly presented as saved recipes.

GET and HEAD requests negotiate cached HTML and Markdown with the shared Accept
helper. Explicit `.md` paths keep Markdown semantics, and unsupported page
representations return 406 with `Vary: Accept`. Cache keys use explicit Accept
headers and respect Vary. Native `browse=1` submissions require the network;
the complete assistant downloads are online resources. `/release.json` is never
served by the worker. The root `/recipes.md` sibling is available to controlled
clients but lies outside the worker's navigation scope.

The browse API at `/api/recipe-browse/` always uses the network. Browsers with
`InstallEvent.addRoutes` route it there before starting the worker, so background
summary requests cannot restart an outgoing worker during explicit activation.
Other browsers retain the fetch-handler bypass. These rules take effect after
the worker containing them activates; they cannot change an older active worker.

Current recipe tabs also coordinate browsing and explicit activation with one
origin-wide Web Lock. Browse transactions share the lock until their response
bodies finish; activation takes it exclusively, rechecks the waiting worker's
identity, and holds it until the intended controller is verified. Queued browsing
uses its existing abort signal, and failures release the lock. This protects a
current tab under a historical worker without changing the historical cache.
Already-open older frontend versions cannot join this coordination; the frozen
7ba3b81 frontend used local recipe data and made no browse API requests.

A connected visit or throttled online focus/reconnection check can download an
updated shell. **Update and reload** activates that verified release and reloads
only the requesting tab. Other tabs retain their cooking view until they choose
to reload. **Later** collapses the notice. Unsaved cooking checks require
confirmation, and cancellation preserves checks and focus. A bounded handshake
verifies the intended full release SHA before and after activation. A different
candidate requires a fresh choice. First installation never reloads the page.
The waiting worker can also activate when every recipe tab closes. Saved recipe
bundles are not refreshed as part of shell installation or activation.

Maintenance builds write no worker and link no manifest. An installed worker's
update check receives a 404 and preserves offline cooking. Any other build whose
landing page lacks the manifest fails. Worker responses use `Cache-Control:
no-cache`, while `/release.json` uses `no-store`.

The worker does not register in development or preview deployments. Verify
production output with `npm run build && npm run preview`. The built PWA suites
exercise installation, atomic saves, release mismatches, browser restart,
negotiated representations, update confirmation and maintenance behavior.
Production smoke separately verifies worker activation at `/recipes/` and
control after reload, then saves one opened recipe and reopens it offline. The
smoke records cancellations of summary GET requests already in flight at its
explicit reload, card navigation or offline step as verification observations,
and waits for rendered card images before following a card link. HTTP errors,
unexpected network failures and offline cooking-resource failures still fail
smoke. That check does not substitute for the broader saved-recipe tests.

When saved recipes exist, an app update also verifies its own deferred saved-view
search, filter and print code in a separate cache. Empty installations
skip that download. This updates the browsing tools without refreshing saved
recipe data, pages or images. Opening an older saved recipe navigates to its
canonical cached page so its cooking data and runtime stay on the same release.

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
cached recipe pages. `tests/built/blogthedata-killswitch.test.mjs` proves both
retirements in Chromium across two origins. Visitors who had the old app
installed install the new one from `/recipes/`.

The library places search after its settings, next to the results. Every recipe
is keto. Vegetarian uses the canonical verified vegetarian flag, excluding meat
and unverified cheese recipes. No current meal is verified vegan. Vegetarian and
plant-forward are not protein choices. Saved settings and native GET forms use
`vegetarianOnly` as a boolean (`=1` in URLs). The retired `mealKetoOnly`,
`smoothieKetoOnly` and `mealStyle` values are ignored. Saving preferences removes
the retired keto keys without discarding unrelated filters. Carbs clears by
unticking choices; other multi-choice filters disable Clear selections when empty.

Recipe pages print their on-screen cooking content directly. Individual card
print packets use the same RecipeContent renderer. Print shows the recipe name above its cooking table, including the table’s
preparation rows, required pressure-liquid minima and selected side amounts.
Images, controls, summaries, attribution and nutrition stay out of print. The
same operation-equipment icons appear in desktop, mobile and print flow steps,
including large and small mixing bowls. Each operation owns explicit equipment
identifiers, validated when the canonical registries load; compacted cells combine their
operations’ equipment without inferring tools from instruction wording.
Measurement provenance remains in
Markdown/JSON downloads.

Back to meals/smoothies uses the matching same-tab collection history entry
when available. Collection history restores the scroll position, search and
shuffle order after hydration; direct recipe links return to the collection top.
After a legacy `/recipes/#<id>` redirect, which replaced the collection's
history entry, Back follows the recipe's collection link instead of history, so
it never leaves the site (a session marker set just before the redirect).

Heat-bearing ingredients include short adjustment guidance in their canonical notes,
shared by cooking views, print and downloads. Blend, canned chili and sausage
notes preserve the measured quantity and suggest a milder or hotter version.
Nutrition estimates still describe the recorded ingredients and amounts.

Dump and go identifies recipes that load the cooker and start without separate
browning or mid-cook additions. Preparation and finishing can still be needed.
The flag is explicitly reviewed recipe metadata, not inferred from elapsed time
or a zero mid-cook action count.

### Archived carrot cake

`carrot-cake` is excluded from the keto collection. Its original record adapts
[Zona House's Mini Carrot Cake](https://zonacooks.com/carrot-cake/).
It includes the measured pecans and omits unmeasured garnish. Ingredient weights
and nutrition source observations are recorded in
`recipes-evidence/carrot-cake-2026-10-22.json`. Generic applesauce models the
cinnamon-flavored product; brands and unobserved spice remain limitations.

All ingredients use whole-cake scaling: one complete 6-inch cake for 2 or 4
portions, two matching cakes for 6 or 8. Pan depth and baking time stay fixed;
extra oven batches and cooling can extend total time. Two portions are larger
than the default four slices. The adaptation has not been kitchen-tested.
Recipe-owned storage and safety guidance keeps the frosted dessert chilled.
