// Scheduling hints only. Discovery and acceptance stay with Vitest and the ledger.
// Costs are queued-to-module-end milliseconds from hosted run39987864720.
import { relative, sep } from "node:path";
import { BaseSequencer } from "vitest/node";
import costs from "../config/testing/built-file-costs.json" with {
	type: "json",
};

export default class BuiltSequencer extends BaseSequencer {
	cost(file) {
		const path = relative(this.ctx.config.root, file.moduleId)
			.split(sep)
			.join("/");
		// Unknown files participate automatically; this is never a test allowlist.
		return costs[path] ?? 10000;
	}
	sort(files) {
		return [...files].sort(
			(a, b) =>
				this.cost(b) - this.cost(a) ||
				(a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0),
		);
	}

	shard(files) {
		const { index, count } = this.ctx.config.shard;
		const bins = Array.from({ length: count }, () => ({ cost: 0, files: [] }));
		for (const file of this.sort(files)) {
			const target = bins.reduce((best, bin) =>
				bin.cost < best.cost ? bin : best,
			);
			target.files.push(file);
			target.cost += this.cost(file);
		}
		return bins[index - 1].files;
	}
}
