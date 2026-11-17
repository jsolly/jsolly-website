import assert from "node:assert/strict";
import { afterAll, beforeAll, it } from "vitest";
import { launchTestBrowser } from "../network/browser.js";
import { DIST, serveStatic } from "./pages.mjs";

const ORIGIN = "https://www.jsolly.com";
const PRIVATE_DETAIL = "private diagnostic exception text";
type FailurePhase =
	| "registration"
	| "download"
	| "version"
	| "check"
	| "activation"
	| "library";
declare global {
	interface Window {
		recipeReportingFault: () => void;
	}
}
let site: Awaited<ReturnType<typeof serveStatic>>;
let browser: Awaited<ReturnType<typeof launchTestBrowser>>;

beforeAll(async () => {
	site = await serveStatic(DIST);
	browser = await launchTestBrowser({ headless: true });
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

// Faults live at the browser's service-worker boundary. The built application,
// its polling, click handlers and reporting transport all remain unchanged.
async function failingPage(phase: FailurePhase) {
	const context = await browser.newContext({ serviceWorkers: "block" });
	const reports: unknown[] = [];
	await context.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin !== ORIGIN) return route.abort();
		if (url.pathname === "/api/client-error/") {
			reports.push(request.postDataJSON());
			return route.fulfill({ status: 204 });
		}
		const response = await fetch(site.origin + url.pathname + url.search);
		let body = Buffer.from(await response.arrayBuffer());
		if (
			phase === "library" &&
			url.pathname.startsWith("/recipes/data/summaries/")
		) {
			const library: unknown = JSON.parse(body.toString());
			if (library === null || typeof library !== "object")
				throw new Error("Expected summary library object");
			body = Buffer.from(
				JSON.stringify({ ...library, release: "f".repeat(40) }),
			);
		}
		return route.fulfill({
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body,
		});
	});
	await context.addInitScript(
		({ phase: faultPhase, detail, origin }) => {
			if (location.origin !== origin) return;
			const worker = (state: ServiceWorkerState, waiting = false) =>
				Object.assign(new EventTarget(), {
					state,
					scriptURL: new URL("/recipes/service-worker.js", location.origin)
						.href,
					postMessage(message: { type: string }, ports: MessagePort[]) {
						if (message.type === "ACTIVATE_RECIPE_UPDATE")
							throw new Error(detail);
						if (message.type !== "RECIPE_VERSION") return;
						const notice = document.querySelector("#site-update-notice");
						if (!(notice instanceof HTMLElement))
							throw new Error("Missing release notice");
						// biome-ignore lint/complexity/useLiteralKeys: strict index-signature access.
						const loaded = notice.dataset["release"];
						if (!loaded) throw new Error("Missing document release");
						const port = ports[0];
						if (!port) throw new Error("Missing version reply port");
						const release =
							faultPhase === "version"
								? "invalid"
								: waiting
									? (loaded === "a".repeat(40) ? "b" : "a").repeat(40)
									: loaded;
						queueMicrotask(() => port.postMessage({ release }));
					},
				});
			const active = worker("activated");
			const installer = faultPhase === "download" ? worker("installing") : null;
			const registration = Object.assign(new EventTarget(), {
				scope: new URL("/recipes/", location.origin).href,
				active: installer ? null : active,
				installing: installer,
				waiting: faultPhase === "activation" ? worker("installed", true) : null,
				update() {
					return faultPhase === "check"
						? Promise.reject(new Error(detail))
						: Promise.resolve();
				},
			});
			const container = Object.assign(new EventTarget(), {
				controller: installer ? null : active,
				register() {
					return faultPhase === "registration"
						? Promise.reject(new Error(detail))
						: Promise.resolve(registration);
				},
				getRegistration() {
					return faultPhase === "library"
						? Promise.reject(new Error(detail))
						: Promise.resolve(registration);
				},
			});
			Object.defineProperty(navigator, "serviceWorker", {
				value: container,
				configurable: true,
			});
			window.recipeReportingFault = () => {
				if (!installer) throw new Error("Missing download fixture");
				installer.state = "redundant";
				installer.dispatchEvent(new Event("statechange"));
			};
		},
		{ phase, detail: PRIVATE_DETAIL, origin: ORIGIN },
	);
	const page = await context.newPage();
	return { context, page, reports };
}

const phases: FailurePhase[] = [
	"registration",
	"download",
	"version",
	"check",
	"activation",
	"library",
];
for (const phase of phases) {
	it(`Recipe ${phase} failure sends its fixed phase without exception details`, async () => {
		const { context, page, reports } = await failingPage(phase);
		try {
			if (phase === "check") await page.clock.install();
			const category = `recipe-update-${phase}`;
			const sent = page.waitForResponse(
				(response) =>
					response.url() === `${ORIGIN}/api/client-error/` &&
					response.request().postDataJSON()?.category === category,
			);
			await page.goto(`${ORIGIN}/recipes/?diagnostic=private#private`);
			await page.waitForFunction(
				() => !document.querySelector("astro-island[ssr]"),
			);
			if (phase === "download")
				await page.evaluate(() => window.recipeReportingFault());
			if (phase === "check") {
				// Run the startup check, then the real one-minute foreground throttle.
				await page.clock.runFor(1);
				await page.evaluate(() => window.dispatchEvent(new Event("online")));
				await page.clock.runFor(60_001);
			}
			if (phase === "activation")
				await page.locator("#recipe-update-button").click();
			if (phase === "library")
				await page
					.getByRole("button", { name: "Check for update", exact: true })
					.click();
			await sent;
			assert.deepEqual(
				reports.filter(
					(report) =>
						report !== null &&
						typeof report === "object" &&
						"category" in report &&
						typeof report.category === "string" &&
						report.category.startsWith("recipe-update"),
				),
				[{ category, page: "/recipes/" }],
			);
			assert.ok(!JSON.stringify(reports).includes(PRIVATE_DETAIL));
		} finally {
			await context.close();
		}
	});
}
