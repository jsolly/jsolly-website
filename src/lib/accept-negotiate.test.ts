import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	markdownSiblingPath,
	normalizePagePath,
	preferredType,
	routeSet,
	shouldNegotiate,
} from "./accept-negotiate.js";
import { agentResponse } from "./agent-response.js";

// Injected in place of src/generated/route-manifest.js, so these tests never
// depend on the generated file: the portfolio pages plus a real blog post and
// recipe, as the manifest will list them once those sections exist.
const ROUTES = routeSet([
	"/",
	"/about/",
	"/contact/",
	"/privacy/",
	"/terms/",
	"/blog/",
	"/blog/Real-Post/",
	"/blog/café-au-lait/",
	"/blog/c++-tips/",
	"/recipes/chicken-posole/",
]);

describe("preferredType", () => {
	it("defaults to HTML when Accept is missing", () => {
		assert.equal(preferredType(null), "text/html");
		assert.equal(preferredType(""), "text/html");
	});

	it("selects markdown when that type is listed first at equal q", () => {
		assert.equal(
			preferredType("text/markdown, text/html, */*"),
			"text/markdown",
		);
	});

	it("honors q-values", () => {
		assert.equal(
			preferredType("text/html;q=0.8, text/markdown;q=1"),
			"text/markdown",
		);
		assert.equal(
			preferredType("text/markdown;q=0.1, text/html;q=0.9"),
			"text/html",
		);
	});

	it("rejects an explicitly zeroed type even when */* is present", () => {
		assert.equal(preferredType("text/html;q=0, */*;q=1"), "text/markdown");
	});

	it("returns null when nothing we produce is acceptable", () => {
		assert.equal(preferredType("application/json"), null);
		assert.equal(preferredType("text/html;q=0, text/markdown;q=0"), null);
	});

	it("treats */* as HTML (first produced type)", () => {
		assert.equal(preferredType("*/*"), "text/html");
	});
});

describe("shouldNegotiate", () => {
	it("allows document routes and markdown siblings", () => {
		assert.equal(shouldNegotiate("/", "GET", ROUTES), true);
		assert.equal(shouldNegotiate("/about/", "GET", ROUTES), true);
		assert.equal(shouldNegotiate("/about.md", "HEAD", ROUTES), true);
		assert.equal(shouldNegotiate("/no-such-page", "GET", ROUTES), true);
	});

	it("skips static assets and non-GET", () => {
		assert.equal(shouldNegotiate("/llms.txt", "GET", ROUTES), false);
		assert.equal(shouldNegotiate("/robots.txt", "GET", ROUTES), false);
		assert.equal(
			shouldNegotiate("/John-Solly-Resume.pdf", "GET", ROUTES),
			false,
		);
		assert.equal(shouldNegotiate("/_astro/foo.js", "GET", ROUTES), false);
		assert.equal(shouldNegotiate("/", "POST", ROUTES), false);
	});
});

describe("path helpers", () => {
	it("normalizes trailing slashes and .md siblings", () => {
		assert.equal(normalizePagePath("/"), "/");
		assert.equal(normalizePagePath("/about/"), "/about");
		assert.equal(normalizePagePath("/about.md"), "/about");
		assert.equal(normalizePagePath("/about.MD"), "/about");
		assert.equal(normalizePagePath("/about.md/"), "/about");
		assert.equal(normalizePagePath("/index.md"), "/");
		assert.equal(normalizePagePath("/index"), "/index");
		assert.equal(markdownSiblingPath("/"), "/index.md");
		assert.equal(markdownSiblingPath("/contact/"), "/contact.md");
	});
});

describe("agentResponse", () => {
	const origin = "https://www.jsolly.com";

	it("serves markdown with Vary: Accept for Accept: text/markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/`, { headers: { accept: "text/markdown" } }),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.match(res.headers.get("vary") ?? "", /Accept/iu);
		assert.equal(
			res.headers.get("cache-control"),
			"public, max-age=0, must-revalidate",
		);
		const body = await res.text();
		assert.match(body, /^# Hi, I'm John Solly/mu);
	});

	it("returns markdown 404 with recovery links for unknown paths", async () => {
		const res = agentResponse(
			new Request(`${origin}/no-such-page`, {
				headers: { accept: "text/markdown" },
			}),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 404);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/u);
		const body = await res.text();
		assert.match(body, /^# Not found/mu);
		assert.match(body, /llms\.txt/u);
		assert.match(body, /sitemap-index\.xml/u);
	});

	it("serves trailing-slash pages as markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/about/`, { headers: { accept: "text/markdown" } }),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(await res.text(), /^# John Solly/mu);
	});

	it("serves terms page markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/terms/`, {
				headers: { accept: "text/markdown" },
			}),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		const body = await res.text();
		assert.match(body, /^# Terms of Service/mu);
		assert.match(body, /You may visit, read, copy, share, and reuse/u);
	});

	it("serves .md siblings as markdown regardless of Accept", async () => {
		const htmlRes = agentResponse(
			new Request(`${origin}/about.md`, {
				headers: { accept: "text/html" },
			}),
			ROUTES,
		);
		assert.ok(htmlRes);
		assert.equal(htmlRes.status, 200);
		assert.match(htmlRes.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.match(await htmlRes.text(), /^# John Solly/mu);

		const jsonRes = agentResponse(
			new Request(`${origin}/about.md`, {
				headers: { accept: "application/json" },
			}),
			ROUTES,
		);
		assert.ok(jsonRes);
		assert.equal(jsonRes.status, 200);
		assert.match(jsonRes.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.match(await jsonRes.text(), /^# John Solly/mu);
	});

	it("returns empty-body HEAD markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/`, {
				method: "HEAD",
				headers: { accept: "text/markdown" },
			}),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.equal(await res.text(), "");
	});

	it("does not leak page markdown during maintenance", async () => {
		const previous = process.env.MAINTENANCE_MODE;
		process.env.MAINTENANCE_MODE = "true";
		try {
			const res = agentResponse(
				new Request(`${origin}/about/`, {
					headers: { accept: "text/markdown" },
				}),
				ROUTES,
			);
			assert.ok(res);
			assert.equal(res.status, 503);
			const body = await res.text();
			assert.match(body, /^# Maintenance/mu);
			assert.doesNotMatch(body, /Health-IT Division CTO/u);
		} finally {
			if (previous === undefined) {
				delete process.env.MAINTENANCE_MODE;
			} else {
				process.env.MAINTENANCE_MODE = previous;
			}
		}
	});

	it("returns 406 when HTML and markdown are both rejected", () => {
		const res = agentResponse(
			new Request(`${origin}/`, {
				headers: { accept: "application/json" },
			}),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 406);
		assert.match(res.headers.get("vary") ?? "", /Accept/iu);
	});

	it("falls through to HTML for a normal browser Accept", () => {
		const res = agentResponse(
			new Request(`${origin}/`, {
				headers: {
					accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			}),
			ROUTES,
		);
		assert.equal(res, null);
	});
});

describe("route-aware exemptions", () => {
	const origin = "https://www.jsolly.com";
	const request = (path: string, accept: string) =>
		new Request(`${origin}${path}`, { headers: { accept } });

	it("passes real blog and recipe routes through as HTML", () => {
		for (const path of [
			"/blog/",
			"/blog/Real-Post/",
			"/blog/Real-Post",
			"/recipes/chicken-posole/",
		]) {
			assert.equal(
				agentResponse(request(path, "text/markdown"), ROUTES),
				null,
				path,
			);
			assert.equal(
				agentResponse(request(path, "application/json"), ROUTES),
				null,
				path,
			);
		}
	});

	it("keeps the markdown 404 for unknown paths in those sections", async () => {
		// Route matching is case-sensitive: /blog/real-post/ is not Real-Post.
		const paths = ["/blog/nope/", "/blog/real-post/", "/recipes/nope/"];
		const responses = paths.map((path) =>
			agentResponse(request(path, "text/markdown"), ROUTES),
		);
		const bodies = await Promise.all(
			responses.map((res, idx) => {
				assert.ok(res, paths[idx]);
				assert.equal(res.status, 404, paths[idx]);
				assert.match(res.headers.get("content-type") ?? "", /text\/markdown/u);
				return res.text();
			}),
		);
		for (const body of bodies) {
			assert.match(body, /^# Not found/mu);
		}
	});

	it("passes a percent-encoded request for a non-ASCII post through as HTML", () => {
		// new Request percent-encodes the slug: /blog/caf%C3%A9-au-lait/.
		const path = "/blog/café-au-lait/";
		assert.equal(agentResponse(request(path, "text/markdown"), ROUTES), null);
		assert.equal(
			shouldNegotiate(encodeURI(path), "GET", ROUTES),
			false,
			"encoded path",
		);
	});

	it("passes a post whose slug has an encoded reserved character through as HTML", () => {
		assert.equal(shouldNegotiate("/blog/c%2B%2B-tips/", "GET", ROUTES), false);
	});

	it("keeps the markdown 404 for a malformed escape instead of throwing", async () => {
		const path = "/blog/%E0%A4%A/";
		assert.equal(shouldNegotiate(path, "GET", ROUTES), true);
		const res = agentResponse(request(path, "text/markdown"), ROUTES);
		assert.ok(res);
		assert.equal(res.status, 404);
		assert.match(await res.text(), /^# Not found/mu);
	});

	it("keeps the markdown 404 for an extensionless miss under /recipes/data/", async () => {
		const path = "/recipes/data/nope/";
		assert.equal(shouldNegotiate(path, "GET", ROUTES), true);
		const res = agentResponse(request(path, "text/markdown"), ROUTES);
		assert.ok(res);
		assert.equal(res.status, 404);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.match(await res.text(), /^# Not found/mu);
	});

	it("serves /recipes/data/ markdown files as static files", () => {
		const path = "/recipes/data/recipe-library.md";
		for (const accept of ["text/markdown", "text/html", "application/json"]) {
			assert.equal(agentResponse(request(path, accept), ROUTES), null, accept);
		}
		assert.equal(shouldNegotiate(path, "GET", ROUTES), false);
	});

	it("never answers 406 for .avif or .mp4 files", () => {
		for (const path of [
			"/blog/x.avif",
			"/recipes/media/chicken-posole-960.avif",
			"/blog/media/clip.mp4",
		]) {
			assert.equal(
				agentResponse(request(path, "application/json"), ROUTES),
				null,
				path,
			);
			assert.equal(shouldNegotiate(path, "GET", ROUTES), false, path);
		}
	});

	it("leaves .xml feeds untouched", () => {
		for (const path of [
			"/blog/rss.xml",
			"/blog/atom.xml",
			"/sitemap-index.xml",
		]) {
			for (const accept of [
				"application/rss+xml",
				"application/atom+xml",
				"text/markdown",
			]) {
				assert.equal(
					agentResponse(request(path, accept), ROUTES),
					null,
					`${path} ${accept}`,
				);
			}
			assert.equal(shouldNegotiate(path, "GET", ROUTES), false, path);
		}
	});

	it("leaves real blog and recipe routes, data files and media out of negotiation", () => {
		// middleware.ts appends Vary: Accept exactly when shouldNegotiate holds.
		for (const path of [
			"/blog/Real-Post/",
			"/recipes/chicken-posole/",
			"/recipes/data/recipe-library.md",
			"/blog/x.avif",
		]) {
			assert.equal(shouldNegotiate(path, "GET", ROUTES), false, path);
		}
		for (const path of ["/", "/about/", "/blog/nope/", "/recipes/nope/"]) {
			assert.equal(shouldNegotiate(path, "GET", ROUTES), true, path);
		}
	});
});
