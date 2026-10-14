import { recipeHref } from "./recipe-url.mjs";

const IOS = /iPhone|iPad|iPod/u;

// iPadOS can identify as a Mac; standalone alone also matches Mac Dock apps,
// where printing works. Restrict the handoff to installed iOS/iPadOS apps.
export function needsSafariPrint(navigator, standalone) {
	const ios =
		IOS.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	return ios && (navigator.standalone === true || standalone);
}

export function safariPrintLinks(recipe, settings, origin) {
	const url = new URL(recipeHref(recipe, settings), origin);
	return {
		url: url.href,
		// Safari's application scheme escapes the Home Screen window. It is
		// not a guaranteed web standard; keep an ordinary copyable URL too.
		safari: url.protocol === "https:" ? `x-safari-${url.href}` : "",
	};
}
