import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { globby } from "globby";
import { chromium } from "playwright";
import { JOB_TITLE } from "../../src/content/constants.js";
import { serveStatic, stubOffOrigin } from "./pages.mjs";
import { createTempCopy, requireSuccess } from "./temp-copy.mjs";

// What process-html.mjs must leave alone for the portfolio's islands to
// hydrate in place. One `astro build` in a temp copy of the working tree gives
// an unprocessed baseline; running process-html over that build in the copy
// gives the processed side.
//
// Node identity across hydration: the island's component and renderer modules
// are held at the network until the page has kept a reference to every element
// inside a server-rendered island, so the snapshot is strictly pre-hydration.
// Once released and hydrated, with the network idle, the page counts how many
// are still connected. An island that re-renders instead of hydrating discards
// all of them. The shipped dist/ must reuse exactly what the unprocessed build
// reuses, and every island on the pages below must reuse every node.
const SHIPPED = "dist";
// The comments islands hydrate from, listed independently of process-html.mjs
// so that dropping one of its ignoreCustomComments patterns fails here: Svelte
// block open (`[`, `[!`, `[-1`) and close (`]`), empty anchors, `$props.id()`
// markers (`$s1`) and Astro's `astro:end`. Svelte writes the empty anchor that
// ends a <select> or <option> with snippet content as `<!>`, which parses to
// the same empty comment as `<!---->`.
const HYDRATION_COMMENT = /^(?:\[.*|\].*|\$.*|astro:end|)$/su;
const COMMENT = /<!(?:--(?<data>[\s\S]*?)--)?>/gu;
const ISLAND_MODULE = /\s(?:component|renderer)-url="(?<url>[^"]+)"/gu;
const OLD_BLOG_HOST = /blogthedata\.com/u;
// Astro hashes an island's uid from the component's absolute path, so the
// temp copy's uids differ from the real tree's; the dist/ comparison masks them.
const ISLAND_UID = /(?<=<astro-island\b[^>]*\s)uid="[^"]*"/gu;
const KINDS = ["[", "]", "", "$", "astro:end"];
// Two synthetic pages carry every kind in one place, the `<!>` anchors that
// end a <select> and an <option>, and an ordinary comment that processing
// must drop. The top-level page goes through process-html's jsdom id pass;
// the recipes/ one skips it, as recipe pages do, so the minifier itself meets
// the `<!>` it cannot parse unless process-html rewrites it.
const SYNTHETIC_PAGES = [
	"__hydration-markers__/index.html",
	"recipes/__hydration-markers__/index.html",
];
const SYNTHETIC_HTML = `<!doctype html>
<html lang="en">
	<head><title>markers</title><!-- dropped --></head>
	<body>
		<astro-island ssr>
			<!--[--><p>
				one   <!--$s1-->
			</p><!----><!--[!--><!--]--><!--[-1--><span>two</span><!--]--><!--]-->
			<select><!--[--><option>three</option><option><!--[--><span>four</span><!--]--><!></option><!--]--><!----><!></select>
		</astro-island>
		<!--astro:end-->
	</body>
</html>
`;

let copy;
let browser;
let unprocessed;
let processed;
const servers = [];
const sites = {};

function kindOf(data) {
	return KINDS.find((kind) => kind !== "" && data.startsWith(kind)) ?? data;
}

// Every page's comments, split into hydration markers and everything else.
async function pageComments(dist) {
	const files = await globby("**/*.html", { cwd: dist });
	const pages = await Promise.all(
		files.map(async (file) => {
			const html = await fs.readFile(join(dist, file), "utf8");
			const comments = [...html.matchAll(COMMENT)].map(
				(match) => match.groups.data ?? "",
			);
			return [
				file,
				{
					hydration: comments.filter((data) => HYDRATION_COMMENT.test(data)),
					ordinary: comments.filter((data) => !HYDRATION_COMMENT.test(data)),
				},
			];
		}),
	);
	return Object.fromEntries(pages);
}

// The shipped dist/ must be byte for byte what process-html makes of a fresh
// build of the current tree, island uids aside. That proves it was processed
// without leaning on any particular page content, and also refuses a stale
// dist/.
async function assertShippedIsProcessed(processedDist) {
	const [shippedFiles, processedFiles] = await Promise.all(
		[SHIPPED, processedDist].map((dist) =>
			globby("**/*.html", { cwd: dist }).then((files) => files.sort()),
		),
	);
	const expectedFiles = processedFiles.filter(
		(file) => !SYNTHETIC_PAGES.includes(file),
	);
	const differing =
		shippedFiles.join("\n") === expectedFiles.join("\n")
			? await Promise.all(
					expectedFiles.map(async (file) => {
						const [shipped, fresh] = await Promise.all(
							[SHIPPED, processedDist].map((dist) =>
								fs
									.readFile(join(dist, file), "utf8")
									.then((html) => html.replace(ISLAND_UID, 'uid=""')),
							),
						);
						return shipped === fresh ? null : file;
					}),
				).then((files) => files.filter(Boolean))
			: ["the set of pages"];
	if (differing.length > 0) {
		throw new Error(
			`dist/ is not process-html's output of the current tree (differing: ${differing.join(", ")}); run \`npm run build\` first. If it persists after a fresh build, some output now depends on the checkout path; extend the ISLAND_UID mask.`,
		);
	}
}

async function listen(name, root) {
	const site = await serveStatic(root);
	servers.push(site);
	sites[name] = { root, origin: site.origin };
}

// The pathnames of the island component and renderer modules on a page.
async function islandModules(root, path) {
	const html = await fs.readFile(join(root, path, "index.html"), "utf8");
	return new Set(
		[...html.matchAll(ISLAND_MODULE)].map((match) => match.groups.url),
	);
}

// `stable`, when given, selects island elements that must survive hydration
// even on a page that replaces part of its server render.
async function nodeReuse({ root, origin }, path, stable = ":not(*)") {
	const held = await islandModules(root, path);
	const intercepted = new Set();
	let release;
	const released = new Promise((resolveRelease) => {
		release = resolveRelease;
	});
	const context = await browser.newContext();
	try {
		// Blog post card images live on CloudFront; networkidle must not wait on it.
		await stubOffOrigin(context, origin);
		await context.route(
			(url) => held.has(url.pathname),
			async (route) => {
				intercepted.add(new URL(route.request().url()).pathname);
				await released;
				await route.continue();
			},
		);
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
		const { total, stableTotal } = await page.evaluate((selector) => {
			window.__ssrIslandNodes = [
				...document.querySelectorAll("astro-island[ssr] *"),
			];
			window.__stableNodes = [
				...document.querySelectorAll(`astro-island[ssr] :is(${selector})`),
			];
			return {
				total: window.__ssrIslandNodes.length,
				stableTotal: window.__stableNodes.length,
			};
		}, stable);
		release();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		await page.waitForLoadState("networkidle");
		const { reused, stableReused } = await page.evaluate(() => ({
			reused: window.__ssrIslandNodes.filter((node) => node.isConnected).length,
			stableReused: window.__stableNodes.filter((node) => node.isConnected)
				.length,
		}));
		return {
			total,
			reused,
			stable: { reused: stableReused, total: stableTotal },
			errors,
			held,
			intercepted,
		};
	} finally {
		release();
		await context.close();
	}
}

before(async () => {
	copy = await createTempCopy("hydration");
	requireSuccess(copy.astroBuild());
	const dist = join(copy.dir, "dist");
	await Promise.all(
		SYNTHETIC_PAGES.map(async (page) => {
			const synthetic = join(dist, page);
			await fs.mkdir(dirname(synthetic), { recursive: true });
			await fs.writeFile(synthetic, SYNTHETIC_HTML);
		}),
	);
	const baseline = join(copy.dir, "baseline");
	await fs.cp(dist, baseline, { recursive: true });
	unprocessed = await pageComments(baseline);
	requireSuccess(copy.node("process-html.mjs"));
	processed = await pageComments(dist);
	await assertShippedIsProcessed(dist);
	await Promise.all([listen("shipped", SHIPPED), listen("baseline", baseline)]);
	browser = await chromium.launch();
});

after(async () => {
	await browser?.close();
	await Promise.all(servers.map((site) => site.close()));
	await copy?.remove();
});

// Every island on these pages must reuse every server-rendered node.
const FULL_REUSE_PAGES = [
	"/",
	"/about/",
	"/blog/",
	"/blog/works-cited/",
	"/blog/search/",
	// The recipe library hydrates in place too; its cards' shuffle on mount
	// moves the keyed card nodes rather than replacing them.
	"/recipes/meals/",
	"/recipes/",
];
// A recipe page legitimately replaces part of its server render on mount (it
// turns interactive: shadcn-svelte controls replace the native fallbacks), so
// it is held to parity with the unprocessed build only (plan §4.5). Greek
// turkey patties has a family side, so its island includes the side select.
// Its title and flow table are not replaced, so they must survive hydration
// whatever the parity count says.
const PARITY_PAGES = [
	{ path: "/recipes/greek-turkey-patties/", stable: "h1, .trn-view table" },
];

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Opens path on the shipped and the unprocessed build. The report is what
// both kinds of page must show: island modules held until the snapshot, no
// page errors, server-rendered nodes, and the unprocessed build's reuse.
async function compareReuse(path, t, stable) {
	const [shipped, baseline] = await Promise.all([
		nodeReuse(sites.shipped, path, stable),
		nodeReuse(sites.baseline, path, stable),
	]);
	t.diagnostic(
		`${path}: shipped reuses ${shipped.reused}/${shipped.total}, unprocessed build ${baseline.reused}/${baseline.total}`,
	);
	const builds = [shipped, baseline];
	return {
		shipped,
		report: {
			loadsIslandModules: builds.every((site) => site.held.size > 0),
			heldUntilSnapshot: builds.every((site) =>
				sameSet(site.intercepted, site.held),
			),
			errors: shipped.errors,
			hasServerNodes: shipped.total > 0,
			reuse: { reused: shipped.reused, total: shipped.total },
		},
		expected: {
			loadsIslandModules: true,
			heldUntilSnapshot: true,
			errors: [],
			hasServerNodes: true,
			reuse: { reused: baseline.reused, total: baseline.total },
		},
	};
}

for (const path of FULL_REUSE_PAGES) {
	it(`a visitor opening ${path} gets its islands hydrated in place`, async (t) => {
		const { shipped, report, expected } = await compareReuse(path, t);
		assert.deepEqual(
			report,
			expected,
			`${path}: island hydration differs from the unprocessed build`,
		);
		assert.equal(
			shipped.reused,
			shipped.total,
			`${path}: every server-rendered island node survives hydration`,
		);
	});
}

for (const { path, stable } of PARITY_PAGES) {
	it(`a visitor opening ${path} gets its islands hydrated as the unprocessed build hydrates them, keeping its title and flow table`, async (t) => {
		const { shipped, report, expected } = await compareReuse(path, t, stable);
		assert.deepEqual(
			report,
			expected,
			`${path}: island hydration differs from the unprocessed build`,
		);
		assert.ok(
			shipped.stable.total > 0,
			`${path}: stable nodes are server-rendered`,
		);
		assert.equal(
			shipped.stable.reused,
			shipped.stable.total,
			`${path}: its stable nodes (${stable}) survive hydration`,
		);
	});
}

it("a phone visitor on a blog page opens and closes the hydrated menu", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	try {
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		const toggle = page.getByRole("button", { name: "Menu" });
		const panel = page.locator("#mobile-navigation");
		const allPosts = page.getByRole("link", { name: "All posts" }).first();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		// onMount enables the toggle in the same update that makes the
		// collapsed panel inert on a phone.
		await page.waitForFunction(
			() => document.querySelector(".menu-toggle")?.disabled === false,
		);
		// Svelte applies a click's state change on its next update, so each
		// check waits for aria-expanded to settle before reading both values.
		const settled = async (expanded) => {
			await page.waitForFunction(
				(value) =>
					document
						.querySelector(".menu-toggle")
						?.getAttribute("aria-expanded") === value,
				expanded,
			);
			return {
				expanded: await toggle.getAttribute("aria-expanded"),
				inert: await panel.evaluate((element) => element.inert),
			};
		};
		assert.deepEqual(await settled("false"), {
			expanded: "false",
			inert: true,
		});
		await toggle.click();
		assert.deepEqual(await settled("true"), {
			expanded: "true",
			inert: false,
		});
		await allPosts.waitFor({ state: "visible" });
		await toggle.click();
		assert.deepEqual(await settled("false"), {
			expanded: "false",
			inert: true,
		});
		assert.deepEqual(errors, [], "no page errors");
	} finally {
		await context.close();
	}
});

it("a desktop visitor on a blog page uses the header links with no menu toggle", async () => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	try {
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		await page.waitForFunction(
			() => document.querySelector(".menu-toggle")?.disabled === false,
		);
		assert.equal(
			await page.locator("#mobile-navigation").evaluate((panel) => panel.inert),
			false,
			"the header links stay reachable on desktop",
		);
		assert.equal(
			await page.locator(".menu-toggle").isVisible(),
			false,
			"desktop shows no menu toggle",
		);
		// Reaching the archive URL proves the click went through.
		await Promise.all([
			page.waitForURL("**/blog/all-posts/"),
			page.locator("header").getByRole("link", { name: "All posts" }).click(),
		]);
		assert.deepEqual(errors, [], "no page errors");
	} finally {
		await context.close();
	}
});

it("a phone visitor without JavaScript gets the expanded header menu from the noscript stylesheet", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		javaScriptEnabled: false,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${sites.shipped.origin}/blog/works-cited/`);
		const header = page.locator("header");
		assert.equal(
			await page.locator(".menu-toggle").isVisible(),
			false,
			"no-script.css hides the toggle that needs JavaScript",
		);
		const categories = header.getByText("Categories", { exact: true });
		assert.equal(await categories.isVisible(), true, "Categories shows");
		await categories.click();
		await header.locator("details.category-menu[open]").waitFor();
		await Promise.all([
			page.waitForURL("**/blog/all-posts/"),
			header.getByRole("link", { name: "All posts" }).click(),
		]);
	} finally {
		await context.close();
	}
});

// The portfolio's primary links as each landmark renders them: the on-site
// blog and recipes open in the same tab, only the resume opens a new one.
// Landmarks are found by label, not role, because a phone viewport hides the
// desktop Primary navigation.
const SITE_LINKS = [
	{ text: "About", href: "/about/", target: null, rel: null },
	{ text: "Contact", href: "/contact/", target: null, rel: null },
	{ text: "Blog", href: "/blog/", target: null, rel: null },
	{ text: "Recipes", href: "/recipes/", target: null, rel: null },
	{
		text: "Resume",
		href: "/John-Solly-Resume.pdf",
		target: "_blank",
		rel: "noopener noreferrer",
	},
];

function landmarkLinks(page, name) {
	return page.locator(`nav[aria-label="${name}"] a`).evaluateAll((links) =>
		links.map((link) => ({
			text: link.textContent.trim(),
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
			rel: link.getAttribute("rel"),
		})),
	);
}

it("A visitor on / reaches the on-site blog and recipes in the same tab and gets the resume in a new tab", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	try {
		const page = await context.newPage();
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${sites.shipped.origin}/`);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		await page.getByRole("button", { name: "Toggle mobile menu" }).click();
		await page
			.getByRole("navigation", { name: "Mobile navigation" })
			.waitFor({ state: "visible" });
		const names = [
			"Primary navigation",
			"Mobile navigation",
			"Footer navigation",
		];
		const landmarks = Object.fromEntries(
			await Promise.all(
				names.map(async (name) => [name, await landmarkLinks(page, name)]),
			),
		);
		assert.deepEqual(landmarks, {
			"Primary navigation": SITE_LINKS,
			"Mobile navigation": SITE_LINKS,
			"Footer navigation": SITE_LINKS,
		});
		const hrefs = await page
			.locator("a[href]")
			.evaluateAll((links) => links.map((link) => link.href));
		assert.deepEqual(
			hrefs.filter((href) => OLD_BLOG_HOST.test(href)),
			[],
			"no link on / points at the old blog host",
		);
		assert.deepEqual(errors, [], "no page errors");
	} finally {
		await context.close();
	}
});

const JSON_LD =
	/<script type="application\/ld\+json">(?<json>[\s\S]*?)<\/script>/u;
const OLD_BIO = /Health-IT/u;

it("A search engine reading the home, about and contact pages gets John's Enterprise Health title and no link to the old blog", async () => {
	const pages = await Promise.all(
		["index.html", "about/index.html", "contact/index.html"].map(
			async (file) => {
				const html = await fs.readFile(join(SHIPPED, file), "utf8");
				const graph = JSON.parse(html.match(JSON_LD).groups.json)["@graph"];
				const person = graph.find((node) => node["@type"] === "Person");
				return {
					file,
					jobTitle: person.jobTitle,
					oldBlogSameAs: graph
						.flatMap((node) => node.sameAs ?? [])
						.filter((url) => OLD_BLOG_HOST.test(url)),
					oldBio: OLD_BIO.test(html),
					oldBlogHost: OLD_BLOG_HOST.test(html),
				};
			},
		),
	);
	assert.deepEqual(
		pages,
		pages.map(({ file }) => ({
			file,
			jobTitle: JOB_TITLE,
			oldBlogSameAs: [],
			oldBio: false,
			oldBlogHost: false,
		})),
	);
});

it("A production build's HTML post-processing leaves every island's hydration markers intact on every page and drops every other comment", () => {
	const markers = (pages) =>
		Object.fromEntries(
			Object.entries(pages).map(([file, { hydration }]) => [file, hydration]),
		);
	assert.deepEqual(
		SYNTHETIC_PAGES.map((page) => {
			const kinds = new Set(unprocessed[page].hydration.map(kindOf));
			return {
				page,
				missingKinds: KINDS.filter((kind) => !kinds.has(kind)),
				ordinary: unprocessed[page].ordinary,
			};
		}),
		SYNTHETIC_PAGES.map((page) => ({
			page,
			missingKinds: [],
			ordinary: [" dropped "],
		})),
		"each synthetic page carries every hydration comment kind and an ordinary comment",
	);
	assert.ok(
		unprocessed["about/index.html"].hydration.includes("astro:end"),
		"the unprocessed /about/ page has its navigation island markers",
	);
	assert.deepEqual(markers(processed), markers(unprocessed));
	assert.deepEqual(
		Object.entries(processed).filter(([, { ordinary }]) => ordinary.length > 0),
		[],
		"no processed page keeps a non-hydration comment",
	);
});
