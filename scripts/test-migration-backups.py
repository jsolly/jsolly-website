"""Ensure the archive preflight rejects changes that could lose recovery data."""

from collections.abc import Callable
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from typing import cast


ROOT = Path(__file__).resolve().parents[1]
module = runpy.run_path(str(ROOT / "scripts/check-migration-backups.py"))
# runpy exposes objects dynamically; these three signatures belong to the checked
# source file above, rather than an external data or plugin boundary.
CHECK = cast(Callable[[Path], None], module["check"])
OBJECT_MAP = cast(Callable[[object], dict[str, object]], module["object_map"])
OBJECT_LIST = cast(Callable[[object], list[object]], module["object_list"])


class BackupContract(unittest.TestCase):
    def test_committed_configuration(self) -> None:
        CHECK(ROOT)

    def test_rejects_destructive_changes(self) -> None:
        for change in ("expiration", "rename", "unretain", "unlock", "unprotect"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as scratch:
                root = Path(scratch)
                config = root / "config/aws/migration-backups"
                shutil.copytree(ROOT / "config/aws/migration-backups", config)
                template_path = config / "template.json"
                template = OBJECT_MAP(json.loads(template_path.read_text()))
                bucket = OBJECT_MAP(OBJECT_MAP(template["Resources"])["BackupBucket"])
                if change == "expiration":
                    OBJECT_MAP(OBJECT_LIST(OBJECT_MAP(OBJECT_MAP(bucket["Properties"])["LifecycleConfiguration"])["Rules"])[0])["ExpirationInDays"] = 365
                elif change == "rename":
                    OBJECT_MAP(bucket["Properties"])["BucketName"] = "replacement-bucket"
                elif change == "unretain":
                    bucket["DeletionPolicy"] = "Delete"
                elif change == "unlock":
                    OBJECT_MAP(bucket["Properties"])["ObjectLockEnabled"] = False
                else:
                    policy_path = config / "stack-policy.json"
                    policy = OBJECT_MAP(json.loads(policy_path.read_text()))
                    policy["Statement"] = [s for s in OBJECT_LIST(policy["Statement"]) if OBJECT_MAP(s)["Effect"] != "Deny"]
                    policy_path.write_text(json.dumps(policy))
                template_path.write_text(json.dumps(template))
                with self.assertRaises(ValueError):
                    CHECK(root)


if __name__ == "__main__":
    unittest.main()
