# Common-material final addendum

The stale-preview gap from `keto-review-wave2.md` is closed. Acceptance bar 10 is met for the local publication package. No required common-material correction remains from this review.

I inspected the actual refreshed `preview-verification.json` and independently calculated SHA-256 hashes for the current Markdown, article HTML, JSON patch, and preview. All four match the receipt's hashes. I separately checked that `post-update.json.body` exactly equals `article-body.html`, that this body is present in `preview.html`, and that the patch preserves `15-minute-dump-and-go-instant-pot-recipes`. The removed draft-history sentence is absent from the current Markdown. The old black-bean add-on is absent from the current HTML.

I visually inspected all six refreshed screenshots, including desktop and mobile overview, salsa-chicken recipe, and chicken-lentil bake. Text is readable at both widths with no clipped lines or overlapping elements. The salsa screenshots now show the actual final 15-minute hands-on estimate, 40–45-minute expected total, 124 g salsa added after cooking, 454 g plain cabbage, measured avocado/yogurt, and 80 g cooked-rice family add-on. This directly closes the prior stale-screenshot finding. Both bake screenshots show the final recipe and omit the draft-history sentence.

The refreshed receipt records 12 recipes, no broken anchors, no duplicate IDs, no page overflow, and no console errors at 1280×900 and 390×844. It records recipe-anchor navigation and mobile table scrolling. Those interaction outcomes are lead-executed verification evidence; I did not independently rerun the browser. The artifact hashes and actual screenshots support accepting the receipt for the current package rather than a prior draft.

I also read the revised manufacturer dossier. Its final-recipe arithmetic now matches the actual 454 g gnocchi, 30 g harissa, 124 g salsa, and 45 g pesto quantities. Pesto contributes 3 g net per four-serving batch, or 0.75 g per person, correctly derived from the 30 g label. The dossier's source-label descriptions and conservative protein/fiber assumptions remain consistent with the prior review. No recipe formula or setting change in this addendum invalidates the independent keto macro calculations.

The local package is reviewable and ready for migration. This disposition does not claim the new Astro application's rendering or live publication was tested, and it does not claim the recipes were cooked. Those limits remain explicit in the receipt and article.
