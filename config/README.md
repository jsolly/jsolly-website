# Configuration

Move optional root-level settings under `config/<domain>/` or their existing owner.
Keep already nested configuration with its component; test configuration lives in
`config/testing/`. Each setting has one repository-owned home:

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
  adapter. The nested policy owns the sole `$lib` alias map, rebased to
  `../../src/lib`. TypeScript and pinned shadcn-svelte 1.7.0 resolve these
  inherited relative paths from the defining file. No `${configDir}` is needed.
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
- `testing/vitest.config.mjs` owns JavaScript suite discovery and isolation;
  `tests/run-tests.mjs` selects the suite and checks Vitest JSON results against
  the ledger. `testing/pytest.ini` owns Python hook/bootstrap discovery.
- `testing/test-counts.json` owns the counted suite floors. Configuration moves
  never authorize dropping tests. Keep a blank line between its entries, so two
  pull requests that change different suites merge without a conflict.
- `agents/repository.json` owns the repository identity used by hook trust.
  [Development guidance](../docs/development.md#hook-trust) documents the explicit
  authenticated upgrade for old installed snapshots and refusal of retired owners.

## Native configuration retained

The root audit on 2026-11-01 moved the remaining `$lib` alias policy into
`config/typescript/tsconfig.json`. The native `tsconfig.json` retains project
membership and extends that policy. These native files have active consumers:

| Native path | Reason retained and affected consumers |
| --- | --- |
| `package.json`, `package-lock.json` | npm's project manifest and lockfile. npm scripts, dependency installation, CI cache keys and isolated build copies use these project-root files. |
| `.npmrc` | [npm discovers per-project settings beside `package.json`](https://docs.npmjs.com/cli/v11/configuring-npm/npmrc/#per-project-config-file). `yes=false` and `min-release-age` must apply to ordinary npm and npx calls, including bootstrap and desktop sessions. `--userconfig` selects a different configuration tier and would require changing every entry point. |
| `.nvmrc` | [nvm searches upward for this basename](https://github.com/nvm-sh/nvm#nvmrc). Actions `setup-node`, npm cache keys and `gate_require_node` also read it. It remains the Node major contract. |
| `.mise.toml` | The [bootstrap-pinned mise 2026.9.12 configuration](https://github.com/jdx/mise/blob/v2026.9.12/docs/configuration.md) discovers native mise paths, not `config/tools/`. Its [schema](https://github.com/jdx/mise/blob/v2026.9.12/schema/mise.json) has no top-level `include` for delegating tool pins. Bootstrap explicitly trusts this file; ordinary `mise install` and `mise exec` discover it. An override environment variable would make shell setup a prerequisite for discovery. |
| `tsconfig.json` | Native project discovery for Astro, Vite, Svelte check, esbuild and shadcn-svelte. Compiler policy already extends `config/typescript/tsconfig.json`. Membership stays here for Vite scope; `$lib` paths are inherited from the nested policy. [TypeScript resolves inherited relative paths from their defining file](https://www.typescriptlang.org/tsconfig/extends.html). The real compiler-consumer regression is `tests/unit/tsconfig-consumer.test.mjs`. |
| `components.json` | [shadcn-svelte's project configuration](https://www.shadcn-svelte.com/docs/components-json). The pinned generator discovers it in the project; changing its working directory would also change project, stylesheet and TypeScript discovery. No separate config-file option is exposed by that version. |
| `.pages.yml` | [PagesCMS requires the repository root](https://pagescms.org/docs/configuration/). It owns content formats and media paths used by the hosted editor and `pages-config.test.ts`. |
| `vercel.json` | [Vercel Git builds read configuration from the project root](https://vercel.com/docs/project-configuration/vercel-json). Middleware bundling, CSP readers and built routing tests read the same owner. A local CLI override would not relocate the Git integration's configuration. `legacy/blogthedata/vercel.json` belongs to that separate project's root and remains generated from its URL map. |
| `.gitignore` | [Git interprets patterns relative to the containing directory](https://git-scm.com/docs/gitignore). Moving it would change ignored paths and discovery. |
| `.github/workflows/`, `.github/dependabot.yml` | [Actions workflow discovery](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) use GitHub's native locations. |
| `.codex/environments/environment.toml`, `.cursor/`, `.claude/settings.json` | Desktop and cloud providers own these registrations. They already delegate executable setup and hooks to `gate/`; moving the registrations would remove native discovery. Skill-owned settings stay with their skill. |
| `.git-hooks/pre-commit` | The repository's gate adapter, used by `npm run gate` and the trusted hook bundle in `config/agents/repository.json`. This is executable entry-point code, not optional tool policy. |

`AGENTS.md` and `README.md` remain repository instructions and documentation.
`middleware.ts`, `api/` and `src/content.config.ts` remain application entry points.
Moving the aliases changes no command, CI, hook or bootstrap path: all consumers
still discover the same native
TypeScript adapter. The root alias copy is removed. There are no obsolete root
configuration files to remove.

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
