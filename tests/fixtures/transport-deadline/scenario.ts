import { fileURLToPath } from "node:url";
import type { DeadlineOutcome, DeadlineRequest } from "./types.ts";
import { parseDeadlineRequest } from "./types.ts";

export async function executeTransportDeadline(options: DeadlineRequest) {
	// The existing MJS implementation is the boundary under test. Validate its
	// callable exports without claiming that implementation is typechecked.
	const transportModule: unknown = await import(
		new URL(
			"../../../monitoring/verify-blogthedata-transports.mjs",
			import.meta.url,
		).href
	);
	if (
		typeof transportModule !== "object" ||
		transportModule === null ||
		!("vercelCurlTransport" in transportModule) ||
		typeof transportModule.vercelCurlTransport !== "function"
	)
		throw new Error("The transport fixture could not load vercelCurlTransport");
	const request: unknown = await transportModule.vercelCurlTransport(
		options.bin,
		options.origin,
		options.scratch,
		{ timeoutMs: options.timeoutMs },
	);
	if (typeof request !== "function")
		throw new Error("vercelCurlTransport did not return a request function");
	await request(options.url, { body: false });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const serialized = process.argv[2];
	if (serialized === undefined)
		throw new Error("Missing transport deadline fixture request");
	const input: unknown = JSON.parse(serialized);
	const options = parseDeadlineRequest(input);
	let outcome: DeadlineOutcome;
	try {
		await executeTransportDeadline(options);
		outcome = { kind: "resolved" };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const transient: unknown =
			"transient" in error ? error.transient : undefined;
		if (transient !== undefined && typeof transient !== "boolean")
			throw new Error("Invalid transport error transient flag", {
				cause: error,
			});
		outcome = {
			kind: "rejected",
			message: error.message,
			...(typeof transient === "boolean" ? { transient } : {}),
		};
	}
	process.stdout.write(JSON.stringify(outcome));
}
