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
`gate/check-migration-backups.py` checks that contract against the checkout;
`python3 gate/check-migration-backups.py` runs it directly. The gate's Python
suite runs `tests/test-migration-backups.py`, including negative cases for
expiration, replacement and weakened retention/protection.

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

John performs administrator infrastructure deployments in **AWS CloudShell**,
using its existing authenticated administrator session. Give him one command
at a time and wait for its result. Prepare the exact commands for the reviewed
revision before handoff; do not depend on a laptop checkout, named profile or
shell variables from a previous session.

Complete source validation in the agent environment or CI before handoff.
John does not repeat those checks. A passing source check does not replace
reviewing the actual change set in the target AWS account.

The archive lifecycle update was already applied from reviewed website revision
`23c12bb2622e582a47d76357bdfbd0430cd6a3ff`. Read its live status before proposing
another deployment. An object still reporting `STANDARD` does not mean the
CloudFormation update failed; S3 processes lifecycle transitions asynchronously.

For a future reviewed update, follow this sequence:

1. Download `config/aws/migration-backups/template.json` directly from the exact
   reviewed merge SHA on GitHub into CloudShell. Supply a literal revision URL
   and a CloudShell path such as `$HOME/migration-backups-template.json`.
2. Inspect the CloudShell caller identity and the live stack, stack policy and
   resources. Stop unless the account is `730335616323`, region is `us-east-1`,
   the existing stack is settled with termination protection enabled, and it
   owns only `BackupBucket` and `BackupBucketPolicy` for this backup bucket.
   An unreadable or missing stack is a blocker, not permission to create one.
3. Create an **UPDATE-only** CloudFormation change set using the downloaded
   template. Preserve the live tags and stamp `InfraDeployCommit` with the exact
   reviewed source SHA. Supply a unique literal change-set name in each command;
   an unset variable must not select or identify the change set.
4. Wait for change-set creation, then inspect the actual change set before
   execution. For the archive change, permit only in-place bucket lifecycle and
   reviewed commit-tag changes, with `Replacement: False`. A bucket-policy
   resource modification is acceptable only when its policy properties are
   unchanged and the difference is inherited tags. Reject additions, removals,
   replacements, IAM changes and any weakened protection or expiration action.
5. After review, execute that exact change-set ARN or name and wait for
   `stack-update-complete`. A successful execute or wait command can return no
   output; verify the resulting stack status instead of treating silence as an
   error or creating another change set.
6. Read back the deployed commit stamp, termination protection, stack policy,
   lifecycle configuration and object versions. Keep the change-set ARN, source
   SHA and readback with the task receipt. Confirm no expiration or deletion
   action was introduced.

A configured lifecycle is not proof the object has transitioned. Reread object
versions later and verify the same recovery version reports `DEEP_ARCHIVE`.
Keep the physical-transition follow-up open until that agreed live result is
recorded. This procedure never changes the separate live media bucket or
CloudFront distribution.
