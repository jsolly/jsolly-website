# Configuration

Move optional root-level settings under `config/<domain>/` or their existing owner.
Keep already nested configuration with its component; test configuration may live
under `tests/`. Each setting has one repository-owned home:

- `app/astro.ts` owns Astro, sitemap, Markdown rendering, CSP and Vite settings.
  Every Astro command selects it with `--config config/app/astro.ts`, including
  the isolated builds used by content and hydration tests. Its post-loader import
  and repository URL are rebased; route output stays anchored to `config.root`.
  Its watch registration reloads Astro configuration when this physical owner
  changes. Verify an actual setting change and restoration in the running dev
  server; successful initial startup alone does not prove reload behavior.
- `typescript/tsconfig.json` owns compiler settings and inherits Astro's strict
  policy. Its empty `files` and `include` keep it from claiming sibling inputs;
  the native `tsconfig.json` owns the existing project membership and exclusions.
  Keeping scope root-relative also preserves Vite's native TypeScript selection.
  The nested policy's native basename lets Vite invalidate its compiler cache
  after physical edits. Verify changed output and exact restoration in a warm
  server, without overriding compiler options or clearing caches by hand.
  Astro's project loader and the recipe PWA's esbuild calls discover the root
  adapter. It retains the sole `$lib` alias map: root-relative targets support
  pinned shadcn-svelte 1.7.0, whose parser rejects `${configDir}`.
- `quality/biome.settings.jsonc` owns rules, globs and category formatting.
  Every Biome command selects this file explicitly from the repository root.
  Its non-discovery filename avoids creating an unintended nested project.
- `quality/knip.json` owns analysis settings and is selected with `--config`.
  Its Astro and Biome plugins explicitly read their canonical owners. This
  project has no custom Svelte config; the Astro integration supplies its defaults.
- `quality/yamllint.yaml` and `quality/.markdownlint-cli2.jsonc` are selected
  explicitly by the YAML command and root-anchored Markdown helper. The latter
  owns the unchanged fifteen blog rule exceptions in a `src/content/blog/posts/**`
  override; normal engineering-document rules and all ignore scopes remain intact.
- `testing/test-counts.json` owns the counted suite floors. Configuration moves
  never authorize dropping tests. Keep a blank line between its entries, so two
  pull requests that change different suites merge without a conflict.
- `agents/repository.json` owns the repository identity used by hook trust.
  [Development guidance](../docs/development.md#hook-trust) documents the explicit
  authenticated upgrade for old installed snapshots and refusal of retired owners.

Required native exceptions keep active discovery paths: package manifests and
lockfiles, `.npmrc`, `.nvmrc`, `.mise.toml`, Git files, `.github/`, native agent
registrations, the minimal `tsconfig.json` described above, `vercel.json` (including
its active legacy subproject), `components.json` (the component generator),
`.pages.yml` (PagesCMS) and `src/content.config.ts` (Astro application registration).
[PagesCMS requires its configuration at the repository root](https://pagescms.org/docs/configuration/).
Application content/data, legacy URL/provenance records, recipe PWA manifests,
retained assets, audit evidence, fixtures and executable helpers keep their owners.
Never move ignored local secrets or app-owned state as part of this convention.

Create only used domains. Preserve roots, scopes, imports, plugins, assets and
outputs; compare resolved settings and selected inputs before the full
`npm run gate`. Keep CMS formatting, test floors, CSP, recipes/offline worker,
legacy redirects and content contracts intact. After merge verify the intended
Vercel production READY deployment and exact-release smoke, including recipe
worker installation and control. No Preview is authorized by this migration. The
legacy project's domain-promotion hold stays in place. No external configuration
checkout, home links, generator or automatic synchronization is required.
