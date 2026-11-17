# Manufacturer nutrition evidence

Accessed 2026-10-02. Values below were read visually from label images reached through each manufacturer's own product page using the supported Chrome browser. Retail summaries were not used to fill values. Label values are rounded; scaling is an estimate, not unrounded nutrient analysis. All inspected labels are **US Nutrition Facts**, including DeLallo's products made in Italy. Their **Total Carbohydrate includes dietary fiber**, as explained by [FDA total carbohydrate guidance](https://www.accessdata.fda.gov/scripts/InteractiveNutritionFactsLabel/assets/InteractiveNFL_TotalCarbohydrate_October2021.pdf); use carbohydrate minus fiber for this article's net-carb convention. Do not treat these as EU panels, where declared carbohydrate excludes fiber and a second fiber subtraction would undercount.

| Product | Manufacturer label serving | kcal | Protein g | Total carb g | Fiber g | Estimated net g |
| --- | --- | --- | --- | --- | --- | --- |
| DeLallo US Potato Gnocchi, 16 oz, UPC 072368510972 | 1 cup (140 g) | 230 | 6 | 50 | 2 | 48 |
| Mina Mild Harissa, 10 oz, UPC 852955007067 | 1 tbsp (15 g) | 10 | 0 | 1 | 0 | 1 |
| HERDEZ Salsa Verde Mild, US 16 oz panel | 2 tbsp (31 g) | 10 | 0 | 2 | Not numerically declared; “not a significant source” | At most the declared 2, using conservative 0 fiber assumption |
| DeLallo Basil Pesto Squeeze Bottle, 6.7 oz, UPC 072368271606 | ¼ cup (30 g), exactly as label says | 190 | <1 | 3 | 1 | 2 |
| DeLallo traditional basil Pesto Jar, 6.35 oz, UPC 072368424675 — does **not** meet requested pesto cap | ¼ cup (45 g) | 280 | 3 | 5 | 0 | 5 |

## Final recipe arithmetic

- Gnocchi: the recipe uses 454 g. Scaling the 140 g label gives approximately 746 kcal, 19.5 g protein, 162.1 g total carbs and 6.5 g fiber per batch, before the other ingredients. Meal totals are rounded only after combining ingredients.
- Mild harissa: 60 g = 40 kcal, 0 g protein, 4 g total carbs and 0 g fiber in the batch.
- Salsa verde: the final recipe uses 124 g (½ cup), added after pressure cooking. This gives 40 kcal, 0 g protein and 8 g total carbs per batch. Fiber is not numerically declared; modeled zero is conservative.
- Qualifying squeeze-bottle pesto: the final cod recipe uses 45 g, added after cooking. This gives 285 kcal, modeled 0 g protein, 4.5 g total carbs and 1.5 g fiber per batch, or 0.75 g net carbs per person from pesto. The label declares protein <1 g per 30 g; zero is a conservative model choice. Weigh the pesto because the displayed ¼ cup/30 g conversion is unusual.
- Jar pesto: its current label gives 5 g net carbs per 45 g, equivalent to 3.33 g per 30 g. It fails the final article's substitute cap of ≤2 g net carbs per 30 g. Do not substitute the jar and squeeze-bottle data.

## Source pages and directly inspected images

### DeLallo gnocchi

[Manufacturer US product page](https://www.delallo.com/delallo-potato-gnocchi-16-oz/) identifies the 16 oz package and UPC. The page contains multiple package-image generations. I inspected its newer `Gnocchi_NFP` side-panel image, whose visual label says 140 g/230 kcal/6 protein/50 carbs/2 fiber. Do not silently mix its values with older images or retail listings.

[Direct manufacturer-hosted current label image](https://cdn11.bigcommerce.com/s-cjh14ahqln/images/stencil/1280x1280/products/467/7956/Gnocchi_NFP__75814.1759248331.jpg?c=1).

### Mina mild harissa

[Manufacturer product page](https://mina.co/products/mina-harissa-mild). Its gallery's second jar image contains an old-format but currently displayed US nutrition panel; visually legible. Says 1 tbsp (15 g), 20 servings per jar, calories10, protein0g, total carbohydrate1g, dietary fiber0g.

[Direct manufacturer-hosted jar-back image](https://mina.co/cdn/shop/files/1_6e35c085-9304-4974-a0d1-35570c9c23d7.png?v=1760448229&width=1946).

### Herdez mild salsa verde

[Manufacturer US product page](https://www.salsas.com/herdez/products/salsas/salsa-verde/). Opened Nutrition Information accordion and visually read the 16 oz panel. The manufacturer cautions that packaging/formulation changes and the purchased label should control.

[Direct manufacturer-hosted 16 oz panel](https://www.salsas.com/herdez/wp-content/uploads/sites/2/2019/01/herdez-salsa-verde-mild-16-oz-nfp.jpg).

### Qualifying basil pesto: DeLallo squeeze bottle

[Manufacturer product page](https://www.delallo.com/pesto-squeeze-bottle/). [Direct inspected manufacturer label](https://cdn11.bigcommerce.com/s-cjh14ahqln/images/stencil/1280x1280/products/636/7332/NutritionFacts_Ingredients__68811.1722528555.jpg?c=1).

**Formulation caveat:** the panel's ingredients include fructose, although its Nutrition Facts lists 0 g added sugars and the product-page bullets say “No added sugars.” The requested numerical net-carb cap is met, but this source does not justify an unconditional “contains no added sugar” ingredient assertion. Use the numerical cap and measured amount, or choose a different product and obtain its manufacturer label. Allergens include milk, cashews, pine nuts; may contain peanut traces. The manufacturer describes pesto as best enjoyed raw/as a finish; the final cod recipe uses it after cooking.

### Rejected alternative: DeLallo jar pesto

[Manufacturer product page](https://www.delallo.com/pesto-jar/). [Direct inspected newer 280-kcal panel](https://cdn11.bigcommerce.com/s-cjh14ahqln/images/stencil/1280x1280/products/1633/8337/Pesto_Nutri_280_cal__49534.1771248156.jpg?c=1). Page also includes an older screenshot label; newer jar-side image takes precedence. The current inspected 5 g carb/0 g fiber per ¼ cup fails the requested cap when halved.

## Access limits

The web text extractor omitted these image nutrition facts. Ordinary terminal HTTP requests could not resolve the manufacturer domains in the sandbox. The supported Chrome browser successfully loaded all four manufacturers' pages/images, so this did not leave the requested evidence unavailable. No retail fallback was needed. Barilla's US page embeds nutrition in an iframe; that iframe was not pursued because a qualifying DeLallo squeeze label was obtained. No EU/UK label was used numerically.

Parent supplied Bob's Red Mill nutritional yeast evidence separately: [manufacturer page](https://www.bobsredmill.com/product/nutritional-yeast), 2 tbsp (8 g) = 30 kcal, 4 g protein, 3 g total carbohydrate, 2 g fiber. This row was not reverified as part of this assignment.
