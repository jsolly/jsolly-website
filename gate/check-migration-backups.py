"""Check the retained migration stack before a human CloudFormation update."""

import json
from pathlib import Path


def check(root):
    config = root / "config/aws/migration-backups"
    template = json.loads((config / "template.json").read_text())
    policy = json.loads((config / "stack-policy.json").read_text())
    resources = template["Resources"]
    if set(resources) != {"BackupBucket", "BackupBucketPolicy"}:
        raise ValueError("Review any resource addition, removal or logical ID change")
    for resource in resources.values():
        if resource.get("DeletionPolicy") != "Retain" or resource.get("UpdateReplacePolicy") != "Retain":
            raise ValueError("Backup resources must remain retained")
    bucket = resources["BackupBucket"]["Properties"]
    if bucket["BucketName"] != {"Fn::Sub": "blogthedata-backups-${AWS::AccountId}"}:
        raise ValueError("Do not rename or recreate the existing bucket")
    if bucket.get("ObjectLockEnabled") is not True:
        raise ValueError("Object Lock must stay enabled")
    if bucket["VersioningConfiguration"] != {"Status": "Enabled"}:
        raise ValueError("Versioning must stay enabled")
    if bucket["ObjectLockConfiguration"] != {
        "ObjectLockEnabled": "Enabled",
        "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 30}},
    }:
        raise ValueError("Keep existing retention protections")
    if not all(bucket["PublicAccessBlockConfiguration"].get(key) is True for key in (
        "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"
    )):
        raise ValueError("Keep all public-access blocks enabled")
    if bucket["LifecycleConfiguration"] != {"Rules": [{
        "Id": "ArchiveMigrationRecovery",
        "Status": "Enabled",
        "Prefix": "migrations/2026-10-02T1742Z/recovery-bundle.tar.gz",
        "Transitions": [{"TransitionInDays": 0, "StorageClass": "DEEP_ARCHIVE"}],
    }]}:
        raise ValueError("Only the reviewed archive transition is allowed; no expiration")
    protected = {f"LogicalResourceId/{name}" for name in resources}
    denies = [statement for statement in policy["Statement"] if statement["Effect"] == "Deny"]
    if not any(set(statement["Resource"]) == protected
               and set(statement["Action"]) == {"Update:Replace", "Update:Delete"}
               and statement["Principal"] == "*" for statement in denies):
        raise ValueError("Stack policy must deny replacement and deletion of both resources")


if __name__ == "__main__":
    check(Path(__file__).resolve().parents[1])
    print("Migration backup archive and retention contract passed")
