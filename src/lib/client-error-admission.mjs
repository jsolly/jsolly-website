import { createHmac } from "node:crypto";
import limits from "../../config/security/client-error-limits.json" with {
	type: "json",
};
import { ERROR_REPORT_ORIGIN } from "./error-categories.mjs";

/** Distributed firewall counters, never process-local maps or visitor identifiers. */
export function createClientErrorAdmission({ checkRateLimit, bucketSecret }) {
	if (typeof bucketSecret !== "string" || bucketSecret.length < 32)
		return async () => "unavailable";
	const keyFor = (parts) =>
		createHmac("sha256", bucketSecret)
			.update(JSON.stringify(parts))
			.digest("hex");
	return async (report) => {
		try {
			// One bucket shared by all source IPs and function instances in a region.
			const budget = await checkRateLimit(limits.ingestion.id, {
				headers: { host: new URL(ERROR_REPORT_ORIGIN).host },
				rateLimitKey: keyFor(["ingestion", "production"]),
				timeout: limits.timeoutMs,
			});
			if (budget.error) return "unavailable";
			if (budget.rateLimited) return "limited";
			// A probe must prove a new write, even when another smoke just ran.
			// It still consumes the same ingestion budget as every browser report.
			if (report.level === "info") return "allow";
			const duplicate = await checkRateLimit(limits.duplicate.id, {
				headers: { host: new URL(ERROR_REPORT_ORIGIN).host },
				rateLimitKey: keyFor(["duplicate", report.category, report.page]),
				timeout: limits.timeoutMs,
			});
			if (duplicate.error) return "unavailable";
			return duplicate.rateLimited ? "duplicate" : "allow";
		} catch {
			// Missing configuration, timeouts and provider errors never bypass limits
			// or reach the CloudWatch recorder. The SDK itself warns on missing rules.
			return "unavailable";
		}
	};
}
