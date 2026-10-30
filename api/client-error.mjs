import { routes } from "../src/generated/route-manifest.js";
import { createClientErrorHandler } from "../src/lib/client-error-server.mjs";

export default {
	fetch: createClientErrorHandler({ paths: new Set(routes) }),
};
