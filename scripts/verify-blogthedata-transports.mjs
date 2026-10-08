// The request transports of scripts/verify-blogthedata-cutover.mjs (see its
// header). A transport is `async (url, { body }) => answer`, where answer is
// { status, location, contentType, cacheControl } plus `body` (a Buffer) when
// asked; a failed request throws, with `transient: true` only for an error a
// retry may cure.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const VERCEL_SCOPE = "jsollys-projects";
const BYPASS_ENV = "VERCEL_AUTOMATION_BYPASS_SECRET";
// curl -v prints each request header the CLI added as `> name: value`.
const BYPASS_HEADER = /^> x-vercel-protection-bypass: (?<token>\S+)\r?$/imu;
const BYPASS_HEADERS = /^> x-vercel-protection-bypass: \S+/gimu;
// curl exits 6 (host not resolved), 7 (no connection) and 28 (timeout).
const TRANSIENT_CURL_EXITS = new Set([6, 7, 28]);
const TIMEOUT_SECONDS = 30;
// curl's write-out, after a marker so CLI chatter on stdout cannot be misread.
const CURL_MARKER = "verify-blogthedata-cutover";
const CURL_WRITE_OUT = `\n${CURL_MARKER}\n%{http_code}\n%header{location}\n%header{content-type}\n%header{cache-control}`;
const NO_BYPASS_SECRET =
	"vercel curl warm-up attached no bypass secret; check vercel login/--scope, or use the fetch transport for an unprotected deployment";

// Node fetch with redirects off; `headers` go on every request. A network
// error or timeout is transient.
export function fetchTransport(headers = {}) {
	return async (url, { body }) => {
		try {
			const response = await fetch(url, {
				redirect: "manual",
				headers,
				signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
			});
			const answer = {
				status: response.status,
				location: response.headers.get("location"),
				contentType: response.headers.get("content-type"),
				cacheControl: response.headers.get("cache-control"),
			};
			if (body) {
				answer.body = Buffer.from(await response.arrayBuffer());
			} else {
				await response.body?.cancel();
			}
			return answer;
		} catch (error) {
			const cause = error.cause?.code ?? error.cause?.message;
			throw Object.assign(
				new Error(cause ? `${error.message} (${cause})` : error.message),
				{
					transient:
						error instanceof TypeError || error.name === "TimeoutError",
				},
			);
		}
	};
}

// The `vercel` arguments for one request of `url`, its body written to
// `output` (a file, or /dev/null).
export function curlArgs(url, output) {
	return [
		"curl",
		url,
		"--scope",
		VERCEL_SCOPE,
		"--",
		"-sS",
		"-o",
		output,
		"--max-redirs",
		"0",
		"--max-time",
		String(TIMEOUT_SECONDS),
		"-w",
		CURL_WRITE_OUT,
	];
}

// Runs `bin args` and resolves its stdout and stderr; a non-zero exit
// rejects, transient for curl's DNS, connect and timeout exits. The bypass
// secret is redacted from any error.
function vercelCurl(bin, args, env, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			env,
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			const shown = stderr
				.replaceAll(BYPASS_HEADERS, "> x-vercel-protection-bypass: [redacted]")
				.trim();
			reject(
				Object.assign(new Error(`vercel curl exited ${code}: ${shown}`), {
					transient: TRANSIENT_CURL_EXITS.has(code),
				}),
			);
		});
	});
}

// The answer in the write-out after the last marker; anything else throws.
function parseWriteOut(stdout) {
	const lines = stdout.slice(stdout.lastIndexOf(CURL_MARKER)).split("\n");
	if (lines[0] !== CURL_MARKER || lines.length !== 5) {
		throw new Error(`unreadable curl write-out: ${JSON.stringify(stdout)}`);
	}
	const [, status, location, contentType, cacheControl] = lines;
	return {
		status: Number(status),
		location: location || null,
		contentType: contentType || null,
		cacheControl: cacheControl || null,
	};
}

// A warm-up answer the deployment would give a let-in request: 2xx, 3xx or
// 404, never 401 or 403.
const warmedUp = ({ status }) =>
	(status >= 200 && status < 400) || status === 404;

// `vercel curl` through `bin` in an empty working directory under `scratch`.
// The serial warm-up on `origin` must answer as a let-in request and must
// show the bypass secret the CLI attached (curl -v); every later call passes
// that secret as VERCEL_AUTOMATION_BYPASS_SECRET, which the CLI uses as it is.
export async function vercelCurlTransport(bin, origin, scratch) {
	const cwd = mkdtempSync(join(scratch, "cwd-"));
	const warmUp = await vercelCurl(
		bin,
		[...curlArgs(`${origin}/`, "/dev/null"), "-v"],
		process.env,
		cwd,
	);
	const warmAnswer = parseWriteOut(warmUp.stdout);
	if (!warmedUp(warmAnswer)) {
		throw new Error(
			`vercel curl warm-up on ${origin}/ answered ${warmAnswer.status}`,
		);
	}
	if (!BYPASS_HEADER.test(warmUp.stderr)) {
		throw new Error(NO_BYPASS_SECRET);
	}
	const env = {
		...process.env,
		[BYPASS_ENV]: BYPASS_HEADER.exec(warmUp.stderr).groups.token,
	};
	let files = 0;
	return async (url, { body }) => {
		files += 1;
		const output = body ? join(scratch, `body-${files}`) : "/dev/null";
		const { stdout } = await vercelCurl(bin, curlArgs(url, output), env, cwd);
		const answer = parseWriteOut(stdout);
		if (body) {
			answer.body = readFileSync(output);
			rmSync(output, { force: true });
		}
		return answer;
	};
}
