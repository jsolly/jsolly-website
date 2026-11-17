import { checkRateLimit } from "@vercel/firewall";
import { routes } from "../src/generated/route-manifest.js";
import { createClientErrorAdmission } from "../src/lib/client-error-admission.mjs";
import { createClientErrorHandler } from "../src/lib/client-error-server.mjs";
import {
	createCloudWatchRecorder,
	productionClient,
} from "../src/lib/client-error-sink.mjs";

export default {
	fetch: createClientErrorHandler({
		paths: new Set(routes),
		admit: createClientErrorAdmission({
			checkRateLimit,
			bucketSecret: process.env.CLIENT_ERROR_BUCKET_SECRET,
		}),
		record: createCloudWatchRecorder({ client: productionClient() }),
	}),
};
