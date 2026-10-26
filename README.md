# jsolly-website

The code for <https://jsolly.com>
![JsollyIpad](https://github.com/jsolly/jsolly-website/assets/9572232/6ab40d9a-2c2c-4e1d-bc34-719f768252e5)

## Install

```sh
git clone git@github.com:jsolly/jsolly-website.git
cd jsolly-website
npm install
npm run dev
```

## Blog and recipes

The blog (`/blog/`) and recipe library (`/recipes/`) now live here. The old blogthedata.com hosts redirect here through the separate Vercel project rooted at `legacy/blogthedata/`. The [source repository is archived](https://github.com/jsolly/awesome-blog). See [legacy host operations and recovery](docs/legacy-redirects.md).

- **Posts and categories:** Markdown with YAML frontmatter in `src/content/blog/posts/`, category JSON in `src/content/blog/categories/`, uploaded images in `public/blog/media/`.
- **Editing:** [PagesCMS](https://app.pagescms.org) on an editorial branch from `main`, published by PR on green CI. See [docs/publishing.md](docs/publishing.md).
- **Recipes:** edit `src/components/recipes/recipes.json`, then run `npm run recipes:sync` to regenerate the downloads in `public/recipes/data/` and commit both. See [docs/recipes.md](docs/recipes.md).

<!-- Preview lifecycle probe: phase A. Temporary; removed after verification. -->
