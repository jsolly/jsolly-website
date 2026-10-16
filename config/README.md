# Configuration

Relocatable tracked settings have one repository-owned home under `config/<domain>/`:

- `app/astro.ts` owns Astro, sitemap, Markdown rendering, CSP and Vite settings.
  Native `astro.config.ts` delegates to it. Its post-loader import and repository
  URL are explicitly rebased; route-manifest output stays anchored to `config.root`.
- `typescript/project.json` and `strict-astro.json` own compiler settings. Includes
  and exclusions are rebased; `${configDir}` aliases preserve the native root for
  TypeScript and Astro. Use root `tsconfig.json` for native discovery and commands.
- `quality/biome.settings.jsonc` owns rules, globs and category-formatting policy.
  Native `biome.jsonc` only extends it, preserving root glob/VCS context. Its
  non-discovery filename avoids creating an unintended nested Biome project.
- `quality/knip.json` owns analysis settings; native `knip.config.js` delegates.
  Static Astro analysis explicitly includes both native entry and settings module.
- `quality/yamllint.yaml` and `quality/.markdownlint-cli2.jsonc` are selected
  explicitly by the YAML command and root-anchored Markdown helper.
- `quality/blog.markdownlint.json` owns the blog-specific Markdown rules. The
  native `src/content/blog/posts/.markdownlint.json` extends it to retain scope.
- `testing/test-counts.json` owns the unchanged suite floors. The repository's
  runner reads it; configuration relocation never authorizes dropping tests.

Required native exceptions stay at discovery paths: package manifests/lockfiles,
`.npmrc`, `.nvmrc`, `.mise.toml`, Git files, `.github/`, native agent registrations,
`.repo-independent.json`, delegation files above, `vercel.json` (including the
active legacy subproject), `components.json`, `.pages.yml` (PagesCMS discovery)
and `src/content.config.ts` (Astro's application content registration).
Application content/data, legacy URL/provenance records, recipe PWA manifests,
retained assets, audit evidence, fixtures and executable helpers keep their owners.
[PagesCMS requires its configuration at the repository root](https://pagescms.org/docs/configuration/).
Never move ignored local secrets/state as part of this convention.

Create only used domains. Preserve roots, scope, imports, plugins, assets and
outputs; compare resolved settings and selected inputs before running the full
`npm run gate`. Keep CMS formatting, test floors, CSP, recipes/offline worker,
legacy redirects and content contracts intact. After merge verify the intended
Vercel production READY deployment and exact-release smoke including recipe
worker installation/control. No Preview is authorized by this migration. The
legacy project's domain-promotion hold stays in place. No external configuration
checkout, home links, generator or automatic synchronization is required.
