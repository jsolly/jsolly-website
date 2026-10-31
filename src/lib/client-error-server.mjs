import {
	ERROR_CATEGORIES,
	ERROR_REPORT_ORIGIN,
	FORWARDING_PROBE,
} from "./error-categories.mjs";

const MAX_BYTES = 512;
const JSON_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const BYTE_LENGTH = /^\d+$/u;
const HEADERS = {
	"Cache-Control": "no-store",
	"X-Robots-Tag": "noindex",
};

async function boundedJSON(request) {
	if (!request.body) throw new Error("Missing report");
	const reader = request.body.getReader();
	let bytes = 0;
	const chunks = [];
	try {
		// biome-ignore lint/suspicious/noUnnecessaryConditions: the request reader's done flag terminates this streaming loop.
		while (true) {
			// biome-ignore lint/performance/noAwaitInLoops: consume the request stream in order with a strict byte budget.
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_BYTES) {
				await reader.cancel();
				throw new Error("Report too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

/**
 * Only deployment-owned page routes and fixed categories may enter logs.
 * `record` forwards an accepted report; a failure answers 502 and is logged
 * here, so a broken forwarding path stays visible in the function's logs.
 */
export function createClientErrorHandler({
	paths,
	record,
	logFailure = console.error,
}) {
	return async (request) => {
		const response = (status, extra = {}) =>
			new Response(null, { status, headers: { ...HEADERS, ...extra } });
		if (request.method !== "POST") return response(405, { Allow: "POST" });
		if (
			new URL(request.url).origin !== ERROR_REPORT_ORIGIN ||
			request.headers.get("origin") !== ERROR_REPORT_ORIGIN
		)
			return response(403);
		if (!JSON_TYPE.test(request.headers.get("content-type") ?? ""))
			return response(415);
		const length = request.headers.get("content-length");
		if (length && (!BYTE_LENGTH.test(length) || Number(length) > MAX_BYTES))
			return response(413);
		let value;
		try {
			value = await boundedJSON(request);
		} catch {
			return response(400);
		}
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			Object.keys(value).length !== 2 ||
			!Object.hasOwn(value, "category") ||
			!Object.hasOwn(value, "page") ||
			typeof value.category !== "string" ||
			!(
				Object.hasOwn(ERROR_CATEGORIES, value.category) ||
				value.category === FORWARDING_PROBE.category
			) ||
			typeof value.page !== "string" ||
			!paths.has(value.page)
		)
			return response(400);
		const probe = value.category === FORWARDING_PROBE.category;
		const report = {
			level: probe ? "info" : "error",
			category: value.category,
			page: value.page,
			message: probe
				? FORWARDING_PROBE.message
				: ERROR_CATEGORIES[value.category],
		};
		try {
			await record(report);
		} catch (error) {
			const { name, code, $metadata } = error instanceof Error ? error : {};
			logFailure(
				JSON.stringify({
					event: "client-error-forward-failed",
					...report,
					// Name, code and HTTP status identify the failure without its message,
					// which can carry provider detail.
					error: name ?? "Unknown error",
					code: typeof code === "string" ? code : undefined,
					status: $metadata?.httpStatusCode,
				}),
			);
			return response(502);
		}
		return response(204);
	};
}
