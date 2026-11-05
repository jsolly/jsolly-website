export interface DeadlineRequest {
	bin: string;
	origin: string;
	scratch: string;
	url: string;
	timeoutMs: number;
}

export type DeadlineOutcome =
	| { kind: "resolved" }
	| { kind: "rejected"; message: string; transient?: boolean };

export function parseDeadlineRequest(value: unknown): DeadlineRequest {
	if (
		typeof value !== "object" ||
		value === null ||
		!("bin" in value) ||
		typeof value.bin !== "string" ||
		!("origin" in value) ||
		typeof value.origin !== "string" ||
		!("scratch" in value) ||
		typeof value.scratch !== "string" ||
		!("url" in value) ||
		typeof value.url !== "string" ||
		!("timeoutMs" in value) ||
		typeof value.timeoutMs !== "number" ||
		!Number.isSafeInteger(value.timeoutMs) ||
		value.timeoutMs <= 0
	)
		throw new Error("Invalid transport deadline fixture request");
	return {
		bin: value.bin,
		origin: value.origin,
		scratch: value.scratch,
		url: value.url,
		timeoutMs: value.timeoutMs,
	};
}

export function parseDeadlineOutcome(value: unknown): DeadlineOutcome {
	if (typeof value !== "object" || value === null || !("kind" in value))
		throw new Error("Invalid transport deadline fixture outcome");
	if (value.kind === "resolved") return { kind: "resolved" };
	if (
		value.kind !== "rejected" ||
		!("message" in value) ||
		typeof value.message !== "string" ||
		("transient" in value && typeof value.transient !== "boolean")
	)
		throw new Error("Invalid transport deadline fixture rejection");
	return {
		kind: "rejected",
		message: value.message,
		...("transient" in value && typeof value.transient === "boolean"
			? { transient: value.transient }
			: {}),
	};
}
