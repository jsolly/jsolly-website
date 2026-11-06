// Unit-only deployment input for API entrypoint tests. Live and built tests use
// the manifest produced by Astro, never this small published-route fixture.
export const routes = ["/", "/recipes/meals/"];
