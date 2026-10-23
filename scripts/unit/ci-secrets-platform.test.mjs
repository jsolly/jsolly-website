import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

const scan = new URL("../ci-secrets-scan.sh", import.meta.url);
async function optionalText(file) {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		return null;
	}
}
async function observeScan(system, arch) {
	const root = await mkdtemp(join(tmpdir(), "ci-scan-platform-"));
	try {
		const bin = join(root, "bin");
		await mkdir(bin);
		const written = await Promise.allSettled(
			Object.entries({
				uname:
					'if [[ "$1" == -s ]]; then echo "$SCAN_SYSTEM"; else echo "$SCAN_ARCH"; fi',
				mktemp: 'mkdir "$SCAN_TEMP"; echo "$SCAN_TEMP"',
				curl: 'printf "%s\\n" "$@" > "$CAPTURE_URL"',
				// Checksum failure must stop the real scanner before tar/install/git.
				shasum:
					'printf "%s\\n" "$@" > "$CAPTURE_ARGS"; cat > "$CAPTURE_SHA"; exit 87',
				tar: 'echo "Extraction must not run" >&2; exit 99',
			}).map(([name, body]) =>
				writeFile(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, {
					mode: 0o755,
				}),
			),
		);
		const failure = written.find((entry) => entry.status === "rejected");
		if (failure) throw failure.reason;
		const result = spawnSync("bash", [scan.pathname], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				SCAN_SYSTEM: system,
				SCAN_ARCH: arch,
				SCAN_TEMP: join(root, "scan"),
				CAPTURE_URL: join(root, "url"),
				CAPTURE_SHA: join(root, "sha"),
				CAPTURE_ARGS: join(root, "args"),
			},
		});
		if (result.error) throw result.error;
		return {
			status: result.status,
			unsupported: result.stderr.includes("Unsupported CI secrets-scan host"),
			url:
				(await optionalText(join(root, "url")))
					?.split("\n")
					.find((value) => value.startsWith("https://")) ?? null,
			checksum:
				(await optionalText(join(root, "sha")))?.replaceAll(`${root}/`, "") ??
				null,
			checksumArgs: await optionalText(join(root, "args")),
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
for (const [system, arch, archive, digest] of [
	[
		"Linux",
		"aarch64",
		"linux_arm64",
		// biome-ignore lint/security/noSecrets: official public Gitleaks archive SHA-256.
		"574a6d52573c61173add7ddb5e3cc68c0e82cb0735818a1eeb9a0a2de1643fbc",
	],
	[
		"Darwin",
		"arm64",
		"darwin_arm64",
		// biome-ignore lint/security/noSecrets: official public Gitleaks archive SHA-256.
		"90d13686937ac7429b97a3acbf1e1d0ce90d92ae2d0cf46a690bd8ae5230bea0",
	],
]) {
	it(`CI secrets scan rejects a corrupt pinned ${system}/${arch} archive before extraction`, async () => {
		assert.deepEqual(await observeScan(system, arch), {
			status: 87,
			unsupported: false,
			url: `https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_${archive}.tar.gz`,
			checksum: `${digest}  scan/gitleaks.tar.gz\n`,
			checksumArgs: "-a\n256\n--check\n",
		});
	});
}
it("CI secrets scan rejects unsupported hosts before downloading", async () => {
	assert.deepEqual(await observeScan("Linux", "unknown"), {
		status: 1,
		unsupported: true,
		url: null,
		checksum: null,
		checksumArgs: null,
	});
});
