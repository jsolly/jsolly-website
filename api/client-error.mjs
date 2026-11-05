import { routes } from "../src/generated/route-manifest.js";
import { createClientErrorHandler } from "../src/lib/client-error-server.mjs";
import {
	createCloudWatchRecorder,
	productionClient,
} from "../src/lib/client-error-sink.mjs";

export default {
	fetch: createClientErrorHandler({
		paths: new Set(routes),
		record: createCloudWatchRecorder({ client: productionClient() }),
	}),
};
