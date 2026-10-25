// Maintenance-only USDA lookups. Credentials stay in memory; builds never import this file.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { loadSharedConfigFiles, loadSsoSessionData } from "@smithy/core/config";

const REGION = "us-east-1";
const PARAMETER = "/shared/nutrition/usda-api-key";
const ARN =
	"arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key";
const AGENT_ROLE = /^arn:aws:sts::730335616323:assumed-role\/agent-readonly\//u;
const API_KEY = /^[A-Za-z0-9_-]{16,256}$/u;
const FOOD_ID = /^[1-9][0-9]{0,9}$/u;
const API = "https://api.nal.usda.gov/fdc/v1/";
const SSO_CONFIG_ERROR =
	/^(?:Profile .*(?:was not found|could not be found|is not configured|is missing required property)|Sso session .*(?:could not be found|is missing required property)|Profile is configured with invalid SSO credentials|Conflicting SSO (?:region|start_url))/u;
const LOCAL_CONFIG =
	'Local SSO uses AWS_CONFIG_FILE="$HOME/.aws/agent-config", AWS_PROFILE=agent-readonly and AWS_SHARED_CREDENTIALS_FILE=/dev/null. Confirm agent-readonly -> agent-readonly-sso -> sso-session agent; never fall back to a personal/default profile. Cloud callers must use their existing approved authentication path.';
const AGENT_ENV =
	'env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_SECURITY_TOKEN -u AWS_DEFAULT_PROFILE AWS_CONFIG_FILE="$HOME/.aws/agent-config" AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_PROFILE=agent-readonly';

async function localConfigurationProblem(env) {
	if (
		env.AWS_PROFILE !== "agent-readonly" ||
		env.AWS_SHARED_CREDENTIALS_FILE !== "/dev/null"
	)
		return;
	const home = env.HOME ?? homedir();
	const configFilepath = join(home, ".aws", "agent-config");
	if (
		!env.AWS_CONFIG_FILE ||
		env.AWS_CONFIG_FILE === join(home, ".aws", "config")
	)
		return "The isolated local SSO config is not selected.";
	// Other approved configurations, including cloud callers, are not this local contract.
	if (env.AWS_CONFIG_FILE !== configFilepath) return;
	// The SDK parser reads only the selected isolated config and /dev/null, never
	// personal/shared credentials or SSO caches. Empty results also cover unreadable
	// or malformed config. Reuse the same parsed file snapshot for its SSO sessions.
	const { configFile } = await loadSharedConfigFiles({
		configFilepath,
		filepath: "/dev/null",
		ignoreCache: true,
	});
	if (!Object.hasOwn(configFile, "agent-readonly"))
		return "The isolated config is missing the agent-readonly profile, or cannot be read/parsed.";
	if (configFile["agent-readonly"].source_profile !== "agent-readonly-sso")
		return "The isolated agent-readonly profile does not select source_profile agent-readonly-sso.";
	if (!Object.hasOwn(configFile, "agent-readonly-sso"))
		return "The isolated config is missing source profile agent-readonly-sso.";
	if (configFile["agent-readonly-sso"].sso_session !== "agent")
		return "The isolated source profile does not select SSO session agent.";
	const sessions = await loadSsoSessionData({ configFilepath });
	const agent = Object.hasOwn(sessions, "agent") ? sessions.agent : undefined;
	if (!agent?.sso_region || !agent?.sso_start_url)
		return "The isolated config is missing SSO session agent or its region/start URL.";
}

async function awsReadError(error, operation, env) {
	// Inspect known provider signatures, but return only our own fixed messages.
	// Never forward provider text, payloads or causes, even for an unknown error.
	const name = error?.name;
	const message = typeof error?.message === "string" ? error.message : "";
	const provider = ["CredentialsProviderError", "TokenProviderError"].includes(
		name,
	);
	let diagnostic;
	if (
		["AccessDenied", "AccessDeniedException", "UnauthorizedOperation"].includes(
			name,
		)
	) {
		diagnostic = `AWS denied ${operation}. Confirm the existing agent-readonly permission for this operation in account 730335616323, us-east-1. This is not evidence of SSO expiry; do not change grants as a recovery step.`;
	} else if (
		[
			"ENOTFOUND",
			"EAI_AGAIN",
			"ECONNREFUSED",
			"ECONNRESET",
			"ETIMEDOUT",
			"CERT_HAS_EXPIRED",
			"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
			"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
			"DEPTH_ZERO_SELF_SIGNED_CERT",
		].includes(error?.code) ||
		["TimeoutError", "NetworkingError"].includes(name)
	) {
		diagnostic = `AWS connectivity failed during ${operation}. Check DNS, TLS and network reachability before retrying. Session expiry is not confirmed.`;
	} else if (provider && SSO_CONFIG_ERROR.test(message)) {
		diagnostic = `AWS configuration could not supply the selected profile/session. Check the selected config file and profile before signing in. ${LOCAL_CONFIG}`;
	} else if (
		provider &&
		(message.startsWith(
			"The SSO session associated with this profile has expired.",
		) ||
			message.startsWith("Token is expired. To refresh this SSO session "))
	) {
		diagnostic = [
			"AWS reports expired SSO credentials; local recipe maintenance needs AWS to retrieve its protected USDA key. The underlying login session may have ended, or token refresh may have failed. Check connectivity first.",
			"If the isolated local agent session needs renewal, John runs this in his own terminal (cwd-independent):",
			`${AGENT_ENV} aws sso login --sso-session agent --no-browser`,
			"Open the printed URL in private Chrome on the same Mac and sign in as agent@jsolly.com. Then verify the direct SSO identity (cwd-independent):",
			`${AGENT_ENV} aws sts get-caller-identity --profile agent-readonly-sso --query Arn --output text`,
			"Expect account 730335616323, an AgentReadOnly SSO role and /agent@jsolly.com. Stop on another identity. Retry maintenance only after verification; never use a personal/default profile. Cloud callers must use their existing approved authentication path.",
		].join("\n");
	} else {
		// DefaultProvider can discard fromIni's missing-profile error. A missing
		// sso-session can also become a TypeError inside the SDK. Only actual config
		// evidence allows either ambiguous error to become a configuration diagnosis.
		const configuration =
			provider || name === "TypeError"
				? await localConfigurationProblem(env)
				: undefined;
		diagnostic = configuration
			? `AWS configuration could not supply the isolated local profile/session. ${configuration} ${LOCAL_CONFIG}`
			: `AWS credential or service failure during ${operation}; session expiry is not confirmed. Check the approved credential provider and AWS service status. ${LOCAL_CONFIG}`;
	}
	return new Error(`Cannot read the USDA SecureString. ${diagnostic}`);
}

async function readIdentity() {
	const client = new STSClient({
		region: REGION,
		maxAttempts: 2,
		requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
		endpoint: `https://sts.${REGION}.amazonaws.com`,
	});
	try {
		return await client.send(new GetCallerIdentityCommand({}));
	} finally {
		client.destroy();
	}
}

async function readParameter() {
	const client = new SSMClient({
		region: REGION,
		maxAttempts: 2,
		requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
		endpoint: `https://ssm.${REGION}.amazonaws.com`,
	});
	try {
		return await client.send(
			new GetParameterCommand({ Name: PARAMETER, WithDecryption: true }),
		);
	} finally {
		client.destroy();
	}
}

export async function loadUsdaKey({
	identity = readIdentity,
	parameter = readParameter,
	env = process.env,
} = {}) {
	let caller;
	try {
		caller = await identity();
	} catch (error) {
		throw await awsReadError(error, "identity verification", env);
	}
	if (caller?.Account !== "730335616323" || !AGENT_ROLE.test(caller.Arn ?? ""))
		throw new Error(
			"Cannot read the USDA SecureString. Unexpected AWS identity. Stop; use only the approved agent-readonly role in account 730335616323. No parameter was requested.",
		);
	let response;
	try {
		response = await parameter();
	} catch (error) {
		throw await awsReadError(error, "USDA parameter retrieval", env);
	}
	const value = response?.Parameter;
	if (
		value?.ARN !== ARN ||
		value.Type !== "SecureString" ||
		typeof value.Value !== "string" ||
		!API_KEY.test(value.Value)
	)
		throw new Error(
			"Cannot read the USDA SecureString. Unexpected USDA parameter ARN, type or value. Check the existing parameter in account 730335616323, us-east-1; no parameter content was logged.",
		);
	return value.Value;
}

function requestFor(args) {
	if (args[0] === "food" && args.length === 2 && FOOD_ID.test(args[1])) {
		return { path: `food/${args[1]}`, init: { method: "GET" }, kind: "food" };
	}
	if (args[0] === "search" && args.length > 1) {
		const query = args.slice(1).join(" ").trim();
		if (query.length > 0 && query.length <= 200) {
			return {
				path: "foods/search",
				init: { method: "POST", body: JSON.stringify({ query, pageSize: 25 }) },
				kind: "search",
			};
		}
	}
	throw new Error(
		'Usage: npm run recipes:usda -- search "raw spinach" | food 168462',
	);
}

function summary(food) {
	if (
		!Number.isSafeInteger(food?.fdcId) ||
		food.fdcId <= 0 ||
		typeof food.description !== "string"
	)
		throw new Error("Unexpected USDA response");
	return {
		fdcId: food.fdcId,
		description: food.description,
		dataType: food.dataType,
		brandOwner: food.brandOwner,
		brandName: food.brandName,
		gtinUpc: food.gtinUpc,
		sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
	};
}

function publicResult(data, kind) {
	if (kind === "search") {
		if (!Array.isArray(data?.foods))
			throw new Error("Unexpected USDA response");
		return { totalHits: data.totalHits, foods: data.foods.map(summary) };
	}
	if (!Array.isArray(data?.foodNutrients))
		throw new Error("Unexpected USDA response");
	return {
		...summary(data),
		publicationDate: data.publicationDate,
		servingSize: data.servingSize,
		servingSizeUnit: data.servingSizeUnit,
		// Keep USDA units and missing values; never infer a recipe portion here.
		foodNutrients: data.foodNutrients.map(
			({ nutrient, amount, dataPoints, derivationCode }) => ({
				nutrient,
				amount,
				dataPoints,
				derivationCode,
			}),
		),
		foodPortions: data.foodPortions,
	};
}

export async function lookup(
	args,
	{ readKey = loadUsdaKey, fetchImpl = fetch } = {},
) {
	const request = requestFor(args); // Validate before touching credentials.
	const key = await readKey();
	try {
		const response = await fetchImpl(new URL(request.path, API), {
			...request.init,
			headers: { "X-Api-Key": key, "Content-Type": "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(`USDA returned HTTP ${response.status}.`);
		}
		const result = publicResult(await response.json(), request.kind);
		if (JSON.stringify(result).includes(key))
			throw new Error("Credential found in response");
		return result;
	} catch {
		// Do not echo URLs, headers, response bodies, or the fetch error/cause.
		// biome-ignore lint/style/useErrorCause: secret-bearing causes must not escape.
		throw new Error(
			"USDA lookup failed. Check API access, quota, network connectivity, and the stored key; no response body was logged.",
		);
	}
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		console.log(JSON.stringify(await lookup(process.argv.slice(2)), null, 2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
