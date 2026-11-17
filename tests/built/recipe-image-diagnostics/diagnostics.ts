import { Buffer } from "node:buffer";
import type {
	Browser,
	BrowserContext,
	ConsoleMessage,
	Frame,
	Page,
	Request,
	Response,
} from "playwright";
import {
	EVENT_LIMIT,
	OUTPUT_BYTES,
	PENDING_LIMIT,
	PREFIX,
	TEXT_LIMIT,
} from "./constants.ts";
import type {
	CurrentPhase,
	Fields,
	Observation,
	PendingRequest,
	Phase,
	Truncation,
} from "./types.ts";

/** Passive synchronous observations. This module makes no browser calls, waits, routes, or cleanup actions. */
export function recipeImageDiagnostics(browser: Browser) {
	const started = performance.now();
	const observations: Observation[] = [];
	const pending = new Map<Request, PendingRequest>();
	const disposeListeners: Array<() => void> = [];
	const truncation: Truncation = {
		eventsDropped: 0,
		pendingDropped: 0,
		stringsClipped: 0,
		textUnitsOmitted: 0,
		outputPacketsClipped: 0,
		outputBytesOmitted: 0,
	};
	let phase: CurrentPhase | null = null;
	let diagnosticErrors = 0;
	let lastDiagnosticError: string | null = null;
	let disposed = false;
	const counts = { requests: 0, responses: 0, finished: 0, failed: 0 };
	function text(value: string) {
		if (value.length <= TEXT_LIMIT) return value;
		truncation.stringsClipped++;
		truncation.textUnitsOmitted += value.length - TEXT_LIMIT;
		return value.slice(0, TEXT_LIMIT);
	}
	function errorText(error: unknown) {
		try {
			return text(
				error instanceof Error && typeof error.message === "string"
					? error.message
					: typeof error === "string"
						? error
						: "Unknown diagnostic error",
			);
		} catch {
			return "Diagnostic error could not be formatted";
		}
	}
	function safely(operation: () => void) {
		try {
			operation();
		} catch (error) {
			diagnosticErrors++;
			lastDiagnosticError = errorText(error);
		}
	}
	function listener<Args extends unknown[]>(
		operation: (...args: Args) => void,
	) {
		return (...args: Args) => safely(() => operation(...args));
	}
	function emit(label: string, value: unknown) {
		safely(() => {
			// biome-ignore lint/suspicious/noUnnecessaryConditions: JSON.stringify returns undefined for runtime values such as undefined, functions and symbols.
			let serialized = JSON.stringify(value) ?? "null";
			const budget = OUTPUT_BYTES - Buffer.byteLength(`${PREFIX} ${label} \n`);
			const originalBytes = Buffer.byteLength(serialized);
			if (originalBytes > budget) {
				truncation.outputPacketsClipped++;
				let preview = serialized.slice(0, Math.floor(budget / 8));
				function clipped() {
					return JSON.stringify({
						truncated: true,
						originalBytes,
						preview,
						phase,
						truncation,
					});
				}
				serialized = clipped();
				while (Buffer.byteLength(serialized) > budget && preview.length) {
					preview = preview.slice(0, Math.floor(preview.length / 2));
					serialized = clipped();
				}
				truncation.outputBytesOmitted +=
					originalBytes - Buffer.byteLength(preview);
				serialized = clipped();
			}
			process.stderr.write(`${PREFIX} ${label} ${serialized}\n`);
		});
	}
	function record(
		kind: string,
		javaScriptEnabled: boolean | null,
		fields: Fields,
	) {
		const clipped: Fields = {};
		for (const [key, value] of Object.entries(fields))
			clipped[key] = typeof value === "string" ? text(value) : value;
		if (observations.length === EVENT_LIMIT) {
			observations.shift();
			truncation.eventsDropped++;
		}
		observations.push({
			atMs: performance.now() - started,
			javaScriptEnabled,
			kind,
			fields: clipped,
		});
	}
	function mark(javaScriptEnabled: boolean, stage: Phase) {
		safely(() => {
			phase = { javaScriptEnabled, stage };
			record("phase", javaScriptEnabled, { stage });
			emit("phase", { atMs: performance.now() - started, phase });
		});
	}
	const disconnected = listener(() => record("browser-disconnected", null, {}));
	safely(() => {
		browser.on("disconnected", disconnected);
		disposeListeners.push(() => {
			browser.off("disconnected", disconnected);
		});
	});
	function observeContext(context: BrowserContext, javaScriptEnabled: boolean) {
		if (disposed) return;
		safely(() => {
			const close = listener(() =>
				record("context-close", javaScriptEnabled, {}),
			);
			context.on("close", close);
			disposeListeners.push(() => {
				context.off("close", close);
			});
		});
	}
	function observePage(observed: Page, javaScriptEnabled: boolean) {
		if (disposed) return;
		safely(() => {
			const request = listener((item: Request) => {
				counts.requests++;
				const info = {
					javaScriptEnabled,
					url: text(item.url()),
					method: text(item.method()),
					resourceType: text(item.resourceType()),
				};
				if (pending.size === PENDING_LIMIT) {
					const oldest = pending.keys().next().value;
					if (oldest !== undefined) pending.delete(oldest);
					truncation.pendingDropped++;
				}
				pending.set(item, info);
				record("request", javaScriptEnabled, info);
			});
			const response = listener((item: Response) => {
				counts.responses++;
				record("response", javaScriptEnabled, {
					url: item.url(),
					status: item.status(),
					statusText: item.statusText(),
					fromServiceWorker: item.fromServiceWorker(),
					resourceType: item.request().resourceType(),
				});
			});
			const requestFinished = listener((item: Request) => {
				counts.finished++;
				pending.delete(item);
				record("request-finished", javaScriptEnabled, {
					url: item.url(),
					responseEnd: item.timing().responseEnd,
				});
			});
			const failed = listener((item: Request) => {
				counts.failed++;
				pending.delete(item);
				record("request-failed", javaScriptEnabled, {
					url: item.url(),
					error: item.failure()?.errorText ?? null,
				});
			});
			const pageError = listener((error: Error) =>
				record("page-error", javaScriptEnabled, { message: error.message }),
			);
			const consoleMessage = listener((message: ConsoleMessage) => {
				if (message.type() === "error" || message.type() === "warning")
					record("page-console", javaScriptEnabled, {
						level: message.type(),
						message: message.text(),
					});
			});
			const navigated = listener((frame: Frame) =>
				record("frame-navigated", javaScriptEnabled, {
					url: frame.url(),
					mainFrame: frame === observed.mainFrame(),
				}),
			);
			const close = listener(() => record("page-close", javaScriptEnabled, {}));
			const crash = listener(() => record("page-crash", javaScriptEnabled, {}));
			const loaded = listener(() =>
				record("page-load", javaScriptEnabled, { url: observed.url() }),
			);
			const domReady = listener(() =>
				record("page-domcontentloaded", javaScriptEnabled, {
					url: observed.url(),
				}),
			);
			observed.on("request", request);
			observed.on("response", response);
			observed.on("pageerror", pageError);
			observed.on("console", consoleMessage);
			observed.on("framenavigated", navigated);
			observed.on("requestfinished", requestFinished);
			observed.on("requestfailed", failed);
			observed.on("close", close);
			observed.on("crash", crash);
			observed.on("load", loaded);
			observed.on("domcontentloaded", domReady);
			disposeListeners.push(() => {
				observed.off("request", request);
				observed.off("response", response);
				observed.off("pageerror", pageError);
				observed.off("console", consoleMessage);
				observed.off("framenavigated", navigated);
				observed.off("requestfinished", requestFinished);
				observed.off("requestfailed", failed);
				observed.off("close", close);
				observed.off("crash", crash);
				observed.off("load", loaded);
				observed.off("domcontentloaded", domReady);
			});
		});
	}
	function dispose() {
		disposed = true;
		for (const disposeListener of disposeListeners) safely(disposeListener);
		disposeListeners.length = 0;
	}
	function finish(failed: boolean) {
		try {
			if (failed)
				safely(() =>
					emit("failure", {
						phase,
						counts,
						truncation,
						diagnosticErrors,
						lastDiagnosticError,
						browserConnected: browser.isConnected(),
						pending: [...pending.values()],
						observations,
					}),
				);
		} finally {
			dispose();
		}
	}
	return { mark, observeContext, observePage, finish };
}
