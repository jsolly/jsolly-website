import { reportError } from "../../lib/report-error.mjs";
import { PRINT_FAILED } from "./constants.mjs";

// Preserve the document's prior print mode, including browser-menu printing.
// mode() names the print mode; prepared and restored are optional callbacks.
export function createRecipePrintSession(mode, prepared, restored) {
	let previous = null;
	let owns = false;
	function prepare() {
		if (!owns) {
			previous = document.documentElement.getAttribute("data-recipe-print");
			owns = true;
		}
		document.documentElement.setAttribute("data-recipe-print", mode());
		prepared?.();
	}
	function restore() {
		if (owns) {
			if (previous === null)
				document.documentElement.removeAttribute("data-recipe-print");
			else document.documentElement.setAttribute("data-recipe-print", previous);
		}
		owns = false;
		restored?.();
	}
	function listen() {
		window.addEventListener("beforeprint", prepare);
		window.addEventListener("afterprint", restore);
		return () => {
			window.removeEventListener("beforeprint", prepare);
			window.removeEventListener("afterprint", restore);
			restore();
		};
	}
	// A Print button: prepares the page, waits for `settle` (an island's
	// tick(), so the print copy renders) and opens the browser's print dialog.
	// Resolves to the status message to show: "" once printing opened, or
	// PRINT_FAILED once the page is restored when the browser cannot print.
	async function print(settle = () => Promise.resolve()) {
		try {
			prepare();
			await settle();
			window.print();
			return "";
		} catch (error) {
			void reportError("recipe-print");
			console.error("Recipe printing failed:", error);
			restore();
			return PRINT_FAILED;
		}
	}
	return { prepare, restore, listen, print };
}
