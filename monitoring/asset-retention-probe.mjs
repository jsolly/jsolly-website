// biome-ignore-all lint/suspicious/noMisplacedAssertion lint/nursery/noConditionalExpect: These are runtime acceptance checks in an operational probe, not conditional test cases.
// Read-only production asset acceptance. Capture A, then verify after a real B release.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { productionUrl } from "./production-smoke-scenario.mjs";

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GENERATED_FILE = /\.(?:js|css)$/u;
const digest = (body) => createHash("sha256").update(body).digest("hex");

/** Read actual resource nodes; inert script strings and navigation links are excluded. */
export function pinnedPageAssets(html) {
	const paths = new Set();
	let component;
	function visit(node) {
		const attrs = Object.fromEntries(
			(node.attrs ?? []).map(({ name, value }) => [name, value]),
		);
		const values = [];
		if (node.tagName === "script" && attrs.src) values.push(attrs.src);
		if (node.tagName === "link" && attrs.rel?.toLowerCase() === "stylesheet")
			values.push(attrs.href);
		if (node.tagName === "astro-island") {
			values.push(attrs["component-url"], attrs["renderer-url"]);
			component ??= attrs["component-url"];
		}
		for (const value of values.filter(Boolean)) {
			const url = new URL(value, productionUrl);
			if (
				url.origin === productionUrl &&
				url.pathname.startsWith("/_astro/") &&
				GENERATED_FILE.test(url.pathname)
			)
				paths.add(url.pathname + url.search);
		}
		for (const child of node.childNodes ?? []) visit(child);
	}
	visit(parse(html, { scriptingEnabled: false }));
	assert.ok(
		component && paths.has(component),
		"page must expose a generated island component",
	);
	const ids = new Set(
		[...paths].map((path) => {
			const params = [...new URL(path, productionUrl).searchParams];
			assert.equal(params.length, 1, `expected one deployment pin: ${path}`);
			assert.equal(params[0][0], "dpl", `expected dpl pin: ${path}`);
			assert.ok(params[0][1], `empty deployment pin: ${path}`);
			return params[0][1];
		}),
	);
	assert.equal(ids.size, 1, "mixed deployments in one page");
	assert.ok(
		[...paths].some((path) =>
			new URL(path, productionUrl).pathname.endsWith(".css"),
		),
		"page must expose a generated stylesheet",
	);
	return { deploymentId: [...ids][0], component, paths: [...paths].sort() };
}

function request(path) {
	const url = new URL(path, productionUrl);
	assert.equal(
		url.origin,
		productionUrl,
		"probe requests stay on the production origin",
	);
	return fetch(url, {
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
	});
}

async function release() {
	const response = await request("/release.json");
	assert.equal(response.status, 200, "production release identity");
	const { sha } = await response.json();
	assert.match(sha, SHA, "release must identify a full commit");
	return sha;
}

async function asset(path) {
	const response = await request(path);
	assert.equal(response.status, 200, `retained asset: ${path}`);
	const mime = (response.headers.get("content-type") ?? "").split(";")[0];
	assert.ok(
		new URL(path, productionUrl).pathname.endsWith(".css")
			? mime === "text/css"
			: ["text/javascript", "application/javascript"].includes(mime),
		`unexpected asset content type: ${path}`,
	);
	const body = Buffer.from(await response.arrayBuffer());
	return { path, bytes: body.byteLength, sha256: digest(body) };
}

export async function captureAssets() {
	const sha = await release();
	const response = await request("/about/");
	assert.equal(response.status, 200, "production About page");
	const { deploymentId, component, paths } = pinnedPageAssets(
		await response.text(),
	);
	const assets = await Promise.all(paths.map(asset));
	assert.equal(
		await release(),
		sha,
		"release changed during capture; capture again",
	);
	return {
		schemaVersion: 1,
		origin: productionUrl,
		capturedAt: new Date().toISOString(),
		release: sha,
		deploymentId,
		component,
		assets,
	};
}

export async function verifyAssets(capture) {
	assert.equal(capture.schemaVersion, 1);
	assert.equal(capture.origin, productionUrl);
	assert.match(capture.release, SHA);
	assert.ok(capture.assets.length > 0);
	assert.ok(capture.assets.some(({ path }) => path === capture.component));
	for (const { path, bytes, sha256 } of capture.assets) {
		const url = new URL(path, productionUrl);
		assert.equal(url.origin, productionUrl);
		assert.ok(
			url.pathname.startsWith("/_astro/") && GENERATED_FILE.test(url.pathname),
		);
		assert.deepEqual([...url.searchParams], [["dpl", capture.deploymentId]]);
		assert.ok(Number.isSafeInteger(bytes) && bytes > 0);
		assert.match(sha256, SHA256);
	}
	const currentRelease = await release();
	assert.notEqual(
		currentRelease,
		capture.release,
		"a different real release must be current",
	);
	const retained = await Promise.all(
		capture.assets.map(async (expected) => {
			const actual = await asset(expected.path);
			assert.deepEqual(
				actual,
				expected,
				`old deployment bytes changed: ${expected.path}`,
			);
			return actual;
		}),
	);
	const componentAsset = capture.assets.find(
		({ path }) => path === capture.component,
	);
	const controlPath = new URL(capture.component, productionUrl).pathname;
	const control = await request(controlPath);
	const controlDetails = {
		path: controlPath,
		status: control.status,
		contentType: control.headers.get("content-type"),
	};
	if (control.status !== 404) {
		assert.equal(
			control.status,
			200,
			"unpinned control must be available or absent",
		);
		const body = Buffer.from(await control.arrayBuffer());
		controlDetails.bytes = body.byteLength;
		controlDetails.sha256 = digest(body);
		assert.notEqual(
			controlDetails.sha256,
			componentAsset.sha256,
			"identical B bytes cannot prove old-deployment routing",
		);
	}
	assert.equal(
		await release(),
		currentRelease,
		"release changed during verification; verify again",
	);
	return {
		verifiedAt: new Date().toISOString(),
		capturedAt: capture.capturedAt,
		deploymentId: capture.deploymentId,
		oldRelease: capture.release,
		currentRelease,
		retained,
		control: controlDetails,
		browserImport: "separate cold-browser acceptance required",
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [mode, file, ...extra] = process.argv.slice(2);
	assert.ok(
		(mode === "capture" || mode === "verify") && file && extra.length === 0,
		"usage: node monitoring/asset-retention-probe.mjs capture|verify /absolute/evidence.json",
	);
	assert.equal(resolve(file), file, "use an absolute evidence path");
	if (mode === "capture") {
		const capture = await captureAssets();
		await writeFile(file, `${JSON.stringify(capture, null, 2)}\n`, {
			flag: "wx",
		});
		console.log(JSON.stringify(capture, null, 2));
	} else
		console.log(
			JSON.stringify(
				await verifyAssets(JSON.parse(await readFile(file, "utf8"))),
				null,
				2,
			),
		);
}
