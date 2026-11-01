// Commands and their inherited environments carry an unguessable ownership token.
// This identifies detached children even after a failed owner has exited. ps
// environment bytes stay inside this helper and are never logged or returned.
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const FIELDS = /\s+/u;

function processes(owners) {
	let output;
	try {
		output = execFileSync(
			"ps",
			[
				"eww",
				"-U",
				String(process.getuid()),
				"-o",
				"pid=,ppid=,lstart=,stat=,command=",
			],
			{
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch {
		// execFileSync errors carry raw stdout/stderr. Never forward process environments.
		// biome-ignore lint/style/useErrorCause: Raw subprocess errors contain private process environments.
		throw new Error("Cannot enumerate owned gate processes; ps failed.");
	}
	return output
		.trim()
		.split("\n")
		.map((line) => {
			const [pid, parent, ...fields] = line.trim().split(FIELDS);
			return {
				pid: Number(pid),
				parent: Number(parent),
				birth: fields.slice(0, 5).join(" "),
				state: fields[5],
				marked: fields
					.slice(6)
					.some((field) =>
						[...owners].some(
							(owner) => field === owner || field.startsWith(`${owner},`),
						),
					),
			};
		});
}

function collect(rows, roots, owned) {
	let parents = new Set(roots);
	for (const row of rows) {
		if (owned.get(row.pid)?.birth === row.birth) parents.add(row.pid);
	}
	while (parents.size) {
		const next = new Set();
		for (const row of rows) {
			if (
				(parents.has(row.pid) || parents.has(row.parent)) &&
				!owned.has(row.pid)
			) {
				owned.set(row.pid, row);
				next.add(row.pid);
			}
		}
		parents = next;
	}
}

// Always await this operation before removing private trees. The grace interval
// is only for shutdown; it never changes a validation or browser test deadline.
export async function terminateOwners(tokens) {
	const owners = new Set(tokens.map((token) => `JSOLLY_GATE_OWNER=${token}`));
	const owned = new Map();
	const initial = processes(owners);
	collect(
		initial,
		initial.filter((row) => row.marked).map((row) => row.pid),
		owned,
	);
	if (![...owned.values()].some((row) => !row.state.startsWith("Z"))) return;
	const sent = new Set();
	const start = Date.now();
	for (;;) {
		const rows = processes(owners);
		collect(
			rows,
			rows.filter((row) => row.marked).map((row) => row.pid),
			owned,
		);
		const alive = rows.filter(
			(row) =>
				owned.get(row.pid)?.birth === row.birth && !row.state.startsWith("Z"),
		);
		if (!alive.length) return;
		const hard = Date.now() - start >= 3000;
		for (const row of alive.reverse()) {
			const key = `${row.pid}:${hard}`;
			if (sent.has(key)) continue;
			try {
				process.kill(row.pid, hard ? "SIGKILL" : "SIGTERM");
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
			sent.add(key);
		}
		if (Date.now() - start > 6000)
			throw new Error(
				"Owned gate descendants did not stop; private trees retained.",
			);
		// biome-ignore lint/performance/noAwaitInLoops: Observe actual process exit before cleanup.
		await delay(20);
	}
}
