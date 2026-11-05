import type { Socket } from "node:net";

interface TcpDestination {
	host: string;
	port: number;
}

export type SocksGreeting =
	| { kind: "incomplete" }
	| { kind: "invalid"; message: string }
	| { kind: "greeting"; consumed: number; acceptsNoAuthentication: boolean };

export type SocksRequest =
	| { kind: "incomplete" }
	| { kind: "invalid"; message: string }
	| { kind: "request"; consumed: number; destination: TcpDestination };

export type ProxyDenial =
	| { kind: "protocol"; message: string }
	| { kind: "host" | "port"; destination: TcpDestination };

export interface LoopbackProxyOptions {
	/** An additional restriction; it can never allow a non-loopback host. */
	allowedPorts?: ReadonlySet<number>;
}

interface LoopbackProxySnapshot {
	clients: number;
	upstreamAttempts: number;
	denials: readonly ProxyDenial[];
}

export interface LoopbackProxy {
	endpoint: string;
	close(): Promise<void>;
	snapshot(): LoopbackProxySnapshot;
}

export type ProxySession =
	| { kind: "greeting" | "request"; buffered: Buffer }
	| { kind: "connecting"; upstream: Socket }
	| { kind: "tunnel"; upstream: Socket }
	| { kind: "closed" };

export interface TestBrowserOptions {
	headless?: boolean;
	ignoreCertificateErrors?: boolean;
}

export interface TestPersistentContextOptions extends TestBrowserOptions {
	offline?: boolean;
}
