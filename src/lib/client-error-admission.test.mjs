import assert from "node:assert/strict";
import { checkRateLimit as realCheckRateLimit } from "@vercel/firewall";
import { it, vi } from "vitest";
import { createClientErrorAdmission } from "./client-error-admission.mjs";

const BUCKET_SECRET = "unit-fixture-only-bucket-identifier";
const REPORT = {
	level: "error",
	category: "recipe-print",
	page: "/recipes/meals/",
};

it("checks the shared budget and category/page bucket without forwarding visitor headers", async () => {
	const calls = [];
	const admit = createClientErrorAdmission({
		bucketSecret: BUCKET_SECRET,
		checkRateLimit: (...args) => {
			calls.push(args);
			return Promise.resolve({ rateLimited: false });
		},
	});
	assert.equal(await admit(REPORT), "allow");
	assert.deepEqual(calls, [
		[
			"client-error-ingestion",
			{
				headers: { host: "www.jsolly.com" },
				rateLimitKey:
					// biome-ignore lint/security/noSecrets: Expected HMAC of a public test fixture, not a credential.
					"0ee271bf8606f03f25a76ff2571a30f91e0ab9cb4e035b300914a83a807688cc",
				timeout: 500,
			},
		],
		[
			"client-error-duplicate",
			{
				headers: { host: "www.jsolly.com" },
				rateLimitKey:
					// biome-ignore lint/security/noSecrets: Expected HMAC of a public test fixture, not a credential.
					"fb74059a7c97e502d96274d7493c3685229b74f136d449dc4a7681872520b33a",
				timeout: 500,
			},
		],
	]);
	const outgoing = [];
	vi.stubEnv("NODE_ENV", "production");
	vi.stubGlobal("fetch", (url, init) => {
		outgoing.push({ url, headers: init.headers });
		return Promise.resolve(new Response(null, { status: 204 }));
	});
	try {
		const realAdmission = createClientErrorAdmission({
			checkRateLimit: realCheckRateLimit,
			bucketSecret: BUCKET_SECRET,
		});
		assert.equal(await realAdmission(REPORT), "allow");
		assert.equal(outgoing.length, 2);
		for (const { url, headers } of outgoing) {
			assert.equal(new URL(url).host, "www.jsolly.com");
			assert.ok(
				![...headers.values()].some((value) => value.includes(BUCKET_SECRET)),
			);
			assert.equal(headers.get("x-real-ip"), "");
			assert.equal(headers.get("cookie"), null);
		}
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	}
});

it("rejects an exhausted budget before checking duplicates and acknowledges duplicates separately", async () => {
	const calls = [];
	const limited = createClientErrorAdmission({
		bucketSecret: BUCKET_SECRET,
		checkRateLimit: (id) => {
			calls.push(id);
			return Promise.resolve({ rateLimited: true });
		},
	});
	assert.equal(await limited(REPORT), "limited");
	assert.deepEqual(calls, ["client-error-ingestion"]);
	const duplicate = createClientErrorAdmission({
		bucketSecret: BUCKET_SECRET,
		checkRateLimit: async (id) => ({
			rateLimited: id === "client-error-duplicate",
		}),
	});
	assert.equal(await duplicate(REPORT), "duplicate");
});

it("never bypasses missing rules, firewall blocks, timeouts or limiter failures", async () => {
	for (const failureAt of [
		"client-error-ingestion",
		"client-error-duplicate",
	]) {
		for (const error of ["not-found", "blocked", "throw"]) {
			const admit = createClientErrorAdmission({
				bucketSecret: BUCKET_SECRET,
				checkRateLimit: (id) => {
					if (id !== failureAt) return Promise.resolve({ rateLimited: false });
					if (error === "throw") throw new Error("private provider detail");
					return Promise.resolve({ rateLimited: false, error });
				},
			});
			// biome-ignore lint/performance/noAwaitInLoops: Each fixture has its own failure mode and no external work.
			assert.equal(await admit(REPORT), "unavailable");
		}
	}
});

it("probes consume the shared budget but cannot be acknowledged as duplicates without a write", async () => {
	const calls = [];
	const admit = createClientErrorAdmission({
		bucketSecret: BUCKET_SECRET,
		checkRateLimit: (id) => {
			calls.push(id);
			return Promise.resolve({ rateLimited: false });
		},
	});
	assert.equal(
		await admit({ level: "info", category: "forwarding-probe", page: "/" }),
		"allow",
	);
	assert.deepEqual(calls, ["client-error-ingestion"]);
});

it("fails closed without a server-only bucket secret before calling the public counter API", async () => {
	let checks = 0;
	const checkRateLimit = () => {
		checks++;
		return Promise.resolve({ rateLimited: false });
	};
	for (const bucketSecret of [undefined, "", "short"]) {
		const admit = createClientErrorAdmission({
			bucketSecret,
			checkRateLimit,
		});
		// biome-ignore lint/performance/noAwaitInLoops: These fixtures have no external work.
		assert.equal(await admit(REPORT), "unavailable");
	}
	assert.equal(checks, 0);
});
