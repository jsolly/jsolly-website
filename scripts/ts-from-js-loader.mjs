/**
 * Node test loader: resolve relative `.js` specifiers to sibling `.ts` files
 * so Edge-safe TypeScript (Node16 `.js` imports) can run under
 * `node --experimental-strip-types`.
 */
const JS_EXT_RE = /\.js$/u;

export async function resolve(specifier, context, nextResolve) {
	if (
		specifier.startsWith(".") &&
		specifier.endsWith(".js") &&
		context.parentURL
	) {
		const asTs = new URL(specifier, context.parentURL);
		asTs.pathname = asTs.pathname.replace(JS_EXT_RE, ".ts");
		const result = await nextResolve(asTs.href, context);
		return result;
	}
	return nextResolve(specifier, context);
}
