// biome-ignore-all lint/nursery/noConditionalExpect: Native protocol controls assert every branch directly.
// biome-ignore-all lint/suspicious/noMisplacedAssertion: Pure Node assertion controls are called by the built-suite wrapper.
import assert from "node:assert/strict";
import {
	assertAllowedPort,
	requireLoopbackHost,
	requireTcpPort,
} from "../policy.ts";
import { readSocksGreeting, readSocksRequest } from "../proxy.ts";

export function runProtocolControls(): void {
	// Pure parser/policy controls only. Importing proxy.ts does not open a server.
	const localHosts = [
		undefined,
		"",
		"localhost",
		"LOCALHOST",
		"127.0.0.1",
		"127.255.255.254",
		"::1",
		"0:0:0:0:0:0:0:1",
		"[::1]",
		"::ffff:127.0.0.1",
	];
	for (const host of localHosts) assert.ok(requireLoopbackHost(host));
	for (const host of [
		null,
		1,
		{},
		"example.invalid",
		"localhost.example.invalid",
		"localhost.",
		"192.0.2.1",
		"10.0.0.1",
		"0.0.0.0",
		"::",
		"2001:db8::1",
		"::ffff:192.0.2.1",
		" 127.0.0.1",
	])
		assert.throws(() => requireLoopbackHost(host));
	for (const port of [1, 80, 443, 65535])
		assert.equal(requireTcpPort(port), port);
	for (const port of [0, -1, 65536, 1.5, NaN, Infinity, "80", undefined, null])
		assert.throws(() => requireTcpPort(port));
	assert.doesNotThrow(() => assertAllowedPort(1234, undefined));
	assert.doesNotThrow(() => assertAllowedPort(1234, new Set([1234])));
	assert.throws(() => assertAllowedPort(1234, new Set([2345])));

	const greeting = Buffer.from([5, 2, 2, 0]);
	for (let end = 0; end < greeting.length; end++)
		assert.equal(
			readSocksGreeting(greeting.subarray(0, end)).kind,
			"incomplete",
		);
	assert.deepEqual(readSocksGreeting(greeting), {
		kind: "greeting",
		consumed: 4,
		acceptsNoAuthentication: true,
	});
	assert.equal(readSocksGreeting(Buffer.from([4, 1, 0])).kind, "invalid");
	assert.equal(readSocksGreeting(Buffer.from([5, 0])).kind, "invalid");
	const unsupported = readSocksGreeting(Buffer.from([5, 1, 2]));
	assert.ok(
		unsupported.kind === "greeting" && !unsupported.acceptsNoAuthentication,
	);

	const ipv4 = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0x1f, 0x90]);
	const domain = Buffer.concat([
		Buffer.from([5, 1, 0, 3, 9]),
		Buffer.from("localhost"),
		Buffer.from([0x1f, 0x90]),
	]);
	const ipv6 = Buffer.from([
		5, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0x1f, 0x90,
	]);
	for (const frame of [ipv4, domain, ipv6]) {
		for (let end = 0; end < frame.length; end++)
			assert.equal(readSocksRequest(frame.subarray(0, end)).kind, "incomplete");
		const parsed = readSocksRequest(
			Buffer.concat([frame, Buffer.from("early payload")]),
		);
		assert.ok(parsed.kind === "request");
		assert.equal(parsed.consumed, frame.length);
		assert.equal(parsed.destination.port, 8080);
		assert.ok(requireLoopbackHost(parsed.destination.host));
	}
	for (const frame of [
		Buffer.from([5, 2, 0, 1]),
		Buffer.from([5, 1, 1, 1]),
		Buffer.from([5, 1, 0, 9]),
		Buffer.from([5, 1, 0, 3, 0]),
	])
		assert.equal(readSocksRequest(frame).kind, "invalid");
}
