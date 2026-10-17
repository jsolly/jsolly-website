# Recipe measurement migration review

Reviewed on 2026-10-15. This is developer evidence, not cooking-page copy.

The explicit decisions in `measurement-decisions.json` cover all 1,680 original
ingredient and family-option identities in 146 recipes. They replace all 136
missing or zero source quantities with positive measured defaults. Splitting
compound rows produces 1,736 measured rows; 109 additional choices have their own
measured quantities. Original ingredient IDs, source lines, original amounts,
optional flags and flow allocations remain traceable. The original identity
SHA-256 is `f670105d5e3f41d9ba467a7ef8c7a17db56307fee5efa41fecacba64aaf7b669`.

The cooking-quantity migration also replaces unspecified packets of riced
cauliflower and spiralized zucchini with the primary ingredient's edible mass.
The two medium cauliflower heads retain 588 g targets; four medium zucchini
retain 784 g. The steamed cauliflower substitute retains the normalized
four-serving 16-ounce prepared target. Fresh florets are riced and steamed before
measuring that target; no raw-to-cooked yield is assumed. These are weighed
substitutions, not inferred grocery-package sizes.
Original packet, onion-size and other source quantity parentheticals remain in
provenance and are removed from scaled cooking copy.

Every ingredient name, preparation state and note was reviewed for literal source
quantities. The cleanup retains cooking geometry, temperatures, nutrition-label
thresholds, measured instruction references, relative allocations and heat
adjustment guidance. A structural data test rejects obsolete food counts,
package substitutions and migration explanations in cooking fields.

## Evidence and decisions

The 153 references in `ingredient-weights.json` distinguish observed portions
from editorial cooking targets. A reference records food identity, preparation,
mass basis, source and review provenance. Runtime lookup uses only its explicit
ID. It never guesses a food from its name or copies nutrition-row grams.

1. Retain positive source mass quantities without rounding. Where the publisher
   supplies a mass alongside a count or volume, use that mass at the same recipe
   scale. Publisher masses override generic portion observations.
2. Match USDA SR Legacy food and portion preparation explicitly. Use each exact
   observed unit before any explicitly permitted volume interpolation. Different
   spoon and cup observations need not be perfectly proportional.
3. Use an identified manufacturer portion for the named product. Do not silently
   turn a 15 mL label serving into an exact US tablespoon.
4. Where the source gives no usable portion size, or its preparation differs from
   the available observation, choose and record an explicit cooking mass. Such a
   target is a recipe adaptation, not a measured food-density claim.

USDA evidence is the SR Legacy `food.csv` and `food_portion.csv` archive with
SHA-256 `b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`,
retrieved 2026-10-13. Each USDA reference links its FDC food record. In particular,
fluid cream retains 15 g/tbsp and 238 g/cup; butter retains 14.2 g/tbsp and
227 g/cup; garlic powder retains 3.1 g/tsp and 9.7 g/tbsp. Shredded cheddar's
113 g/cup and grated Parmesan's 100 g/cup and 5 g/tbsp remain distinct.
Shredded Parmesan uses its own USDA173431 tablespoon observation, 5 g/tbsp
(food portion id92515), with explicit cup interpolation. The Zuppa Toscana
publisher mass remains authoritative.

Other primary evidence:

- [King Arthur ingredient weight chart](https://www.kingarthurbaking.com/learn/ingredient-weight-chart): almond flour 96 g/cup, baking powder 4 g/tsp, coconut flour 128 g/cup, all-purpose flour 120 g/cup, chopped cashews 113 g/cup, unsweetened coconut cream 284 g/cup and sliced scallions 64 g/cup. Generic yogurt does not establish Greek-yogurt density.
- [Morton coarse kosher salt](https://www.mortonsalt.com/shop/kosher-salt/morton-kosher-salt-flakes-16-oz/): manufacturer label 1.2 g per quarter teaspoon. This product is named explicitly; fine table salt retains its own USDA observation.
- [Grey Poupon Dijon](https://www.kraftheinz.com/grey-poupon/products/00054400600506-dijon-mustard): 5 g/tsp, distinct from yellow mustard.
- [Chobani plain whole-milk Greek yogurt](https://www.chobani.com/products/yogurt/greek/whole-milk-plain-large-size-tub): 170 g per three-quarter cup.
- [Big Tree Farms coconut aminos](https://bigtreefarms.com/products/regenerative-organic-coco-aminos): current product label 18 g/tbsp. The original product's retired PDF is not the evidence link.
- [Frank's manufacturer specification](https://www.webstaurantstore.com/documents/nutrition/417416104eafranksredhotbuffalowingssauce41gal.pdf): product 417416104, UPC 041500741611, 15 mL weighs 15 g. The distributor hosts the manufacturer document. This portion evidence does not assert the current nutrient formulation.
- [Mizkan manufacturer specification](https://shop.hr-gastro.ch/dta.php/vendfiles/hrgastro/prodspecs/de/126928.pdf): unseasoned rice vinegar, document 1001248 issue 2 dated 2015-09-10, specific-gravity target 1.013 (range 1.010–1.016). The reference records a nominal 1.013 g/mL approximation, not an assumed water density.

## Editorial targets and food state

Undefined meat counts use explicit portion sizes, with bone-in cuts and whole
birds marked as purchased. Vegetable bunches use trimmed cooking targets.
Drained cans and jars use drained contents, not package liquid or gross weight.
Two four-serving fish recipes whose single fillet is cut into several pieces use
680 g whole-side targets rather than a single 170 g diner portion.

Missing salt and pepper mixtures become separate measured rows. Missing herb,
garnish, oil and vegetable amounts have explicit per-row decisions. Source heat
adjustment guidance remains. The fajita packet is an explicit 28 g default, with
3 g allocated to chicken and 25 g to vegetables. These are reviewed cooking
targets rather than a claimed universal packet or seasoning density.

Riced cauliflower, shredded cooked chicken, broccoli florets,
chile flakes and open-ended cheese choices use explicit weighed targets when an
exact preparation observation is unavailable. Ancho and red-chile powders are
not silently assigned the USDA salted chili-seasoning blend. Nutrition may use a
separately documented composition proxy without turning it into portion evidence.

Alternatives carry their own amount, unit and reference, or share an explicitly
selected fixed mass. Examples include butter/oil/ghee, broth/wine, fresh/ground
aromatics, soy sauce/coconut aminos, fresh herbs, and pork-rind/regular/gluten-free
breadcrumbs. Unmeasured publisher substitutions that were not retained are kept
in original provenance; the cooking row states the selected measured default.

## Repeatability and verification

From an unmigrated library, run `node scripts/recipes/migrate-measurements.mjs`
from the repository root. The migration consumes the explicit decision table,
checks original source quantities, expands compound flow leaves and records its
completion marker. Running it again validates original identity coverage and
positive quantities without overwriting later recipe edits. Original positive
mass quantities are protected in the decision loader.

Verification of this data pass resolved every primary, family and alternative
quantity to positive grams. The original-mass and butter-identity regressions
passed, as did the conversion and full serving-matrix tests. The audit snapshot,
nutrition reconciliation, generated downloads, cooking-text tokens and full
repository gate are owned by the coordinating task and must be regenerated or
verified against the final combined changes.
