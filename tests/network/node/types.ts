declare global {
	// biome-ignore lint/style/useVarsOnTop: TypeScript ambient global properties require var; this declares no executable variable.
	var __jsollyOfflineNodeGuard: NodeNetworkGuard | undefined;
}

export type ConnectionOptions = Record<string, unknown> & {
	path?: unknown;
	host?: unknown;
	port?: unknown;
};

export type ConnectionCall = {
	options: ConnectionOptions;
	callback: unknown;
};

export type NetworkViolation = {
	kind: "connection-arguments" | "destination";
	error: Error;
};

export type NodeNetworkGuardOptions = {
	allowedPorts?: ReadonlySet<number>;
};

export type NodeNetworkGuard = {
	readonly allowedPorts: ReadonlySet<number> | undefined;
	readonly violations: readonly NetworkViolation[];
	assertNoExternalNetwork(): void;
};
