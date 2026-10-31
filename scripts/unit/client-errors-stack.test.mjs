import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "vitest";
import { CLIENT_ERROR_LOG } from "../../src/lib/client-error-log.mjs";

const read = (name) =>
	JSON.parse(readFileSync(`config/aws/client-errors/${name}`, "utf8"));
const template = read("template.json");
const policy = read("stack-policy.json");
const resources = template.Resources;
const ofType = (type) =>
	Object.entries(resources).filter(([, resource]) => resource.Type === type);
const ISSUER = "oidc.vercel.com/jsollys-projects";
const OWN_LOG_GROUP = /^\/jsolly-website\//u;

it("defines exactly the reviewed resources", () => {
	assert.deepEqual(Object.keys(resources).sort(), [
		"ClientErrorAlarm",
		"ClientErrorLogGroup",
		"ClientErrorLogStream",
		"ClientErrorMetricFilter",
		"ClientErrorWriterRole",
	]);
});

it("names the log group, stream and role the Vercel function writes with", () => {
	const group = resources.ClientErrorLogGroup.Properties;
	assert.equal(group.LogGroupName, CLIENT_ERROR_LOG.logGroupName);
	assert.equal(group.RetentionInDays, 30);
	assert.equal(
		resources.ClientErrorLogStream.Properties.LogStreamName,
		CLIENT_ERROR_LOG.logStreamName,
	);
	const role = resources.ClientErrorWriterRole.Properties;
	assert.equal(
		CLIENT_ERROR_LOG.roleArn,
		`arn:aws:iam::730335616323:role/${role.RoleName}`,
	);
	// shared-infra enriches from the metric filter's group; it never queries /shared-infra/*.
	assert.match(CLIENT_ERROR_LOG.logGroupName, OWN_LOG_GROUP);
});

it("trusts only Vercel production tokens for this project", () => {
	const trust =
		resources.ClientErrorWriterRole.Properties.AssumeRolePolicyDocument
			.Statement;
	assert.deepEqual(trust, [
		{
			Effect: "Allow",
			Principal: {
				Federated: {
					"Fn::Sub": `arn:\${AWS::Partition}:iam::\${AWS::AccountId}:oidc-provider/${ISSUER}`,
				},
			},
			Action: "sts:AssumeRoleWithWebIdentity",
			Condition: {
				StringEquals: {
					[`${ISSUER}:aud`]: "https://vercel.com/jsollys-projects",
					[`${ISSUER}:sub`]:
						"owner:jsollys-projects:project:jsolly-website:environment:production",
				},
			},
		},
	]);
	assert.equal(ofType("AWS::IAM::Role").length, 1);
	assert.equal(ofType("AWS::IAM::OIDCProvider").length, 0);
});

it("grants only PutLogEvents on the one stream", () => {
	const { Policies, ManagedPolicyArns } =
		resources.ClientErrorWriterRole.Properties;
	assert.equal(ManagedPolicyArns, undefined);
	assert.deepEqual(
		Policies.flatMap((p) => p.PolicyDocument.Statement),
		[
			{
				Effect: "Allow",
				Action: "logs:PutLogEvents",
				Resource: {
					"Fn::Sub":
						// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal CloudFormation substitution.
						// biome-ignore lint/security/noSecrets: CloudFormation ARN template, not a credential.
						"arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${ClientErrorLogGroup}:log-stream:${ClientErrorLogStream}",
				},
			},
		],
	);
});

it("pages shared-infra on five or more reports in an hour, and on recovery", () => {
	const filter = resources.ClientErrorMetricFilter.Properties;
	assert.deepEqual(filter.LogGroupName, { Ref: "ClientErrorLogGroup" });
	assert.equal(filter.FilterPattern, '{ $.level = "error" }');
	const [metric] = filter.MetricTransformations;
	const alarm = resources.ClientErrorAlarm.Properties;
	assert.equal(alarm.Namespace, metric.MetricNamespace);
	assert.equal(alarm.MetricName, metric.MetricName);
	assert.equal(metric.MetricValue, "1");
	assert.deepEqual(
		{
			Statistic: alarm.Statistic,
			Period: alarm.Period,
			EvaluationPeriods: alarm.EvaluationPeriods,
			Threshold: alarm.Threshold,
			ComparisonOperator: alarm.ComparisonOperator,
			TreatMissingData: alarm.TreatMissingData,
		},
		{
			Statistic: "Sum",
			Period: 3600,
			EvaluationPeriods: 1,
			Threshold: 5,
			ComparisonOperator: "GreaterThanOrEqualToThreshold",
			TreatMissingData: "notBreaching",
		},
	);
	// biome-ignore lint/security/noSecrets: CloudFormation parameter name, not a credential.
	const topic = [{ Ref: "AlertTopicArn" }];
	assert.deepEqual(alarm.AlarmActions, topic);
	assert.deepEqual(alarm.OKActions, topic);
	assert.deepEqual(template.Parameters.AlertTopicArn, {
		// biome-ignore lint/security/noSecrets: CloudFormation parameter type, not a credential.
		Type: "AWS::SSM::Parameter::Value<String>",
		Default: "/shared-infra/alert-topic-arn",
		Description: "shared-infra's alert topic, resolved at deploy time",
	});
});

it("denies replacing or deleting the retained log resources", () => {
	const deny = policy.Statement.find(
		(statement) => statement.Effect === "Deny",
	);
	assert.deepEqual(deny, {
		Effect: "Deny",
		Action: ["Update:Replace", "Update:Delete"],
		Principal: "*",
		Resource: [
			"LogicalResourceId/ClientErrorLogGroup",
			"LogicalResourceId/ClientErrorLogStream",
		],
	});
	for (const id of ["ClientErrorLogGroup", "ClientErrorLogStream"]) {
		assert.equal(resources[id].DeletionPolicy, "Retain");
		assert.equal(resources[id].UpdateReplacePolicy, "Retain");
	}
});
