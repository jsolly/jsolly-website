let reporter;

/** Load the transport only when an error occurs; healthy visits send nothing. */
export async function reportError(category) {
	try {
		reporter ??= import("./report-error-client.mjs");
		return (await reporter).reportError(category);
	} catch {
		/* Reporting must not disrupt the UI. */
	}
}

export function installErrorReporting(target = window, report = reportError) {
	const runtime = () => void report("client-runtime");
	const asynchronous = () => void report("client-async");
	target.addEventListener("error", runtime);
	target.addEventListener("unhandledrejection", asynchronous);
	return () => {
		target.removeEventListener("error", runtime);
		target.removeEventListener("unhandledrejection", asynchronous);
	};
}
