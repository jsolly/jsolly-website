/** A seed orders stable IDs globally, so filtering retains relative order. */
export function orderRecipeIds(ids: readonly string[], seed: string): string[] {
	const ordered = [...ids].sort();
	let hash = 2166136261;
	for (const character of seed)
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	for (let index = ordered.length - 1; index > 0; index--) {
		hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
		const other = Math.floor((hash / 4294967296) * (index + 1));
		const current = ordered[index];
		const replacement = ordered[other];
		// Both indexes are bounded by the same array length; retain that proof
		// at the assignment boundary under noUncheckedIndexedAccess.
		if (current !== undefined && replacement !== undefined)
			[ordered[index], ordered[other]] = [replacement, current];
	}
	return ordered;
}
