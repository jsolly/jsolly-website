import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	downloadOverride,
	installFailedMessage,
	missingMessage,
	plannedHeadlessShell,
	withoutDownloadOverrides,
} from "../../gate/provision-chromium.js";

const plan = (
	url: string,
) => `Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243)
  Install location:    /opt/pw-browsers/chromium_headless_shell-1243
  Download url:        ${url}

FFmpeg (playwright ffmpeg v1011)
  Install location:    /opt/pw-browsers/ffmpeg-1011
`;
const ARCHIVE =
	"builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip";
const DEFAULT_PLAN = plan(`https://cdn.playwright.dev/${ARCHIVE}`);
// The shell block verbatim from a cloud session whose container sets
// PLAYWRIGHT_DOWNLOAD_HOST=http://127.0.0.1:1 (the FFmpeg block is abbreviated).
const OVERRIDE_PLAN = plan(`http://127.0.0.1:1/${ARCHIVE}`);
const DIRECTORY = "/opt/pw-browsers/chromium_headless_shell-1243";

describe("Chromium provisioning", () => {
	it("reads the pinned shell, its install location and download host from Playwright's plan", () => {
		expect(plannedHeadlessShell(DEFAULT_PLAN)).toEqual({
			version: "153.0.8010.12",
			revision: "1243",
			directory: DIRECTORY,
			downloadHost: "cdn.playwright.dev",
		});
		expect(() =>
			plannedHeadlessShell("FFmpeg (playwright ffmpeg v1011)\n"),
		).toThrow(/names no Chrome Headless Shell/u);
	});

	it("names a download-host override, its origin and the default host it replaces", () => {
		const env = {
			PLAYWRIGHT_DOWNLOAD_HOST: "http://127.0.0.1:1",
			PATH: "/bin",
		};
		const override = downloadOverride(env);
		expect(override).toEqual({
			name: "PLAYWRIGHT_DOWNLOAD_HOST",
			origin: "http://127.0.0.1:1",
		});
		expect(
			downloadOverride({
				...env,
				PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: "http://a",
			}),
		).toEqual({
			name: "PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST",
			origin: "http://a",
		});
		expect(downloadOverride({ PATH: "/bin" })).toBeUndefined();
		const shell = plannedHeadlessShell(OVERRIDE_PLAN);
		expect(shell.downloadHost).toBe("127.0.0.1:1");
		const owner =
			/the environment owner has to provision Chrome Headless Shell 153\.0\.8010\.12 at \/opt\/pw-browsers\/chromium_headless_shell-1243, or remove the PLAYWRIGHT_DOWNLOAD_HOST override \(http:\/\/127\.0\.0\.1:1\), which replaces Playwright's CDN, and allow cdn\.playwright\.dev\./u;
		const provisioning = {
			shell,
			defaultHost: "cdn.playwright.dev",
			...(override ? { override } : {}),
		};
		expect(missingMessage(provisioning)).toMatch(owner);
		expect(installFailedMessage(provisioning, "exited with 1")).toMatch(owner);
		expect(missingMessage(provisioning)).not.toMatch(/allow 127\.0\.0\.1/u);
	});

	it("follows Playwright's npm_config_ and npm_package_config_ forms and strips all six", () => {
		expect(
			downloadOverride({
				npm_config_playwright_download_host: "http://127.0.0.1:1",
			}),
		).toEqual({
			name: "npm_config_playwright_download_host",
			origin: "http://127.0.0.1:1",
		});
		expect(
			downloadOverride({
				npm_package_config_playwright_chromium_download_host: "http://b",
				npm_config_playwright_download_host: "http://c",
			}),
		).toEqual({
			name: "npm_package_config_playwright_chromium_download_host",
			origin: "http://b",
		});
		// Playwright stops at the first set form of a name, so an empty variable hides npm's.
		expect(
			downloadOverride({
				PLAYWRIGHT_DOWNLOAD_HOST: "",
				npm_config_playwright_download_host: "http://c",
			}),
		).toBeUndefined();
		const all = {
			PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: "1",
			npm_config_playwright_chromium_download_host: "2",
			npm_package_config_playwright_chromium_download_host: "3",
			PLAYWRIGHT_DOWNLOAD_HOST: "4",
			npm_config_playwright_download_host: "5",
			npm_package_config_playwright_download_host: "6",
			PATH: "/bin",
		};
		expect(withoutDownloadOverrides(all)).toEqual({ PATH: "/bin" });
	});

	it("never prints override credentials, path or query", () => {
		const secret = "s3cr3t-token";
		const shell = plannedHeadlessShell(
			plan(`https://mirror.example.invalid/${ARCHIVE}`),
		);
		for (const [value, expected] of [
			[
				`https://agent:${secret}@mirror.example.invalid/pw?token=${secret}`,
				{
					name: "PLAYWRIGHT_DOWNLOAD_HOST",
					origin: "https://mirror.example.invalid",
				},
			],
			[`not a url ${secret}`, { name: "PLAYWRIGHT_DOWNLOAD_HOST" }],
		] as const) {
			const override = downloadOverride({ PLAYWRIGHT_DOWNLOAD_HOST: value });
			expect(override).toEqual(expected);
			const provisioning = {
				shell,
				defaultHost: "cdn.playwright.dev",
				...(override ? { override } : {}),
			};
			for (const message of [
				missingMessage(provisioning),
				installFailedMessage(provisioning, "exited with 1"),
			]) {
				expect(message).not.toContain(secret);
				expect(message).not.toContain("agent");
				expect(message).not.toContain("token=");
				expect(message).not.toContain("invalid/pw");
				expect(message).toContain(
					"remove the PLAYWRIGHT_DOWNLOAD_HOST override",
				);
			}
		}
	});

	it("words an install failure conditionally and reports how the install ended", () => {
		const shell = plannedHeadlessShell(DEFAULT_PLAN);
		const provisioning = { shell, defaultHost: shell.downloadHost };
		expect(missingMessage(provisioning)).toMatch(
			new RegExp(
				`not installed at ${DIRECTORY}\\. Run \`npm run browser:install\``,
				"u",
			),
		);
		const failed = installFailedMessage(provisioning, "exited with 1");
		expect(failed).toMatch(
			/^Playwright did not install Chrome Headless Shell 153\.0\.8010\.12 \(`playwright install --only-shell chromium` exited with 1\)\. If the error above is a download failure, the browser download host cdn\.playwright\.dev is not reachable from this environment, so the environment owner has to provision Chrome Headless Shell 153\.0\.8010\.12 at \/opt\/pw-browsers\/chromium_headless_shell-1243 or allow the browser download host cdn\.playwright\.dev\./u,
		);
		expect(
			installFailedMessage(provisioning, "could not start: spawn node ENOENT"),
		).toMatch(
			/`playwright install --only-shell chromium` could not start: spawn node ENOENT/u,
		);
	});

	it("--check exits 0 only when the pinned shell's install marker exists", {
		timeout: 60_000,
	}, () => {
		const browsers = mkdtempSync(join(tmpdir(), "provision-chromium-"));
		try {
			const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers };
			const dryRun = spawnSync(
				"npx",
				[
					"--no-install",
					"playwright",
					"install",
					"--dry-run",
					"chromium-headless-shell",
				],
				{ env, encoding: "utf8" },
			);
			expect(dryRun.status).toBe(0);
			const { directory } = plannedHeadlessShell(dryRun.stdout);
			expect(directory.startsWith(browsers)).toBe(true);
			const check = () =>
				spawnSync(process.execPath, ["gate/provision-chromium.ts", "--check"], {
					env,
					encoding: "utf8",
				});
			const missing = check();
			expect(missing.status).toBe(1);
			expect(missing.stderr).toContain(`is not installed at ${directory}`);
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "INSTALLATION_COMPLETE"), "");
			const present = check();
			expect(present.stderr).toBe("");
			expect(present.status).toBe(0);
		} finally {
			rmSync(browsers, { recursive: true, force: true });
		}
	});
});
