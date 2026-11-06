import { renameSync, writeFileSync } from "node:fs";
import { launchTestBrowserServer } from "../network/browser.ts";

// The gate must reap Playwright's real detached browser when it cancels this child.
// Rename publishes the pid in one step so a reader never observes an empty file.
const server = await launchTestBrowserServer({ headless: true });
writeFileSync("descendant.tmp", String(server.process().pid));
renameSync("descendant.tmp", "descendant");
setInterval(() => undefined, 1000);
