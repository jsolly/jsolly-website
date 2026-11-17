export const LOOPBACK_HOST = "127.0.0.1";
export const LOOPBACK_NETWORK_BITS = 8;
export const LOOPBACK_IPV6 = "::1";
export const PROXY_ENVIRONMENT_KEY = "TEST_NETWORK_PROXY";
export const PROXY_BYPASS = "<-loopback>";
export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const MAX_HANDSHAKE_BYTES = 1_024;
export const MAX_RECORDED_DENIALS = 1_024;
export const TCP_PORT_MAXIMUM = 65_535;
export const SOCKS = {
	version: 5,
	noAuthentication: 0,
	noAcceptableAuthentication: 255,
	connect: 1,
	reserved: 0,
	ipv4: 1,
	domain: 3,
	ipv6: 4,
	succeeded: 0,
	generalFailure: 1,
	forbidden: 2,
	connectionRefused: 5,
} as const;

export const MAX_DENIAL_DETAILS = 8;
export const MAX_DENIAL_SUMMARY_BYTES = 4096;
export const DENIAL_DNS_HOST =
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/iu;
export const DENIAL_PROTOCOL_REASONS = new Set([
	"SOCKS5 is required",
	"No authentication methods supplied",
	"Only SOCKS5 CONNECT is supported",
	"Empty SOCKS destination",
	"Unsupported SOCKS address type",
	"SOCKS handshake timed out",
	"SOCKS handshake exceeded its byte limit",
	"No supported authentication method",
]);
