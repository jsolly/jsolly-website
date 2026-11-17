// Types for route-manifest.js, which astro build writes (routeManifest in
// config/app/astro.ts) and git ignores, so middleware.ts type-checks before a build.

/** Every page route the build emitted as `/path/` ("/" for the index), error pages excluded. */
export declare const routes: readonly string[];

/** Published page key and its generated static Markdown sibling. */
export declare const markdownRoutes: readonly (readonly [string, string])[];
