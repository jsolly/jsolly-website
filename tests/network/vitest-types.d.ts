import "vitest";

declare module "vitest" {
	interface ProvidedContext {
		offlineNetworkProxy: string;
	}
}
