# Publishing with PagesCMS

The blog at `/blog/` is edited with [hosted PagesCMS](https://app.pagescms.org)
through its GitHub App, configured by `.pages.yml` at the repository root. Posts
are Markdown files with YAML frontmatter in `src/content/blog/posts/`; categories
are JSON files in `src/content/blog/categories/`. Both paths are `POSTS_DIR` and
`CATEGORIES_DIR` in `src/lib/blog/constants.ts`, which the content collections
read too.

## Access and branches

Grant the PagesCMS GitHub App access to `jsolly/jsolly-website` only. Edit on an
editorial branch made from current `main`. Saves create commits on that branch;
production changes only after a PR passes `CI / ci` and merges. Start each later
branch from updated `main`. Do not edit protected `main` directly or weaken the
ruleset. Editorial PRs run the full gate, because post edits are not docs-only.

### Completed migration rehearsal

PagesCMS now edits this repository. John accepted the source App-access exception;
the old `awesome-blog` repository is archived and cannot accept editorial writes.
The migration branch was retired before destination editing began.

Destination rehearsal [PR105](https://github.com/jsolly/jsolly-website/pull/105)
was closed unmerged after the complex-article roundtrip and image-upload checks,
independent review, full local gate and successful CI. Keep using a fresh editorial
branch from `main`; that rehearsal does not authorize direct protected-main edits.

An email PagesCMS login can connect a GitHub installation from Settings. If the
installation shows Disconnected, connect it there; verify the repository list
before editing. John's connection currently uses GitHub sign-in.

## Write an article

Create a post with a stable slug, title, description, category, publication and
update timestamps, and an image with alt text. New posts default to drafts. The
body uses PagesCMS's Markdown code editor, not a WYSIWYG editor: keep it that way
unless a complex-article roundtrip (tables, code, embeds) has been verified first.
The renderer is CommonMark with GFM and smart punctuation turned off, so write
links explicitly and use HTML for tables. Complex tables and embeds can use HTML;
scripts, event handlers and unapproved iframe providers are removed by the
sanitizer. The card excerpt is optional HTML; without one the card uses the
description.

Only YouTube, YouTube No-Cookie, diagrams.net and nbviewer frames are allowed,
by both the sanitizer and the blog pages' `frame-src`. Any other provider needs a
reviewed sanitizer and CSP change. Pages load no runtime CSS or JavaScript from
third-party CDNs.

Keep existing heading text when its link fragment must stay stable. Heading ids
come from the heading text through `headingId` in `src/lib/blog/html.ts`, the
old blog's algorithm, which must not change.

### Images and media

Upload ordinary images through the CMS Media sidebar. They land in
`public/blog/media/` and are served at `/blog/media/`. Resize and compress them
before uploading, then paste the uploaded `/blog/media/...` path into the
cover-image field. That field also keeps existing HTTPS image URLs.

The cover-image pattern accepts any `https://` URL, but the blog pages' CSP
allows images only from jsolly.com itself, `data:` and the retained blogthedata
CloudFront host `https://d1d7p8ufhgz4ld.cloudfront.net` (decision J6). The
build-time `csp` suite fails on any built image from another host. Large
downloads, videos or datasets go into the existing `blogthedata` S3 bucket
separately and are linked by their CloudFront URL. The CMS has no S3 uploader
and no AWS credentials; never paste AWS credentials into a CMS field.

### Timestamps and slugs

Publication and update timestamps are ISO 8601 strings with seconds and an
explicit timezone, such as `2026-10-02T14:00:00Z`. Keep an existing
publication timestamp, and change `updated` when editing a post. The fields are
strings, not PagesCMS date controls, because the date control initializes and
truncates values to minutes. The post loader parses frontmatter with the YAML
1.2 core schema, so quoted and unquoted timestamps keep their seconds, fraction
and offset. The build rejects a date-only or offset-less timestamp, naming the
field and the file.

Keep published post and category slugs, and their case, unchanged: they are
URLs (`/blog/<slug>/`, `/blog/category/<slug>/`), and the old host's redirects
point at them. A new slug uses lowercase letters, digits and hyphens.

Choose up to three related posts by hand; a slug that names no post fails the
build. `settings.content.merge: true` keeps frontmatter keys the CMS does not
manage, such as `legacyId`, `legacyImage` and `legacyAuthorId`. Empty optional
fields may be dropped on save; their defaults keep the same public meaning.

PagesCMS rewrites a whole category file on each save as
`JSON.stringify(x, null, 2)` with no final newline. It owns that formatting:
`config/quality/biome.settings.jsonc` turns the formatter off for `src/content/blog/categories/**` only,
with linting still on. Do not reformat those files by hand.

## Review and publish

Check the PR diff for accidental frontmatter or body rewrites. Run `npm run gate`
and preview the build locally (`npm run build && npm run preview`). A draft must
be absent from every route, the archive, search, the feeds, the sitemap and
client data; `scripts/built/blog-content-contracts.test.mjs` builds a real draft
and checks that. Set `draft` to false only when ready. Review image
accessibility, the canonical URL, the category, the article, and the search and
feed entries, then merge after green CI. Branch pushes create no Vercel Preview;
use a local preview unless John asks for the opt-in `/preview` comment or
`preview` label.

## Content validation

Posts are linted by markdownlint with `src/content/blog/posts/.markdownlint.json`,
which allows retained HTML, original punctuation, heading order and verbatim code
whitespace: these are authored content, not repository style errors. Biome does
not process Markdown. The Astro schemas (`src/lib/blog/schemas.ts`) and the
built content contracts supply the structural checks: an empty article, a
duplicate post or category slug, an unknown category or an unknown `related`
slug fails the build. Engineering docs keep the normal Markdown lint.
