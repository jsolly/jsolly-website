import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { globby } from "globby";
import { chromium } from "playwright";
import { serveStatic, stubOffOrigin } from "./pages.mjs";
import { createTempCopy } from "./temp-copy.mjs";

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
// reuses on every page below, and discard exactly the page's `discarded`
// nodes (none, except where an island replaces its own server render).
const SHIPPED = "dist";
// The comments islands hydrate from, listed independently of process-html.mjs
// so that dropping one of its ignoreCustomComments patterns fails here: Svelte
// block open (`[`, `[!`, `[-1`) and close (`]`), empty anchors, `$props.id()`
// markers (`$s1`) and Astro's `astro:end`.
const HYDRATION_COMMENT = /^(?:\[.*|\].*|\$.*|astro:end|)$/su;
const COMMENT = /<!--(?<data>[\s\S]*?)-->/gu;
const ISLAND_MODULE = /\s(?:component|renderer)-url="(?<url>[^"]+)"/gu;
// Astro hashes an island's uid from the component's absolute path, so the
// temp copy's uids differ from the real tree's; the dist/ comparison masks them.
const ISLAND_UID = /(?<=<astro-island\b[^>]*\s)uid="[^"]*"/gu;
const KINDS = ["[", "]", "", "$", "astro:end"];
// No page uses $props.id() yet, so a synthetic page carries every kind, plus
// an ordinary comment that processing must drop.
const SYNTHETIC_PAGE = "__hydration-markers__/index.html";
const SYNTHETIC_HTML = `<!doctype html>
<html lang="en">
	<head><title>markers</title><!-- dropped --></head>
	<body>
		<astro-island ssr>
			<!--[--><p>
				one   <!--$s1-->
			</p><!----><!--[!--><!--]--><!--[-1--><span>two</span><!--]--><!--]-->
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

function succeeded(result, command) {
	if (result.status !== 0) {
		throw new Error(
			`${command} in ${copy.dir} failed:\n${result.stdout}${result.stderr}`,
		);
	}
}

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
				(match) => match.groups.data,
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
		(file) => file !== SYNTHETIC_PAGE,
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

async function nodeReuse({ root, origin }, path) {
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
		const total = await page.evaluate(() => {
			window.__ssrIslandNodes = [
				...document.querySelectorAll("astro-island[ssr] *"),
			];
			return window.__ssrIslandNodes.length;
		});
		release();
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		await page.waitForLoadState("networkidle");
		const reused = await page.evaluate(
			() => window.__ssrIslandNodes.filter((node) => node.isConnected).length,
		);
		return { total, reused, errors, held, intercepted };
	} finally {
		release();
		await context.close();
	}
}

before(async () => {
	copy = await createTempCopy("hydration");
	succeeded(copy.astroBuild(), "astro build");
	const dist = join(copy.dir, "dist");
	const synthetic = join(dist, SYNTHETIC_PAGE);
	await fs.mkdir(dirname(synthetic), { recursive: true });
	await fs.writeFile(synthetic, SYNTHETIC_HTML);
	const baseline = join(copy.dir, "baseline");
	await fs.cp(dist, baseline, { recursive: true });
	unprocessed = await pageComments(baseline);
	succeeded(
		spawnSync(process.execPath, ["process-html.mjs"], {
			cwd: copy.dir,
			encoding: "utf8",
		}),
		"node process-html.mjs",
	);
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

// Plan §4.5. On mount the search island swaps its one server-rendered
// "Loading search..." paragraph for the query's state; every other node on
// that page, the header navigation included, must survive.
const PAGES = [
	{ path: "/", discarded: 0 },
	{ path: "/about/", discarded: 0 },
	{ path: "/blog/", discarded: 0 },
	{ path: "/blog/works-cited/", discarded: 0 },
	{ path: "/blog/search/", discarded: 1 },
];

for (const { path, discarded } of PAGES) {
	it(`a visitor opening ${path} gets its islands hydrated in place`, async (t) => {
		const [shipped, baseline] = await Promise.all([
			nodeReuse(sites.shipped, path),
			nodeReuse(sites.baseline, path),
		]);
		t.diagnostic(
			`${path}: shipped reuses ${shipped.reused}/${shipped.total}, unprocessed build ${baseline.reused}/${baseline.total}`,
		);
		for (const site of [shipped, baseline]) {
			assert.ok(site.held.size > 0, `${path}: the page loads island modules`);
			assert.deepEqual(
				site.intercepted,
				site.held,
				`${path}: every island module was held until the snapshot`,
			);
		}
		assert.deepEqual(shipped.errors, [], `${path}: no page errors`);
		assert.ok(
			shipped.total > 0,
			`${path}: the island has server-rendered nodes`,
		);
		assert.deepEqual(
			{ reused: shipped.reused, total: shipped.total },
			{ reused: baseline.reused, total: baseline.total },
			`${path}: process-html changes island node reuse`,
		);
		assert.equal(
			shipped.total - shipped.reused,
			discarded,
			`${path}: server-rendered island nodes discarded by hydration`,
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

it("A production build's HTML post-processing leaves every island's hydration markers intact on every page and drops every other comment", () => {
	const markers = (pages) =>
		Object.fromEntries(
			Object.entries(pages).map(([file, { hydration }]) => [file, hydration]),
		);
	const syntheticKinds = new Set(
		unprocessed[SYNTHETIC_PAGE].hydration.map(kindOf),
	);
	assert.deepEqual(
		KINDS.filter((kind) => !syntheticKinds.has(kind)),
		[],
		"the synthetic page carries every hydration comment kind",
	);
	assert.deepEqual(
		unprocessed[SYNTHETIC_PAGE].ordinary,
		[" dropped "],
		"the synthetic page carries an ordinary comment",
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
