// A fixed vocabulary shared by the browser and receiver. Never pass an Error,
// its message, a query string, or user-entered text to this reporting boundary.
export const ERROR_CATEGORIES = Object.freeze({
	"client-runtime": "A client script failed.",
	"client-async": "A client operation failed asynchronously.",
	"recipe-storage-read": "Recipe browser storage could not be read.",
	"recipe-storage-write": "Recipe browser storage could not be written.",
	"recipe-offline": "Recipe offline storage failed.",
	"recipe-print": "Recipe printing failed.",
	"recipe-share": "Recipe sharing failed.",
	"recipe-copy": "Copying a recipe link failed.",
	"recipe-update": "A recipe app update failed.",
	"recipe-browse": "Recipe browsing failed.",
	"blog-copy": "Copying a blog heading link failed.",
	"blog-search": "Blog search failed.",
});

export const ERROR_REPORT_ORIGIN = "https://www.jsolly.com";

// Sent only by the production smoke to prove reports still reach CloudWatch.
// The receiver records it at info level, so the error metric filter and alarm
// never count it, and the browser reporter cannot send it.
export const FORWARDING_PROBE = Object.freeze({
	category: "forwarding-probe",
	message: "Production smoke verified client-error forwarding.",
});
