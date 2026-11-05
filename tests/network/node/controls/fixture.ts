// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone native child verification CLI intentionally asserts outside a test framework.
// biome-ignore-all lint/suspicious/noConditionalExpect: Each isolated child runs one explicitly selected control case.
import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { NODE_NETWORK_ERROR_CODE } from "../constants.ts";
import { withOfflineNodeGuard } from "../guard.ts";
import { requireControlReceipt } from "./receipts.ts";

const { NODE_CONTROL_CASE, NODE_CONTROL_URL } = process.env;
const deadline = setTimeout(() => process.exit(2), 10_000);
deadline.unref();
const scenario = NODE_CONTROL_CASE;
const guard = globalThis.__jsollyOfflineNodeGuard;
assert.ok(guard, "Native guard must be installed before fixture startup");
if (!scenario) throw new Error("Missing control case");
let accepted = 0;
let lookups = 0;
let redirectTarget: string | undefined;
const server = http.createServer((_request, response) => {
	if (redirectTarget) {
		response.writeHead(302, { location: redirectTarget });
		response.end();
	} else response.end("fixture");
});
server.on("connection", () => accepted++);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
	throw new Error("Missing fixture port");
const port = address.port;
const lookup: net.LookupFunction = (_hostname, options, callback) => {
	lookups++;
	callback(
		null,
		options.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1",
		4,
	);
};
const started = { pid: process.pid, scenario, port };
process.stdout.write(`${JSON.stringify({ event: "started", ...started })}\n`);

async function connectSocket(socket: net.Socket): Promise<void> {
	await once(socket, "connect");
	socket.destroy();
	await once(socket, "close");
}

async function requestHttp(options: http.RequestOptions): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = http.get(options, (response) => {
			response.resume();
			response.once("end", resolve);
		});
		request.once("error", reject);
	});
}

const failures: unknown[] = [];
try {
	if (scenario === "positive") {
		await connectSocket(net.connect(port, "127.0.0.1"));
		const numericStringSocket = new net.Socket();
		Reflect.apply(numericStringSocket.connect, numericStringSocket, [
			String(port),
			"localhost",
		]);
		await connectSocket(numericStringSocket);
		await connectSocket(net.connect({ port, host: "localhost" }));
		await requestHttp({ host: "127.0.0.1", port });
		const response = await fetch(`http://127.0.0.1:${port}/`);
		assert.equal(await response.text(), "fixture");
		assert.ok(accepted >= 5);
	}

	if (scenario === "tls-positive") {
		const directory = await mkdtemp(
			path.join(tmpdir(), "website-network-tls-"),
		);
		const keyPath = path.join(directory, "ephemeral-key.pem");
		const certPath = path.join(directory, "ephemeral-cert.pem");
		try {
			await promisify(execFile)(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-keyout",
					keyPath,
					"-out",
					certPath,
					"-days",
					"1",
					"-subj",
					"/CN=localhost",
					"-addext",
					"subjectAltName=DNS:localhost,IP:127.0.0.1",
				],
				{ timeout: 5_000, maxBuffer: 32_768 },
			);
			const [key, cert] = await Promise.all([
				readFile(keyPath),
				readFile(certPath),
			]);
			const secure = https.createServer({ key, cert }, (_request, response) =>
				response.end("secure-fixture"),
			);
			const sockets = new Set<net.Socket>();
			secure.on("connection", (socket) => {
				sockets.add(socket);
				socket.once("close", () => sockets.delete(socket));
			});
			await new Promise<void>((resolve) =>
				secure.listen(0, "127.0.0.1", resolve),
			);
			try {
				const secureAddress = secure.address();
				assert.ok(secureAddress && typeof secureAddress !== "string");
				const socket = tls.connect({
					host: "localhost",
					port: secureAddress.port,
					ca: cert,
					servername: "localhost",
				});
				await once(socket, "secureConnect");
				assert.equal(socket.authorized, true);
				const closed = once(socket, "close");
				socket.destroy();
				await closed;
				const text = await new Promise<string>((resolve, reject) => {
					const request = https.get(
						{
							host: "localhost",
							port: secureAddress.port,
							ca: cert,
							servername: "localhost",
							agent: new https.Agent({ keepAlive: false }),
						},
						(response) => {
							let result = "";
							response.setEncoding("utf8");
							response.on("data", (chunk: string) => {
								result += chunk;
							});
							response.once("end", () => resolve(result));
						},
					);
					request.once("error", reject);
				});
				assert.equal(text, "secure-fixture");
			} finally {
				for (const socket of sockets) socket.destroy();
				secure.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					secure.close((error) => (error ? reject(error) : resolve())),
				);
				assert.equal(secure.listening, false);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
	if (scenario === "ipc") {
		const socketPath = path.join(
			tmpdir(),
			`website-network-${process.pid}.sock`,
		);
		const ipc = net.createServer((socket) => socket.end());
		await new Promise<void>((resolve) => ipc.listen(socketPath, resolve));
		try {
			await connectSocket(net.connect(socketPath));
		} finally {
			await new Promise<void>((resolve, reject) =>
				ipc.close((error) => (error ? reject(error) : resolve())),
			);
			assert.equal(ipc.listening, false);
		}
	}
	if (scenario === "worker") {
		const worker = new Worker(new URL(import.meta.url), {
			env: withOfflineNodeGuard({ NODE_CONTROL_CASE: "deny-net" }),
			stdout: true,
			stderr: true,
		});
		let stdout = "";
		let stderr = "";
		worker.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		worker.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const outputClosed = Promise.all([
			once(worker.stdout, "end"),
			once(worker.stderr, "end"),
		]);
		let timedOut = false;
		const workerIdentity = worker.threadId;
		const timeout = setTimeout(() => {
			timedOut = true;
			void worker.terminate();
		}, 8_000);
		const [[code]] = await Promise.all([
			once(worker, "exit"),
			outputClosed,
		]).finally(() => clearTimeout(timeout));
		assert.equal(code, 1);
		assert.equal(timedOut, false);
		assert.ok(workerIdentity > 0);
		assert.equal(worker.threadId, -1);
		requireControlReceipt(stdout, "deny-net", process.pid, true);
		assert.ok(
			stderr.includes("Offline tests attempted forbidden network access"),
		);
	}
	if (scenario === "fork") {
		const child = fork(new URL(import.meta.url), [], {
			env: withOfflineNodeGuard({ NODE_CONTROL_CASE: "deny-net" }),
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
		const [code, signal] = await once(child, "close").finally(() =>
			clearTimeout(timeout),
		);
		assert.equal(code, 1);
		assert.ok(child.pid);
		assert.equal(signal, null);
		requireControlReceipt(stdout, "deny-net", child.pid, true);
		assert.ok(
			stderr.includes("Offline tests attempted forbidden network access"),
		);
	}
	if (scenario === "fetch-child") {
		assert.ok(NODE_CONTROL_URL);
		await assert.rejects(fetch(NODE_CONTROL_URL));
	}
	if (scenario === "fetch-redirect") {
		let targetAccepted = 0;
		const target = http.createServer((_request, response) =>
			response.end("forbidden"),
		);
		target.on("connection", () => targetAccepted++);
		await new Promise<void>((resolve) =>
			target.listen(0, "127.0.0.1", resolve),
		);
		const targetAddress = target.address();
		assert.ok(targetAddress && typeof targetAddress !== "string");
		redirectTarget = `http://127.0.0.1:${targetAddress.port}/`;
		try {
			const child = fork(new URL(import.meta.url), [], {
				env: withOfflineNodeGuard({
					NODE_CONTROL_CASE: "fetch-child",
					NODE_CONTROL_URL: `http://127.0.0.1:${port}/`,
					TEST_NETWORK_NODE_ALLOWED_PORTS: JSON.stringify([port]),
				}),
				stdio: ["ignore", "pipe", "pipe", "ipc"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
			const [code, signal] = await once(child, "close").finally(() =>
				clearTimeout(timeout),
			);
			assert.equal(code, 1);
			assert.equal(signal, null);
			assert.ok(child.pid);
			requireControlReceipt(stdout, "fetch-child", child.pid, true);
			assert.ok(
				stderr.includes("Offline tests attempted forbidden network access"),
			);
			assert.equal(targetAccepted, 0);
			assert.ok(accepted > 0);
		} finally {
			target.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				target.close((error) => (error ? reject(error) : resolve())),
			);
			assert.equal(target.listening, false);
		}
	}
	if (scenario === "fresh-env") {
		const fresh = withOfflineNodeGuard({ FIXTURE_ONLY: "true" });
		assert.deepEqual(
			Object.keys(fresh).sort((firstValue, secondValue) =>
				firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0,
			),
			["FIXTURE_ONLY", "NODE_OPTIONS"],
		);
		assert.equal(fresh[Object.keys(fresh)[0] ?? ""], "true");
		assert.throws(() => withOfflineNodeGuard({ TEST_SUITE: "production" }));
	}
	if (scenario.startsWith("deny-")) {
		assert.match(scenario, /^deny-(?:net|http|tls|https)$/u);
		assert.throws(
			() => {
				const options = { host: "forced-loopback.invalid", port, lookup };
				if (scenario === "deny-net") net.connect(options);
				if (scenario === "deny-http") http.get(options);
				if (scenario === "deny-tls") tls.connect(options);
				if (scenario === "deny-https") https.get(options);
			},
			{ code: NODE_NETWORK_ERROR_CODE },
		);
		assert.equal(lookups, 0);
		assert.equal(accepted, 0);
	}
} catch (error) {
	failures.push(error);
}
try {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	assert.equal(server.listening, false);
	process.stdout.write(
		`${JSON.stringify({ event: "closed", ...started, accepted, lookups, listening: server.listening })}\n`,
	);
} catch (error) {
	failures.push(error);
}
if (failures.length)
	throw new AggregateError(failures, "Native control or cleanup failed");

const denialCodes = guard.violations.map(({ error }) => {
	assert.ok("code" in error);
	assert.equal(error.code, NODE_NETWORK_ERROR_CODE);
	return error.code;
});
assert.deepEqual(
	denialCodes,
	scenario.startsWith("deny-") || scenario === "fetch-child"
		? [NODE_NETWORK_ERROR_CODE]
		: [],
);

// Expected negatives deliberately catch the error and request success. The
// guard's lifetime reporter must still make their dedicated process fail.
await new Promise<void>((resolve, reject) => {
	process.stdout.write(
		`${JSON.stringify({ event: "verified", ...started, denialCodes })}\n`,
		(error) => (error ? reject(error) : resolve()),
	);
});
process.exit(0);
