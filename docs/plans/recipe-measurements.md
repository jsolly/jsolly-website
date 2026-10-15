# Complete recipe measurements

Plan date: 2026-10-15. Baseline: `e2b57531ed6934b9afe738a47f14e1562278af3b`, verified against fetched `origin/main`.

Status: independently reviewed implementation scope, authorized on 2026-10-15. Validation and release evidence belongs in the implementation PR.

## Outcome

Every ingredient in all 146 recipes, including optional ingredients and family sides, has a measured amount and works in Metric, US imperial and Grams only. Ingredient rows show the selected quantity and unit, with no conversion explanation, duplicate source quantity or "weight unavailable" suffix.

John approved measured defaults for missing amounts and "to taste" ingredients on 2026-10-15. Recover publisher amounts where possible; otherwise choose and review explicit recipe defaults. Preserve the publisher's original text in provenance. The new defaults are adaptations, not recovered publisher facts.

Use the current US customary interpretation of "US imperial". Preserve `grams|us|metric` URLs, saved preferences and their priority. Metric uses grams for solids and mL for liquids; Grams only uses g for every ingredient, including liquids, eggs, produce and packages. US imperial uses appropriate US cups, spoons, counts, mass ounces and pounds. Use mass ounces for a solid whose volume would require an unsupported assumption. Keep mass ounces distinct from fluid ounces.

## Baseline audited scope

At the baseline commit, `docs/recipe-units-audit.json` matched its generator. The library contained 140 meals and 6 smoothies, with 1,672 base ingredient rows and 8 family options, totaling 1,680 entries and 491 case-folded ingredient names.

| Current grams result | Entries | Required work |
| --- | ---: | --- |
| Direct mass conversion | 298 | Verify mass basis and rounding |
| Conversion from a portion reference | 538 | Review state, source and consistency |
| Positive quantity without a usable weight | 707 | Resolve every portion or adopt a measured default |
| Missing quantity | 68 | Recover or set a measured default |
| To taste | 68 | Set a measured starting amount |
| Pressure liquid minimum shown as volume | 1 | Supply a gram quantity while retaining the cooking volume requirement |

The 707 unresolved entries include 418 cup/spoon quantities and 289 count, package or other measures. There are 31 base unit strings, including the empty string. Current matching rejects 148 unresolved entries because `or`, `packed`, `heaping` or `whipped` occurs anywhere in their name, state or note. A note containing "or" can block an otherwise supported ingredient.

Audit all existing conversions too. Current coverage is not proof of a correct food-state match. For example, the nutrition model and cooking registry disagree on almond-milk cup weight. Nutrition grams exist for 702 of the 707 unresolved entries, but cannot be copied wholesale: bone-in pork chops use approximately 907 g purchased weight and 726 g edible nutrition weight for the same source amount.

## Conversion design

Extend `ingredient-weights.json` into a reviewed reference registry. Give ingredient rows explicit reference identities rather than deriving food identity from display names or arbitrary prose. Retain the original unrounded source amount and unit, plus the cooking mass basis and adaptation record where applicable. Reuse one quantity resolver across the ingredient list, cooking diagram, family sides, print and exports.

Each reference must record the exact food or product, preparation state, size or packing where relevant, observed unit and amount, gram weight, source URL, source record or label, retrieval evidence and review decision. Distinguish edible contents from as-purchased weight, liquid from dry food, and drained from undrained products. Store evidence in canonical data and developer audit files. Do not append conversion explanations to cooking views or downloads.

Prefer an observation in the recipe's actual source unit. Cup and tablespoon observations can differ because of rounding, packing or measurement method. Do not derive a reference from whichever property appears first in JSON. Use another volume unit only when the observation supports that interpolation. Reserve grams per mL for a supported liquid density; a kitchen weight chart is not automatically a precise physical-density table. Never assign water's density to all liquids or a common weight to all cups.

Keep one unrounded quantity through scaling and conversion. Apply linear, fixed, whole-batch and minimum rules before display rounding. Round only at the final display boundary, retaining fractional grams for small seasonings. Reject nonfinite, missing and nonpositive recipe amounts after migration. Every ingredient quantity must be numeric; no source-measure fallback is an acceptable completed entry.

### Cases requiring individual decisions

- Eggs and produce: define size and preparation basis. Large egg contents can use a reviewed edible portion; shells do not enter the ingredient weight. Whole birds and bone-in cuts retain their cooking purchase-weight basis and batch rules. Nutrition separately accounts for refuse.
- Cheese, flour, herbs and vegetables: match shredded, finely grated, crumbled, chopped, loose, packed, raw, cooked and drained states explicitly. Keep almond flour separate from almond meal and fluid heavy whipping cream separate from whipped cream.
- Cans, jars, cartons, packets, slices and links: recover actual package or portion sizes first. Confirm whether an ounce label is mass or fluid volume. Where the source gives no size, adopt a measured default and record it internally. Do not present an assumed drained yield as the package's net weight.
- Alternatives: represent meaningful choices explicitly. Give volume-based alternatives their own references and quantities. For open-ended choices such as "any shredded cheese", choose a reviewed default or a reviewed fixed mass target, and use US mass units where necessary. Do not claim that one cup weight describes every variety. Preserve valid substitutions and optional status.
- Mixed salt-and-pepper ingredients: establish measured component amounts and split the rows where needed, updating cooking-tree references and nutrient models. Brand-specific salts and seasoning blends need their own portion basis.
- Packed, heaping, pinches and undefined measures: find an exact observed portion or replace the measure with an explicit reviewed gram amount. A "heap" or "coffeespoon" has no universal conversion.
- Missing and to-taste rows: choose measured starting amounts appropriate to four portions and the cooking role. Keep optional additions optional. Do not convert a missing value to zero or reuse a nutrition assumption without reviewing it as a cooking quantity.
- Pressure cooking: preserve the required volume independently. Calculate the scaled liquid volume with its existing minimum, then derive the ingredient's grams. Keep the mL requirement in the cooking operation in every mode, including Grams only. A density estimate never reduces or replaces that volume requirement.

## Implementation sequence

### 1. Extend the audit and establish the data contract

Extend `scripts/recipes/audit-units.mjs` to enumerate every base row, family option and explicit alternative, its reference, mass basis, defaults and unresolved decisions. Include real serving and family scaling, not only raw four-serving ingredient amounts. Track every existing row by recipe and ingredient identity through any split or normalization so no ingredient disappears.

Add validation for positive quantities, valid references, matching states, dimensional correctness and reference uniqueness. During migration, use the audit as the worklist. The completed gate must reject every unresolved entry; do not preserve a permanent exception list for difficult foods.

### 2. Research and migrate the entire library

Work in reviewable batches: current matches, remaining volume measures, counts and packages, alternatives and unusual states, then all 136 missing/to-taste entries. Record a decision for each row. Start with the chaffle screenshot as a concrete example, then cover the entire library.

Prefer publisher cooking weights and exact manufacturer portions for named products. Use USDA portions and established test-kitchen references when they match the ingredient and state. Retain contradictory observations for review rather than averaging them silently. Apply reviewed mappings with a repeatable migration script; keep judgment in explicit data. Re-running the migration must make no additional changes.

Do not claim that editorial defaults have been cooked or tasted. Review plausible quantities, cooking role, salt and leavener amounts, vessel limits and the existing method before accepting them. Record genuine source gaps and the chosen adaptations in the developer audit.

### 3. Complete the shared resolver and all quantity consumers

Update `ingredient-units.mjs` and `recipe-logic.mjs` to resolve all approved data into all three modes. Remove broad prose-based exclusion and unresolved fallbacks from the valid-recipe path. Keep validation errors specific enough to name the recipe and ingredient.

Migrate `trn-logic.mjs`, including the three recipes with symbolic pinch/remainder allocations. Give each cooking allocation a measured quantity and preserve the unrounded total across branches. Do not replace a whole-batch rule with linear mass scaling.

Audit quantities embedded in flow operations, preparation instructions, ingredient notes, tips and family-side text. `cookText()` currently converts temperature and geometry, not ingredient amounts. Replace ingredient amounts that change with units or servings with references to resolved quantities, including half-eggs, patty weights and seasoning allocations. Keep shopping package counts distinct from cooking quantities and calculate `purchaseNote()` from the correct mass basis.

Preserve existing cooking endpoints, vessel capacity, required liquid volumes and ingredient preparation. New conversion commentary is out of scope.

### 4. Reconcile nutrition and exports

Keep equivalent conversions from altering the intended food quantity. For new defaults, changed ingredient choices or corrections to an existing assumed weight, reconcile `nutrition-data.json`, ingredient snapshots, edible yields, recipe estimates, family additions and nutrient/filter results. Preserve original publisher-reported nutrition separately and identify estimates internally. A cooking mass containing bones must not become edible nutrition grams.

Give every nutrient contribution a stable link to its cooking ingredient, including components of split mixtures. Migrate rows whose `food` label currently differs from the ingredient id. Use each ingredient's actual unrounded scaling factor for macros, Daily Values and recorded omega-3, covering `linear`, `fixed`, `minimum` and `whole-batch`. The 12 existing fixed rows currently have zero quantities; positive defaults will activate a gap in `nutrition.mjs`, which currently special-cases only minimum and whole-batch scaling. Fix that branch and the corresponding macro calculations. Verify fixed-quantity nutrient contributions decrease per serving as diners increase, while linear contributions remain constant per serving. Preserve the separate per-glass smoothie yield calculation.

Make `recipe-export.mjs`, download controls and static Markdown siblings consume the same resolved quantities as the screen. Remove obsolete conversion-policy prose and duplicate source measures from generated cooking documents. Do not introduce a replacement explanation. Preserve attribution, existing provenance and other required recipe metadata. Check the existing measurement-help content for stale claims about unsupported ingredients; delete obsolete statements without adding conversion commentary.

Regenerate `public/recipes/data/recipe-library.json`, `recipe-library.md`, `docs/recipe-units-audit.json`, static Markdown siblings and the normal service-worker build. Update `docs/recipes.md` and affected `AGENTS.md` measurement contracts, including the old missing/to-taste policy. Keep these developer instructions out of the product UI.

### 5. Verify complete coverage and release together

Add source-derived expected values independent of the resolver. Cover the screenshot and cases where food density or refuse changes the answer, including shredded versus grated cheese, salt grains, almond flour, liquid cream, cooked rice, drained cans and bone-in food. Test direct observed units and any permitted interpolation separately.

Run the complete recipe matrix for all 146 recipes at 2, 4, 6 and 8 servings in all three modes. Include every family option, per-person and total family quantities, all supported family-diner counts, optional ingredients and explicit alternatives. Assert numeric mode-appropriate units, no missing quantity, no "weight unavailable", no accidental zero, no duplicate source units in quantity strings, preserved allocation totals and no mutation or rounding drift across repeated switches. Verify pressure minima and whole-batch scaling independently.

Update unit, nutrition, flow, source-data, export, print, built-page and offline tests that currently permit the old fallbacks. Update `scripts/test-counts.json` with changed discovery counts; do not weaken coverage or lower counts without naming retired cases.

Replace nutrition tests that assume constant per-serving nutrients for every recipe without a minimum or whole-batch ingredient. Derive expected totals independently from nutrient observations, edible yields and actual ingredient quantities at each serving count. Require every model contribution to resolve to its intended cooking ingredient and test fixed, minimum, whole-batch, split-mixture, family and smoothie calculations across macros, Daily Values, omega-3 and nutrient filters.

Browser verification must exercise recipe pages and the library dialog at desktop and mobile widths, light and dark themes, keyboard and pointer controls, saved preferences and shared URLs. Check print and no-JavaScript defaults. Compare screen, JSON, Markdown, static `.md` and offline quantities. Verify a previously installed offline app updates to the new recipe content. Check consoles and shared portfolio/blog navigation for regressions.

## Concrete example for the screenshot

The four-serving recipe is `source-basic-keto-chaffle-recipe`. Candidate references from the King Arthur chart give 50 g per large egg, 96 g per cup of almond flour and 4 g per teaspoon of baking powder. These yield 100 g eggs, 16 g almond flour and approximately 1.333 g baking powder before display rounding. A reviewed 113 g/cup reference for common shredded melting cheeses yields approximately 75.333 g cheese. Resolve the source's unrestricted cheese choice before accepting that mapping.

The expected Grams only ingredient list after review is simply `100 g`, `75 g`, `16 g` and `1.3 g`, followed by the ingredient names. Those numbers are a test case, not a substitute for the full-library audit.

## Completion bar

- Every original entry is accounted for, including all family sides and any newly split mixture rows. No unresolved conversion, unspecified cooking quantity or quantity-free ingredient remains.
- Every grams-mode ingredient and cooking allocation has a positive numeric gram amount. Metric and US imperial describe the same unrounded food quantity with the intended unit dimensions and source-specific observations.
- New defaults and ambiguous-state decisions have internal evidence and review. Existing matches receive the same review as new matches.
- Conversion explanations, source-quantity echoes and warning suffixes are absent from ingredient quantities; no new conversion prose appears elsewhere in cooking documents.
- Nutrition matches the corrected ingredient quantities and mass basis, while publisher claims remain distinguishable from estimates.
- All generated files are current, required automated and browser checks pass, and independent semantic review accepts the data and consumer changes.

## Integration and commands

Use one implementation branch from then-current `origin/main`, with separate local commits for the contract, reviewed data batches, consumers and verification. Release the completed migration together in one reviewed PR so the live site never presents partial coverage as complete. If data review needs more PRs, keep preparatory changes behavior-preserving and activate strict complete coverage only with the final migration. Do not trigger a Preview without John's request.

Implementation commands below run with cwd `/Users/johnsolly/code/jsolly-website`. They are planned checks and have not been run against an implementation in this planning task.

```bash
node scripts/recipes/audit-units.mjs --write
```

```bash
npm run recipes:sync
```

```bash
npm run gate
```

Run the full gate before `/ship`; this is a data and logic migration and cannot use the UI-only preview shortcut. Follow repository release instructions, merge on green `CI / ci`, then verify Vercel READY, the exact live `/release.json` SHA and that release's successful Production smoke run. Record the run URL and verify the production recipe worker installs and controls the page. Production integration is a later implementation step, not part of this plan-only request.

## Planning evidence

The current audit generator matches the committed audit. The focused existing ingredient-unit and display-unit tests passed 13/13. Those tests permit unresolved values today and do not establish that the requested feature works. The full gate, browser verification, build and production checks were not run for this plan.

Independent review inspected the plan and current data/consumers. Its required nutrition-scaling gap was added to steps 4 and 5, then rechecked. Final result: bar met, with no required planning gaps. The plan file also passed direct Markdown lint validation.

No project-specific shared-recall index exists at the expected normalized repository path; this plan uses the current repository, the screenshot and the source checks below. No remembered recipe decisions were assumed.

Primary references inspected on 2026-10-15:

- [USDA FoodData Central documentation](https://fdc.nal.usda.gov/data-documentation/)
- [USDA portion definitions and edible-weight basis](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)
- [King Arthur ingredient weight chart](https://www.kingarthurbaking.com/learn/ingredient-weight-chart)
- [NIST Special Publication 811](https://www.nist.gov/pml/special-publication-811)
- [Clabber Girl baking powder label](https://clabbergirl.com/product/clabber-girl-baking-powder/)
- [Morton table salt label](https://www.mortonsalt.com/article/morton-iodized-table-salt-nutritional-facts/)
- [Morton kosher salt flakes label](https://www.mortonsalt.com/shop/kosher-salt/morton-kosher-salt-flakes-16-oz/)

The user authorized the complete measurement migration, including measured defaults. The implementation PR owns the resulting validation and release receipt.
