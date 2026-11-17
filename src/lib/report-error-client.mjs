import { ERROR_CATEGORIES, ERROR_REPORT_ORIGIN } from "./error-categories.mjs";

/** At most three attempts per page load, with one for all recipe-update phases. */
export function createErrorReporter({
	location = () => globalThis.location,
	fetcher = (...args) => fetch(...args),
} = {}) {
	const sent = new Set();
	let failureReported = false;
	return async (category) => {
		try {
			if (!Object.hasOwn(ERROR_CATEGORIES, category)) return;
			const key = category.startsWith("recipe-update-")
				? "recipe-update"
				: category;
			const page = location();
			if (
				!page ||
				page.origin !== ERROR_REPORT_ORIGIN ||
				typeof page.pathname !== "string" ||
				page.pathname.length > 256 ||
				sent.has(key) ||
				sent.size >= 3
			)
				return;
			sent.add(key);
			const response = await fetcher("/api/client-error/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ category, page: page.pathname }),
				credentials: "omit",
				referrerPolicy: "no-referrer",
				redirect: "error",
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok)
				throw new Error("Client error endpoint rejected report");
		} catch {
			if (!failureReported) {
				failureReported = true;
				console.error(
					"Client error reporting failed; reports may not reach monitoring.",
				);
			}
		}
	};
}

export const reportError = createErrorReporter();
