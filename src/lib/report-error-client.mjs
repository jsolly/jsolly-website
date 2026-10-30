import { ERROR_CATEGORIES, ERROR_REPORT_ORIGIN } from "./error-categories.mjs";

/** At most three distinct categories per page load, with no durable identity. */
export function createErrorReporter({
	location = () => globalThis.location,
	fetcher = (...args) => fetch(...args),
} = {}) {
	const sent = new Set();
	return async (category) => {
		try {
			const page = location();
			if (
				!Object.hasOwn(ERROR_CATEGORIES, category) ||
				!page ||
				page.origin !== ERROR_REPORT_ORIGIN ||
				typeof page.pathname !== "string" ||
				page.pathname.length > 256 ||
				sent.has(category) ||
				sent.size >= 3
			)
				return;
			sent.add(category);
			await fetcher("/api/client-error/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ category, page: page.pathname }),
				credentials: "omit",
				referrerPolicy: "no-referrer",
				redirect: "error",
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
		} catch {
			// Error reporting must never retry, recurse, or disrupt the original UI.
		}
	};
}

export const reportError = createErrorReporter();
