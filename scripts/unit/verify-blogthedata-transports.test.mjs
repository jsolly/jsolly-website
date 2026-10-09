import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import it from "node:test";
import {
	fetchTransport,
	vercelCurlTransport,
} from "../verify-blogthedata-transports.mjs";

// The vercel-curl transport against a fake `vercel` CLI; nothing here runs
// the real CLI or reaches the network.
const STUB = "https://stub.invalid";
const UNREADABLE = /unreadable curl write-out/u;
const EXITED_1 = /^vercel curl exited 1: /u;
const EXITED_28 = /vercel curl exited 28/u;
const NO_SECRET =
	/vercel curl warm-up attached no bypass secret; check vercel login\/--scope, or use the fetch transport for an unprotected deployment$/u;
const WARM_UP_401 =
	/vercel curl warm-up on https:\/\/denied\.invalid\/ answered 401$/u;
// The fake logs each call next to itself and prints chatter before the
// write-out. The -v warm-up prints the bypass header the real CLI would
// attach, except on noheader.invalid; denied.invalid answers it 401, and
// fail.invalid exits 1 after printing it. Any later call without the secret
// fails. /slow exits 28, /garbled prints no write-out, /moved answers 301,
// and every other request answers 200 with a body written to the -o path.
const FAKE_VERCEL = `#!/usr/bin/env node
import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
// Pinned CLI forwards --cwd to curl rather than consuming it.
if (args.includes("--cwd")) {
 console.error("curl: option --cwd: is unknown");
 process.exit(2);
}
const cwd = process.cwd();
const cwdEntries = readdirSync(cwd);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null;
const warmUp = args.includes("-v");
appendFileSync(new URL("calls.jsonl", import.meta.url), JSON.stringify({ args, bypass, cwd, cwdEntries }) + "\\n");
const url = new URL(args[1]);
const marker = "\\nverify-blogthedata-cutover\\n";
process.stdout.write("Vercel CLI 59.17.0\\nchatter before the write-out\\n");
if (warmUp) {
	if (url.hostname !== "noheader.invalid") {
		process.stderr.write("> GET / HTTP/2\\n> x-vercel-protection-bypass: fake-token\\n");
	}
	if (url.hostname === "fail.invalid") {
		console.error("Error: the deployment could not be reached");
		process.exit(1);
	}
	process.stdout.write(marker + (url.hostname === "denied.invalid" ? "401\\n\\n\\n\\n" : "200\\n\\ntext/html\\n\\n"));
	process.exit(0);
}
if (bypass !== "fake-token") {
	console.error("no bypass secret from the warm-up");
	process.exit(1);
}
if (url.pathname === "/slow") {
	console.error("curl: (28) Operation timed out");
	process.exit(28);
}
if (url.pathname === "/garbled") {
	process.stdout.write("no write-out");
	process.exit(0);
}
const output = args[args.indexOf("-o") + 1];
if (output !== "/dev/null") {
	writeFileSync(output, "served bytes\\n");
}
process.stdout.write(
	url.pathname === "/moved"
		? marker + "301\\nhttps://www.jsolly.com/moved/\\n\\n\\n"
		: marker + "200\\n\\ntext/plain; charset=utf-8\\nno-cache\\ndeny",
);
`;

it("The vercel-curl transport warms up once, then reads each answer past the CLI's chatter", async () => {
	const dir = mkdtempSync(join(tmpdir(), "verify-cutover-vercel-"));
	try {
		const bin = join(dir, "vercel.mjs");
		writeFileSync(bin, FAKE_VERCEL);
		chmodSync(bin, 0o755);
		const scratch = mkdtempSync(join(dir, "scratch-"));
		const transport = (origin) => vercelCurlTransport(bin, origin, scratch);

		// A warm-up that shows no secret, answers 401 or fails stops the run.
		await assert.rejects(transport("https://noheader.invalid"), NO_SECRET);
		await assert.rejects(transport("https://denied.invalid"), WARM_UP_401);
		await assert.rejects(transport("https://fail.invalid"), (error) => {
			assert.match(error.message, EXITED_1);
			assert.ok(error.message.includes("[redacted]"), error.message);
			assert.ok(!error.message.includes("fake-token"), error.message);
			return true;
		});

		const request = await transport(STUB);
		assert.deepEqual(await request(`${STUB}/robots.txt`, { body: true }), {
			status: 200,
			location: null,
			contentType: "text/plain; charset=utf-8",
			cacheControl: "no-cache",
			mitigated: "deny",
			body: Buffer.from("served bytes\n"),
		});
		assert.deepEqual(await request(`${STUB}/moved`, { body: false }), {
			status: 301,
			location: "https://www.jsolly.com/moved/",
			contentType: null,
			cacheControl: null,
			mitigated: null,
		});
		await assert.rejects(
			request(`${STUB}/garbled`, { body: false }),
			(error) => {
				assert.match(error.message, UNREADABLE);
				assert.ok(!error.transient, "an unreadable write-out is not retried");
				return true;
			},
		);
		await assert.rejects(request(`${STUB}/slow`, { body: false }), (error) => {
			assert.match(error.message, EXITED_28);
			assert.equal(error.transient, true);
			return true;
		});

		const calls = readFileSync(join(dir, "calls.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line))
			.filter(({ args }) => args[1].startsWith(`${STUB}/`));
		const [warmUp, ...probes] = calls;
		assert.equal(warmUp.args[1], `${STUB}/`);
		assert.ok(warmUp.args.includes("-v"));
		assert.equal(probes.length, 4);
		for (const { args, cwd, cwdEntries } of calls) {
			assert.equal(args[0], "curl");
			assert.deepEqual(args.slice(2, 5), ["--scope", "jsollys-projects", "--"]);
			assert.ok(cwd.startsWith(`${realpathSync(scratch)}/cwd-`));
			assert.deepEqual(cwdEntries, []);
			assert.equal(cwd, warmUp.cwd);
			const at = args.indexOf("--max-redirs");
			assert.deepEqual(args.slice(at, at + 2), ["--max-redirs", "0"]);
		}
		// Only the warm-up runs curl -v; every later call has its secret.
		assert.deepEqual(
			probes.map(({ args, bypass }) => [args.includes("-v"), bypass]),
			probes.map(() => [false, "fake-token"]),
		);
		const output = probes[0].args[probes[0].args.indexOf("-o") + 1];
		assert.ok(output.startsWith(scratch));
		assert.equal(probes[1].args[probes[1].args.indexOf("-o") + 1], "/dev/null");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("Fetch reports Vercel mitigation and Location without following a deny", async () => {
	const server = createServer((_req, res) => {
		res.writeHead(403, {
			"x-vercel-mitigated": "deny",
			location: "/unexpected",
		});
		res.end("denied");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const response = await fetchTransport()(
			`http://127.0.0.1:${server.address().port}/wp-login.php`,
			{ body: false },
		);
		assert.equal(response.status, 403);
		assert.equal(response.mitigated, "deny");
		assert.equal(response.location, "/unexpected");
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
