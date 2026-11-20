// Installs and checks the Chrome Headless Shell that Playwright pins and every browser
// test launches. Installation is Playwright's own `install --only-shell chromium`;
// this file adds no other download source. When that install fails and the shell is
// still missing, it prints one message for the environment owner and exits 1 (setup
// warns and continues). `--check`
// reports whether the pinned shell is installed and changes nothing; it exits with
// SHELL_MISSING_EXIT only when the shell is missing, so the local gate can skip its
// browser checks then and still fail on any other error.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "INSTALLATION_COMPLETE";
// gate/run-gate.mjs imports this to recognise a missing shell.
export const SHELL_MISSING_EXIT = 3;

class ShellMissing extends Error {}
// Playwright takes the first non-empty of these names, browser-specific first. For
// each name it reads the variable, then npm's `npm_config_<name>` (for example from
// ~/.npmrc under `npm run`), then `npm_package_config_<name>`, stopping at the first
// form that is set (Playwright's getFromENV).
const envForms = (name: string) => [
	name,
	`npm_config_${name.toLowerCase()}`,
	`npm_package_config_${name.toLowerCase()}`,
];
function fromEnv(env: NodeJS.ProcessEnv, name: string) {
	const form = envForms(name).find((candidate) => env[candidate] !== undefined);
	return form === undefined ? undefined : { form, value: env[form] };
}
const HOST_OVERRIDES = [
	"PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST",
	"PLAYWRIGHT_DOWNLOAD_HOST",
];
const INSTALL = "`playwright install --only-shell chromium`";

export interface PlannedShell {
	version: string;
	revision: string;
	directory: string;
	downloadHost: string;
}

export interface Provisioning {
	shell: PlannedShell;
	// The host Playwright downloads from with no override set.
	defaultHost: string;
	// The variable that replaces Playwright's CDN and its origin, never credentials,
	// path or query. `origin` is absent when the value is not a URL.
	override?: { name: string; origin?: string };
}

const PLANNED_SHELL =
	/^Chrome Headless Shell (?<version>\S+) \(playwright chromium-headless-shell v(?<revision>\d+)\)\n\s+Install location:\s+(?<directory>\S.*)\n\s+Download url:\s+(?<url>\S+)$/mu;

export function plannedHeadlessShell(dryRun: string): PlannedShell {
	const groups = PLANNED_SHELL.exec(dryRun)?.groups ?? {};
	const { version, revision, directory, url } = groups;
	if (!(version && revision && directory && url))
		throw new Error(
			"Playwright's install plan names no Chrome Headless Shell; `playwright install --dry-run chromium-headless-shell` changed its output.",
		);
	return {
		version,
		revision,
		directory: directory.trim(),
		downloadHost: new URL(url).host,
	};
}

// The origin never carries userinfo, path or query.
function redactedOrigin(value: string): string | undefined {
	const origin = URL.canParse(value) ? new URL(value).origin : "null";
	return origin === "null" ? undefined : origin;
}

export function downloadOverride(
	env: NodeJS.ProcessEnv,
): Provisioning["override"] {
	for (const variable of HOST_OVERRIDES) {
		const found = fromEnv(env, variable);
		if (found?.value) {
			const origin = redactedOrigin(found.value);
			return origin ? { name: found.form, origin } : { name: found.form };
		}
	}
	return undefined;
}

// Playwright's own reading of PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: the first form that
// is set, where "false", "0" and empty mean downloads stay on.
export function browserDownloadsDisabled(env: NodeJS.ProcessEnv): boolean {
	const value = fromEnv(env, "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD")?.value;
	return Boolean(value) && value !== "false" && value !== "0";
}

export function withoutDownloadOverrides(env: NodeJS.ProcessEnv) {
	const copy = { ...env };
	for (const name of HOST_OVERRIDES.flatMap(envForms)) delete copy[name];
	return copy;
}

function ownerAction({ shell, defaultHost, override }: Provisioning) {
	const provision = `the environment owner has to provision Chrome Headless Shell ${shell.version} at ${shell.directory}`;
	if (!override)
		return `${provision} or allow the browser download host ${shell.downloadHost}.`;
	const named = override.origin
		? `${override.name} override (${override.origin})`
		: `${override.name} override`;
	return `${provision}, or remove the ${named}, which replaces Playwright's CDN, and allow ${defaultHost}.`;
}

function hostDescription({ shell, override }: Provisioning) {
	return override
		? `the download host ${shell.downloadHost} that ${override.name} sets`
		: `the browser download host ${shell.downloadHost}`;
}

export function missingMessage(provisioning: Provisioning) {
	const { shell } = provisioning;
	return `Chrome Headless Shell ${shell.version} (Playwright revision ${shell.revision}) is not installed at ${shell.directory}. Run \`npm run browser:install\` (repository setup runs it), then rerun the gate. If that install fails to download because ${hostDescription(provisioning)} is not reachable from this environment, ${ownerAction(provisioning)}`;
}

export function installFailedMessage(
	provisioning: Provisioning,
	outcome: string,
) {
	const { shell } = provisioning;
	return `Playwright did not install Chrome Headless Shell ${shell.version} (${INSTALL} ${outcome}). If the error above is a download failure, ${hostDescription(provisioning)} is not reachable from this environment, so ${ownerAction(provisioning)} Browser tests cannot run until then.`;
}

// Run the CLI with Node directly: npx would re-add npm_config_* from .npmrc to the
// child's environment and defeat withoutDownloadOverrides.
function playwrightCli() {
	let manifest: string;
	try {
		manifest = createRequire(import.meta.url).resolve(
			"playwright/package.json",
		);
	} catch (error) {
		throw new Error("Playwright is not installed; run `npm ci` first.", {
			cause: error,
		});
	}
	return join(
		dirname(manifest),
		JSON.parse(readFileSync(manifest, "utf8")).bin.playwright,
	);
}

function playwright(
	args: string[],
	stdout: "pipe" | "inherit",
	env: NodeJS.ProcessEnv = process.env,
) {
	return spawnSync(process.execPath, [playwrightCli(), ...args], {
		env,
		encoding: "utf8",
		stdio: ["ignore", stdout, "inherit"],
	});
}

// The dry run prints the plan and downloads nothing.
function plan(env: NodeJS.ProcessEnv = process.env) {
	const result = playwright(
		["install", "--dry-run", "chromium-headless-shell"],
		"pipe",
		env,
	);
	if (result.status !== 0)
		throw new Error(
			"`playwright install --dry-run` failed; run `npm ci` first.",
		);
	return plannedHeadlessShell(result.stdout);
}

function provisioningFor(shell: PlannedShell): Provisioning {
	const override = downloadOverride(process.env);
	if (!override) return { shell, defaultHost: shell.downloadHost };
	const defaultHost = plan(withoutDownloadOverrides(process.env)).downloadHost;
	return { shell, defaultHost, override };
}

const installed = (shell: PlannedShell) =>
	existsSync(join(shell.directory, MARKER));

function main(mode: string | undefined) {
	const shell = plan();
	if (mode === "--check") {
		if (!installed(shell))
			throw new ShellMissing(missingMessage(provisioningFor(shell)));
		return;
	}
	if (mode !== undefined) throw new Error(`Unknown option: ${mode}`);
	const result = playwright(["install", "--only-shell", "chromium"], "inherit");
	if (result.error)
		throw new Error(
			installFailedMessage(
				provisioningFor(shell),
				`could not start: ${result.error.message}`,
			),
		);
	if (result.status !== 0)
		throw new Error(
			installFailedMessage(
				provisioningFor(shell),
				`exited with ${result.status ?? `signal ${result.signal}`}`,
			),
		);
	if (!installed(shell))
		throw new Error(
			installFailedMessage(
				provisioningFor(shell),
				`exited with 0 but left no ${MARKER} in ${shell.directory}`,
			),
		);
}

// `import.meta.main` needs Node 24.2; engines allows any 26.x.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		main(process.argv[2]);
	} catch (error) {
		console.error(
			`✗ ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = error instanceof ShellMissing ? SHELL_MISSING_EXIT : 1;
	}
}
