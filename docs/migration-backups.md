# Migration backup infrastructure

This repository owns the existing standalone CloudFormation stack
`blogthedata-migration-backups`, account `730335616323`, region `us-east-1`.
Its source moved from archived `jsolly/awesome-blog` with John's October 28,
2026 decision to keep the recovery archive for several years in cheap storage.
The archived source is historical. Do not deploy its older template again.
No stack import, resource import, recreation or shared-infra change is needed.

The source is `config/aws/migration-backups/template.json`. Its stack policy is
beside it. Both retain the original resource names and logical IDs. The only
initial resource change is the recovery archive's transition to Glacier Deep
Archive. There is no expiration or automatic deletion. Keep termination
protection, stack policy, Object Lock, versioning and private access enabled.
Vercel builds and website releases do not deploy this stack.
The gate's Python suite runs `scripts/test-migration-backups.py`, including
negative cases for expiration, replacement and weakened retention/protection.

## Backup and recovery

Bucket `blogthedata-backups-730335616323` contains the independent recovery
bundle `migrations/2026-10-02T1742Z/recovery-bundle.tar.gz`. The verified version
is `A7Eg62qqtUAxYJySvCGI2aoWGcB41w2W`, 73,873,206 bytes, SHA-256
`233bd84e4325f767eb2a9b1d527b0730255f89a2d3b9f0e6e77ff63ab2cb8832`.
Governance retention for that version ends November 1, 2026 at
18:19:35.530 UTC. Lifecycle archival does not require deleting the version or
bypassing its lock. The existing 30-day default retention is not a promise of
several years of immutable retention; the no-expiration rule keeps the data
until a separately authorized deletion.

Deep Archive has a 180-day minimum storage charge and restore charges.
Standard and bulk restores typically take 12 and 48 hours respectively.
Request a restore of the exact version, wait for it to finish, then download
that version and verify the checksum before using it. The historical recovery
receipt in `awesome-blog/docs/migration-backups.md` records a successful
download, database restore and media verification. Private receipts and separate
local copies remain outside Git.

This bucket is separate from the live `blogthedata` media bucket and CloudFront
distribution. This procedure changes neither those resources nor Heroku.

## Review and apply

John runs AWS commands in his own MFA-authenticated administrator terminal.
Agents prepare source and inspect native MCP reads; they do not apply stacks
or broaden IAM grants. The current AgentMcp connection cannot write S3 lifecycle
configuration. No console lifecycle edit is needed.

After the source change is reviewed, passes the full repository gate and CI,
and merges, use a clean, current main checkout of `jsolly/jsolly-website`:

```bash
cd /Users/johnsolly/code/jsolly-website
git switch main
git pull --ff-only
git status --short
python3 scripts/check-migration-backups.py
export AWS_PROFILE=prod-admin
aws sts get-caller-identity
aws cloudformation describe-stacks --region us-east-1 --stack-name blogthedata-migration-backups
aws cloudformation get-stack-policy --region us-east-1 --stack-name blogthedata-migration-backups
aws cloudformation list-stack-resources --region us-east-1 --stack-name blogthedata-migration-backups
aws cloudformation validate-template --region us-east-1 --template-body file://config/aws/migration-backups/template.json
```

Stop unless the checkout is clean, the account is `730335616323`, the stack is
settled with termination protection enabled, the live policy matches the
committed policy, and the stack owns only `BackupBucket` and `BackupBucketPolicy`
for this exact backup bucket. An unreadable or missing stack is a blocker,
never permission to create it. Preserve any additional live tags discovered
during review. The following tags are the complete set observed October 28.

Create an update-only change set; its unique name identifies this review:

```bash
backup_commit="$(git rev-parse HEAD)"
backup_change="archive-backup-$(date -u +%Y%m%dT%H%M%SZ)"
aws cloudformation create-change-set \
  --region us-east-1 --stack-name blogthedata-migration-backups \
  --change-set-type UPDATE --change-set-name "$backup_change" \
  --template-body file://config/aws/migration-backups/template.json \
  --tags Key=Project,Value=blogthedata Key=Purpose,Value=migration-recovery \
    "Key=InfraDeployCommit,Value=$backup_commit"
aws cloudformation wait change-set-create-complete \
  --region us-east-1 --stack-name blogthedata-migration-backups --change-set-name "$backup_change"
aws cloudformation describe-change-set \
  --region us-east-1 --stack-name blogthedata-migration-backups --change-set-name "$backup_change"
```

Review the actual change set. Only an in-place `Modify` of `BackupBucket` with
`Replacement: False`, adding `LifecycleConfiguration`, is expected. Reject any
add, remove, replacement, IAM change, unexpected property change or protection
change. The `InfraDeployCommit` stamp now refers to this repository's commit,
not the archived source. Check that tag separately after apply.

Only after reviewing that exact change set, John executes it:

```bash
aws cloudformation execute-change-set \
  --region us-east-1 --stack-name blogthedata-migration-backups --change-set-name "$backup_change"
aws cloudformation wait stack-update-complete --region us-east-1 --stack-name blogthedata-migration-backups
aws cloudformation describe-stacks --region us-east-1 --stack-name blogthedata-migration-backups
aws s3api get-bucket-lifecycle-configuration --region us-east-1 --bucket blogthedata-backups-730335616323
aws s3api list-object-versions --region us-east-1 --bucket blogthedata-backups-730335616323
```

Verify the stamp equals `backup_commit`, protection remains enabled, and the
live rule matches the template with no expiration. A configured lifecycle is
not proof the object has transitioned. S3 processes transitions asynchronously;
reread versions later and verify the same version reports `DEEP_ARCHIVE`.
Retain the change-set ARN, release commit and readback with the task receipt.
The task stays open until its agreed live verification is recorded.
