// biome-ignore-all lint/performance/noAwaitInLoops: Bound filesystem memory and serialize object writes, retries and verification.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { documentReferences } from "./references.js";

export const CACHE_CONTROL = "public, max-age=31536000, immutable";
const PUBLIC_PATH =
	/^\/(?:blog\/media|recipes\/media|images)\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|gif)$/u;
type ImageType = "image/webp" | "image/png" | "image/jpeg" | "image/gif";
const DOCUMENT = /\.(?:html|json|md|css)$/u;
const DISTRIBUTION = /^d[a-z0-9]+\.cloudfront\.net$/u;
const TYPES: Readonly<Record<string, ImageType>> = {
	webp: "image/webp",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
};
export const digest = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");
const entrySchema = z
	.object({
		path: z.string().regex(PUBLIC_PATH),
		sha256: z.string().regex(/^[a-f0-9]{64}$/u),
		bytes: z.number().int().positive().max(100_000_000),
		contentType: z.enum(["image/webp", "image/png", "image/jpeg", "image/gif"]),
		key: z.string(),
	})
	.strict();
export const manifestSchema = z
	.object({
		version: z.literal(1),
		assets: z.array(entrySchema).min(1),
	})
	.strict()
	.superRefine(({ assets }, ctx) => {
		const paths = new Set<string>();
		for (const asset of assets) {
			if (
				asset.path.includes("..") ||
				asset.path.includes("//") ||
				paths.has(asset.path) ||
				asset.key !== objectKey(asset.path, asset.sha256) ||
				asset.contentType !== contentType(asset.path)
			) {
				ctx.addIssue({
					code: "custom",
					message: `Invalid or duplicate asset: ${asset.path}`,
				});
			}
			paths.add(asset.path);
		}
		if (
			assets.some(
				(asset, i) => i > 0 && (assets[i - 1]?.path ?? "") >= asset.path,
			)
		) {
			ctx.addIssue({
				code: "custom",
				message: "Manifest must be sorted by public path",
			});
		}
	});
export type AssetManifest = z.infer<typeof manifestSchema>;
export type Asset = AssetManifest["assets"][number];
export function objectKey(path: string, sha256: string): string {
	return `sha256/${sha256}${path}`;
}
function contentType(path: string): ImageType {
	const type = TYPES[path.split(".").at(-1) ?? ""];
	if (!type) throw new Error(`Unsupported image: ${path}`);
	return type;
}

async function files(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const results: string[] = [];
	for (const entry of entries.sort((a, b) =>
		a.name.localeCompare(b.name, "en"),
	)) {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink())
			throw new Error(`Symlink is not an asset input: ${path}`);
		if (entry.isDirectory()) results.push(...(await files(path)));
		else if (entry.isFile()) results.push(path);
	}
	return results;
}

/** Inspect only the published build's documents/data/styles, never draft source. */
export async function publishedReferences(dist: string): Promise<Set<string>> {
	const paths = new Set<string>();
	for (const path of await files(dist)) {
		if (!DOCUMENT.test(path)) continue;
		const kind = path.split(".").at(-1);
		if (kind !== "html" && kind !== "json" && kind !== "css") continue;
		for (const reference of documentReferences(
			await readFile(path, "utf8"),
			kind,
		))
			paths.add(reference);
	}
	if (!paths.size)
		throw new Error("No published image references; build the site first");
	return paths;
}

export async function createManifest(
	root: string,
	references: ReadonlySet<string>,
): Promise<AssetManifest> {
	if ((await lstat(join(root, "public"))).isSymbolicLink())
		throw new Error("Symlink is not an asset input: public root");
	const assets: Asset[] = [];
	for (const path of [...references].sort()) {
		if (!PUBLIC_PATH.test(path) || path.includes("..") || path.includes("//"))
			throw new Error(`Unsafe public path: ${path}`);
		const local = join(root, "public", path);
		// Check every component so a parent symlink cannot expose another directory.
		let current = join(root, "public");
		for (const part of path.slice(1).split("/")) {
			current = join(current, part);
			if ((await lstat(current)).isSymbolicLink())
				throw new Error(`Symlink is not an asset input: ${current}`);
		}
		const bytes = await readFile(local);
		const sha256 = digest(bytes);
		assets.push({
			path,
			sha256,
			bytes: bytes.length,
			contentType: contentType(path),
			key: objectKey(path, sha256),
		});
	}
	return manifestSchema.parse({ version: 1, assets });
}

export function assertCoverage(
	manifest: AssetManifest,
	references: ReadonlySet<string>,
): void {
	const expected = new Set(manifest.assets.map((asset) => asset.path));
	for (const path of references)
		if (!expected.has(path))
			throw new Error(`Published image missing from manifest: ${path}`);
	for (const path of expected)
		if (!references.has(path))
			throw new Error(`Manifest image is no longer published: ${path}`);
}

export interface ObjectResponse {
	bytes: Uint8Array;
	contentType: string | null;
	cacheControl: string | null;
}
export interface AssetTransport {
	get(asset: Asset): Promise<ObjectResponse | undefined>;
	put(asset: Asset, bytes: Uint8Array): Promise<void>;
}

function assertObject(asset: Asset, response: ObjectResponse): void {
	if (
		response.bytes.length !== asset.bytes ||
		digest(response.bytes) !== asset.sha256
	)
		throw new Error(`Object bytes mismatch: ${asset.path}`);
	if (
		response.contentType !== asset.contentType ||
		response.cacheControl !== CACHE_CONTROL
	)
		throw new Error(`Object headers mismatch: ${asset.path}`);
}

/** Retry transient transport failures only; integrity errors never become permission to overwrite. */
async function retry<T>(operation: () => Promise<T>): Promise<T> {
	let last: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (!(error instanceof TransientError)) throw error;
			last = error;
			if (attempt < 2) await setTimeout(1_100 * (attempt + 1));
		}
	}
	throw last;
}
export class TransientError extends Error {}

export async function verifyAssets(
	manifest: AssetManifest,
	transport: AssetTransport,
): Promise<void> {
	for (const asset of manifest.assets) {
		const response = await retry(() => transport.get(asset));
		if (!response) throw new Error(`Missing object: ${asset.path}`);
		assertObject(asset, response);
	}
}

export async function uploadAssets(
	manifest: AssetManifest,
	read: (asset: Asset) => Promise<Uint8Array>,
	transport: AssetTransport,
): Promise<void> {
	// Validate all source bytes before the first write.
	for (const asset of manifest.assets) {
		const bytes = await read(asset);
		if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256)
			throw new Error(`Local bytes mismatch: ${asset.path}`);
	}
	for (const asset of manifest.assets) {
		const existing = await retry(() => transport.get(asset));
		if (existing) {
			assertObject(asset, existing);
			continue;
		}
		const bytes = await read(asset);
		if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256)
			throw new Error(`Local bytes mismatch: ${asset.path}`);
		await retry(() => transport.put(asset, bytes));
		const uploaded = await retry(async () => {
			const response = await transport.get(asset);
			// S3-origin CloudFront errors cache for at least one second, even with TTL 0.
			if (!response)
				throw new TransientError(`Upload not readable: ${asset.path}`);
			return response;
		});
		assertObject(asset, uploaded);
	}
}

function parseUrl(value: string): URL {
	try {
		return new URL(value);
	} catch {
		// biome-ignore lint/style/useErrorCause: Native URL errors can contain presigned credentials.
		throw new Error("Invalid asset URL (value redacted)");
	}
}

export function deliveryOrigin(value: string): string {
	const url = parseUrl(value);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		!DISTRIBUTION.test(url.hostname)
	)
		throw new Error("Expected the stack's HTTPS CloudFront origin");
	return url.origin;
}
export function assetUrl(origin: string, asset: Asset): string {
	return `${deliveryOrigin(origin)}/${asset.key}`;
}

export function assertUploadTarget(
	manifest: AssetManifest,
	bucket: string | undefined,
	key: string,
	value: string,
): void {
	const url = parseUrl(value);
	if (
		!bucket ||
		!manifest.assets.some((entry) => entry.key === key) ||
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		url.hash ||
		url.hostname !== `${bucket}.s3.us-east-1.amazonaws.com` ||
		decodeURIComponent(url.pathname) !== `/${key}` ||
		url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
		!url.searchParams.has("X-Amz-Signature")
	) {
		throw new Error(
			"Authorization must contain only exact manifest keys on the intended regional S3 endpoint",
		);
	}
}
