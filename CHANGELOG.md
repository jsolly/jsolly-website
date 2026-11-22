# Changelog

## 2026-11-22

- Remove npm overrides for `@tootallnate/once`, `minimatch`, `tar` and `srvx`. None appears in the lockfile.

## 2026-11-20

- Let a local gate without the Chrome Headless Shell, where `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` switches browser downloads off, skip only its smoke contract and built-output tests, with a warning that gives the reason and the tracking task, instead of failing; setup warns instead of stopping when the browser download fails. CI is unchanged and still runs every browser suite. Temporary until cloud agent sessions can run a browser (Todoist 6j3qXFvGP5QhCRP5).
- Add **Print all meals** and **Print all smoothies** to the recipe library. Each prints every recipe in that collection, one per page, with the current servings, units and sides; Home Screen apps hand off to Safari with those settings.

## 2026-11-17

- Report bounded, sanitized local errors when client telemetry cannot load, connect, or receive a successful HTTP response. Bound setup/security downloads and test bootstrap timeout refusal.
