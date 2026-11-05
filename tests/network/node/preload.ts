import { requireTcpPort } from "../policy.ts";
import {
	LIVE_PRODUCTION_SUITE,
	NODE_ALLOWED_PORTS_ENV,
	NODE_LIVE_SUITE_ERROR,
} from "./constants.ts";
import { installNodeNetworkGuard } from "./guard.ts";

const { TEST_SUITE } = process.env;
if (TEST_SUITE === LIVE_PRODUCTION_SUITE) {
	throw new Error(NODE_LIVE_SUITE_ERROR);
}

const configured = process.env[NODE_ALLOWED_PORTS_ENV];
let allowedPorts: ReadonlySet<number> | undefined;
if (configured !== undefined) {
	const parsed: unknown = JSON.parse(configured);
	if (!Array.isArray(parsed)) {
		throw new Error(`${NODE_ALLOWED_PORTS_ENV} must be a JSON array of ports`);
	}
	allowedPorts = new Set(parsed.map((port: unknown) => requireTcpPort(port)));
}
installNodeNetworkGuard(allowedPorts === undefined ? {} : { allowedPorts });
