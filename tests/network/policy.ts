import { BlockList, isIP } from "node:net";
import {
	LOOPBACK_HOST,
	LOOPBACK_IPV6,
	LOOPBACK_NETWORK_BITS,
	TCP_PORT_MAXIMUM,
} from "./constants.ts";

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", LOOPBACK_NETWORK_BITS, "ipv4");
loopbackAddresses.addAddress(LOOPBACK_IPV6, "ipv6");

/** Resolve the supported local alias without invoking DNS. */
export function requireLoopbackHost(host: unknown): string {
	if (host === undefined || host === "") return LOOPBACK_HOST;
	if (typeof host !== "string")
		throw new TypeError("A test connection needs a loopback host");
	if (host.toLowerCase() === "localhost") return LOOPBACK_HOST;
	const address =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const family = isIP(address);
	if (family === 4 && loopbackAddresses.check(address, "ipv4")) return address;
	if (family === 6 && loopbackAddresses.check(address, "ipv6"))
		return new URL(`http://[${address}]/`).hostname.slice(1, -1);
	throw new Error(
		"Tests may only connect to literal loopback addresses or localhost",
	);
}

export function requireTcpPort(port: unknown): number {
	if (
		typeof port !== "number" ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > TCP_PORT_MAXIMUM
	)
		throw new TypeError(
			"A test TCP port must be an integer from 1 through 65535",
		);
	return port;
}

export function assertAllowedPort(
	port: number,
	allowedPorts: ReadonlySet<number> | undefined,
): void {
	requireTcpPort(port);
	if (allowedPorts !== undefined && !allowedPorts.has(port))
		throw new Error(
			"This loopback port is outside the fixture's allowed ports",
		);
}
