# Recipe image style and contract

Every recipe in `src/components/recipes/recipes.json` needs a food illustration
that matches its ingredients and finished dish. This applies to household meals,
imported recipes and smoothies. Images belong in `public/recipes/media`; publisher
photos and remote image URLs are not used.

## Visual reference

The reference is
[`lemon-chicken-potatoes-and-green-beans-960.webp`](../public/recipes/media/lemon-chicken-potatoes-and-green-beans-960.webp).
It establishes style version `warm-overhead-v1`:

- A close overhead view of the finished food, with the dish filling most of a
  horizontal 4:3 frame. Keep the food and vessel inside the crop.
- Warm, soft daylight and gentle shadows. Preserve natural ingredient colors,
  browned edges and visible food texture.
- A matte off-white ceramic plate or bowl on a pale limestone tabletop. Keep
  props sparse. Smoothies can use a clear glass on an off-white ceramic saucer.
- Photorealistic food illustration with restrained styling. No text, logos,
  watermarks, hands, collage panels or unrelated garnishes.

Read the recipe before generating its image. Show the correct protein, cut,
vegetables, sauce and preparation. A stuffed breast, shredded chicken, whole
roast bird and chicken thighs need different compositions. Show only ingredients
or accompaniments included in the depicted recipe. For recipes with optional sides, depict
the base meal and keep the optional starch separate.

Use the reference image when generating a new illustration. A reusable prompt
starting point is:

> Create a photorealistic food illustration of [finished dish and its defining
> ingredients], matching the attached lemon-chicken reference. Close overhead
> composition, horizontal 4:3 frame, matte off-white ceramic serving vessel,
> pale limestone tabletop, warm soft daylight, gentle shadows and natural food
> texture. Keep the vessel and food inside the frame. Sparse props, no text,
> logos, hands or unrelated food.

The [saved illustration prompts](../public/recipes/media/illustration-prompts.json)
record the built-in image generation tool, reference, full prompt and alt text for
each newly generated asset. Use these dish descriptions as examples when adding
a recipe.

Replace the bracketed description with the actual recipe. Inspect the result for
ingredient accuracy, cooking state, composition and the reference's lighting and
palette. Metadata alone cannot prove that an image matches this style.

## Asset and metadata contract

Export one approved composition as three static WebP files. All three must use
the same 4:3 crop:

| Use | Filename suffix | Pixel dimensions |
| --- | --- | --- |
| Small card | `-480.webp` | 480 × 360 |
| Default detail | `-960.webp` | 960 × 720 |
| Large detail | `-1440.webp` | 1440 × 1080 |

Use a lowercase filename stem containing letters, digits and hyphens. Larger
exports must come from a source large enough for 1440 pixels; do not enlarge the
480-pixel card to create detail assets. Closely related recipes may share an
approved image only when their depicted food is the same, as with the two Greek
turkey-patty cooking methods.

Each canonical recipe's `image` object follows this example:

```json
{
  "src": "/recipes/media/lemon-chicken-potatoes-and-green-beans-960.webp",
  "width": 960,
  "height": 720,
  "cardSrc": "/recipes/media/lemon-chicken-potatoes-and-green-beans-480.webp",
  "cardSrcset": "/recipes/media/lemon-chicken-potatoes-and-green-beans-480.webp 480w, /recipes/media/lemon-chicken-potatoes-and-green-beans-960.webp 960w",
  "detailSrcset": "/recipes/media/lemon-chicken-potatoes-and-green-beans-480.webp 480w, /recipes/media/lemon-chicken-potatoes-and-green-beans-960.webp 960w, /recipes/media/lemon-chicken-potatoes-and-green-beans-1440.webp 1440w",
  "alt": "Illustration of lemon-oregano chicken, roasted baby potatoes and green beans.",
  "caption": "AI-generated illustration; appearance and portions are approximate.",
  "styleVersion": "warm-overhead-v1"
}
```

Write alt text for the depicted dish, naming its defining foods and their visible
preparation. Do not use generic descriptions such as "recipe image", repeat the
style prompt, or claim a photograph of a tested meal. The caption metadata records that
the image is generated and that portions are approximate; the browser omits this metadata caption. Shared-main captions
may append `Keto base shown; family starch is separate.`

When adding or replacing an image, update the files and metadata together, then
regenerate the assistant downloads. Inspect card and detail
views on desktop and mobile, including the actual responsive image selected by
the browser. Check printed and exported attribution after regeneration.

The Node contract test checks every canonical recipe for local asset paths,
supported style version, dish-specific alt text, the illustration caption,
responsive candidates and actual WebP dimensions. It also rejects stale SVG
metadata. Existing vector placeholders must be replaced, not exempted.

Run from `/Users/johnsolly/code/jsolly-website`:

```bash
node --test src/components/recipes/recipe-images.test.mjs
```

The test is also included by `npm test`. It does not replace visual
review. A future style change needs a new documented version and an explicit
supported-version update in the test; new recipes continue using the approved
version until that change is reviewed.
