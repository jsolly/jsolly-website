# Piece A independent final review

The four keto recipes meet the documentary and design bar. One required common-material gap remains: the saved preview screenshots predate the current article. Regenerate the desktop/mobile verification against the current preview before declaring acceptance bar 10 met.

## Required gap

**P2: preview evidence is stale.** `outputs/verification/mobile-recipe.png` visibly shows salsa chicken at 8 minutes hands-on, 35–50 total, ¾ cup salsa, 10 oz cabbage/slaw, and an optional black-bean family add-on. The current article uses 15 minutes hands-on, 40–45 expected, 124 g salsa, 454 g plain cabbage, and only the measured rice add-on. The current HTML body exactly equals `post-update.json.body`, and that body is present in `preview.html`; the old screenshot does not prove this revised rendering. Rerun the preview verification and replace all screenshots and its JSON against the current artifact. This is a verification-evidence correction, not a recipe design failure.

## Independent nutrition check

I read the actual Markdown ingredient lists, entered a separate four-recipe ingredient mapping, and calculated their nutrients directly from `work/usda-sr-legacy.zip` CSV records. I did not execute the delivered recomputation script or use its generated pass flags as proof. The archive SHA-256 independently matches `b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`.

I checked all food descriptions in the relevant archive records. Salmon and cod are raw fish, thighs are raw meat-only thighs, broccoli/asparagus/zucchini are raw vegetables, and spinach is frozen unprepared. Eggs use 600 g edible weight for 12 large eggs. All oil, acids, zest, hemp, feta, yeast, pesto, and salad are included. Water and salt contribute none of the five reported macros. Pepper to taste is immaterial at ordinary seasoning amounts. Oil uses 13.5 g per tablespoon and 4.5 g per teaspoon.

| Recipe | Recomputed kcal | Protein g | Total carb g | Fiber g | Net carb g | Vegetable ingredient g/person |
| --- | --- | --- | --- | --- | --- | --- |
| Salmon | 468.0703 | 38.9510 | 5.9985 | 2.7288 | 3.2697 | 113.5 |
| Smoky chicken | 316.8030 | 37.8566 | 9.5054 | 3.7858 | 5.7196 | 113.5 |
| Cod | 327.6950 | 33.9251 | 7.1042 | 2.2862 | 4.8180 | 170.0 |
| Frittata | 407.8251 | 30.2943 | 9.9114 | 4.9831 | 4.9283 | 149.0 before spinach squeezing |

Extra digits above show the arithmetic audit, not biological precision. Published rounding is correct for every row. Every meal clears protein, vegetable ingredient mass, and keto limits with useful margin. The frittata still supplies approximately 26.17 g protein even if all modeled spinach protein is removed. Drained spinach uncertainty and pre-cook vegetable weights are disclosed at article lines 32, 48, and 163. Romaine is a reasonable explicitly traceable proxy for unspecified salad greens, and the small salad fraction does not threaten the keto/protein thresholds.

I independently opened [Bob's Red Mill's current manufacturer page](https://www.bobsredmill.com/product/nutritional-yeast), whose US label lists 2 tbsp/8 g, 30 kcal, 4 g protein, 3 g total carbohydrate, and 2 g fiber. I also visually inspected the [manufacturer-hosted DeLallo squeeze-pesto label](https://cdn11.bigcommerce.com/s-cjh14ahqln/images/stencil/1280x1280/products/636/7332/NutritionFacts_Ingredients__68811.1722528555.jpg?c=1) in the supported browser. It says 30 g, 190 kcal, 3 g total carb, 1 g fiber, and protein <1 g. Thus the actual 45 g recipe contributes 285 kcal, 4.5 g total carb, 1.5 g fiber, and 3 g net per batch. Modeling its protein as zero is conservative. The unusual quarter-cup/30-g labeling is real, and using grams avoids its volume ambiguity. The article's substitute cap is stated per 30 g and does not assert the product has no sugar ingredients.

USDA web detail pages failed to render through the text tool; the raw downloaded USDA CSV records were the successful independent source check. No cooked/raw yield conversion was introduced.

## Execution, flavor, and safety

- **Salmon, lines 71–91.** Six-to-eight-minute readiness plus at most 14 minutes cooking and 2 minutes finishing gives 18–24 minutes; 20–25 is defensible. Fish and asparagus have separate stop checks, so neither inherits the other's cook time. The 680 g fish batch is conditional on gaps in its basket. The oven fallback handles small baskets honestly and remains within 35 minutes. Measured oil, garlic, zest, acid, and a modest hemp finish provide a coherent flavor mechanism.
- **Smoky chicken, lines 93–115.** Ready/load 7–9 plus the longest 22-minute chicken cook plus 2 finishing gives 25–33 minutes. Broccoli's delayed 5-minute start and 10–14-minute cook finish by chicken minute 19. There are exactly two mid-cook actions, delayed start and shake. Twelve hands-on minutes is plausible with pre-cut broccoli and unfolded thighs, including handling hygiene. Avoiding a chicken flip trades underside browning for less work and is honestly disclosed. The two-pan fallback resolves basket crowding. Yeast and lemon finish after heat; no burned topping is implied.
- **Cod, lines 117–137.** Twelve-minute oven readiness plus at most 23-minute zucchini roast and 2-minute finish gives 37 minutes. Four fillets fit a half-sheet without stacking. A 680 g zucchini batch cut ½ inch thick has approximately 85–100 square inches of solid projected food area, before gaps, on a nominal 234-square-inch pan; single-layer spreading is credible. Separate pans and separately removing the fish prevent wet zucchini from dictating fish doneness. Pesto after cooking preserves basil flavor and avoids scorching.
- **Frittata, lines 139–163.** Twelve-minute readiness plus 30-minute bake plus 3-minute rest gives 45 minutes, properly marked as the longer option. A 9-inch-square, 2-inch-deep dish has ample capacity for 600 g eggs, about 79 g water, squeezed spinach, and measured cheese/seeds. The resulting shallow egg mixture is credible for the proposed bake range. Microwave spinach preparation overlaps preheat; the 12-minute active budget includes squeezing, cracking/whisking, salad, and cutting. Feta, garlic, hemp, and yeast are coherent with spinach, and the dressed salad supplies acid and fresh texture.

I independently read the current [FoodSafety.gov chart](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures). It specifically lists egg dishes such as frittata at 160°F, poultry at 165°F, fish at 145°F, and leftovers at 165°F. The recipe endpoints match it. The common material separates raw poultry from ready-to-eat food and requires clean serving utensils, multiple temperature locations, and continued cooking if a timer expires first. It rejects carrying thawed-food times over to frozen blocks or frozen vegetable substitutions.

No recipe omits a measured ingredient in its method. No initial sauté, reduction, constant watching, or overnight preparation is hidden. Frittata vegetable mass uses the expressly disclosed ingredient-before-draining convention rather than claiming 149 g cooked vegetables on the plate. Calories are approximate and light dinners are disclosed; no guaranteed ketosis claim appears.

## Package and limits

I checked `post-update.json.body == article-body.html`, found the current body in `preview.html`, and found one matching ID for each of the four keto anchors. JSON preserves slug `15-minute-dump-and-go-instant-pot-recipes`. I did not independently perform the interactive desktop/mobile browser pass; the stale screenshot means that common acceptance item remains open.

The article explicitly says these are newly designed, untested recipes. No kitchen test is required to meet this review's documentary/design bar. Actual basket fit, frittata center setting after spinach drainage, and two-rack oven browning remain honest first-cook checks already covered in the evidence dossier. No required recipe correction is identified in Piece A.
