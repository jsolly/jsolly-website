/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace NodeJS {
	interface ProcessEnv {
		readonly MAINTENANCE_MODE?: string;
		readonly VERCEL_GIT_COMMIT_SHA?: string;
		readonly GITHUB_SHA?: string;
		readonly NODE_ENV?: string;
		readonly CI?: string;
	}
}
