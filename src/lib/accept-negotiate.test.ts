import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	markdownSiblingPath,
	normalizePagePath,
	preferredType,
	shouldNegotiate,
} from "./accept-negotiate.ts";
import { agentResponse } from "./agent-response.ts";

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
			"abc",
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
		assert.match(res.headers.get("vary") ?? "", /Accept/i);
		assert.equal(res.headers.get("x-release-id"), "abc");
		const body = await res.text();
		assert.match(body, /^# Hi, I'm John Solly/m);
	});

	it("returns markdown 404 with recovery links for unknown paths", async () => {
		const res = agentResponse(
			new Request(`${origin}/no-such-page`, {
				headers: { accept: "text/markdown" },
			}),
			"abc",
		);
		assert.ok(res);
		assert.equal(res.status, 404);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
		const body = await res.text();
		assert.match(body, /^# Not found/m);
		assert.match(body, /llms\.txt/);
		assert.match(body, /sitemap-index\.xml/);
	});

	it("serves trailing-slash pages as markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/about/`, { headers: { accept: "text/markdown" } }),
			"abc",
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(await res.text(), /^# John Solly/m);
	});

	it("serves .md siblings as markdown regardless of Accept", async () => {
		for (const accept of ["text/html", "application/json"]) {
			const res = agentResponse(
				new Request(`${origin}/about.md`, { headers: { accept } }),
				"abc",
			);
			assert.ok(res);
			assert.equal(res.status, 200);
			assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
			assert.match(await res.text(), /^# John Solly/m);
		}
	});

	it("returns empty-body HEAD markdown", async () => {
		const res = agentResponse(
			new Request(`${origin}/`, {
				method: "HEAD",
				headers: { accept: "text/markdown" },
			}),
			"abc",
		);
		assert.ok(res);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
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
				"abc",
			);
			assert.ok(res);
			assert.equal(res.status, 503);
			const body = await res.text();
			assert.match(body, /^# Maintenance/m);
			assert.doesNotMatch(body, /Health-IT Division CTO/);
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
			"abc",
		);
		assert.ok(res);
		assert.equal(res.status, 406);
		assert.match(res.headers.get("vary") ?? "", /Accept/i);
	});

	it("falls through to HTML for a normal browser Accept", () => {
		const res = agentResponse(
			new Request(`${origin}/`, {
				headers: {
					accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			}),
			"abc",
		);
		assert.equal(res, null);
	});
});
