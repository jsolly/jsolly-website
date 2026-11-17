import assert from "node:assert/strict";
import { it } from "vitest";
import {
	checkClientErrorFirewall,
	clientErrorFirewallRules,
} from "../../monitoring/check-client-error-firewall.mjs";

function config() {
	return {
		// biome-ignore lint/security/noSecrets: Public Vercel project ID, not a credential.
		projectKey: "prj_9irfTPLYZwwuC7YK0oB3bkc1QXtW#active",
		// biome-ignore lint/security/noSecrets: Public Vercel team ID, not a credential.
		ownerId: "team_T8yHg0aDz7nCbyBgJh5a2saR",
		firewallEnabled: true,
		rules: clientErrorFirewallRules(),
	};
}

it("requires endpoint-only edge protection and two independent SDK counters", () => {
	const active = config();
	assert.deepEqual(checkClientErrorFirewall(active), []);
	const [edge, ingestion, duplicate] = active.rules;
	assert.deepEqual(edge.conditionGroup, [
		{
			conditions: [
				{
					type: "path",
					op: "inc",
					value: ["/api/client-error", "/api/client-error/"],
				},
				{ type: "host", op: "eq", value: "www.jsolly.com" },
				{ type: "method", op: "eq", value: "POST" },
				{ type: "environment", op: "eq", value: "production" },
			],
		},
	]);
	assert.deepEqual(
		active.rules.map((rule) => rule.action.mitigate.rateLimit.limit),
		[60, 120, 1],
	);
	assert.equal(
		ingestion.conditionGroup[0].conditions[0].value,
		"client-error-ingestion",
	);
	assert.equal(
		duplicate.conditionGroup[0].conditions[0].value,
		"client-error-duplicate",
	);
});

it("does not call observation mode, disabled rules, wrong scope or broadened matches enforcement", () => {
	for (const mutate of [
		(value) => {
			value.rules[0].action.mitigate.rateLimit.action = "log";
		},
		(value) => {
			value.rules[1].active = false;
		},
		(value) => {
			value.rules[2].action.mitigate.rateLimit.limit = 999;
		},
		(value) => {
			value.rules[0].conditionGroup[0].conditions[0].value = ["/"];
		},
		(value) => {
			value.rules.pop();
		},
		(value) => {
			value.projectKey = "another-project#active";
		},
		(value) => {
			value.ownerId = "another-team";
		},
		(value) => {
			value.firewallEnabled = false;
		},
		(value) => {
			value.rules[0].valid = false;
		},
		(value) => {
			const bypass = structuredClone(value.rules[1]);
			bypass.action.mitigate.action = "bypass";
			value.rules.push(bypass);
		},
		(value) => {
			value.rules[0].validationErrors = ["invalid rule"];
		},
		(value) => {
			value.rules.unshift({
				active: true,
				conditionGroup: [
					{ conditions: [{ type: "host", op: "eq", value: "www.jsolly.com" }] },
				],
				action: { mitigate: { action: "bypass" } },
			});
		},
		(value) => {
			value.rules[0].action.mitigate.actionDuration = "1h";
		},
	]) {
		const active = config();
		mutate(active);
		assert.ok(checkClientErrorFirewall(active).length > 0);
	}
});
