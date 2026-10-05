// Check 4.9: the ported blog and recipe pages against live www.blogthedata.com,
// screenshot by screenshot (after B06c, B07, B08 and in C0):
//
//   npm run build && node scripts/port/visual-compare.mjs [--pages home,works-cited]
//
// Serves dist/ in-process (or uses --local <origin>), opens each page on
// both sides at 1280×800 and 390×844 in Chromium, and compares full-page
// screenshots pixel by pixel with sharp, once every image has loaded. The local path is the url-map.json
// destination of the old path, so there is no second mapping to drift.
// The site header and footer (their link targets differ by design) and
// per-page regions such as the shuffled recipe cards are masked on both sides
// and left out of the comparison; every mask must match an element, and a
// height difference counts as differing pixels. A live page that redirected
// off the --live host fails.
// Screenshots, diff images and report.json go to a fresh os.tmpdir()
// directory. Exits 1 when a page differs by more than 0.5% outside its masks
// or fails to load: review it and record the result in the PR body.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { parseCli, ROOT, redirectPaths, runCli } from "./lib.mjs";

const LIVE_ORIGIN = "https://www.blogthedata.com";
const THRESHOLD_PERCENT = 0.5;
// A channel must move by more than this (of 255) to count, which absorbs
// anti-aliasing noise without hiding a real change.
const CHANNEL_TOLERANCE = 24;
const VIEWPORTS = [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 },
];
// Only the site chrome: a post's own <footer class="post-details"> is content.
const CHROME_MASKS = ["body > header", "body > footer"];
const PAGES = [
	{ name: "home", old: "/" },
	{
		name: "code-post",
		old: "/post/how-to-get-a-perfect-mozilla-observatory-score/",
	},
	{
		name: "youtube-post",
		// A post with an embedded YouTube iframe.
		old: "/post/how-to-debug-an-astro-app/",
	},
	{ name: "category", old: "/category/Geodev/" },
	{ name: "all-posts", old: "/all-posts/" },
	{ name: "search", old: "/search/" },
	// `query` goes on both URLs; the url-map.json rows match the bare path.
	{ name: "search-django", old: "/search/", query: "?searched=django" },
	{ name: "works-cited", old: "/works-cited/" },
	{ name: "recipes-meals", old: "/recipes/meals/", masks: [".recipe-grid"] },
	{ name: "recipe-detail", old: "/recipes/chicken-posole/" },
];
const MASK_COLOR = "#ff00ff";
const MIN_COMPARED_SHARE = 0.2;

function localPath(redirects, old) {
	const path = redirects.get(old);
	if (!path) {
		throw new Error(`url-map.json has no redirect row for ${old}`);
	}
	return path;
}

// Serves dist/ the way a static host does: a directory answers with its
// index.html, anything missing with dist/404.html and status 404. In-process,
// so nothing outlives the run (`astro preview` daemonizes without a TTY).
const CONTENT_TYPES = {
	".css": "text/css",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".js": "text/javascript",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".xml": "application/xml",
};

async function readServed(dist, pathname) {
	const target = normalize(join(dist, decodeURIComponent(pathname)));
	if (!target.startsWith(dist)) {
		return null;
	}
	const file = pathname.endsWith("/") ? join(target, "index.html") : target;
	try {
		return { file, body: await readFile(file) };
	} catch {
		return null;
	}
}

async function serveDist() {
	const dist = join(ROOT, "dist");
	if (!existsSync(dist)) {
		throw new Error("no dist/: run `npm run build` first");
	}
	const server = createServer(async (request, response) => {
		const { pathname } = new URL(request.url, "http://localhost");
		const found = await readServed(dist, pathname);
		const served = found ?? {
			file: join(dist, "404.html"),
			body: await readFile(join(dist, "404.html")),
		};
		response.writeHead(found ? 200 : 404, {
			"content-type":
				CONTENT_TYPES[extname(served.file)] ?? "application/octet-stream",
		});
		response.end(served.body);
	});
	await new Promise((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		stop: () => {
			server.closeAllConnections();
			server.close();
		},
	};
}

// Runs `run` over `items` one at a time, collecting the results.
async function inSequence(items, run) {
	const results = [];
	await items.reduce(async (previous, item) => {
		await previous;
		results.push(await run(item));
	}, Promise.resolve());
	return results;
}

// Lazy images and iframes below the fold would otherwise still be blank (or
// load mid-shot) when the full-page screenshot is taken. They switch to eager
// in place, rather than by scrolling, which would also fire the post cards'
// automatic batches; the shot waits until every <img> has loaded (or failed)
// and decoded, and the network is idle again.
async function loadEveryImage(page) {
	await page.evaluate(async () => {
		for (const element of document.querySelectorAll("img, iframe")) {
			element.loading = "eager";
		}
		await Promise.allSettled(
			Array.from(document.images, (image) => image.decode()),
		);
	});
	await page.waitForLoadState("networkidle");
	const incomplete = await page.evaluate(
		() => Array.from(document.images).filter((image) => !image.complete).length,
	);
	if (incomplete > 0) {
		throw new Error(`${page.url()}: ${incomplete} images never completed`);
	}
}

async function shoot(browser, url, viewport, selectors, file) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
		serviceWorkers: "block",
	});
	try {
		const page = await context.newPage();
		const response = await page.goto(url, { waitUntil: "networkidle" });
		await page.evaluate(() => document.fonts.ready);
		await loadEveryImage(page);
		const perSelector = await Promise.all(
			selectors.map((selector) =>
				page.$$eval(selector, (elements) =>
					elements.map((element) => {
						const rect = element.getBoundingClientRect();
						return {
							left: rect.left + window.scrollX,
							top: rect.top + window.scrollY,
							right: rect.right + window.scrollX,
							bottom: rect.bottom + window.scrollY,
						};
					}),
				),
			),
		);
		const unmatched = selectors.filter(
			(_selector, index) => perSelector[index].length === 0,
		);
		await page.screenshot({
			path: file,
			fullPage: true,
			animations: "disabled",
			caret: "hide",
			mask: selectors.map((selector) => page.locator(selector)),
			maskColor: MASK_COLOR,
		});
		return {
			status: response?.status() ?? 0,
			finalUrl: page.url(),
			boxes: perSelector.flat(),
			unmatched,
		};
	} finally {
		await context.close();
	}
}

async function rawImage(file) {
	const { data, info } = await sharp(file)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

// Differing pixels outside every mask box of either side, over the pixels
// compared; a pixel only one image has always differs.
function comparePixels(live, local, boxes) {
	const width = Math.max(live.width, local.width);
	const height = Math.max(live.height, local.height);
	const diff = Buffer.alloc(width * height * 4);
	let compared = 0;
	let differing = 0;
	const masked = (x, y) =>
		boxes.some(
			(box) => x >= box.left && x < box.right && y >= box.top && y < box.bottom,
		);
	const channel = (image, x, y, offset) =>
		image.data[(y * image.width + x) * 4 + offset];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * 4;
			diff[at + 3] = 255;
			if (masked(x, y)) {
				diff[at + 2] = 96;
				continue;
			}
			compared += 1;
			const inBoth =
				x < live.width &&
				y < live.height &&
				x < local.width &&
				y < local.height;
			const same =
				inBoth &&
				[0, 1, 2, 3].every(
					(offset) =>
						Math.abs(
							channel(live, x, y, offset) - channel(local, x, y, offset),
						) <= CHANNEL_TOLERANCE,
				);
			if (same) {
				diff[at] = Math.round(channel(local, x, y, 0) / 3);
				diff[at + 1] = Math.round(channel(local, x, y, 1) / 3);
				diff[at + 2] = Math.round(channel(local, x, y, 2) / 3);
			} else {
				differing += 1;
				diff[at] = 255;
			}
		}
	}
	return {
		width,
		height,
		diff,
		compared,
		percent: compared === 0 ? 0 : (100 * differing) / compared,
	};
}

async function comparePage(
	{ browser, origins, redirects, outDir },
	page,
	viewport,
) {
	const label = `${page.name}-${viewport.width}x${viewport.height}`;
	const selectors = [...CHROME_MASKS, ...(page.masks ?? [])];
	const newPath = localPath(redirects, page.old);
	const query = page.query ?? "";
	const [live, local] = await Promise.all([
		shoot(
			browser,
			`${origins.live}${page.old}${query}`,
			viewport,
			selectors,
			join(outDir, `${label}-live.png`),
		),
		shoot(
			browser,
			`${origins.local}${newPath}${query}`,
			viewport,
			selectors,
			join(outDir, `${label}-local.png`),
		),
	]);
	const [liveImage, localImage] = await Promise.all([
		rawImage(join(outDir, `${label}-live.png`)),
		rawImage(join(outDir, `${label}-local.png`)),
	]);
	const result = comparePixels(liveImage, localImage, [
		...live.boxes,
		...local.boxes,
	]);
	await sharp(result.diff, {
		raw: { width: result.width, height: result.height, channels: 4 },
	})
		.png()
		.toFile(join(outDir, `${label}-diff.png`));
	// page.goto follows redirects; a live page that left the live host (a
	// cutover already in place) compares jsolly.com with itself.
	const problems = [
		...(live.status === 200 ? [] : [`live answered ${live.status}`]),
		...(local.status === 200 ? [] : [`local answered ${local.status}`]),
		...(new URL(live.finalUrl).host === new URL(origins.live).host
			? []
			: [`live ended on ${live.finalUrl}`]),
		...live.unmatched.map(
			(selector) => `mask ${selector} matched nothing live`,
		),
		...local.unmatched.map(
			(selector) => `mask ${selector} matched nothing locally`,
		),
		// Masks that swallow most of the page would let anything pass.
		...(result.compared < MIN_COMPARED_SHARE * result.width * result.height
			? ["nothing left to compare outside masks"]
			: []),
	];
	return {
		label,
		old: `${page.old}${query}`,
		local: `${newPath}${query}`,
		percent: Number(result.percent.toFixed(3)),
		problems,
		pass: problems.length === 0 && result.percent <= THRESHOLD_PERCENT,
	};
}

async function main(argv) {
	const options = parseCli(argv, {
		options: {
			pages: { type: "string" },
			local: { type: "string" },
			live: { type: "string" },
		},
	});
	const wanted = options.pages?.split(",") ?? PAGES.map((page) => page.name);
	const pages = PAGES.filter((page) => wanted.includes(page.name));
	if (pages.length !== wanted.length) {
		throw new Error(
			`--pages takes: ${PAGES.map((page) => page.name).join(", ")}`,
		);
	}
	const redirects = redirectPaths(ROOT);
	const preview = options.local ? null : await serveDist();
	let browser = null;
	try {
		const origins = {
			live: options.live ?? LIVE_ORIGIN,
			local: options.local ?? preview.origin,
		};
		const outDir = mkdtempSync(join(tmpdir(), "visual-compare-"));
		browser = await chromium.launch();
		const run = { browser, origins, redirects, outDir };
		const results = (
			await inSequence(pages, (page) =>
				Promise.all(
					VIEWPORTS.map((viewport) => comparePage(run, page, viewport)),
				),
			)
		).flat();
		writeFileSync(
			join(outDir, "report.json"),
			`${JSON.stringify(results, null, "\t")}\n`,
		);
		for (const result of results) {
			console.log(
				`${result.pass ? "✓" : "✗"} ${result.label}: ${result.percent}% differing (local ${result.local})${result.problems.map((problem) => `; ${problem}`).join("")}`,
			);
		}
		console.log(`Screenshots, diffs and report.json: ${outDir}`);
		return results.every((result) => result.pass) ? 0 : 1;
	} finally {
		await browser?.close();
		preview?.stop();
	}
}

runCli(import.meta.url, main);
