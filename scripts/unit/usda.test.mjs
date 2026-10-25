import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { lookup, loadUsdaKey as readUsdaKey } from "../recipes/usda.mjs";

// Every test explicitly isolates selectors; no test inspects the real AWS config.
const loadUsdaKey = (options = {}) => readUsdaKey({ env: {}, ...options });

const SSO_EXPIRY = /expired SSO credentials/u;
const MAINTENANCE_CONTEXT = /local recipe maintenance needs AWS/u;
const CONNECTIVITY = /connectivity/u;
const ISOLATED_CONFIG = /AWS_CONFIG_FILE="\$HOME\/\.aws\/agent-config"/u;
const NO_SHARED_CREDENTIALS = /AWS_SHARED_CREDENTIALS_FILE=\/dev\/null/u;
const ISOLATED_PROFILE = /AWS_PROFILE=agent-readonly/u;
const RENEW_SESSION = /aws sso login --sso-session agent --no-browser/u;
const VERIFY_SSO = /get-caller-identity --profile agent-readonly-sso/u;
const AGENT_USER = /agent@jsolly\.com/u;
const CLEAR_STATIC_KEY = /-u AWS_ACCESS_KEY_ID/u;
const LOGIN_OR_EXPIRY = /aws sso login|expired SSO credentials/u;
const PARAMETER_DENIED = /AWS denied USDA parameter retrieval/u;
const LOGIN_COMMAND = /aws sso login/u;
const IDENTITY_STOP = /Unexpected AWS identity.*Stop/u;
const CONFIGURATION_ERROR = /AWS configuration/u;
const UNCONFIRMED_ERROR = /not confirmed/u;
const CREDENTIAL_ERROR = /Cannot read the USDA SecureString/u;
const USAGE_ERROR = /Usage:/u;
const KEY = "fixture-only-usda-key-not-a-real-key";
const ARN =
	"arn:aws:ssm:us-east-1:730335616323:parameter/shared/nutrition/usda-api-key";
const IDENTITY = {
	Account: "730335616323",
	Arn: "arn:aws:sts::730335616323:assumed-role/agent-readonly/fixture",
};
const PARAMETER = { ARN, Type: "SecureString", Value: KEY };
const FOOD = {
	fdcId: 168462,
	description: "Spinach, raw",
	dataType: "SR Legacy",
	foodNutrients: [
		{ nutrient: { id: 1003, name: "Protein", unitName: "g" }, amount: 2.86 },
	],
};

it("USDA credentials require the exact agent identity and encrypted parameter", async () => {
	assert.equal(
		await loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => ({ Parameter: PARAMETER }),
		}),
		KEY,
	);
	await Promise.all(
		[
			{ ...IDENTITY, Account: "111111111111" },
			{
				...IDENTITY,
				Arn: "arn:aws:sts::730335616323:assumed-role/AdministratorAccess/fixture",
			},
		].map(async (identity) => {
			let reads = 0;
			await assert.rejects(
				loadUsdaKey({
					identity: () => identity,
					parameter: () => {
						reads++;
						return { Parameter: PARAMETER };
					},
				}),
				CREDENTIAL_ERROR,
			);
			assert.equal(reads, 0);
		}),
	);
	await Promise.all(
		[
			{ ...PARAMETER, Type: "String" },
			{ ...PARAMETER, ARN: `${ARN}/child` },
			{ ...PARAMETER, Value: "" },
		].map((parameter) =>
			assert.rejects(
				loadUsdaKey({
					identity: () => IDENTITY,
					parameter: () => ({ Parameter: parameter }),
				}),
				CREDENTIAL_ERROR,
			),
		),
	);
	await assert.rejects(
		loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => {
				throw new Error(KEY);
			},
		}),
		(error) => !error.message.includes(KEY) && !error.cause,
	);
});

it("USDA lookups validate input before credentials and send the key only in a fixed-origin header", async () => {
	await Promise.all(
		[
			[],
			["food", "../secret"],
			["food", "168462", "extra"],
			["search", " "],
		].map((args) =>
			assert.rejects(
				lookup(args, {
					readKey: () => {
						throw new Error("credentials touched");
					},
				}),
				USAGE_ERROR,
			),
		),
	);
	const calls = [];
	const fetchImpl = (url, init) => {
		calls.push({ url: String(url), init });
		return {
			ok: true,
			json: async () =>
				init.method === "POST" ? { totalHits: 1, foods: [FOOD] } : FOOD,
		};
	};
	const result = await lookup(["food", "168462"], {
		readKey: async () => KEY,
		fetchImpl,
	});
	assert.equal(result.foodNutrients[0].amount, 2.86);
	assert.equal(result.foodNutrients[0].nutrient.unitName, "g");
	assert.equal(
		result.sourceUrl,
		"https://fdc.nal.usda.gov/food-details/168462/nutrients",
	);
	const search = await lookup(["search", "raw", "spinach"], {
		readKey: async () => KEY,
		fetchImpl,
	});
	assert.equal(search.foods[0].fdcId, 168462);
	assert.equal(search.foods[0].foodNutrients, undefined);
	assert.deepEqual(JSON.parse(calls[1].init.body), {
		query: "raw spinach",
		pageSize: 25,
	});
	for (const { url, init } of calls) {
		assert.ok(url.startsWith("https://api.nal.usda.gov/fdc/v1/"));
		assert.ok(!url.includes(KEY));
		assert.equal(init.headers["X-Api-Key"], KEY);
		assert.equal(init.redirect, "error");
		assert.ok(init.signal instanceof AbortSignal);
	}
});

it("USDA failures and malformed or credential-bearing responses never expose the key", async () => {
	await Promise.all(
		[
			() => {
				throw new Error(`network failure ${KEY}`);
			},
			async () => ({
				ok: false,
				status: 403,
				json: () => {
					throw new Error(KEY);
				},
			}),
			async () => ({
				ok: true,
				json: () => {
					throw new Error(KEY);
				},
			}),
			async () => ({
				ok: true,
				json: async () => ({ ...FOOD, description: KEY }),
			}),
			async () => ({
				ok: true,
				json: async () => ({ ...FOOD, foodNutrients: null }),
			}),
		].map((fetchImpl) =>
			assert.rejects(
				lookup(["food", "168462"], { readKey: async () => KEY, fetchImpl }),
				(error) =>
					error.message.startsWith("USDA lookup failed.") &&
					!error.message.includes(KEY) &&
					!error.cause,
			),
		),
	);
});

function awsError(name, message, code) {
	return Object.assign(new Error(message), {
		name,
		code,
		cause: new Error(KEY),
	});
}

it.each([
	[
		"CredentialsProviderError",
		"The SSO session associated with this profile has expired.",
	],
	[
		"CredentialsProviderError",
		"Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
	],
	[
		"TokenProviderError",
		"Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
	],
])(
	"USDA wrapper explains %s SSO expiry without forwarding provider payloads: %s",
	async (name, message) => {
		let parameterReads = 0;
		let fetches = 0;
		await assert.rejects(
			lookup(["food", "168462"], {
				readKey: () =>
					loadUsdaKey({
						identity: () => {
							throw awsError(name, `${message} ${KEY}`);
						},
						parameter: () => {
							parameterReads++;
						},
					}),
				fetchImpl: () => {
					fetches++;
				},
			}),
			(error) => {
				assert.match(error.message, SSO_EXPIRY);
				assert.match(error.message, MAINTENANCE_CONTEXT);
				assert.match(error.message, CONNECTIVITY);
				assert.match(error.message, ISOLATED_CONFIG);
				assert.match(error.message, NO_SHARED_CREDENTIALS);
				assert.match(error.message, ISOLATED_PROFILE);
				assert.match(error.message, RENEW_SESSION);
				assert.match(error.message, VERIFY_SSO);
				assert.match(error.message, AGENT_USER);
				assert.match(error.message, CLEAR_STATIC_KEY);
				assert.ok(!error.message.includes(KEY));
				assert.equal(error.cause, undefined);
				return true;
			},
		);
		assert.equal(parameterReads, 0);
		assert.equal(fetches, 0);
	},
);

it.each([
	[
		"missing profile",
		awsError(
			"CredentialsProviderError",
			"Profile agent-readonly-sso was not found.",
		),
		/AWS configuration/u,
	],
	[
		"wrong config",
		awsError(
			"TokenProviderError",
			"Profile 'agent-readonly-sso' could not be found in shared credentials file.",
		),
		/AWS configuration/u,
	],
	[
		"missing session",
		awsError(
			"TokenProviderError",
			"Sso session 'agent' could not be found in shared credentials file.",
		),
		/AWS configuration/u,
	],
	[
		"network",
		awsError("Error", "DNS lookup failed", "ENOTFOUND"),
		/AWS connectivity/u,
	],
	[
		"TLS",
		awsError("Error", "certificate failure", "CERT_HAS_EXPIRED"),
		/AWS connectivity/u,
	],
	[
		"timeout",
		awsError("TimeoutError", "request timed out"),
		/AWS connectivity/u,
	],
	[
		"permission",
		awsError("AccessDeniedException", "access denied"),
		/AWS denied/u,
	],
	[
		"ambiguous refresh",
		awsError("CredentialsProviderError", "refresh failed"),
		/not confirmed/u,
	],
	[
		"ambiguous expired token",
		awsError(
			"CredentialsProviderError",
			"Token has expired and refresh failed.",
		),
		/not confirmed/u,
	],
	[
		"unattributed SSO text",
		awsError(
			"Error",
			"The SSO session associated with this profile has expired.",
		),
		/not confirmed/u,
	],
	[
		"role token",
		awsError(
			"ExpiredToken",
			"The security token included in the request is expired",
		),
		/not confirmed/u,
	],
	[
		"invalid cache",
		awsError(
			"CredentialsProviderError",
			"The SSO session associated with this profile is invalid.",
		),
		/not confirmed/u,
	],
])(
	"USDA %s failure never claims SSO expiry or recommends login",
	async (_label, providerError, expected) => {
		await assert.rejects(
			loadUsdaKey({
				identity: () => {
					throw providerError;
				},
			}),
			(error) => {
				assert.match(error.message, expected);
				assert.doesNotMatch(error.message, LOGIN_OR_EXPIRY);
				assert.ok(!error.message.includes(KEY));
				assert.equal(error.cause, undefined);
				return true;
			},
		);
	},
);

it("USDA parameter denial names the failed step and preserves the secret boundary", async () => {
	await assert.rejects(
		loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => {
				throw awsError("AccessDeniedException", KEY);
			},
		}),
		(error) => {
			assert.match(error.message, PARAMETER_DENIED);
			assert.doesNotMatch(error.message, LOGIN_COMMAND);
			assert.ok(!error.message.includes(KEY));
			assert.equal(error.cause, undefined);
			return true;
		},
	);
});

it("USDA expiry during parameter retrieval is sanitized just like identity resolution", async () => {
	await assert.rejects(
		loadUsdaKey({
			identity: () => IDENTITY,
			parameter: () => {
				throw awsError(
					"CredentialsProviderError",
					`The SSO session associated with this profile has expired. ${KEY}`,
				);
			},
		}),
		(error) => {
			assert.match(error.message, SSO_EXPIRY);
			assert.ok(!error.message.includes(KEY));
			assert.equal(error.cause, undefined);
			return true;
		},
	);
});

it("USDA identity mismatch stops before parameter access and gives no renewal advice", async () => {
	let reads = 0;
	await assert.rejects(
		loadUsdaKey({
			identity: () => ({ Account: "111111111111", Arn: KEY }),
			parameter: () => {
				reads++;
			},
		}),
		IDENTITY_STOP,
	);
	assert.equal(reads, 0);
});

it("USDA wrapper succeeds on a later invocation after a simulated provider renewal", async () => {
	const identities = [
		awsError(
			"CredentialsProviderError",
			"The SSO session associated with this profile has expired.",
		),
		IDENTITY,
	];
	let reads = 0;
	let fetches = 0;
	const dependencies = {
		readKey: () =>
			loadUsdaKey({
				identity: () => {
					const next = identities.shift();
					if (next instanceof Error) throw next;
					return next;
				},
				parameter: () => {
					reads++;
					return { Parameter: PARAMETER };
				},
			}),
		fetchImpl: (_url, init) => {
			fetches++;
			assert.equal(init.headers["X-Api-Key"], KEY);
			return { ok: true, json: async () => FOOD };
		},
	};
	await assert.rejects(lookup(["food", "168462"], dependencies), SSO_EXPIRY);
	assert.equal(reads, 0);
	assert.equal(fetches, 0);
	assert.equal(
		(await lookup(["food", "168462"], dependencies)).fdcId,
		FOOD.fdcId,
	);
	assert.equal(reads, 1);
	assert.equal(fetches, 1);
});

const LOCAL_PROFILE = `[profile agent-readonly]
role_arn = arn:aws:iam::730335616323:role/agent-readonly
source_profile = agent-readonly-sso
`;
const SSO_PROFILE = `[profile agent-readonly-sso]
sso_session = agent
sso_account_id = 730335616323
sso_role_name = AgentReadOnly
`;
const SSO_SESSION = `[sso-session agent]
sso_region = us-east-2
sso_start_url = https://fixture.awsapps.com/start
`;

it.each([
	["missing selected profile", SSO_PROFILE + SSO_SESSION],
	["missing source profile", LOCAL_PROFILE + SSO_SESSION],
	["missing referenced SSO session", LOCAL_PROFILE + SSO_PROFILE],
])(
	"USDA diagnoses actual SDK %s failure using only isolated config evidence",
	async (_label, config) => {
		const home = await mkdtemp(join(tmpdir(), "usda-config-"));
		try {
			await mkdir(join(home, ".aws"));
			const env = {
				HOME: home,
				AWS_CONFIG_FILE: join(home, ".aws", "agent-config"),
				AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
				AWS_PROFILE: "agent-readonly",
				AWS_EC2_METADATA_DISABLED: "true",
			};
			await writeFile(env.AWS_CONFIG_FILE, config, { mode: 0o600 });
			// Exercise the installed client's default credential chain. Its home/config
			// are synthetic, shared credentials are /dev/null and metadata is disabled.
			// These missing definitions fail before SSO caches or STS can be reached.
			const result = spawnSync(
				process.execPath,
				[
					"--input-type=module",
					"--eval",
					`
import { STSClient } from "@aws-sdk/client-sts";
const client = new STSClient({ region: "us-east-1" });
try {
	await client.config.credentials();
	process.exitCode = 1;
} catch (error) {
	console.log(JSON.stringify({ name: error.name, message: error.message }));
} finally { client.destroy(); }
`,
				],
				{ env, encoding: "utf8", timeout: 10_000 },
			);
			assert.equal(result.status, 0, result.stderr);
			const observed = JSON.parse(result.stdout);
			const providerError = Object.assign(new Error(observed.message), {
				name: observed.name,
			});
			let parameterReads = 0;
			let fetches = 0;
			await assert.rejects(
				lookup(["food", "168462"], {
					readKey: () =>
						loadUsdaKey({
							env,
							identity: () => {
								throw providerError;
							},
							parameter: () => {
								parameterReads++;
							},
						}),
					fetchImpl: () => {
						fetches++;
					},
				}),
				CONFIGURATION_ERROR,
			);
			assert.equal(parameterReads, 0);
			assert.equal(fetches, 0);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
);

it.each([
	["selected ordinary config", "/.aws/config", "", CONFIGURATION_ERROR],
	[
		"valid local definitions with exhausted providers",
		"/.aws/agent-config",
		LOCAL_PROFILE + SSO_PROFILE + SSO_SESSION,
		UNCONFIRMED_ERROR,
	],
	["other approved config", "/cloud-config", "", UNCONFIRMED_ERROR],
])(
	"USDA keeps %s distinct without falling back or inferring expiry",
	async (_label, relative, config, expected) => {
		const home = await mkdtemp(join(tmpdir(), "usda-selector-"));
		try {
			await mkdir(join(home, ".aws"));
			const env = {
				HOME: home,
				AWS_CONFIG_FILE: home + relative,
				AWS_PROFILE: "agent-readonly",
				AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
			};
			await writeFile(env.AWS_CONFIG_FILE, config);
			await assert.rejects(
				loadUsdaKey({
					env,
					identity: () => {
						throw awsError(
							"CredentialsProviderError",
							"Could not load credentials from any providers",
						);
					},
				}),
				(error) => {
					assert.match(error.message, expected);
					assert.doesNotMatch(error.message, LOGIN_OR_EXPIRY);
					assert.equal(error.cause, undefined);
					return true;
				},
			);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
);
