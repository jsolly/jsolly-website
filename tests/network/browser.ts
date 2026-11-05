import { chromium } from "playwright";
import {
	LOOPBACK_HOST,
	PROXY_BYPASS,
	PROXY_ENVIRONMENT_KEY,
} from "./constants.ts";
import { requireTcpPort } from "./policy.ts";
import type {
	TestBrowserOptions,
	TestPersistentContextOptions,
} from "./types.ts";

/** No missing-endpoint fallback: the suite must own a live proxy first. */
function proxyConfiguration() {
	const value = process.env[PROXY_ENVIRONMENT_KEY];
	if (value === undefined || value.trim() !== value)
		throw new Error("The test suite has not provided its loopback SOCKS proxy");
	const url = new URL(value);
	if (
		url.protocol !== "socks5:" ||
		url.hostname !== LOOPBACK_HOST ||
		url.username ||
		url.password ||
		url.pathname ||
		url.search ||
		url.hash ||
		!url.port
	)
		throw new Error(
			"The test proxy must be an unadorned socks5 loopback endpoint",
		);
	const port = requireTcpPort(Number(url.port));
	return { server: `socks5://${LOOPBACK_HOST}:${port}`, bypass: PROXY_BYPASS };
}

function requireOptions(
	options: TestBrowserOptions | TestPersistentContextOptions,
	persistent: boolean,
) {
	for (const key of Object.keys(options)) {
		if (
			key !== "headless" &&
			key !== "ignoreCertificateErrors" &&
			!(persistent && key === "offline")
		)
			throw new Error(
				"Test browser options cannot override the network boundary",
			);
		const value: unknown = Reflect.get(options, key);
		if (value !== undefined && typeof value !== "boolean")
			throw new TypeError("Test browser option values must be booleans");
	}
}

function browserArguments(options: TestBrowserOptions) {
	return [
		"--disable-quic",
		"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
		...(options.ignoreCertificateErrors ? ["--ignore-certificate-errors"] : []),
	];
}

export async function launchTestBrowser(options: TestBrowserOptions = {}) {
	requireOptions(options, false);
	return await chromium.launch({
		...(options.headless === undefined ? {} : { headless: options.headless }),
		proxy: proxyConfiguration(),
		args: browserArguments(options),
	});
}

export async function launchPersistentTestContext(
	profile: string,
	options: TestPersistentContextOptions = {},
) {
	requireOptions(options, true);
	return await chromium.launchPersistentContext(profile, {
		...(options.headless === undefined ? {} : { headless: options.headless }),
		...(options.offline === undefined ? {} : { offline: options.offline }),
		proxy: proxyConfiguration(),
		args: browserArguments(options),
	});
}

export async function launchTestBrowserServer(
	options: TestBrowserOptions = {},
) {
	requireOptions(options, false);
	return await chromium.launchServer({
		...(options.headless === undefined ? {} : { headless: options.headless }),
		proxy: proxyConfiguration(),
		args: browserArguments(options),
	});
}
