// biome-ignore-all lint/performance/noAwaitInLoops: Controls deliberately serialize shared sentinel state and prove ordered lifecycle cleanup.
// biome-ignore-all lint/nursery/noConditionalExpect: This standalone native assertion harness checks both paired branches directly.
// biome-ignore-all lint/suspicious/noMisplacedAssertion: Native Node assert controls run without a Vitest test wrapper.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createTlsServer } from "node:https";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import {
	launchPersistentTestContext,
	launchTestBrowser,
	launchTestBrowserServer,
} from "../browser.ts";
import { startLoopbackProxy } from "../proxy.ts";
import type { LoopbackProxy } from "../types.ts";
import { browserOperation } from "./driver.ts";
import { runProtocolControls } from "./protocol.ts";
import type { Channel, Receipt } from "./types.ts";

const here = import.meta.dirname;
const deadlineMs = 15_000;
let controlsRunning = false;
/** Run serially: the public launch factories consume the process proxy endpoint. */
export async function runBrowserControls(): Promise<readonly Receipt[]> {
	if (controlsRunning)
		throw new Error("Browser boundary controls already running");
	controlsRunning = true;
	try {
		runProtocolControls();
		return await executeBrowserControls();
	} finally {
		controlsRunning = false;
	}
}

async function executeBrowserControls(): Promise<readonly Receipt[]> {
	const receipts: Receipt[] = [];
	const cleanups: (() => Promise<void>)[] = [];
	let bRequests = 0;
	let revision = 1;
	let redirectTarget = "";
	const scripts = new Map<string, string>();
	function setProxyEndpoint(value: string | undefined): void {
		if (value === undefined)
			Reflect.deleteProperty(process.env, "TEST_NETWORK_PROXY");
		else Object.assign(process.env, { TEST_NETWORK_PROXY: value });
	}

	function own(cleanup: () => Promise<void>) {
		cleanups.push(cleanup);
	}
	async function bounded<T>(pending: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				pending,
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() =>
							reject(new Error("Control exceeded outer operation deadline")),
						deadlineMs,
					);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
	async function stopServer(
		server: Server,
		sockets: Set<Socket>,
	): Promise<void> {
		const closed = [...sockets].map(
			(socket) =>
				new Promise<void>((resolve) => {
					if (socket.closed) resolve();
					else socket.once("close", () => resolve());
				}),
		);
		const serverClosed = new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		for (const socket of sockets) socket.destroy();
		await Promise.all([serverClosed, ...closed]);
	}
	async function listen(server: Server): Promise<number> {
		const sockets = new Set<Socket>();
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		own(async () => await stopServer(server, sockets));
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		return address.port;
	}
	function sentinel(_request: IncomingMessage, response: ServerResponse) {
		bRequests++;
		response.setHeader("Access-Control-Allow-Origin", "*");
		response.setHeader("Content-Type", "text/javascript");
		response.end("sentinel");
	}
	function websocket(server: Server) {
		server.on("upgrade", (request, socket) => {
			bRequests++;
			const key = request.headers["sec-websocket-key"];
			assert.equal(typeof key, "string");
			const accept = createHash("sha1")
				.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
				.digest("base64");
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
			);
			const payload = Buffer.from("sentinel");
			socket.write(
				Buffer.concat([Buffer.from([0x81, payload.length]), payload]),
			);
		});
	}
	async function operation(
		page: Page,
		channel: Channel,
		target: string,
		a: string,
	): Promise<boolean> {
		if (channel === "navigation" || channel === "redirect") {
			try {
				return (
					(await (
						await page.goto(
							channel === "redirect" ? `${a}/redirect-first` : target,
						)
					)?.text()) === "sentinel"
				);
			} catch {
				return false;
			}
		}
		if (channel === "frame") {
			await page.setContent('<iframe name="sentinel-frame"></iframe>');
			const frame = page.frame({ name: "sentinel-frame" });
			assert.ok(frame);
			try {
				return (await (await frame.goto(target))?.text()) === "sentinel";
			} catch {
				return false;
			}
		}
		if (channel === "context-request") {
			try {
				return (
					(await (await page.context().request.get(target)).text()) ===
					"sentinel"
				);
			} catch {
				return false;
			}
		}
		if (channel === "route-fetch") {
			let outcome = false;
			await page.route("**/routed-control", async (route) => {
				try {
					const response = await route.fetch({ url: target });
					outcome = (await response.text()) === "sentinel";
					await route.fulfill({ response });
				} catch {
					await route.abort();
				}
			});
			try {
				await page.goto(`${a}/routed-control`);
			} catch {
				/* A denied upstream aborts navigation. */
			}
			return outcome;
		}
		return await page.evaluate(browserOperation, { channel, target });
	}
	async function withBrowser<T>(
		proxy: LoopbackProxy,
		action: (browser: Browser) => Promise<T>,
	): Promise<T> {
		setProxyEndpoint(proxy.endpoint);
		const browser = await launchTestBrowser({ ignoreCertificateErrors: true });
		try {
			return await action(browser);
		} finally {
			await browser.close();
		}
	}
	async function rawSocks(aPort: number, bPort: number): Promise<void> {
		for (const allowed of [true, false]) {
			bRequests = 0;
			const proxy = await startLoopbackProxy({
				allowedPorts: new Set(allowed ? [aPort, bPort] : [aPort]),
			});
			try {
				const endpoint = new URL(proxy.endpoint);
				const socket = createConnection({
					host: "127.0.0.1",
					port: Number(endpoint.port),
				});
				try {
					const received: Buffer[] = [];
					const result = new Promise<number>((resolve, reject) => {
						let greeting = false;
						let buffered = Buffer.alloc(0);
						socket.on("error", reject);
						socket.on("data", (chunk) => {
							try {
								buffered = Buffer.concat([
									buffered,
									typeof chunk === "string" ? Buffer.from(chunk) : chunk,
								]);
								if (!greeting && buffered.length >= 2) {
									assert.deepEqual(
										buffered.subarray(0, 2),
										Buffer.from([5, 0]),
									);
									buffered = buffered.subarray(2);
									greeting = true;
									// Deliberately fragmented request and early HTTP payload.
									socket.write(Buffer.from([5, 1, 0, 1, 127]));
									socket.write(
										Buffer.concat([
											Buffer.from([0, 0, 1, bPort >> 8, bPort & 255]),
											Buffer.from(
												"GET /raw HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
											),
										]),
									);
								}
								if (greeting && buffered.length >= 10) {
									received.push(buffered);
									resolve(buffered[1] ?? -1);
								}
							} catch (error) {
								reject(error);
							}
						});
					});
					socket.write(Buffer.from([5]));
					socket.write(Buffer.from([1, 0]));
					const reply = await bounded(result);
					assert.equal(reply, allowed ? 0 : 2);
					if (allowed) {
						await bounded(
							new Promise<void>((resolve) =>
								socket.once("close", () => resolve()),
							),
						);
						assert.ok(
							Buffer.concat(received).includes(Buffer.from("sentinel")),
						);
					}
				} finally {
					socket.destroy();
					await new Promise<void>((resolve) => {
						if (socket.closed) resolve();
						else socket.once("close", () => resolve());
					});
				}
				const denials = proxy
					.snapshot()
					.denials.filter((d) => d.kind === "port").length;
				assert.equal(denials, allowed ? 0 : 1);
				assert.equal(proxy.snapshot().upstreamAttempts, allowed ? 1 : 0);
				if (allowed) assert.ok(bRequests > 0);
				else assert.equal(bRequests, 0);
				receipts.push({
					channel: "raw-socks",
					allowed,
					success: allowed,
					bRequests,
					portDenials: denials,
				});
			} finally {
				await proxy.close();
			}
		}
	}
	async function pair(
		channel: Channel,
		a: string,
		aPort: number,
		bPort: number,
		tlsPort: number,
	): Promise<void> {
		for (const allowed of [true, false]) {
			revision = 1;
			bRequests = 0;
			const port = channel === "wss" ? tlsPort : bPort;
			const proxy = await startLoopbackProxy({
				allowedPorts: new Set(allowed ? [aPort, port] : [aPort]),
			});
			try {
				const target =
					channel === "ws"
						? `ws://127.0.0.1:${port}/control`
						: channel === "wss"
							? `wss://127.0.0.1:${port}/control`
							: `http://127.0.0.1:${port}/sentinel`;
				// importScripts requires syntactically valid code. A string expression is inert.
				const effectiveTarget =
					channel === "sw-import"
						? target.replace("/sentinel", "/import.js")
						: target;
				redirectTarget = effectiveTarget;
				const success = await withBrowser(proxy, async (browser) => {
					const context = await browser.newContext();
					try {
						const page = await context.newPage();
						await page.goto(a);
						return await bounded(operation(page, channel, effectiveTarget, a));
					} finally {
						await context.close();
					}
				});
				const portDenials = proxy
					.snapshot()
					.denials.filter((d) => d.kind === "port").length;
				receipts.push({ channel, allowed, success, bRequests, portDenials });
				assert.equal(
					success,
					allowed,
					`${channel}: paired expected operation outcome`,
				);
				if (allowed) {
					assert.ok(bRequests > 0, `${channel}: positive sentinel receipt`);
					assert.equal(portDenials, 0);
				} else {
					assert.equal(
						bRequests,
						0,
						`${channel}: forbidden sentinel must receive nothing`,
					);
					assert.ok(
						portDenials > 0,
						`${channel}: deny must occur at proxy floor`,
					);
				}
				assert.equal(
					proxy.snapshot().denials.filter((d) => d.kind === "host").length,
					0,
				);
			} finally {
				await proxy.close();
			}
		}
	}
	async function mutationControl(
		a: string,
		aPort: number,
		bPort: number,
	): Promise<void> {
		bRequests = 0;
		// The only mutation is allowing B's port; the host floor is unchanged.
		const proxy = await startLoopbackProxy({
			allowedPorts: new Set([aPort, bPort]),
		});
		try {
			const success = await withBrowser(proxy, async (browser) => {
				const context = await browser.newContext();
				try {
					const page = await context.newPage();
					await page.goto(a);
					return await bounded(
						operation(
							page,
							"navigation",
							`http://127.0.0.1:${bPort}/sentinel`,
							a,
						),
					);
				} finally {
					await context.close();
				}
			});
			const receipt: Receipt = {
				channel: "navigation",
				allowed: false,
				success,
				bRequests,
				portDenials: proxy.snapshot().denials.filter((d) => d.kind === "port")
					.length,
			};
			// All causal evidence is asserted OUTSIDE the expected assertion-failure catcher.
			assert.equal(receipt.allowed, false);
			assert.equal(receipt.success, true);
			assert.ok(receipt.bRequests > 0);
			assert.equal(receipt.portDenials, 0);
			assert.equal(proxy.snapshot().denials.length, 0);
			receipts.push(receipt);
			// Only the negative predicate is expected to fail, not the positive setup.
			assert.throws(() => assert.equal(receipt.success, receipt.allowed), {
				code: "ERR_ASSERTION",
			});
		} finally {
			await proxy.close();
		}
	}
	async function launcherControls(a: string, aPort: number): Promise<void> {
		bRequests = 0;
		for (const value of [
			undefined,
			"",
			"http://127.0.0.1:1",
			"socks5://example.invalid:1",
			"socks5://127.0.0.1:1/path",
			"socks5://user@127.0.0.1:1",
		]) {
			setProxyEndpoint(value);
			await assert.rejects(launchTestBrowser());
			await assert.rejects(
				launchPersistentTestContext(
					join(tmpdir(), "not-created-network-control"),
				),
			);
			await assert.rejects(launchTestBrowserServer());
		}
		const proxy = await startLoopbackProxy({ allowedPorts: new Set([aPort]) });
		let profile: string | undefined;
		try {
			profile = await mkdtemp(join(tmpdir(), "network-profile-"));
			setProxyEndpoint(proxy.endpoint);
			for (let i = 0; i < 2; i++) {
				const context = await launchPersistentTestContext(profile);
				try {
					const page = await context.newPage();
					await page.goto(a);
					if (i === 0)
						await page.evaluate(() =>
							localStorage.setItem("control", "persistent"),
						);
					else
						assert.equal(
							await page.evaluate(() => localStorage.getItem("control")),
							"persistent",
						);
				} finally {
					await context.close();
				}
			}
			receipts.push({
				channel: "persistent",
				allowed: true,
				success: true,
				bRequests,
				portDenials: 0,
			});
			const server = await launchTestBrowserServer();
			try {
				const browser = await chromium.connect(server.wsEndpoint());
				try {
					const page = await browser.newPage();
					assert.ok((await page.goto(a))?.ok());
				} finally {
					await browser.close();
				}
			} finally {
				await server.close();
			}
			receipts.push({
				channel: "server",
				allowed: true,
				success: true,
				bRequests,
				portDenials: 0,
			});
			assert.equal(proxy.snapshot().denials.length, 0);
			assert.equal(bRequests, 0);
		} finally {
			await Promise.allSettled([
				proxy.close(),
				profile === undefined
					? Promise.resolve()
					: rm(profile, { recursive: true, force: true }),
			]).then((results) => {
				const errors = results.filter((r) => r.status === "rejected");
				if (errors.length)
					throw new AggregateError(errors, "Launcher cleanup failed");
			});
		}
	}
	async function main(): Promise<void> {
		const { TEST_NETWORK_PROXY: previousProxy } = process.env;
		const work = await mkdtemp(join(tmpdir(), "browser-network-controls-"));
		own(async () => await rm(work, { recursive: true, force: true }));
		let failure: unknown;
		const errors: unknown[] = [];
		try {
			for (const name of ["dedicated", "shared", "service", "imported"])
				for (const version of name === "service" ? [1, 2] : [1]) {
					const result = await build({
						entryPoints: [join(here, "fixtures", `${name}.ts`)],
						bundle: true,
						write: false,
						format: "iife",
						platform: "browser",
						target: "es2024",
						define: { CONTROL_VERSION: String(version) },
					});
					const output = result.outputFiles[0];
					assert.ok(output);
					scripts.set(`${name}-${version}`, output.text);
				}
			await promisify(execFile)("openssl", [
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				join(work, "key.pem"),
				"-out",
				join(work, "cert.pem"),
				"-days",
				"1",
				"-subj",
				"/CN=localhost",
			]);
			const aServer = createServer((request, response) => {
				const url = new URL(request.url ?? "/", "http://127.0.0.1");
				if (url.pathname === "/advance-service-revision") {
					revision = 2;
					response.end("advanced");
					return;
				}
				if (url.pathname.startsWith("/redirect")) {
					response.writeHead(302, {
						location:
							url.pathname === "/redirect-first"
								? "/redirect-second"
								: redirectTarget,
					});
					response.end();
					return;
				}
				const name =
					url.pathname === "/service.js"
						? "service"
						: url.pathname === "/shared.js"
							? "shared"
							: url.pathname === "/dedicated.js"
								? "dedicated"
								: undefined;
				if (name) {
					response.setHeader("Content-Type", "text/javascript");
					response.setHeader("Cache-Control", "no-store");
					response.end(
						scripts.get(`${name}-${name === "service" ? revision : 1}`),
					);
					return;
				}
				response.setHeader("Content-Type", "text/html");
				response.end("<!doctype html><title>loopback A</title>loopback A");
			});
			const bServer = createServer((request, response) => {
				if (request.url === "/import.js") {
					bRequests++;
					response.setHeader("Content-Type", "text/javascript");
					response.end(scripts.get("imported-1"));
				} else sentinel(request, response);
			});
			websocket(bServer);
			const tlsServer = createTlsServer(
				{
					key: await readFile(join(work, "key.pem")),
					cert: await readFile(join(work, "cert.pem")),
				},
				sentinel,
			);
			websocket(tlsServer);
			const aPort = await listen(aServer),
				bPort = await listen(bServer),
				tlsPort = await listen(tlsServer);
			const a = `http://127.0.0.1:${aPort}`;
			await rawSocks(aPort, bPort);
			for (const channel of [
				"navigation",
				"frame",
				"redirect",
				"dedicated",
				"shared",
				"sw-install",
				"sw-import",
				"sw-update",
				"sw-fetch",
				"ws",
				"wss",
				"context-request",
				"route-fetch",
			] as const)
				await pair(channel, a, aPort, bPort, tlsPort);
			// Private mutation removes ONLY the extra B-port restriction; the literal loopback floor remains active.
			await mutationControl(a, aPort, bPort);
			await launcherControls(a, aPort);
		} catch (error) {
			failure = error;
		} finally {
			setProxyEndpoint(previousProxy);
			for (const cleanup of cleanups.reverse())
				try {
					await cleanup();
				} catch (error) {
					errors.push(error);
				}
		}
		if (failure !== undefined) errors.unshift(failure);
		if (errors.length)
			throw new AggregateError(errors, "Browser controls failed");
	}
	await main();
	return receipts;
}
