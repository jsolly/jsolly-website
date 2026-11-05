# Keto recipes plan

Plan date: 2026-10-23. Baseline: `6cd3c11cbff493cfbfaebc4f48a283069fb5412e`.

Implemented locally on 2026-10-23. The original 147-recipe review is retained below. The current collection has 136 keto meals and four keto smoothies, including fried calamari. See [recipe operations](../recipes.md) for the implemented data and behavior contract. Production publication remains a separate release step.

## Proposed collection

Rename the landing page to **Keto meals & smoothies**, with **Keto meals** and **Keto smoothies** collections. Every published recipe must qualify using the existing limit of at most 12.5 g net carbohydrate per four-serving base meal portion or estimated 8 fl oz smoothie glass. Preserve actual carbohydrate values and the explanation of their serving basis.

Keep 124 qualifying recipes, adapt and recalculate 15, exclude eight current versions, and add keto fried calamari. The target is 140 published recipes if all 15 adaptations and calamari qualify, comprising 136 meals and four smoothies. Any adaptation that remains above the limit stays out of the published set. Do not reduce serving sizes to obtain a keto label.

The [complete review](keto-recipes-audit.json) preserves all 147 recipes at the baseline, their unrounded displayed net carbohydrates, original classification, proposed action, adaptation work and individual shared-table copy. The implemented adaptations retain their actual measured changes in canonical data. No kitchen testing is claimed.

| Classification at baseline | Meals and other non-smoothies | Smoothies | Total |
| --- | ---: | ---: | ---: |
| Qualifies as keto | 120 | 4 | 124 |
| Exceeds the keto limit | 21 | 2 | 23 |
| All recipes reviewed | 141 | 6 | 147 |

The baseline non-smoothie collection included carrot cake. Five recipes had selectable family sides, totaling eight side options. Smoothie classifications above use the glass calculation, not the raw four-serving nutrition object.

## Adapt these 15 recipes

Review source quantities, food states and product labels before changing the recipe. Reconcile ingredient models and cooking instructions together, preserving the original publisher facts in provenance. The suggested quantities in the detailed review are starting points for that work, not approved replacement formulas.

| Recipe | Current net carbs per serving | Proposed change |
| --- | ---: | --- |
| Lemon chicken, potatoes, and green beans | 28.05 g | Move potatoes and their oil and seasoning allocation to a separate measured side. Keep chicken and green beans as the base. |
| Low Carb Taco Casserole | 13.49 g | Review the retained publisher baseline, measured taco seasoning and tomato products. Specify a suitable seasoning and sauce. |
| Creamy Chicken Breast in Spinach Parmesan Sauce | 15.49 g | Reduce the large sun-dried tomato quantity while retaining the chicken, spinach and Parmesan. |
| Creamy Tuscan Salmon | 18.63 g | Review the sun-dried tomato amount and cream-to-broth balance. Preserve the fish portion and review sauce consistency. |
| Creamy Cajun Shrimp with Sausage | 15.18 g | Use a reviewed lower-carbohydrate sausage and a revised cream-to-broth balance. |
| Garlic Butter Shrimp with Lemon Parmesan Cauliflower Rice | 13.00 g | Review a smaller onion quantity, the hot-sauce label and the current macro baseline. |
| Lemon Garlic Butter Steak with Spinach | 14.64 g | Check unusually large marinade quantities against the source. Establish a measured marinade and retain the full-boil step. |
| Easy Cajun Pork Chops with Lemon Garlic Zucchini | 15.23 g | Review the 54 g seasoning quantity and specify a measured spice blend. |
| Fried Cabbage with Sausage | 13.61 g | Review a lower-carbohydrate smoked sausage while retaining the cabbage portion. |
| Italian Sausage with Cilantro Lime Cauliflower Rice | 13.49 g | Specify a reviewed sausage and hot sauce at measured quantities. |
| Sausage Taco Cauliflower Rice Skillet | 16.34 g | Review sausage and taco seasoning together. Either change alone may be insufficient. |
| One-Pan Lemon Butter Chicken with Asparagus | 47.51 g | Remove honey from the base and revise the coating. Removing honey alone leaves about 12.68 g. |
| Italian Sausage and Peppers Skillet | 12.76 g | Review the tomato quantity or sausage profile, then check the unrounded result. |
| Stuffed Chicken Breast with Mozzarella and Spinach | 15.75 g | Remove added sugar from the tomato sauce and retain the filling. |
| Grilled Bruschetta Chicken | 13.35 g | Move both balsamic-glaze ingredients to an optional non-keto addition. Preserve chicken, tomato-basil topping and pine nuts. |

Several stored publisher macro baselines differ from a fresh sum of ingredient contributions. Subtraction estimates help identify candidates but do not prove a revised recipe qualifies. Use the existing reconciliation process before publication.

## Exclude these eight current versions

Exclude tomato-lentil-chicken bake, harissa chickpea-cauliflower bowls, gnocchi-white bean-broccoli bake, chicken posole, the peas-and-carrots One-Pan Sausage Veggies, strawberry-banana smoothie, banana-flax smoothie and carrot cake.

Their starches, fruit or baking formula define the current dish. Prefer existing keto alternatives over silently changing those identities. In particular, removing chickpeas alone still leaves that bowl around 13.59 g, and its protein-critical yogurt must stay. A keto carrot cake needs a separate reviewed baking formula.

Retain the original records as editorial evidence outside the published recipe set. Preserve old recipe URLs and legacy fragments with explicit retirement notices linking to the keto collection or a relevant keto alternative. Maintain a separate retired-ID registry for standalone HTML and Markdown routes and the landing page's recipe-fragment resolver. Mark retirement pages noindex and exclude them from the sitemap. Do not serve the excluded recipes as active cooking pages, include them in search or downloads, or redirect them silently to a different dish. Keep the existing collection URLs and the landing page's legacy `#easy-meals--smoothies` anchor.

## Add keto fried calamari

Add `keto-fried-calamari` under Other seafood. Use stovetop frying with cleaned, thawed squid rings, a measured almond-flour-based coating, lemon and a measured no-added-sugar dipping sauce. Review coating adhesion, browning and texture before finalizing the method.

Establish a four-adult base with measured squid, coating, any wash, seasonings, sauce and oil. Squid itself contains carbohydrates. Calculate the whole recipe and aim comfortably below the limit rather than assuming a flour substitute makes it keto. Record how unused dredge is handled. Distinguish oil needed in the pan from estimated oil eaten. A measured shallow-fry method can conservatively count all its measured oil within the existing model; do not treat a deep-frying bath as wholly consumed or omit oil without an assumption.

Specify ring thickness, drying, frying thermometer settings, a source-backed seafood cooking endpoint, batch capacity and larger-batch timing. Identify squid as molluscan shellfish, with almond, egg or milk allergens where actually used. Supply reviewed weight references, ingredient nutrition rows, flow allocations, provenance and the existing three-size first-party illustration.

Suggested shared-table copy: "Serve the calamari for everyone. Offer fries, bread or pasta in separate dishes so each person can build their own plate. Keep dipping sauces on the side." Any salad or additional keto accompaniment has separate nutrition unless added to the measured base.

## Give every published recipe a shared-table note

Add a required recipe-specific `sharedTable` string to published recipe data. Render **For a shared table** after the core method in the shared screen and print content, and include it in canonical Markdown, JSON, recipe packs, search and saved offline content. Keep the notes visible without JavaScript. Retain required ingredients and protein portions in the base.

Examples from the complete review:

- Fajitas: serve chicken, peppers, avocado and yogurt in lettuce bowls. Offer tortillas separately.
- Zuppa toscana: keep cauliflower or radishes in the shared soup. Offer cooked potatoes for individual non-keto bowls.
- Turkey patties: serve the patties, salad and yogurt to everyone. Offer pita or buns separately.
- Zucchini-noodle dishes: cook pasta in another pan and add it only to individual non-keto plates.
- Bruschetta chicken: keep the sweet glaze separate rather than pouring it over the shared chicken.
- Smoothies: blend the keto base and pour its glasses first. Blend banana or oats into only the remaining non-keto portion.

Use text advice for most new examples. Reuse `familyOptions` for measured selectable sides, rather than creating a second side-calculation system. Base macros exclude extras. Show a selected side's nutrition separately and default to None. Do not promise unchanged totals for unmeasured additions or ingredient substitutions.

Existing side controls currently set `familyDiners` equal to total servings. Expose a side-diner count when a measured side is selected, so four people can share a meal with rice for only two. Carry that count through settings, URLs, share links and print. The underlying quantity and export code already supports it.

Review copied preparation instructions while editing affected recipes. The audit found poultry-temperature preparation text in some pork and shrimp recipes that conflicts with their own methods. Correct the recipe-specific instructions against suitable cooking sources during implementation.

## Change publication and browsing together

Use a single published-recipe selection at the server/build data boundary, retaining complete source records separately. Require every published recipe to pass `dietaryClass()` and have a shared-table note. This keeps initial cards, browse results, search, shuffle, detail packs, pages and exports consistent. A hidden checkbox alone cannot enforce the collection's promise.

Remove both Keto controls and retire `mealKetoOnly` and `smoothieKetoOnly` from default filters, persistence, query parsing, summaries and native forms. Ignore old stored or linked values. Preserve other useful filters and settings. The meal starch filter currently mixes base ingredients with optional sides; label it **Optional sides** only after its choices are backed by actual shared-table side metadata. Keep smoothie ingredient choices distinct.

Update page titles, descriptions, navigation copy, app name, manifest, agent-discovery text and shared resource descriptions. Preserve collection routes, recipe IDs and legacy anchors.

Existing offline saves are immutable older recipe bundles and survive app updates. Apply current keto eligibility to the saved-library list, including legacy summaries, so retired non-keto saves do not reappear in keto browsing. Preserve users' saved cooking data and let older direct saves identify themselves as an older version. New or refreshed saves must contain the revised recipe, note and matching runtime. An app-shell update does not update stored recipe ingredients.

| Work | Main implementation locations |
| --- | --- |
| Recipes, nutrition and units | `src/components/recipes/recipes.json`, `nutrition-data.json`, `ingredient-weights.json` |
| Published set and retirement handling | `recipe-data.server.mjs`, recipe page and pack routes, Markdown build and sitemap handling |
| Shared-table note | `RecipeContent.svelte`, `RecipeBody.svelte`, `recipe-export.mjs`, `recipe-search.mjs` |
| Side-diner count | `RecipePage.svelte`, `RecipeLibrary.svelte`, settings and URL modules |
| Filter removal | `LibraryControls.svelte`, `NativeRecipeControls.svelte`, `constants.mjs`, `nutrient-filters.mjs`, `recipe-browse.mjs`, `recipe-summary.mjs` |
| Names and descriptions | Recipe landing and collection pages, `RecipeCollectionPage.astro`, content constants, PWA manifest, `public/llms.txt` |
| Saved recipes | Saved-library selection, saved summaries and the existing offline bundle pipeline |

## Implement and verify

1. Establish the published-set invariant and retirement handling. Migrate the 15 adaptations with reviewed quantities, source evidence and reconciled nutrition. Keep any failed candidate unpublished.
2. Complete and validate calamari, then add shared-table notes to every published recipe. Add the side-diner control using the existing calculation model.
3. Rename the collections and app, remove both keto filters and migrate stale settings. Apply eligibility to every browsing and output path.
4. Regenerate assistant downloads with `npm run recipes:sync`, update the units audit with `node src/components/recipes/tools/audit-units.mjs --write`, and build canonical Markdown and offline bundles normally. Update recipe docs and affected count expectations.
5. Test no non-keto leaks through initial cards, pagination, search, shuffle, native forms, direct pages, JSON, Markdown, packs or saved browsing. Check retired links and stale preferences explicitly.
6. Verify changed ingredients, flow allocations, macros and measurements for 2, 4, 6 and 8 servings in Grams, Metric and US imperial. Check four base diners with a side for two, including print and shared URL round-trips.
7. Run `npm run recipes:check` and the full `npm run gate`. Verify desktop and mobile, keyboard and pointer, light and dark themes, no JavaScript, print and an existing offline installation. Recipe data and nutrition changes require the full gate before release.

The planning inventory can be rechecked without network access:

```bash
node src/components/recipes/tools/audit-keto-plan.mjs --check
```

After explicitly reviewing changed records, `--write` refreshes factual fields and this appendix. The script refuses missing, duplicate or inconsistent decisions. The inventory is a planning snapshot, not the runtime publication policy.

## Complete recipe review

The following table is generated from the detailed review. Net carbohydrates are per base meal serving or estimated 8 fl oz smoothie glass. **Adapt** and **Exclude** rows describe proposed revised or alternative meals; their current recipes do not qualify.

<!-- recipe-audit:start -->

| Recipe | Net carbs | Action | Shared-table suggestion |
| --- | ---: | --- | --- |
| Lemon salmon and asparagus | 3.33 g | keep | Serve the salmon and asparagus as written. Offer cooked rice in a separate bowl for diners who want a starch. |
| Smoky chicken thighs and broccoli | 5.78 g | keep | Plate the smoky chicken and broccoli for everyone, with baked potatoes served separately. Keep the lemon and nutritional yeast on the broccoli. |
| Pesto cod and zucchini | 4.87 g | keep | Serve the pesto cod and zucchini as written, with separately cooked pasta available for other plates. Keep the measured pesto on the fish rather than stretching it through the pasta. |
| Spinach, feta, and hemp frittata | 4.98 g | keep | Keep the full egg, feta and hemp frittata with its salad. Offer toast alongside individual non-keto plates. |
| Keto zuppa toscana | 6.15 g | keep | Keep cauliflower in the shared soup. Offer cooked potato pieces in a separate bowl to add only after each keto bowl has been served. |
| Shawarma chicken bowls | 7.87 g | keep | Set out chicken, cauliflower, cucumber, greens and the full yogurt sauce for everyone. Add the existing 80 g cooked-rice or 60 g pita option only to the diners who choose it. |
| Sheet-pan chicken fajitas | 7.13 g | keep | Build the keto plates as lettuce bowls with the chicken, avocado and yogurt. Offer the existing two corn tortillas per non-keto diner alongside, or fill them with part of that diner's bowl. |
| Salsa verde shredded chicken | 8.41 g | keep | Serve salsa verde chicken over the cabbage slaw with avocado. Add the existing 80 g cooked-rice option only to individual non-keto bowls. |
| Greek turkey patties | 5.45 g | keep | Keep both turkey patties, salad and yogurt sauce on each plate. Offer the existing pita or bun option separately, using a double-patty bun or serving the second patty alongside. |
| Tomato, lentil, and chicken bake | 18.25 g | exclude | For a future keto tomato-chicken bake, keep lentils in a separate warmed serving bowl and add them only to non-keto plates. The current mixed lentil bake cannot be separated after cooking. |
| Harissa chickpea and cauliflower bowls | 33.47 g | exclude | For a future keto harissa bowl, roast chickpeas separately and add them only to non-keto plates. Keep the full measured yogurt sauce rather than making it optional to lower carbs. |
| Lemon chicken, potatoes, and green beans | 28.05 g | adapt | Serve the revised lemon chicken and green beans to everyone. Microwave and roast the potatoes on their own tray and add them only to the plates that request them. |
| Sheet-pan gnocchi, white beans, and broccoli | 69.65 g | exclude | For a future keto vegetable-and-protein tray bake, cook gnocchi and white beans separately and spoon them onto non-keto plates. Keep any measured cheese in the keto nutrition model. |
| Pan-fried Greek turkey patties | 5.45 g | keep | Serve two pan-fried patties per person with cucumber, greens and lemon yogurt. Offer the existing pita or bun option only to non-keto diners, retaining both patties in their portion. |
| Avocado-lime smoothie | 5.23 g | keep | Blend the unsweetened avocado, cucumber, yogurt and flax base, then pour the keto glasses first. Blend banana into only the remaining portion for diners who want it. |
| Strawberry-avocado smoothie | 6.02 g | keep | Pour the strawberry-avocado keto glasses before making additions. Blend banana or oats into only the remaining smoothie for non-keto servings. |
| Strawberry-banana smoothie | 16.41 g | exclude | Use the existing keto strawberry-avocado smoothie as the shared base, pour its keto glasses first, then blend banana into the remaining non-keto portion. Keep this banana recipe out of the keto collection as written. |
| Banana-flax smoothie | 18.90 g | exclude | Use the existing keto avocado-lime smoothie with flax as the shared base, pour its keto glasses first, then blend banana into only the remaining non-keto portion. The current banana-flax blend cannot supply the keto base. |
| Strawberry-hemp smoothie | 5.94 g | keep | Blend the strawberry, hemp and unsweetened yogurt base, then pour the keto glasses first. Add banana or oats only to the remaining non-keto smoothie and blend again. |
| Cucumber-spinach-lime smoothie | 4.58 g | keep | Pour the cucumber-spinach-lime keto glasses first. Blend a peeled banana into only the remaining portion for diners who prefer a sweeter smoothie. |
| Chicken Posole (enchilada soup) | 25.88 g | exclude | If developed as a separate keto chicken enchilada soup, keep cooked beans in a serving bowl and add them only to non-keto bowls. The current posole has beans simmered into the shared pot. |
| One-pan keto green chili chicken | 4.05 g | keep | Serve the green chili chicken as written, with cooked rice or warmed tortillas in separate dishes. Spoon the chicken onto each plate before adding that diner's starch. |
| Honey Mustard Chicken Sheet Pan Dinner (keto + low carb) | 5.51 g | keep | Keep the sugar-free honey-mustard chicken and asparagus for everyone. Roast potatoes on a separate tray and offer them only to non-keto diners. |
| One Pan Cheesy Fajita Chicken (keto + low carb) | 6.33 g | keep | Serve the cheesy chicken and peppers as a bowl. Offer warmed tortillas alongside, keeping them out of the shared skillet. |
| Keto Jalapeño Chicken | 4.84 g | keep | Plate the jalapeno chicken with its measured cheese sauce. Put cooked rice in a separate serving bowl so each non-keto diner can add it to their own plate. |
| Keto Broccoli Cheddar Chicken | 9.56 g | keep | Keep the chicken, broccoli and cheese sauce together as written. Offer baked potatoes separately, with the casserole spooned onto the non-keto diner's potato only after plating. |
| Sesame Chicken Keto Stir Fry | 3.43 g | keep | Serve the sesame chicken and zucchini with the measured cashews and green onions. Offer cooked rice separately and spoon it only into non-keto bowls. |
| One Pan Mushroom Chicken (keto + low carb) | 3.01 g | keep | Plate the mushroom chicken with its Swiss and cream sauce. Offer separately cooked egg noodles for other diners, keeping them out of the shared sauce pan. |
| Keto Slow Cooker Zesty Ranch Chicken | 3.77 g | keep | Serve the ranch chicken and pepperoncini as written. Offer rolls for individual non-keto sandwiches, or cooked rice in a separate bowl. |
| Skillet Creamy Lemon Chicken with Cauliflower | 5.04 g | keep | Keep the chicken and measured cauliflower in the shared lemon sauce. Offer separately cooked rice for other diners to add to their own plates. |
| Creamy Buffalo Chicken Cauliflower Casserole | 9.35 g | keep | Bake the chicken-and-cauliflower casserole as written. Serve tortilla chips separately for non-keto diners rather than baking a crumb topping over the whole dish. |
| Keto Butter Chicken (Family Favorite) | 6.82 g | keep | Serve the butter chicken sauce as written. Offer cooked basmati rice and naan separately for non-keto diners; any cauliflower-rice accompaniment also needs its own measured serving if included in the keto meal. |
| Greek Chicken Marinade Sheet Pan Dinner | 7.13 g | keep | Keep the Greek chicken, peppers and zucchini on the shared tray. Offer warm pita separately so non-keto diners can build wraps at their plates. |
| Easy Creamy Chicken Marsala Recipe | 6.75 g | keep | Serve the chicken and mushroom Marsala sauce as written. Offer separately cooked pasta or mashed potatoes for non-keto plates, keeping the starch out of the shared sauce. |
| Chicken Taco Casserole | 6.18 g | keep | Bake the taco chicken casserole as written. Offer tortilla chips or warmed tortillas at the table so non-keto diners can assemble their own portions. |
| Cheesy Chicken Zucchini Boats Recipe | 5.93 g | keep | Keep the measured chicken filling in the zucchini boats. Offer garlic bread alongside individual non-keto plates rather than replacing the zucchini in the shared bake. |
| Asparagus Stuffed Chicken (low carb + keto) | 2.98 g | keep | Keep the cheese-and-asparagus filling inside every chicken breast. Offer roasted potatoes from a separate tray for non-keto plates. |
| Crockpot Shredded Chicken | 1.20 g | keep | Serve the shredded chicken as written. Put rolls, tortillas and any additional sauces in separate dishes so each diner can assemble a sandwich or wrap after the chicken has been portioned. |
| Cheesy Chicken Enchilada Soup | 7.42 g | keep | Keep the enchilada soup base as written. Offer cooked rice and tortilla strips separately, adding them only to individual non-keto bowls. |
| Bacon Wrapped Chicken with Avocado Salsa | 3.01 g | keep | Serve the bacon-wrapped chicken with its measured avocado salsa. Offer cooked rice separately, keeping salsa and chicken portions intact on every plate. |
| Jalapeño Popper Stuffed Chicken Breast | 2.52 g | keep | Keep the jalapeno, bacon and cheese filling inside the chicken. Offer mashed potatoes separately for non-keto plates. |
| Perfect Roast Chicken | 5.20 g | keep | Carve and portion the roast chicken as written. Roast potatoes in a separate pan and serve them only on the plates that want them. |
| Jalapeno Popper Chicken Skillet (keto + low carb) | 3.53 g | keep | Serve the creamy jalapeno chicken as written. Offer warmed tortillas or rolls separately so non-keto diners can assemble their own wraps or sandwiches. |
| Cajun Chicken Sausage and Cabbage Skillet | 6.93 g | keep | Keep the Cajun chicken, sausage and cabbage together in the skillet. Offer cooked rice separately and add it only after individual portions have been served. |
| Spinach Artichoke Stuffed Chicken (low carb + keto) | 3.93 g | keep | Keep the spinach, artichoke and measured cheese filling inside the chicken. Offer separately cooked pasta or garlic bread for non-keto plates. |
| Broccoli and Cheese Stuffed Chicken Breasts | 2.25 g | keep | Serve the broccoli-and-cheese stuffed chicken as written. Offer baked potatoes separately for diners who want them. |
| Chicken Cheesesteak Skillet | 6.15 g | keep | Serve the cheesy chicken, peppers and mushrooms in bowls. Offer hoagie rolls separately so non-keto diners can fill their own sandwiches without adding bread to the skillet. |
| Keto Asian Chicken Lettuce Wraps | 4.70 g | keep | Set out the chicken filling, lettuce leaves, measured almonds and green onions separately. Keto diners use the lettuce wraps; other diners can spoon their filling over separately cooked rice. |
| Cabbage Casserole with Ground Beef | 7.01 g | keep | Keep the beef, cabbage and tomato casserole as written. Offer cooked rice separately and add it only to individual non-keto bowls. |
| Keto Cheeseburger Casserole Skillet | 5.10 g | keep | Serve the cheeseburger skillet as written. Offer buns and fries separately so non-keto diners can assemble their own plates without mixing bread into the shared skillet. |
| Steak and Eggs (keto + low carb) | 8.06 g | keep | Serve the steak and eggs as written; put toast or breakfast potatoes in a separate dish for diners who want them. |
| Steak Rolls | 5.02 g | keep | Keep the steak rolls filled with the listed vegetables. Offer cooked rice separately so each diner can add it to their own plate. |
| Keto Beef Stroganoff | 3.91 g | keep | Serve the beef and mushroom sauce as written. Offer cooked egg noodles separately and add them only to individual non-keto plates. |
| The BEST Keto Chili Recipe | 8.82 g | keep | Keep the chili bean-free. Set out heated beans, rice, and tortilla chips separately for individual bowls. |
| Keto Italian Meatballs | 6.21 g | keep | Keep pork-rind panko in the shared meatball batch. Serve cooked spaghetti separately for diners who want it, and measure any marinara added to keto plates. |
| Low Carb Taco Casserole | 13.49 g | adapt | Serve the adapted taco cabbage skillet as a bowl. Put tortillas or tortilla chips beside it for diners to add to their own portions. |
| One Pan Keto Philly Cheesesteak | 4.63 g | keep | Serve the cheesesteak mixture in bowls for keto diners and spoon it into separate toasted rolls for other diners. |
| Cabbage with Sausage Foil Packs | 8.66 g | keep | Keep the sausage and cabbage packets as written. Cook potatoes separately and add them only to plates after the packets are opened. |
| Zuppa Toscana | 4.28 g | keep | Keep radishes in the shared soup. Offer cooked potato pieces separately for individual non-keto bowls, with bread on the side. |
| Roasted Brussel Sprouts and Kielbasa | 9.00 g | keep | Serve the roasted sprouts and kielbasa together, with potatoes roasted on a separate tray for diners who want a starch. |
| Pan Seared Pork Chops with Creamy Pan Gravy and Garlicky Green Beans | 6.31 g | keep | Plate the pork chops with their cream gravy and green beans. Offer mashed potatoes from a separate bowl for other diners. |
| Keto Sausage Veggie Sheet Pan Dinner | 8.75 g | keep | Keep the sausage, broccoli, and peppers on the shared sheet pan. Serve cooked rice separately for diners to add at the table. |
| Cheesy Sausage Soup | 6.81 g | keep | Ladle the cheesy sausage soup into bowls and offer bread or crackers separately; keep them out of the shared pot. |
| Sausage Broccoli Cheddar Sheet Pan | 12.05 g | keep | Serve the sausage, broccoli, and cheddar as written, with cooked rice in a separate bowl for non-keto plates. |
| Fried Cabbage with Bacon (keto + low carb) | 3.77 g | keep | Serve the bacon and cabbage as written. Offer mashed potatoes separately for diners who want them. |
| Keto Lasagna Recipe (low carb + one pan) | 7.88 g | keep | Keep the zucchini skillet lasagna noodle-free. Serve garlic bread separately for diners who want a carby accompaniment. |
| Sausage Sheet Pan Dinner | 9.05 g | keep | Serve the sausage links and green beans as written; offer separate rolls so other diners can make sausage sandwiches. |
| Keto Sesame Pork and Green Beans | 4.88 g | keep | Keep the sesame pork and green beans together. Serve cooked rice separately and spoon it only onto non-keto plates. |
| Grilled Shrimp Skewers | 2.42 g | keep | Serve the shrimp skewers as written. Offer cooked rice or pita separately for diners who want a starch. |
| Lemon Garlic Shrimp and Broccolini Sheet Pan Meal | 5.64 g | keep | Plate the shrimp and broccolini directly for keto diners. Offer cooked orzo separately for other diners. |
| Grilled Salmon Kabobs with Greek Marinade | 5.52 g | keep | Keep the salmon, zucchini, and onion skewers as written. Offer pita or rice in separate serving dishes. |
| Sheet Pan Butter Dill Salmon with Asparagus | 2.57 g | keep | Serve the salmon and asparagus with the listed dill butter. Roast potatoes on a separate tray for diners who want them. |
| Cilantro Lime Shrimp and Cauliflower Rice (keto + low carb) | 7.51 g | keep | Keep the cauliflower rice and shrimp in their separate pans until plating. Offer a separate pot of ordinary rice for non-keto bowls. |
| Lobster Bisque (low carb + keto) | 6.50 g | keep | Serve the lobster bisque as written and offer crusty bread separately for dipping; keep croutons out of the shared pot. |
| Salmon with Jalapeño Lime Butter (keto + low carb) | 0.58 g | keep | Serve the salmon with its measured jalapeno-lime butter. Offer cooked rice separately for other plates. |
| Keto Shrimp and Broccoli Recipe | 5.37 g | keep | Keep the shrimp and broccoli stir-fry as written. Offer cooked rice in a separate bowl for non-keto diners to add to their own portions. |
| Keto Parmesan Tilapia and Asparagus for One | 5.03 g | keep | Keep the Parmesan-topped tilapia and asparagus in the shared baking dish. Offer potatoes cooked separately for non-keto plates. |
| Keto Cajun Shrimp | 2.30 g | keep | Serve the creamy Cajun shrimp as written. Offer cooked rice separately for non-keto diners to add to their own plates. |
| Creamy Chicken Breast in Spinach Parmesan Sauce | 15.49 g | adapt | Serve the revised spinach Parmesan chicken and sauce as written. Offer cooked pasta separately and add it only to individual non-keto portions. |
| One Pan Shrimp and Asparagus | 8.08 g | keep | Keep the shrimp and asparagus in the shared skillet. Serve cooked rice separately for diners who want it beneath their portion. |
| Blackened Shrimp and Asparagus Skillet (20 Minutes) | 6.55 g | keep | Plate the blackened shrimp and asparagus as written. Offer cooked rice separately, with hot sauce at the table for individual heat preferences. |
| Lemon Garlic Butter Chicken and Green Beans Skillet | 10.61 g | keep | Serve the chicken and green beans directly on keto plates, with cooked potatoes in a separate dish for other diners. |
| Garlic Butter Chicken Bites with Lemon Asparagus | 5.90 g | keep | Plate the chicken bites and asparagus with their lemon butter sauce. Offer cooked pasta separately for non-keto plates. |
| Creamy Tuscan Salmon Recipe | 18.63 g | adapt | Serve the adapted Tuscan salmon and spinach directly on keto plates. Offer cooked pasta separately so other diners can spoon their fish and sauce over it. |
| Lemon Garlic Steak and Broccoli Skillet | 9.51 g | keep | Keep the steak and broccoli in their boiled-and-reduced marinade sauce. Serve cooked rice separately for individual non-keto portions. |
| One-Pan Sausage Veggies | 32.07 g | exclude | Use an existing keto sausage and vegetable recipe as the shared base. Cook this recipe’s peas and carrots separately for diners to add to their plates. |
| Garlic Butter Steak Bites with Lemon Zucchini Noodles | 7.28 g | keep | Keep zucchini noodles in the shared steak dish. Cook pasta separately, then add it only to individual non-keto servings. |
| 15-Minute Lemon Garlic Butter Steak with Zucchini Noodles | 9.02 g | keep | Keep the steak with its zucchini noodles as written. Offer cooked pasta separately so diners can add it to their own plates. |
| Garlic Butter Shrimp and Broccoli Skillet | 12.03 g | keep | Serve the shrimp and broccoli as written, with cooked rice in a separate bowl for diners who want it. |
| Sheet Pan Shrimp Fajitas | 4.31 g | keep | Serve the shrimp and peppers in bowls for keto diners. Set out warm tortillas separately so other diners can assemble fajitas. |
| Garlic Butter Cod with Lemon Asparagus Skillet | 4.96 g | keep | Plate the cod and asparagus with their lemon butter sauce. Offer rice separately for non-keto plates. |
| Asado Chicken Breast with Sauteed Lemon Zucchini | 6.09 g | keep | Serve sliced asado chicken over its lemon zucchini. Put cooked rice or tortillas in separate dishes for other diners. |
| Garlic Butter Chicken Bites with Zucchini Noodles | 9.03 g | keep | Keep the chicken bites with zucchini noodles in the shared skillet. Offer cooked pasta separately for non-keto diners to add after serving. |
| Lemon Garlic Butter Baked Cod Fillets | 2.05 g | keep | Serve the baked cod with its measured lemon-butter sauce. Offer bread or rice separately for diners who want it. |
| Lemon Garlic Butter Shrimp with Zucchini Noodles | 7.08 g | keep | Keep the shrimp and zucchini noodles together. Cook spaghetti separately and add it only to individual non-keto portions. |
| Creamy Cajun Shrimp with Sausage | 15.18 g | adapt | Serve the revised creamy shrimp and sausage as written. Offer cooked rice separately for non-keto diners to add to their own bowls. |
| Garlic Butter Shrimp with Lemon Parmesan Cauliflower Rice | 13.00 g | adapt | Keep the adapted Parmesan cauliflower rice as the shared base. Offer ordinary cooked rice separately and add it only to individual non-keto portions. |
| Cheesy Garlic Burgers with Lemon Butter Zucchini Noodles | 8.25 g | keep | Keep the cheese-filled burgers and zucchini noodles as written. Set out buns separately so other diners can assemble burgers. |
| Garlic Butter Ground Turkey with Cauliflower | 7.25 g | keep | Serve the turkey and cauliflower as written. Offer cooked rice separately for diners to add under their individual portions. |
| Garlic Butter Chicken with Cauliflower Rice | 9.80 g | keep | Serve the Parmesan-coated chicken and cauliflower rice as written. Offer cooked rice separately for non-keto diners without mixing it into the skillet. |
| Garlic Butter Pork Bites with Lemon Green Beans | 7.84 g | keep | Serve the lemon-garlic pork and green beans to everyone. Offer mashed potatoes in a separate bowl for non-keto diners. |
| Garlic Butter Salmon with Lemon Asparagus | 8.92 g | keep | Keep salmon and asparagus as the shared meal. Add cooked rice only to the plates of diners who want it. |
| Lemon Garlic Butter Salmon with Zucchini Noodles | 6.90 g | keep | Cook pasta separately and add it only to non-keto plates after the salmon and zucchini noodles are portioned. |
| Lemon Garlic Butter Steak with Spinach | 14.64 g | adapt | Serve the revised steak and spinach base to everyone, with cooked rice in a separate bowl for non-keto plates. |
| Cowboy Butter Chicken with Zucchini Noodles (15-Minute) | 6.62 g | keep | Keep the zucchini noodles in the shared skillet. Offer separately cooked spaghetti for non-keto diners to add to their own plates. |
| Creamy Garlic Pesto Chicken | 10.48 g | keep | Serve the creamy pesto chicken and peppers to everyone. Offer crusty bread separately for diners who want to mop up the sauce. |
| Garlic Herb Butter Chicken Thighs with Asparagus | 4.54 g | keep | Serve the chicken thighs and asparagus as the shared base. Roast potatoes separately for the diners who want a starchy side. |
| Easy Chicken Fajitas | 7.14 g | keep | Serve the seasoned chicken and peppers as a skillet plate for keto diners. Put warm tortillas on the table for others to fill individually. |
| Easy Cajun Pork Chops with Lemon Garlic Zucchini | 15.23 g | adapt | Serve the revised Cajun pork and zucchini to everyone. Put cooked rice in a separate serving bowl for non-keto diners. |
| Creamy Fajita Chicken Breasts Skillet | 11.90 g | keep | Keep the creamy chicken and peppers in the shared pan. Offer rice or warm tortillas separately so each non-keto diner can add their own. |
| Cheesy Turkey Meatballs with Cauliflower Rice | 10.89 g | keep | Keep the cheese filling and cauliflower rice in the base recipe. Offer cooked rice separately for non-keto diners rather than stirring it into the shared cauliflower pan. |
| Fried Cabbage with Sausage | 13.61 g | adapt | Serve the revised sausage and cabbage from the shared skillet. Offer bread rolls separately for non-keto diners. |
| Tomato Spinach Chicken Skillet (Low Carb - Keto) | 8.10 g | keep | Serve the cheesy tomato-spinach chicken as the shared meal. Offer separately cooked pasta for non-keto plates after the chicken and sauce are portioned. |
| Paprika Chicken Thighs with Lemon Zucchini Skillet | 6.36 g | keep | Keep the paprika chicken and lemon zucchini as the shared meal. Offer roasted potatoes cooked in a separate pan for non-keto diners. |
| Garlic Butter Sausages and Broccoli Skillet | 10.91 g | keep | Serve the sausages with broccoli to everyone. Put bread rolls on the table so non-keto diners can make their own sausage sandwich. |
| Garlic Butter Pork with Lemon Asparagus | 6.21 g | keep | Serve the pork and lemon asparagus as the shared base. Offer cooked rice separately for non-keto diners to spoon sauce over on their own plates. |
| Lemon Garlic Butter Chicken and Zucchini Noodles Skillet | 7.19 g | keep | Keep the zucchini noodles in the shared chicken skillet. Cook pasta separately and add it only to the plates of diners who want it. |
| 10-Minute Sheet Pan Steak with Lemon Zucchini | 7.41 g | keep | Serve the broiled steak and zucchini to everyone. Cook potatoes separately for non-keto diners, allowing their cooking time independently of the short broiler stage. |
| Creamy Garlic Shrimp with Spinach (10-Minute) | 9.10 g | keep | Portion the creamy shrimp and spinach first. Add separately cooked pasta only to non-keto plates so no pasta enters the shared sauce pan. |
| Lemon Garlic Butter Chicken Tenders Recipe | 7.95 g | keep | Keep the chicken tenders and green beans as the shared meal. Serve mashed potatoes in a separate bowl for non-keto diners. |
| Parmesan Chicken Casserole and Cauliflower Steaks | 5.90 g | keep | Serve the chicken and cauliflower casserole to everyone. Offer garlic bread separately instead of adding bread or crumbs to the shared casserole. |
| Creamy Ground Beef and Cauliflower Rice Casserole | 8.40 g | keep | Keep the beef and cauliflower-rice casserole as the shared base. Offer bread separately for non-keto diners, leaving the measured casserole unchanged. |
| 15-Minute Broccoli Chicken in Cream Cheese Sundried Tomato Sauce | 7.60 g | keep | Serve the chicken and broccoli from the shared skillet. Offer separately cooked pasta for diners to add to their own plates. |
| Chicken Burrito Bowls with Cauliflower | 8.12 g | keep | Keep the cauliflower-rice chicken bowls as the shared base. Set cooked rice and black beans out separately for non-keto diners to add to their own bowls. |
| Italian Sausage with Cilantro Lime Cauliflower Rice | 13.49 g | adapt | Keep cauliflower rice for everyone and offer cooked rice in a separate bowl for non-keto diners. Put extra hot sauce on individual plates. |
| Garlic Butter Turkey Meatballs with Zucchini Noodles | 7.82 g | keep | Cook pasta separately for non-keto diners and spoon their meatballs over it. Keep the zucchini noodles and remaining meatballs in the shared keto pan. |
| 10-Minute Pizza Zucchini Noodles with Marinara Sauce & Pepperoni | 7.62 g | keep | Offer cooked pasta separately and add it only to non-keto bowls. Serve extra pepperoni, Parmesan and chili flakes at the table without mixing pasta into the zucchini pan. |
| Egg Roll Bowls with Chicken and Cabbage | 8.90 g | keep | Serve steamed rice and crisp wonton strips in separate bowls for non-keto diners to add after serving. Keep the chicken-cabbage mixture common to every bowl. |
| Garlic Butter Sausages with Lemon Green Beans | 11.17 g | keep | Offer crusty rolls beside the sausage and beans for non-keto diners. Keep rolls out of the skillet and let each person spoon over their own lemon-garlic sauce. |
| Mexican Cauliflower Rice with Cheesy Steak Roll-Ups | 9.57 g | keep | Offer cooked rice or tortillas separately for non-keto diners. Plate the same steak rolls with cauliflower rice for keto diners and add the starch only after serving. |
| Sausage Taco Cauliflower Rice Skillet | 16.34 g | adapt | Keep a revised keto sausage-cauliflower mixture in the shared skillet. Offer tortillas, cooked rice and beans separately so non-keto diners can build their own bowls. |
| Buttery Garlic Herb Chicken and Lemon Parmesan Cauliflower Rice | 6.61 g | keep | Offer a separate bowl of cooked rice or a crusty roll to non-keto diners. Keep the shared chicken and cauliflower rice unchanged and let each person add starch to their own plate. |
| Garlic Butter Steak and Green Beans | 11.32 g | keep | Serve roasted potatoes separately for non-keto diners. Plate the same rested steak, green beans and boiled marinade sauce for everyone before adding potatoes. |
| Taco Chicken Tenders with Lemon Garlic Butter Zucchini Noodles | 8.38 g | keep | Offer warm tortillas separately so non-keto diners can make chicken wraps. Keep zucchini noodles and the lemon-butter sauce in the shared pan; add extra hot sauce per plate. |
| Garlic Butter Herb Pork Chops with Zucchini | 5.47 g | keep | Serve mashed potatoes in a separate dish for non-keto diners. Spoon the same herb-butter pan juices over each pork chop and keep potatoes out of the zucchini skillet. |
| One-Pan Lemon Butter Chicken with Asparagus | 47.51 g | adapt | Prepare a revised unsweetened lemon-butter sauce for everyone. Serve rice separately, and offer honey only as a measured addition to individual non-keto plates. |
| Italian Sausage and Peppers Skillet | 12.76 g | adapt | Serve sausage, peppers and the revised tomato sauce to everyone. Offer toasted sandwich rolls separately for non-keto diners to fill at the table. |
| Beef and Cauliflower Rice Burrito Bowl | 12.10 g | keep | Offer cooked rice, black beans and tortilla chips separately for non-keto diners. Divide the recorded garnishes between bowls and add the starches only after the keto portions are served. |
| Stuffed Chicken Breast with Mozzarella and Spinach | 15.75 g | adapt | Use a revised tomato sauce without added sugar around the shared stuffed chicken. Offer pasta separately for non-keto diners and spoon sauce onto their individual plates. |
| Sausage, Pepper and Cauliflower Fried Rice | 9.07 g | keep | Cook regular rice separately and stir it only into non-keto diners' individual portions. Keep the common sausage, peppers and cauliflower mixture in its original pan. |
| Creamy Chicken with Bacon and Spinach | 8.88 g | keep | Offer pasta or bread separately for non-keto diners. Serve chicken with the same creamy spinach sauce to everyone and spoon pasta into individual plates only. |
| Sheet Pan Garlic Butter Chicken and Asparagus | 8.28 g | keep | Serve roasted potatoes on a separate tray for non-keto diners, and plate them separately from the chicken and asparagus. Keep the measured butter mixture as written when using the current nutrition estimate. |
| Grilled Bruschetta Chicken | 13.35 g | adapt | Serve the same chicken, tomato-basil topping and pine nuts to everyone. Keep the sweet balsamic glaze in a separate jug for individual non-keto plates, with bread served alongside. |
| Garlic Lemon Chicken Breasts with Green Beans | 6.84 g | keep | Serve cooked rice separately for non-keto diners to catch the lemon pan sauce. Plate chicken and beans first, then add rice only to those plates. |
| Basic Keto Chaffle Recipe | 1.09 g | keep | Use the chaffles as a shared savory side and offer regular toast separately to non-keto diners. Put sandwich fillings on the table so each person can assemble a chaffle or bread sandwich. |
| Keto crack chicken (slow cooker) | 4.31 g | keep | Serve the chicken with its recorded bacon and scallion portions. Offer sandwich rolls separately so non-keto diners can assemble their own sandwiches. |
| Carrot cake | 60.70 g | exclude | Keep this existing cake outside the keto collection. If a separate keto carrot cake is later developed, offer fruit or regular sweet frosting separately for non-keto diners to add to individual slices. |

<!-- recipe-audit:end -->
