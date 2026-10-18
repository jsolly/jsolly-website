import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	markdownSiblingPath,
	normalizePagePath,
	preferredType,
	shouldNegotiate,
} from "./accept-negotiate.js";
import { agentResponse } from "./agent-response.js";

// Injected in place of src/generated/route-manifest.js, so these tests never
// depend on the generated file: the portfolio pages plus a real blog post and
// recipe, as the manifest will list them once those sections exist.
const ROUTES = new Map(
	[
		"/blog/",
		"/blog/Real-Post/",
		"/blog/café-au-lait/",
		"/blog/c++-tips/",
		"/recipes/chicken-posole/",
	].map((path) => [normalizePagePath(path), markdownSiblingPath(path)]),
);

// The blog moved on-site; no portfolio Markdown may still send readers there.
const OLD_BLOG_HOST = /blogthedata\.com/u;

// Copied from the Context7 Ask install instructions, not from constants.ts.
const SEARCH_SECTION =
	// biome-ignore lint/security/noSecrets: public site verification key, not a credential
	"## Search\n\nThis site has a search endpoint: https://context7.com/api/v2/ask?siteKey=ask_43369889032b1355b89bc7f4&query=<URL-encoded question>. It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.\n";
const SEARCH_LINK =
	// biome-ignore lint/security/noSecrets: public site verification key, not a credential
	'<https://context7.com/api/v2/ask?siteKey=ask_43369889032b1355b89bc7f4>; rel="search"; type="text/plain"; title="Search jsolly.com"';

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
		assert.equal(shouldNegotiate("/", "GET"), true);
		assert.equal(shouldNegotiate("/about/", "GET"), true);
		assert.equal(shouldNegotiate("/about.md", "HEAD"), true);
		assert.equal(shouldNegotiate("/no-such-page", "GET"), true);
	});

	it("skips static assets and non-GET", () => {
		assert.equal(shouldNegotiate("/llms.txt", "GET"), false);
		assert.equal(shouldNegotiate("/robots.txt", "GET"), false);
		assert.equal(shouldNegotiate("/John-Solly-Resume.pdf", "GET"), false);
		assert.equal(shouldNegotiate("/_astro/foo.js", "GET"), false);
		assert.equal(shouldNegotiate("/", "POST"), false);
	});
});

it("API routes own JSON and Markdown negotiation independently of page responses", () => {
	for (const path of [
		"/api/recipe-browse",
		"/api/recipe-browse/",
		"/api/other.md",
	]) {
		assert.equal(shouldNegotiate(path, "GET"), false);
		for (const accept of ["application/json", "text/markdown"]) {
			assert.equal(
				agentResponse(
					new Request(`https://www.jsolly.com${path}`, { headers: { accept } }),
					ROUTES,
				),
				null,
			);
		}
	}
	assert.equal(shouldNegotiate("/apiculture/", "GET"), true);
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
		assert.ok(body.includes(`](${origin}/blog/)`), "links the on-site blog");
		assert.ok(
			body.includes(`](${origin}/recipes/)`),
			"links the on-site recipes",
		);
		assert.doesNotMatch(body, OLD_BLOG_HOST);
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
		const body = await res.text();
		assert.match(body, /^# John Solly/mu);
		assert.ok(body.includes(`](${origin}/blog/)`), "links the on-site blog");
		assert.ok(
			body.includes(`](${origin}/recipes/)`),
			"links the on-site recipes",
		);
		assert.doesNotMatch(body, OLD_BLOG_HOST);
	});

	it("An agent requesting /contact/ as Markdown gets the contact page with no link to the old blog host", async () => {
		const res = agentResponse(
			new Request(`${origin}/contact/`, {
				headers: { accept: "text/markdown" },
			}),
			ROUTES,
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		const body = await res.text();
		assert.match(body, /^# Contact John Solly/mu);
		assert.doesNotMatch(body, OLD_BLOG_HOST);
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
			assert.doesNotMatch(body, /^# John Solly/mu);
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
	it("encoded separators cannot alias a different published route", () => {
		for (const path of ["/blog%2FReal-Post/", "/blog%5CReal-Post/"]) {
			assert.equal(
				agentResponse(request(path, "text/markdown"), ROUTES)?.status,
				404,
			);
		}
	});

	it("rewrites real blog and recipe routes to generated Markdown and keeps browser HTML", () => {
		for (const path of [
			"/blog/",
			"/blog/Real-Post/",
			"/blog/Real-Post",
			"/recipes/chicken-posole/",
		]) {
			const response = agentResponse(request(path, "text/markdown"), ROUTES);
			assert.ok(response);
			assert.equal(
				response.headers.get("x-middleware-rewrite"),
				`${origin}${markdownSiblingPath(path)}`,
			);
			assert.match(
				response.headers.get("content-type") ?? "",
				/text\/markdown/u,
			);
			assert.match(response.headers.get("vary") ?? "", /Accept/iu);
			assert.equal(
				agentResponse(request(path, "application/json"), ROUTES)?.status,
				406,
			);
			assert.equal(agentResponse(request(path, "text/html"), ROUTES), null);
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

	it("rewrites percent-encoded Unicode and reserved characters without changing case", () => {
		for (const path of ["/blog/caf%C3%A9-au-lait/", "/blog/c%2B%2B-tips/"]) {
			const response = agentResponse(request(path, "text/markdown"), ROUTES);
			assert.ok(response);
			assert.equal(
				response.headers.get("x-middleware-rewrite"),
				`${origin}${path.slice(0, -1)}.md`,
			);
		}
	});

	it("lets canonical generated .md files pass to static serving, regardless of Accept", () => {
		const response = agentResponse(
			request("/blog/Real-Post.md", "application/json"),
			ROUTES,
		);
		assert.ok(response);
		assert.equal(response.headers.get("x-middleware-next"), "1");
		assert.match(response.headers.get("content-type") ?? "", /text\/markdown/u);
		assert.equal(response.headers.get("link"), SEARCH_LINK);
	});

	it("never serves direct Markdown for POST and sends empty HEAD 406", async () => {
		assert.equal(
			agentResponse(
				new Request(`${origin}/blog/Real-Post.md`, { method: "POST" }),
				ROUTES,
			),
			null,
		);
		const response = agentResponse(
			new Request(`${origin}/blog/`, {
				method: "HEAD",
				headers: { accept: "application/json" },
			}),
			ROUTES,
		);
		assert.equal(response?.status, 406);
		assert.equal(await response?.text(), "");
	});

	it("keeps the markdown 404 for a malformed escape instead of throwing", async () => {
		const path = "/blog/%E0%A4%A/";
		assert.equal(shouldNegotiate(path, "GET"), true);
		const res = agentResponse(request(path, "text/markdown"), ROUTES);
		assert.ok(res);
		assert.equal(res.status, 404);
		assert.match(await res.text(), /^# Not found/mu);
	});

	it("keeps the markdown 404 for an extensionless miss under /recipes/data/", async () => {
		const path = "/recipes/data/nope/";
		assert.equal(shouldNegotiate(path, "GET"), true);
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
		assert.equal(shouldNegotiate(path, "GET"), false);
	});
	it("leaves Markdown-named files in static asset namespaces untouched", () => {
		for (const path of [
			"/_astro/example.md",
			"/images/example.md",
			"/scripts/example.md",
			"/favicons/example.md",
		]) {
			assert.equal(
				agentResponse(request(path, "application/json"), ROUTES),
				null,
				path,
			);
		}
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
			assert.equal(shouldNegotiate(path, "GET"), false, path);
		}
	});

	it("leaves .xml feeds and sitemaps and the site's .txt files untouched", () => {
		for (const path of [
			"/blog/rss.xml",
			"/blog/atom.xml",
			"/sitemap-index.xml",
			"/sitemap-0.xml",
			"/robots.txt",
			"/.well-known/security.txt",
			"/pgp-key.txt",
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
			assert.equal(shouldNegotiate(path, "GET"), false, path);
		}
	});

	it("negotiates page routes while excluding data files and media", () => {
		// middleware.ts appends Vary: Accept exactly when shouldNegotiate holds.
		for (const path of ["/recipes/data/recipe-library.md", "/blog/x.avif"]) {
			assert.equal(shouldNegotiate(path, "GET"), false, path);
		}
		for (const path of [
			"/",
			"/about/",
			"/blog/Real-Post/",
			"/recipes/chicken-posole/",
			"/blog/nope/",
			"/recipes/nope/",
		]) {
			assert.equal(shouldNegotiate(path, "GET"), true, path);
		}
	});
});

describe("Context7 search discovery", () => {
	const origin = "https://www.jsolly.com";

	it("An agent fetching /about/ or a missing page as Markdown gets the Search section last and the search Link header", async () => {
		for (const [path, status] of [
			["/about/", 200],
			["/no-such-page", 404],
		] as const) {
			const res = agentResponse(
				new Request(`${origin}${path}`, {
					headers: { accept: "text/markdown" },
				}),
				ROUTES,
			);
			assert.ok(res);
			assert.equal(res.status, status);
			assert.equal(res.headers.get("link"), SEARCH_LINK);
			// biome-ignore lint/performance/noAwaitInLoops: two requests checked in turn.
			const body = await res.text();
			assert.ok(
				body.endsWith(`\n\n${SEARCH_SECTION}`),
				`${path} ends with Search`,
			);
			assert.equal(
				body.split("This site has a search endpoint").length,
				2,
				`${path} offers the search endpoint exactly once`,
			);
		}
	});

	it("An agent asking for a recipe's Markdown by GET or HEAD is rewritten to its static sibling with the search Link header", () => {
		for (const method of ["GET", "HEAD"]) {
			const res = agentResponse(
				new Request(`${origin}/recipes/chicken-posole/`, {
					method,
					headers: { accept: "text/markdown" },
				}),
				ROUTES,
			);
			assert.ok(res);
			assert.equal(
				res.headers.get("x-middleware-rewrite"),
				`${origin}/recipes/chicken-posole.md`,
				method,
			);
			assert.equal(res.headers.get("link"), SEARCH_LINK, method);
		}
	});
});
