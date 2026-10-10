import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { chromium } from "playwright";
import { collectErrors, serveStatic, stubOffOrigin } from "./pages.mjs";

let browser;
let site;
before(async () => {
	browser = await chromium.launch();
	site = await serveStatic("dist");
});
after(async () => {
	await browser?.close();
	await site?.close();
});

it("expanding mobile navigation cannot scroll its clipped links away from a click", async () => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		reducedMotion: "no-preference",
	});
	try {
		await stubOffOrigin(context, site.origin);
		const page = await context.newPage();
		const errors = collectErrors(page);
		await page.goto(site.origin);
		await page.waitForFunction(
			() => !document.querySelector("astro-island[ssr]"),
		);
		// Hold the transition long enough to capture it even on a busy runner.
		await page.locator("#mobile-menu").evaluate((element) => {
			element.style.transitionDuration = "1000000ms";
		});
		await page.getByRole("button", { name: "Toggle mobile menu" }).click();
		const clip = page.locator(".mobile-menu-clip");
		// Browser automation and keyboard focus both scroll links into view.
		// A partially expanded clipping box must never acquire an inner scroll.
		const clipping = await clip.evaluate((element) => {
			const transition = element.parentElement
				.getAnimations()
				.find(
					(animation) => animation.transitionProperty === "grid-template-rows",
				);
			if (!transition) throw new Error("Missing menu expansion transition");
			transition.pause();
			transition.effect.updateTiming({ duration: 1000 });
			transition.currentTime = 20;
			const height = element.clientHeight;
			const contentHeight = element.scrollHeight;
			element.querySelector('a[href="/recipes/"]').scrollIntoView();
			const scrollTop = element.scrollTop;
			for (const animation of element.parentElement.getAnimations())
				animation.finish();
			return { scrollTop, height, contentHeight };
		});
		assert.ok(
			clipping.height > 0 && clipping.height < clipping.contentHeight,
			"menu is partially expanded",
		);
		assert.equal(
			clipping.scrollTop,
			0,
			"the animation clip cannot internally scroll",
		);
		await page
			.getByRole("navigation", { name: "Mobile navigation" })
			.getByRole("link", { name: "My Recipes", exact: true })
			.click();
		await page.waitForURL(`${site.origin}/recipes/`);
		assert.deepEqual(errors, []);
	} finally {
		await context.close();
	}
});
