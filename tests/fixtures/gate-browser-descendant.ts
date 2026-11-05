import { writeFileSync } from "node:fs";
import { launchTestBrowserServer } from "../network/browser.ts";

// The gate must reap Playwright's real detached browser when it cancels this child.
const server = await launchTestBrowserServer({ headless: true });
writeFileSync("descendant", String(server.process().pid));
setInterval(() => undefined, 1000);
