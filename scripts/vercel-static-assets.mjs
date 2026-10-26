import { parse } from "parse5";

/** Local/CI builds stay portable; Vercel builds must have a usable version pin. */
export function deploymentAssetPin(env) {
	if (env.VERCEL !== "1") return;
	if (env.VERCEL_SKEW_PROTECTION_ENABLED !== "1" || !env.VERCEL_DEPLOYMENT_ID) {
		throw new Error(
			"Vercel asset pinning requires enabled Skew Protection and VERCEL_DEPLOYMENT_ID.",
		);
	}
	return env.VERCEL_DEPLOYMENT_ID;
}

/** Astro pins JS entrypoints/imports but currently omits static CSS links. */
export function pinStylesheets(html, deploymentId) {
	if (!deploymentId) return html;
	const edits = [];
	function visit(node) {
		if (node.tagName === "link") {
			const attributes = Object.fromEntries(
				node.attrs.map(({ name, value }) => [name, value]),
			);
			if (
				attributes.rel?.toLowerCase() === "stylesheet" &&
				attributes.href?.startsWith("/_astro/")
			) {
				const url = new URL(attributes.href, "https://build.invalid");
				if (url.pathname.endsWith(".css")) {
					url.searchParams.set("dpl", deploymentId);
					const location = node.sourceCodeLocation.attrs.href;
					edits.push({
						start: location.startOffset,
						end: location.endOffset,
						value: `href="${url.pathname}${url.search.replaceAll("&", "&amp;")}"`,
					});
				}
			}
		}
		for (const child of node.childNodes ?? []) visit(child);
	}
	visit(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }));
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
	}
	return html;
}
