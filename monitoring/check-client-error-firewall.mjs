import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import limits from "../config/security/client-error-limits.json" with {
	type: "json",
};

/** Reviewed production rules. Printing them never changes a firewall. */
export function clientErrorFirewallRules() {
	const rule = (name, conditions, limit) => ({
		name,
		active: true,
		conditionGroup: [{ conditions }],
		action: {
			mitigate: {
				action: "rate_limit",
				rateLimit: {
					action: "rate_limit",
					algo: "fixed_window",
					window: limits.window,
					limit,
					keys: [],
				},
			},
		},
	});
	const edge = rule(
		"Client error POST rate limit",
		[
			{
				type: "path",
				op: "inc",
				value: ["/api/client-error", "/api/client-error/"],
			},
			{ type: "host", op: "eq", value: "www.jsolly.com" },
			{ type: "method", op: "eq", value: "POST" },
			{ type: "environment", op: "eq", value: "production" },
		],
		limits.edge.limit,
	);
	edge.action.mitigate.rateLimit.keys = ["ip"];
	return [
		edge,
		...["ingestion", "duplicate"].map((kind) =>
			rule(
				`Client error ${kind}`,
				[{ type: "rate_limit_api_id", op: "eq", value: limits[kind].id }],
				limits[kind].limit,
			),
		),
	];
}

/** Fail when a rule is absent, observes only, broadens its match or changes the budget. */
export function checkClientErrorFirewall(config) {
	const errors = [];
	if (
		config.projectKey !== `${limits.projectId}#active` ||
		config.ownerId !== limits.teamId
	)
		errors.push("Wrong project, team or inactive configuration.");
	if (!config.firewallEnabled) errors.push("Firewall is disabled.");
	const expectedRules = clientErrorFirewallRules();
	for (const candidate of config.rules ?? []) {
		if (
			candidate.active &&
			["bypass", "deny", "challenge", "rate_limit", "redirect"].includes(
				candidate.action?.mitigate?.action,
			) &&
			!expectedRules.some((expected) =>
				isDeepStrictEqual(candidate.conditionGroup, expected.conditionGroup),
			)
		) {
			errors.push(
				"Additional active mitigation or bypass requires manual ordering and scope review.",
			);
		}
	}
	for (const expected of expectedRules) {
		const matches = config.rules?.filter((candidate) =>
			isDeepStrictEqual(candidate.conditionGroup, expected.conditionGroup),
		);
		const actual = matches?.length === 1 ? matches[0] : undefined;
		if (
			!actual?.active ||
			actual.valid === false ||
			actual.validationErrors?.length
		) {
			errors.push(
				`${expected.name}: no active rule with the exact reviewed conditions.`,
			);
			continue;
		}
		const action = actual.action?.mitigate;
		const expectedLimit = expected.action.mitigate.rateLimit;
		if (
			action?.action !== "rate_limit" ||
			(action.actionDuration !== undefined && action.actionDuration !== null) ||
			["action", "algo", "window", "limit", "keys"].some(
				(key) =>
					JSON.stringify(action.rateLimit?.[key]) !==
					JSON.stringify(expectedLimit[key]),
			)
		)
			errors.push(
				`${expected.name}: enforcement or budget differs from the reviewed policy.`,
			);
	}
	return errors;
}

if (import.meta.main) {
	if (process.argv[2] === "--print-rules") {
		console.log(JSON.stringify(clientErrorFirewallRules(), null, 2));
	} else if (process.argv.length === 3) {
		const captured = JSON.parse(await readFile(process.argv[2], "utf8"));
		const errors = checkClientErrorFirewall(captured.result ?? captured);
		console.log(
			errors.length
				? errors.join("\n")
				: "Client-error firewall definitions match the reviewed policy; verify live enforcement separately.",
		);
		process.exitCode = errors.length ? 1 : 0;
	} else {
		console.error(
			"Usage: node monitoring/check-client-error-firewall.mjs <active-config.json|--print-rules>",
		);
		process.exitCode = 2;
	}
}
