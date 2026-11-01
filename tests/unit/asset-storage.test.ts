// biome-ignore-all lint/suspicious/useAwait: Fake transport methods deliberately implement the asynchronous production interface.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import template from "../../config/aws/static-assets/template.json" with {
	type: "json",
};
import {
	type AssetManifest,
	type AssetTransport,
	assertCoverage,
	assertUploadTarget,
	assetUrl,
	CACHE_CONTROL,
	createManifest,
	digest,
	manifestSchema,
	type ObjectResponse,
	objectKey,
	publishedReferences,
	TransientError,
	uploadAssets,
	verifyAssets,
} from "../../static-assets/media.js";
import { documentReferences } from "../../static-assets/references.js";

const bytes = new TextEncoder().encode("image-fixture");
const path = "/blog/media/test.webp";
const sha256 = digest(bytes);
const manifest: AssetManifest = {
	version: 1,
	assets: [
		{
			path,
			sha256,
			bytes: bytes.length,
			key: objectKey(path, sha256),
			contentType: "image/webp",
		},
	],
};
const asset = manifest.assets[0];
if (!asset) throw new Error("Missing test fixture");
const object = (): ObjectResponse => ({
	bytes,
	contentType: "image/webp",
	cacheControl: CACHE_CONTROL,
});
function fake(
	initial?: ObjectResponse,
): AssetTransport & { writes: number; value: ObjectResponse | undefined } {
	const state: AssetTransport & {
		writes: number;
		value: ObjectResponse | undefined;
	} = {
		writes: 0,
		value: initial,
		async get() {
			return state.value;
		},
		async put() {
			state.writes++;
			state.value = object();
		},
	};
	return state;
}

it("immutable keys and public mappings remain stable and reject altered manifest contracts", () => {
	assert.deepEqual(manifestSchema.parse(manifest), manifest);
	assert.equal(
		assetUrl("https://d123.cloudfront.net", asset),
		`https://d123.cloudfront.net/sha256/${sha256}/blog/media/test.webp`,
	);
	for (const change of [
		{ key: "other" },
		{ path: "/blog/media/../private.webp" },
		{ path: "/recipes/pwa/icon.png" },
		{ contentType: "text/html" },
	])
		assert.throws(() =>
			manifestSchema.parse({ version: 1, assets: [{ ...asset, ...change }] }),
		);
	assert.throws(() =>
		manifestSchema.parse({ version: 1, assets: [asset, asset] }),
	);
	assert.throws(() => assetUrl("https://example.com", asset));
	assert.throws(() => assetUrl("https://d123.cloudfront.net/path", asset));
});

it("published-reference coverage fails for missing and unpublished images", () => {
	assertCoverage(manifest, new Set([path]));
	assert.throws(
		() => assertCoverage(manifest, new Set([path, "/images/missing.png"])),
		/missing/u,
	);
	assert.throws(
		() => assertCoverage(manifest, new Set()),
		/no longer published/u,
	);
});

it("inventories published documents and data without exposing unreferenced or symlinked files", async () => {
	const root = await mkdtemp(join(tmpdir(), "asset-inventory-"));
	try {
		await mkdir(join(root, "public/blog/media"), { recursive: true });
		await mkdir(join(root, "dist"));
		await writeFile(join(root, `public${path}`), bytes);
		await writeFile(
			join(root, "public/blog/media/private.webp"),
			"unpublished",
		);
		await writeFile(join(root, "dist/index.html"), `<img src="${path}">`);
		const references = await publishedReferences(join(root, "dist"));
		assert.deepEqual(await createManifest(root, references), manifest);
		await rm(join(root, `public${path}`));
		await symlink(
			join(root, "public/blog/media/private.webp"),
			join(root, `public${path}`),
		);
		await assert.rejects(createManifest(root, references), /Symlink/u);
		await rm(join(root, "public"), { recursive: true, force: true });
		await mkdir(join(root, "outside/blog/media"), { recursive: true });
		await writeFile(join(root, `outside${path}`), bytes);
		await symlink(join(root, "outside"), join(root, "public"));
		await assert.rejects(createManifest(root, references), /Symlink/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("uploads are idempotent, verify bytes and headers, and never overwrite corrupt remote objects", async () => {
	const transport = fake();
	await uploadAssets(manifest, async () => bytes, transport);
	assert.equal(transport.writes, 1);
	await uploadAssets(manifest, async () => bytes, transport);
	assert.equal(transport.writes, 1);
	transport.value = { ...object(), bytes: new Uint8Array([1]) };
	await assert.rejects(
		uploadAssets(manifest, async () => bytes, transport),
		/bytes mismatch/u,
	);
	assert.equal(transport.writes, 1);
});

it("verification rejects missing, hash-mismatched and incorrectly served objects", async () => {
	await assert.rejects(verifyAssets(manifest, fake()), /Missing object/u);
	await Promise.all(
		[
			{ bytes: new Uint8Array(bytes.length) },
			{ contentType: "text/html" },
			{ cacheControl: "public, max-age=3600" },
		].map((change) =>
			assert.rejects(
				verifyAssets(manifest, fake({ ...object(), ...change })),
				/mismatch/u,
			),
		),
	);
});

it("all local bytes are checked before uploads; failed uploads cannot pass verification", async () => {
	const transport = fake();
	await assert.rejects(
		uploadAssets(manifest, async () => new Uint8Array([2]), transport),
		/Local bytes mismatch/u,
	);
	assert.equal(transport.writes, 0);
	const discarded: AssetTransport = {
		async get() {
			/* Deliberately missing object. */
		},
		async put() {
			/* Deliberately lose the upload. */
		},
	};
	await assert.rejects(
		uploadAssets(manifest, async () => bytes, discarded),
		/not readable/u,
	);
});

it("transient failures retry within a bound and authorization failures stop immediately", async () => {
	let attempts = 0;
	const transport = fake(object());
	transport.get = async () => {
		if (++attempts < 3) throw new TransientError("retry");
		return object();
	};
	await verifyAssets(manifest, transport);
	assert.equal(attempts, 3);
	attempts = 0;
	transport.get = async () => {
		attempts++;
		throw new Error("denied");
	};
	await assert.rejects(verifyAssets(manifest, transport), /denied/u);
	assert.equal(attempts, 1);
	attempts = 0;
	transport.get = async () => {
		attempts++;
		throw new TransientError("offline");
	};
	await assert.rejects(verifyAssets(manifest, transport), /offline/u);
	assert.equal(attempts, 3);
});

it("the storage stack retains encrypted versioned objects behind one private signed origin", () => {
	const resources = template.Resources;
	const bucket = resources.MediaBucket;
	assert.equal(bucket.DeletionPolicy, "Retain");
	assert.equal(bucket.UpdateReplacePolicy, "Retain");
	assert.equal(bucket.Properties.VersioningConfiguration.Status, "Enabled");
	assert.ok(
		Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(
			Boolean,
		),
	);
	assert.equal(
		bucket.Properties.OwnershipControls.Rules[0]?.ObjectOwnership,
		"BucketOwnerEnforced",
	);
	assert.equal(
		resources.OriginAccess.Properties.OriginAccessControlConfig.SigningBehavior,
		"always",
	);
	assert.equal(
		resources.MediaDistribution.Properties.DistributionConfig
			.DefaultCacheBehavior.ViewerProtocolPolicy,
		"https-only",
	);
	const policy = JSON.stringify(resources.MediaBucketPolicy);
	assert.ok(policy.includes("AWS:SourceArn"));
	assert.ok(policy.includes("/sha256/*"));
	assert.ok(policy.includes("aws:SecureTransport"));
	assert.equal(resources.MediaCache.Properties.CachePolicyConfig.MinTTL, 0);
	assert.equal(
		resources.MediaCache.Properties.CachePolicyConfig.MaxTTL,
		31536000,
	);
});

it("fresh uploads tolerate CloudFront negative-cache visibility delays without writing again", async () => {
	let reads = 0;
	let writes = 0;
	const transport: AssetTransport = {
		async get() {
			return ++reads < 3 ? undefined : object();
		},
		async put() {
			writes++;
		},
	};
	await uploadAssets(manifest, async () => bytes, transport);
	assert.equal(reads, 3);
	assert.equal(writes, 1);
});

it("published references exclude external URLs, source examples and prose while preserving responsive and data images", () => {
	const html = `<img src="${path}" srcset="${path} 480w, /images/photo.png 960w"><img src="https://elsewhere.example/images/private.png"><pre><code>import x from '/src/images/example.png'</code></pre><p>/images/not-an-image.png</p><astro-island props='{"image":[0,"/recipes/media/meal.webp"]}'></astro-island><meta property="og:image" content="https://www.jsolly.com/images/og.jpg">`;
	assert.deepEqual([...documentReferences(html, "html")].sort(), [
		path,
		"/images/og.jpg",
		"/images/photo.png",
		"/recipes/media/meal.webp",
	]);
	assert.deepEqual(
		[
			...documentReferences(
				'{"image":"/images/json.png","other":"https://external.example/images/not-local.png"}',
				"json",
			),
		],
		["/images/json.png"],
	);
	assert.deepEqual(
		[
			...documentReferences(
				'body { background: url("/images/bg.png") }',
				"css",
			),
		],
		["/images/bg.png"],
	);
});

it("upload authorization pins the exact bucket and key before using any signed credential", () => {
	const bucket = "reviewed-assets-bucket";
	const signed = `https://${bucket}.s3.us-east-1.amazonaws.com/${asset.key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=fake`;
	assertUploadTarget(manifest, bucket, asset.key, signed);
	assert.throws(
		() =>
			assertUploadTarget(manifest, bucket, asset.key, "malformed signed input"),
		{ message: "Invalid asset URL (value redacted)" },
	);
	assert.throws(() =>
		assertUploadTarget(manifest, "other-bucket", asset.key, signed),
	);
	assert.throws(() =>
		assertUploadTarget(manifest, bucket, "other-key", signed),
	);
	assert.throws(() =>
		assertUploadTarget(
			manifest,
			bucket,
			asset.key,
			signed.replace("https:", "http:"),
		),
	);
});

it("the real CLI and repository TS loader inventory and check a self-contained published fixture", async () => {
	const root = await mkdtemp(join(tmpdir(), "asset-cli-"));
	const loader = fileURLToPath(
		new URL("../../build/register-ts-from-js.mjs", import.meta.url),
	);
	const cli = fileURLToPath(
		new URL("../../static-assets/cli.ts", import.meta.url),
	);
	try {
		await mkdir(join(root, "public/blog/media"), { recursive: true });
		await mkdir(join(root, "config/aws/static-assets"), { recursive: true });
		await mkdir(join(root, "dist"));
		await writeFile(join(root, `public${path}`), bytes);
		await writeFile(join(root, "dist/index.html"), `<img src="${path}">`);
		const run = (command: string) =>
			execFileSync(process.execPath, ["--import", loader, cli, command], {
				cwd: root,
				encoding: "utf8",
				stdio: "pipe",
			});
		assert.match(run("inventory"), /Inventoried 1 published images/u);
		assert.match(run("check"), /Verified 1 source images/u);
		assert.deepEqual(
			JSON.parse(
				await readFile(
					join(root, "config/aws/static-assets/manifest.json"),
					"utf8",
				),
			),
			manifest,
		);
		await writeFile(join(root, `public${path}`), "corrupted");
		assert.throws(() => run("check"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("verification receipts attest the captured manifest and reject concurrent manifest edits", async () => {
	const root = await mkdtemp(join(tmpdir(), "asset-receipt-"));
	const receiptRoot = await mkdtemp(join(tmpdir(), "asset-receipt-output-"));
	const loader = fileURLToPath(
		new URL("../../build/register-ts-from-js.mjs", import.meta.url),
	);
	const cli = fileURLToPath(
		new URL("../../static-assets/cli.ts", import.meta.url),
	);
	try {
		await mkdir(join(root, "config/aws/static-assets"), { recursive: true });
		const manifestFile = join(root, "config/aws/static-assets/manifest.json");
		const manifestBytes = JSON.stringify(manifest);
		await writeFile(manifestFile, manifestBytes);
		const preload = join(root, "mock-fetch.mjs");
		const mock = `import { appendFileSync } from 'node:fs';
		globalThis.fetch = async () => {
			if (process.env.MUTATE_FIXTURE === '1') appendFileSync('config/aws/static-assets/manifest.json', ' ');
			return new Response('image-fixture', { headers: { 'content-type': 'image/webp', 'cache-control': '${CACHE_CONTROL}' } });
		};`;
		await writeFile(preload, mock);
		const run = (targetReceipt: string, mutate: boolean) =>
			execFileSync(
				process.execPath,
				[
					"--import",
					loader,
					"--import",
					preload,
					cli,
					"verify",
					"https://d123.cloudfront.net",
					targetReceipt,
				],
				{
					cwd: root,
					stdio: "pipe",
					encoding: "utf8",
					env: { ...process.env, MUTATE_FIXTURE: mutate ? "1" : "0" },
				},
			);
		const receipt = join(receiptRoot, "success.json");
		run(receipt, false);
		const saved: unknown = JSON.parse(await readFile(receipt, "utf8"));
		// biome-ignore lint/security/noSecrets: This public receipt field name is not a credential.
		assert.ok(saved && typeof saved === "object" && "manifestSha256" in saved);
		assert.equal(saved.manifestSha256, digest(Buffer.from(manifestBytes)));
		const rejected = join(receiptRoot, "rejected.json");
		assert.throws(() => run(rejected, true));
		await assert.rejects(readFile(rejected), { code: "ENOENT" });
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(receiptRoot, { recursive: true, force: true });
	}
});

it("malformed external upload authorization never leaks parser input", async () => {
	const root = await mkdtemp(join(tmpdir(), "asset-auth-"));
	const loader = fileURLToPath(
		new URL("../../build/register-ts-from-js.mjs", import.meta.url),
	);
	const cli = fileURLToPath(
		new URL("../../static-assets/cli.ts", import.meta.url),
	);
	try {
		await mkdir(join(root, "config/aws/static-assets"), { recursive: true });
		await writeFile(
			join(root, "config/aws/static-assets/manifest.json"),
			JSON.stringify(manifest),
		);
		const authorization = join(root, "private-map.json");
		await writeFile(authorization, "private-auth-canary is malformed JSON");
		assert.throws(
			() =>
				execFileSync(
					process.execPath,
					[
						"--import",
						loader,
						cli,
						"upload",
						"https://d123.cloudfront.net",
						"reviewed-assets-bucket",
						authorization,
					],
					{ cwd: root, stdio: "pipe" },
				),
			(error: unknown) => {
				assert.ok(error && typeof error === "object" && "stderr" in error);
				const stderr = String(error.stderr);
				assert.match(
					stderr,
					/Invalid upload authorization map \(contents redacted\)/u,
				);
				assert.doesNotMatch(stderr, /private-auth/u);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
