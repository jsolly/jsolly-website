// Check 4.9: the ported blog and recipe pages against live www.blogthedata.com,
// screenshot by screenshot (after B06c, B07, B08 and in C0):
//
//   npm run build && node scripts/port/visual-compare.mjs [--pages home,works-cited]
//
// Serves dist/ with `astro preview` (or uses --local <origin>), opens each page
// on both sides at 1280×800 and 390×844 in Chromium, and compares full-page
// screenshots pixel by pixel with sharp. The local path is the url-map.json
// destination of the old path, so there is no second mapping to drift.
// Header and footer (their link targets differ by design) and per-page
// regions such as the shuffled recipe cards are masked on both sides and left
// out of the comparison; a height difference counts as differing pixels.
// Screenshots, diff images and report.json go to a fresh os.tmpdir()
// directory. Exits 1 when a page differs by more than 0.5% outside its masks
// or fails to load: review it and record the result in the PR body.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { JSOLLY_ORIGIN, readLegacyJson } from "../blogthedata-redirects.mjs";
import { parseCli, ROOT, runCli } from "./lib.mjs";

const LIVE_ORIGIN = "https://www.blogthedata.com";
const THRESHOLD_PERCENT = 0.5;
// A channel must move by more than this (of 255) to count, which absorbs
// anti-aliasing noise without hiding a real change.
const CHANNEL_TOLERANCE = 24;
const VIEWPORTS = [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 },
];
const CHROME_MASKS = ["header", "footer"];
const PAGES = [
	{ name: "home", old: "/" },
	{
		name: "code-post",
		old: "/post/how-to-get-a-perfect-mozilla-observatory-score/",
	},
	{
		name: "youtube-post",
		old: "/post/I-re-created-1979-Atari-game-asteroids-with-JS/",
	},
	{ name: "category", old: "/category/Geodev/" },
	{ name: "all-posts", old: "/all-posts/" },
	{ name: "search", old: "/search/" },
	{ name: "works-cited", old: "/works-cited/" },
	{ name: "recipes-meals", old: "/recipes/meals/", masks: [".recipe-grid"] },
	{ name: "recipe-detail", old: "/recipes/chicken-posole/" },
];
const ASTRO_BIN = join(ROOT, "node_modules", "astro", "bin", "astro.mjs");
const PREVIEW_TIMEOUT_MS = 30_000;
const MASK_COLOR = "#ff00ff";

function localPath(old) {
	const row = readLegacyJson("url-map.json").rows.find(
		(candidate) =>
			candidate.source === old && candidate.action === "redirect-301",
	);
	if (!row) {
		throw new Error(`url-map.json has no redirect row for ${old}`);
	}
	return row.destination.slice(JSOLLY_ORIGIN.length);
}

function freePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});
}

async function waitForServer(origin, deadline) {
	try {
		await fetch(origin);
	} catch (error) {
		if (Date.now() > deadline) {
			throw new Error(`astro preview did not answer at ${origin}`, {
				cause: error,
			});
		}
		await sleep(250);
		await waitForServer(origin, deadline);
	}
}

async function startPreview() {
	if (!existsSync(join(ROOT, "dist"))) {
		throw new Error("no dist/: run `npm run build` first");
	}
	const port = await freePort();
	const child = spawn(
		process.execPath,
		[ASTRO_BIN, "preview", "--host", "127.0.0.1", "--port", String(port)],
		{ cwd: ROOT, stdio: "ignore" },
	);
	const origin = `http://127.0.0.1:${port}`;
	await waitForServer(origin, Date.now() + PREVIEW_TIMEOUT_MS);
	return { origin, stop: () => child.kill() };
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
		const boxes = await page.$$eval(selectors.join(","), (elements) =>
			elements.map((element) => {
				const rect = element.getBoundingClientRect();
				return {
					left: rect.left + window.scrollX,
					top: rect.top + window.scrollY,
					right: rect.right + window.scrollX,
					bottom: rect.bottom + window.scrollY,
				};
			}),
		);
		await page.screenshot({
			path: file,
			fullPage: true,
			animations: "disabled",
			caret: "hide",
			mask: selectors.map((selector) => page.locator(selector)),
			maskColor: MASK_COLOR,
		});
		return { status: response?.status() ?? 0, boxes };
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
export function comparePixels(live, local, boxes) {
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
		percent: compared === 0 ? 0 : (100 * differing) / compared,
	};
}

async function comparePage(browser, origins, outDir, page, viewport) {
	const label = `${page.name}-${viewport.width}x${viewport.height}`;
	const selectors = [...CHROME_MASKS, ...(page.masks ?? [])];
	const newPath = localPath(page.old);
	const [live, local] = await Promise.all([
		shoot(
			browser,
			`${origins.live}${page.old}`,
			viewport,
			selectors,
			join(outDir, `${label}-live.png`),
		),
		shoot(
			browser,
			`${origins.local}${newPath}`,
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
	const loaded = live.status === 200 && local.status === 200;
	return {
		label,
		old: page.old,
		local: newPath,
		status: { live: live.status, local: local.status },
		percent: Number(result.percent.toFixed(3)),
		pass: loaded && result.percent <= THRESHOLD_PERCENT,
	};
}

async function main(argv) {
	const options = parseCli(argv, {
		pages: { type: "string" },
		local: { type: "string" },
		live: { type: "string" },
	});
	const wanted = options.pages?.split(",") ?? PAGES.map((page) => page.name);
	const pages = PAGES.filter((page) => wanted.includes(page.name));
	if (pages.length !== wanted.length) {
		throw new Error(
			`--pages takes: ${PAGES.map((page) => page.name).join(", ")}`,
		);
	}
	const preview = options.local ? null : await startPreview();
	const origins = {
		live: options.live ?? LIVE_ORIGIN,
		local: options.local ?? preview.origin,
	};
	const outDir = mkdtempSync(join(tmpdir(), "visual-compare-"));
	const browser = await chromium.launch();
	try {
		const results = (
			await inSequence(pages, (page) =>
				Promise.all(
					VIEWPORTS.map((viewport) =>
						comparePage(browser, origins, outDir, page, viewport),
					),
				),
			)
		).flat();
		writeFileSync(
			join(outDir, "report.json"),
			`${JSON.stringify(results, null, "\t")}\n`,
		);
		for (const result of results) {
			console.log(
				`${result.pass ? "✓" : "✗"} ${result.label}: ${result.percent}% differing (live ${result.status.live}, local ${result.status.local} ${result.local})`,
			);
		}
		console.log(`Screenshots, diffs and report.json: ${outDir}`);
		return results.every((result) => result.pass) ? 0 : 1;
	} finally {
		await browser.close();
		preview?.stop();
	}
}

runCli(import.meta.url, main);
