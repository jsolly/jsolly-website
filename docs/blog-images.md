# Blog image migration

The migrated article images live in `public/blog/media/migrated/`. The runtime
map in `src/lib/blog/image-variants.json` supplies their intrinsic dimensions
and responsive candidates for hero images, article bodies and cards. PagesCMS
uploads still use their authored root-relative paths.

The one-time migration records each original CloudFront URL, original SHA-256,
size and dimensions in `blog-image-migration.json`, together with every output's
SHA-256, dimensions, byte size, animation frame count and duration. The receipt
retains provenance even though article image sources now point to this site.
Original AWS objects and infrastructure remain retained. This migration does
not authorize retiring their bucket, distribution or backup resources.

Run the integrity and coverage check without network access or image tools:

```bash
python3 scripts/blog/migrate-images.py --check
```

To reproduce the initial conversion in an unmodified pre-migration checkout,
install curl, ImageMagick 7 and Inkscape, then supply an external original-image cache:

```bash
python3 scripts/blog/migrate-images.py --write --cache /absolute/external/cache
```

The command inherits the session proxy and CA trust, accepts only the inventoried
HTTPS CloudFront media sources and downloads all originals before rewriting any
post. It corrects orientation and preserves aspect ratio and animation timing.
WebP candidates use quality 82 and widths 480, 960 and 1440, capped at the source
width to avoid enlarging screenshots. WebP may combine duplicate animation
frames while retaining the complete duration. Output filenames include the
original content digest. A completed run is idempotent: later `--write` calls
verify the existing outputs and do not download, rewrite or recompress them.

The normal build does not require ImageMagick or network access. Unit coverage
checks the committed receipt, file bytes, canvases, animation timing, runtime
map and complete authored-image inventory. The built-site contracts additionally
check the emitted article and card images under the same-origin CSP.
