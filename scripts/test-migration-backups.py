"""Ensure the archive preflight rejects changes that could lose recovery data."""

import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHECK = runpy.run_path(str(ROOT / "scripts/check-migration-backups.py"))["check"]


class BackupContract(unittest.TestCase):
    def test_committed_configuration(self):
        CHECK(ROOT)

    def test_rejects_destructive_changes(self):
        for change in ("expiration", "rename", "unretain", "unlock", "unprotect"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as scratch:
                root = Path(scratch)
                config = root / "config/aws/migration-backups"
                shutil.copytree(ROOT / "config/aws/migration-backups", config)
                template_path = config / "template.json"
                template = json.loads(template_path.read_text())
                bucket = template["Resources"]["BackupBucket"]
                if change == "expiration":
                    bucket["Properties"]["LifecycleConfiguration"]["Rules"][0]["ExpirationInDays"] = 365
                elif change == "rename":
                    bucket["Properties"]["BucketName"] = "replacement-bucket"
                elif change == "unretain":
                    bucket["DeletionPolicy"] = "Delete"
                elif change == "unlock":
                    bucket["Properties"]["ObjectLockEnabled"] = False
                else:
                    policy_path = config / "stack-policy.json"
                    policy = json.loads(policy_path.read_text())
                    policy["Statement"] = [s for s in policy["Statement"] if s["Effect"] != "Deny"]
                    policy_path.write_text(json.dumps(policy))
                template_path.write_text(json.dumps(template))
                with self.assertRaises(ValueError):
                    CHECK(root)


if __name__ == "__main__":
    unittest.main()
