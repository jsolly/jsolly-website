# Recipe collection before keto migration

These three JSON files preserve the complete recipe, nutrition and measurement
registries from commit `6cd3c11cbff493cfbfaebc4f48a283069fb5412e` before the
2026-10-23 keto collection migration. Their bytes match the original files.

The snapshot contains all 147 original recipes, including the eight excluded
versions and the 15 recipes adapted for the keto collection. It preserves
publisher claims, prior cooking instructions and ingredient observations for
review. These records are not published recipe data.

`src/components/recipes/tools/migrate-keto-collection.mjs` reads these immutable inputs and
the reviewed plan and calamari source to reproduce the current registries.
Keep this snapshot unchanged. Revise the current data and the migration decisions
when correcting a recipe, and retain the original evidence here.
