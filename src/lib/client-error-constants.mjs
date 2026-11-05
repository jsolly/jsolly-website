// The CloudWatch destination created by config/aws/client-errors/template.json.
// tests/unit/client-errors-stack.test.mjs pins the role name, log group and
// log stream to that template. The account and region are not template values:
// docs/client-errors.md creates the stack in exactly this account and region.
export const CLIENT_ERROR_LOG = Object.freeze({
	region: "us-east-1",
	roleArn: "arn:aws:iam::730335616323:role/jsolly-website-client-errors",
	logGroupName: "/jsolly-website/client-errors",
	logStreamName: "vercel",
});
