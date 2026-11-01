"""Check the retained migration stack before a human CloudFormation update."""

import json
from pathlib import Path
from typing import cast


def object_map(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError("Expected a JSON object")
    return cast(dict[str, object], value)


def object_list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON array")
    return cast(list[object], value)


def check(root: Path) -> None:
    config = root / "config/aws/migration-backups"
    template = object_map(json.loads((config / "template.json").read_text()))
    policy = object_map(json.loads((config / "stack-policy.json").read_text()))
    resources = object_map(template["Resources"])
    if set(resources) != {"BackupBucket", "BackupBucketPolicy"}:
        raise ValueError("Review any resource addition, removal or logical ID change")
    for raw_resource in resources.values():
        resource = object_map(raw_resource)
        if resource.get("DeletionPolicy") != "Retain" or resource.get("UpdateReplacePolicy") != "Retain":
            raise ValueError("Backup resources must remain retained")
    bucket = object_map(object_map(resources["BackupBucket"])["Properties"])
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
    if not all(object_map(bucket["PublicAccessBlockConfiguration"]).get(key) is True for key in (
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
    denies = [statement for raw in object_list(policy["Statement"])
              if (statement := object_map(raw))["Effect"] == "Deny"]
    if not any(set(object_list(statement["Resource"])) == protected
               and set(object_list(statement["Action"])) == {"Update:Replace", "Update:Delete"}
               and statement["Principal"] == "*" for statement in denies):
        raise ValueError("Stack policy must deny replacement and deletion of both resources")


if __name__ == "__main__":
    check(Path(__file__).resolve().parents[1])
    print("Migration backup archive and retention contract passed")
