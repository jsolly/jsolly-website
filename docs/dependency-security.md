# Dependency security assessment

Reviewed on 2026-10-11 against the repository's Dependabot alerts and installed
dependency consumers. Package scope labels alone do not establish runtime exposure.

## Patched dependencies

The security update addresses these six alerts in `package-lock.json`:

| Alert | Package | Patched minimum | Dependency path |
| --- | --- | --- | --- |
| [#57](https://github.com/jsolly/jsolly-website/security/dependabot/57) | source-map-js | 1.2.2 | Astro/Vite/PostCSS, Tailwind, sanitizer CSS parsing, shadcn tooling and jsdom |
| [#60](https://github.com/jsolly/jsolly-website/security/dependabot/60) | sharp | 0.35.5 | Astro image generation |
| [#42](https://github.com/jsolly/jsolly-website/security/dependabot/42) | markdown-it | 14.3.1 or 15.0.1 | markdownlint-cli2 |
| [#59](https://github.com/jsolly/jsolly-website/security/dependabot/59) | smol-toml | 1.9.0 | Astro/frontmatter helpers, Knip, markdownlint-cli2 and Vercel tooling |
| [#41](https://github.com/jsolly/jsolly-website/security/dependabot/41) | js-yaml | 5.4.1 on the 5.x line | markdownlint-cli2's nested copy; Astro's 4.3.2 is outside this advisory's range |
| [#58](https://github.com/jsolly/jsolly-website/security/dependabot/58) | KaTeX | 0.18.2 | markdownlint-cli2 → markdownlint → micromark-extension-math |

`markdownlint-cli2` 0.23.3 supplies patched markdown-it and js-yaml. The smol-toml
override sets a patched minimum across its consumers. The KaTeX override is scoped
to micromark-extension-math because its current 3.1.0 release still requests the
vulnerable 0.16 line. Prefer removing that override when the parent accepts a
patched KaTeX release. The source-map-js and sharp updates fit their parent ranges.

## Open http-cache-semantics alert

Keep [Dependabot #56](https://github.com/jsolly/jsolly-website/security/dependabot/56)
open. [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp),
CVE-2026-93748, affects http-cache-semantics through 4.2.0; no patched release was
listed when reviewed. The lockfile retains 4.2.0 through Astro 7.3.5.

The advisory describes disclosure from a shared response cache containing sensitive
responses, including session cookies, when an attacker sends a large `max-stale`
directive. Astro's installed `dist/assets/build/remote.js` uses the package to
calculate expiry for downloaded build images through `storable()` and
`timeToLive()`. It creates its own image requests and conditional revalidation
headers. It does not forward visitors' cache directives, call the shared-cache
response-serving methods, or serve cached session headers to visitors.

This site builds static pages. Its `middleware.ts` import chain negotiates HTML
and static Markdown responses and does not import Astro's image cache or this
package. The recipe service worker uses browser Cache Storage independently.
No reachable path for the advisory's cross-user disclosure was found in the
inspected application. This is a source-based exposure assessment, not a claim
about Vercel's internal caching implementation or a deployed-bundle audit.

Reassess when Astro or http-cache-semantics changes, or before introducing SSR,
authenticated image fetching, a response proxy, or shared user-response caching.
Adopt an upstream patch or a parent release that removes the affected dependency
when available; do not dismiss the alert or force an unrelated package version.

## Additional npm audit findings

The same audit also identified
[fast-uri host normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj),
which is patched by refreshing its compatible 3.x lockfile resolution to 3.1.8
or later, and
[braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
CVE-2026-93687, which has no published patch through braces 3.0.3.

braces enters through micromatch/fast-glob in file-discovery and CLI tooling,
including markdownlint-cli2, globby and Vercel's ts-morph dependency chain.
It processes glob patterns; exploitation requires a deeply nested attacker-supplied
pattern. The inspected application does not accept public glob patterns or import
these tools in its middleware. Keep this finding visible until an upstream fix
or a reviewed parent migration removes it. npm reports many affected parent
packages for this single underlying advisory; those counts are not distinct flaws.
