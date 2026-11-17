import type { Socket } from "node:net";
import { createConnection, createServer } from "node:net";
import {
	HANDSHAKE_TIMEOUT_MS,
	LOOPBACK_HOST,
	MAX_HANDSHAKE_BYTES,
	MAX_RECORDED_DENIALS,
	SOCKS,
} from "./constants.ts";
import {
	assertAllowedPort,
	requireLoopbackHost,
	requireTcpPort,
} from "./policy.ts";
import type {
	LoopbackProxy,
	LoopbackProxyOptions,
	ProxyDenial,
	ProxySession,
	SocksGreeting,
	SocksRequest,
} from "./types.ts";

export function readSocksGreeting(bytes: Buffer): SocksGreeting {
	if (bytes.length < 2) return { kind: "incomplete" };
	if (bytes.readUInt8(0) !== SOCKS.version)
		return { kind: "invalid", message: "SOCKS5 is required" };
	const count = bytes.readUInt8(1);
	if (!count)
		return { kind: "invalid", message: "No authentication methods supplied" };
	const consumed = count + 2;
	if (bytes.length < consumed) return { kind: "incomplete" };
	return {
		kind: "greeting",
		consumed,
		acceptsNoAuthentication: bytes
			.subarray(2, consumed)
			.includes(SOCKS.noAuthentication),
	};
}

/** Parse bytes only. The caller applies the immutable destination policy next. */
export function readSocksRequest(bytes: Buffer): SocksRequest {
	if (bytes.length < 4) return { kind: "incomplete" };
	if (
		bytes.readUInt8(0) !== SOCKS.version ||
		bytes.readUInt8(1) !== SOCKS.connect ||
		bytes.readUInt8(2) !== SOCKS.reserved
	)
		return { kind: "invalid", message: "Only SOCKS5 CONNECT is supported" };
	const kind = bytes.readUInt8(3);
	let host: string;
	let portOffset: number;
	if (kind === SOCKS.ipv4) {
		portOffset = 8;
		if (bytes.length < portOffset + 2) return { kind: "incomplete" };
		host = [...bytes.subarray(4, portOffset)].join(".");
	} else if (kind === SOCKS.ipv6) {
		portOffset = 20;
		if (bytes.length < portOffset + 2) return { kind: "incomplete" };
		const groups: string[] = [];
		for (let offset = 4; offset < portOffset; offset += 2)
			groups.push(bytes.readUInt16BE(offset).toString(16));
		host = groups.join(":");
	} else if (kind === SOCKS.domain) {
		if (bytes.length < 5) return { kind: "incomplete" };
		const length = bytes.readUInt8(4);
		if (!length) return { kind: "invalid", message: "Empty SOCKS destination" };
		portOffset = 5 + length;
		if (bytes.length < portOffset + 2) return { kind: "incomplete" };
		host = bytes.subarray(5, portOffset).toString("utf8");
	} else {
		return { kind: "invalid", message: "Unsupported SOCKS address type" };
	}
	return {
		kind: "request",
		consumed: portOffset + 2,
		destination: { host, port: bytes.readUInt16BE(portOffset) },
	};
}

function reply(code: number): Buffer {
	// The unspecified bound address is permitted by SOCKS5; it is not a target.
	return Buffer.from([
		SOCKS.version,
		code,
		SOCKS.reserved,
		SOCKS.ipv4,
		0,
		0,
		0,
		0,
		0,
		0,
	]);
}

/** A suite-owned TCP tunnel, never an external resolver or general forward proxy. */
export async function startLoopbackProxy(
	options: LoopbackProxyOptions = {},
): Promise<LoopbackProxy> {
	const allowedPorts =
		options.allowedPorts === undefined
			? undefined
			: new Set(options.allowedPorts);
	for (const port of allowedPorts ?? []) requireTcpPort(port);
	const sockets = new Set<Socket>();
	const denials: ProxyDenial[] = [];
	const infrastructureErrors: Error[] = [];
	let recordingOverflowed = false;
	let clients = 0;
	let upstreamAttempts = 0;
	let closing: Promise<void> | undefined;
	function record(denial: ProxyDenial) {
		if (denials.length < MAX_RECORDED_DENIALS) denials.push(denial);
		else if (!recordingOverflowed) {
			recordingOverflowed = true;
			infrastructureErrors.push(
				new Error("Test proxy denial recording overflowed"),
			);
		}
	}
	const server = createServer((client) => {
		if (closing !== undefined) {
			client.destroy();
			return;
		}
		clients += 1;
		sockets.add(client);
		let state: ProxySession = { kind: "greeting", buffered: Buffer.alloc(0) };
		const deny = (denial: ProxyDenial, response: Buffer) => {
			record(denial);
			state = { kind: "closed" };
			client.end(response);
			client.destroySoon();
		};
		client.setTimeout(HANDSHAKE_TIMEOUT_MS, () => {
			record({ kind: "protocol", message: "SOCKS handshake timed out" });
			client.destroy();
		});
		client.on("error", () => client.destroy());
		client.on("close", () => {
			sockets.delete(client);
			if (state.kind === "connecting" || state.kind === "tunnel")
				state.upstream.destroy();
			state = { kind: "closed" };
		});
		const receive = (chunk: Buffer) => {
			if (closing !== undefined) {
				client.destroy();
				return;
			}
			if (state.kind !== "greeting" && state.kind !== "request") return;
			state.buffered = Buffer.concat([state.buffered, chunk]);
			const incomplete = () => {
				if (
					(state.kind === "greeting" || state.kind === "request") &&
					state.buffered.length > MAX_HANDSHAKE_BYTES
				)
					deny(
						{
							kind: "protocol",
							message: "SOCKS handshake exceeded its byte limit",
						},
						reply(SOCKS.generalFailure),
					);
			};
			if (state.kind === "greeting") {
				const greeting = readSocksGreeting(state.buffered);
				if (greeting.kind === "incomplete") {
					incomplete();
					return;
				}
				if (greeting.kind === "invalid" || !greeting.acceptsNoAuthentication) {
					deny(
						{
							kind: "protocol",
							message:
								greeting.kind === "invalid"
									? greeting.message
									: "No supported authentication method",
						},
						Buffer.from([SOCKS.version, SOCKS.noAcceptableAuthentication]),
					);
					return;
				}
				client.write(Buffer.from([SOCKS.version, SOCKS.noAuthentication]));
				state = {
					kind: "request",
					buffered: state.buffered.subarray(greeting.consumed),
				};
			}
			const request = readSocksRequest(state.buffered);
			if (request.kind === "incomplete") {
				incomplete();
				return;
			}
			if (request.kind === "invalid") {
				deny(
					{ kind: "protocol", message: request.message },
					reply(SOCKS.generalFailure),
				);
				return;
			}
			const destination = request.destination;
			let host: string;
			try {
				host = requireLoopbackHost(destination.host);
			} catch {
				deny({ kind: "host", destination }, reply(SOCKS.forbidden));
				return;
			}
			try {
				requireTcpPort(destination.port);
				assertAllowedPort(destination.port, allowedPorts);
			} catch {
				deny({ kind: "port", destination }, reply(SOCKS.forbidden));
				return;
			}
			const remainder = state.buffered.subarray(request.consumed);
			client.pause();
			client.removeListener("data", receive);
			upstreamAttempts += 1;
			// host is now a literal loopback IP. No DNS lookup is possible here.
			const upstream = createConnection({ host, port: destination.port });
			sockets.add(upstream);
			state = { kind: "connecting", upstream };
			upstream.on("error", () => {
				if (state.kind === "connecting")
					client.end(reply(SOCKS.connectionRefused));
				else client.destroy();
			});
			upstream.on("close", () => {
				sockets.delete(upstream);
				client.end();
			});
			upstream.once("connect", () => {
				if (state.kind !== "connecting" || closing !== undefined) {
					upstream.destroy();
					return;
				}
				state = { kind: "tunnel", upstream };
				client.setTimeout(0);
				client.write(reply(SOCKS.succeeded));
				if (remainder.length) upstream.write(remainder);
				client.pipe(upstream);
				upstream.pipe(client);
				client.resume();
			});
		};
		client.on("data", receive);
	});
	server.on("error", (error) => infrastructureErrors.push(error));
	await new Promise<void>((resolve, reject) => {
		const failed = (error: Error) => {
			server.removeListener("listening", listening);
			reject(error);
		};
		const listening = () => {
			server.removeListener("error", failed);
			resolve();
		};
		server.once("error", failed);
		server.once("listening", listening);
		server.listen(0, LOOPBACK_HOST);
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		server.close();
		throw new Error("Test proxy did not bind a TCP address");
	}
	return {
		endpoint: `socks5://${LOOPBACK_HOST}:${address.port}`,
		snapshot: () => ({
			clients,
			upstreamAttempts,
			denials: denials.map((denial) =>
				denial.kind === "protocol"
					? { ...denial }
					: { ...denial, destination: { ...denial.destination } },
			),
		}),
		close() {
			if (closing !== undefined) return closing;
			closing = Promise.resolve().then(async () => {
				// Subscribe before destroy: destroyed sockets may still await close.
				const socketClosures = [...sockets].map(
					(socket) =>
						new Promise<void>((resolve) => {
							if (socket.closed) resolve();
							else socket.once("close", () => resolve());
						}),
				);
				const serverClosure = new Promise<void>((resolve) => {
					server.close((error) => {
						if (error) infrastructureErrors.push(error);
						resolve();
					});
				});
				for (const socket of sockets) socket.destroy();
				await Promise.all([serverClosure, ...socketClosures]);
				if (infrastructureErrors.length)
					throw new AggregateError(infrastructureErrors, "Test proxy failed");
			});
			return closing;
		},
	};
}
