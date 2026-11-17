export type Channel =
	| "navigation"
	| "frame"
	| "redirect"
	| "dedicated"
	| "shared"
	| "sw-install"
	| "sw-import"
	| "sw-update"
	| "sw-fetch"
	| "ws"
	| "wss"
	| "context-request"
	| "route-fetch";
export interface BrowserOperation {
	channel: Channel;
	target: string;
}
export interface Receipt {
	channel: Channel | "raw-socks" | "persistent" | "server";
	allowed: boolean;
	success: boolean;
	bRequests: number;
	portDenials: number;
}
