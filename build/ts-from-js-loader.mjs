/**
 * Resolve relative `.js` specifiers to sibling `.ts` files so Edge-safe
 * TypeScript (Node16 `.js` imports) can run while Node strips types.
 */
const JS_EXT_RE = /\.js$/u;

export function resolve(specifier, context, nextResolve) {
	if (
		specifier.startsWith(".") &&
		specifier.endsWith(".js") &&
		context.parentURL
	) {
		const asTs = new URL(specifier, context.parentURL);
		asTs.pathname = asTs.pathname.replace(JS_EXT_RE, ".ts");
		try {
			return nextResolve(asTs.href, context);
		} catch (error) {
			// Real `.js` files (dependencies such as lightningcss import their own
			// `./index.js`) keep resolving as written. ESM reports
			// ERR_MODULE_NOT_FOUND; CommonJS require reports MODULE_NOT_FOUND.
			if (
				error.code !== "ERR_MODULE_NOT_FOUND" &&
				error.code !== "MODULE_NOT_FOUND"
			) {
				throw error;
			}
		}
	}
	return nextResolve(specifier, context);
}
