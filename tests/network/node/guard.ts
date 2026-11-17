import { Socket } from "node:net";
import {
	assertAllowedPort,
	requireLoopbackHost,
	requireTcpPort,
} from "../policy.ts";
import {
	LIVE_PRODUCTION_SUITE,
	NODE_LIVE_SUITE_ERROR,
	NODE_NETWORK_ERROR_CODE,
	NODE_NETWORK_ERROR_MESSAGE,
	NODE_NETWORK_REPORT_MESSAGE,
} from "./constants.ts";
import type {
	ConnectionCall,
	ConnectionOptions,
	NetworkViolation,
	NodeNetworkGuard,
	NodeNetworkGuardOptions,
} from "./types.ts";

function isOptions(value: unknown): value is ConnectionOptions {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectionCall(args: readonly unknown[]): ConnectionCall {
	// net.connect passes Socket.connect its already-normalized argument array.
	// Convert that shape back to public options/callback arguments; do not rely
	// on Node's private symbol that marks the internal array.
	const input: readonly unknown[] = Array.isArray(args[0]) ? args[0] : args;
	const first: unknown = input[0];
	const last: unknown = input.at(-1);
	const callback = typeof last === "function" ? last : undefined;
	if (isOptions(first)) return { options: { ...first }, callback };
	// Node treats nonnumeric string arguments as IPC paths. Numeric strings
	// remain TCP ports; in particular, never classify a TCP host as an IPC path.
	if (typeof first === "string" && !(Number(first) >= 0)) {
		return { options: { path: first }, callback };
	}
	return {
		options: {
			port: first,
			...(typeof input[1] === "string" ? { host: input[1] } : {}),
		},
		callback,
	};
}

function samePorts(
	left: ReadonlySet<number> | undefined,
	right: ReadonlySet<number>,
) {
	return (
		left !== undefined &&
		left.size === right.size &&
		[...left].every((port) => right.has(port))
	);
}

/** Install once in this Node process, before loading application/test code. */
export function installNodeNetworkGuard(
	options: NodeNetworkGuardOptions = {},
): NodeNetworkGuard {
	const previous = globalThis.__jsollyOfflineNodeGuard;
	if (previous) {
		if (
			options.allowedPorts !== undefined &&
			!samePorts(previous.allowedPorts, options.allowedPorts)
		) {
			throw new Error(
				"Offline Node guard already has different fixture limits",
			);
		}
		return previous;
	}
	const allowedPorts =
		options.allowedPorts === undefined
			? undefined
			: new Set([...options.allowedPorts].map(requireTcpPort));
	const violations: NetworkViolation[] = [];
	const original = Socket.prototype.connect;
	const descriptor = Object.getOwnPropertyDescriptor(
		Socket.prototype,
		"connect",
	);
	if (!descriptor || typeof descriptor.value !== "function") {
		throw new Error("Node Socket.connect is unavailable for offline tests");
	}
	const reject = (kind: NetworkViolation["kind"]): never => {
		// Do not retain arbitrary host/URL text, which could contain credentials.
		const error = Object.assign(new Error(NODE_NETWORK_ERROR_MESSAGE), {
			code: NODE_NETWORK_ERROR_CODE,
		});
		violations.push({ kind, error });
		throw error;
	};
	function connect(this: Socket, ...args: unknown[]): Socket {
		let call: ConnectionCall;
		try {
			call = connectionCall(args);
		} catch {
			return reject("connection-arguments");
		}
		const path = call.options.path;
		if (path !== undefined && path !== null && path !== "") {
			if (typeof path !== "string") return reject("connection-arguments");
			// Unix IPC is local and is used by the test runner's child processes.
			Reflect.apply(original, this, [call.options, call.callback]);
			return this;
		}
		let host: string;
		let port: number;
		try {
			host = requireLoopbackHost(call.options.host);
			port = requireTcpPort(
				typeof call.options.port === "string"
					? Number(call.options.port)
					: call.options.port,
			);
			assertAllowedPort(port, allowedPorts);
		} catch {
			return reject("destination");
		}
		// Canonical literal addresses avoid DNS, including custom lookup callbacks
		// for localhost. Other connection options and the original callback stay.
		Reflect.apply(original, this, [
			{ ...call.options, host, port },
			call.callback,
		]);
		return this;
	}
	// Preserve the native property's flags. The public overloads return this;
	// the implementation above accepts each shape and returns that same Socket.
	Object.defineProperty(Socket.prototype, "connect", {
		...descriptor,
		value: connect,
	});
	const guard: NodeNetworkGuard = {
		get allowedPorts() {
			return allowedPorts === undefined ? undefined : new Set(allowedPorts);
		},
		get violations() {
			return violations.slice();
		},
		assertNoExternalNetwork() {
			if (violations.length) {
				throw new AggregateError(
					violations.map(({ error }) => error),
					NODE_NETWORK_REPORT_MESSAGE,
				);
			}
		},
	};
	globalThis.__jsollyOfflineNodeGuard = guard;
	process.once("exit", () => {
		if (!violations.length) return;
		process.stderr.write(
			`${NODE_NETWORK_REPORT_MESSAGE}: ${violations.length}\n`,
		);
		if (process.exitCode === undefined || Number(process.exitCode) === 0) {
			process.exitCode = 1;
		}
	});
	return guard;
}

/** Used by the test framework so caught application fallbacks still fail. */
export function assertNoExternalNetwork(): void {
	const guard = globalThis.__jsollyOfflineNodeGuard;
	if (!guard) throw new Error("Offline Node network guard was not installed");
	guard.assertNoExternalNetwork();
}

/** Propagate only the caller-provided environment, including fresh fixtures. */
export function withOfflineNodeGuard(
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const { TEST_SUITE, NODE_OPTIONS } = env;
	if (TEST_SUITE === LIVE_PRODUCTION_SUITE) {
		throw new Error(NODE_LIVE_SUITE_ERROR);
	}
	const preload = `--import=${new URL("./preload.ts", import.meta.url).href}`;
	return {
		...env,
		NODE_OPTIONS: NODE_OPTIONS ? `${preload} ${NODE_OPTIONS}` : preload,
	};
}
