import { isIP } from "node:net";
import type { TestProject } from "vitest/node";
import {
	DENIAL_DNS_HOST,
	DENIAL_PROTOCOL_REASONS,
	MAX_DENIAL_DETAILS,
	MAX_DENIAL_SUMMARY_BYTES,
} from "./constants.ts";
import { isOfflineSuite } from "./entry.ts";
import {
	assertNoExternalNetwork,
	installNodeNetworkGuard,
} from "./node/guard.ts";
import { startLoopbackProxy } from "./proxy.ts";
import type { ProxyDenial } from "./types.ts";

export default async function setup(project: TestProject) {
	const { TEST_SUITE } = process.env;
	if (!isOfflineSuite(TEST_SUITE)) return;
	installNodeNetworkGuard();
	const proxy = await startLoopbackProxy();
	try {
		project.provide("offlineNetworkProxy", proxy.endpoint);
	} catch (error) {
		try {
			await proxy.close();
		} catch (cleanup) {
			// biome-ignore lint/style/useErrorCause: both setup and cleanup errors are retained by AggregateError.
			throw new AggregateError(
				[error, cleanup],
				"Offline network setup failed",
				{ cause: cleanup },
			);
		}
		throw error;
	}
	return async () => {
		const failures: unknown[] = [];
		try {
			await proxy.close();
		} catch (error) {
			failures.push(error);
		}
		const denied = proxy.snapshot().denials;
		if (denied.length)
			failures.push(
				new Error(
					`Offline browser connections denied: ${denied.length} ${formatProxyDenials(denied)}`,
				),
			);
		try {
			assertNoExternalNetwork();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length)
			throw new AggregateError(failures, "Offline test network failed");
	};
}

/** Only protocol-defined host/port data; never request URLs, userinfo or buffers. */
function formatProxyDenials(denials: readonly ProxyDenial[]): string {
	const details = denials.slice(0, MAX_DENIAL_DETAILS).map((denial) => {
		if (denial.kind === "protocol")
			return {
				kind: denial.kind,
				reason: DENIAL_PROTOCOL_REASONS.has(denial.message)
					? denial.message
					: "Unrecognized protocol failure",
			};
		const { host, port } = denial.destination;
		return {
			kind: denial.kind,
			host:
				host.length <= 255 && (isIP(host) !== 0 || DENIAL_DNS_HOST.test(host))
					? host
					: "[redacted invalid host]",
			port,
		};
	});
	const summary = JSON.stringify({
		total: denials.length,
		omitted: denials.length - details.length,
		details,
	});
	if (Buffer.byteLength(summary) <= MAX_DENIAL_SUMMARY_BYTES) return summary;
	// Preserve the failure count even if a future data shape exceeds this bound.
	return JSON.stringify({
		total: denials.length,
		omitted: denials.length,
		details: [],
		reason: "Diagnostic byte limit exceeded",
	});
}
