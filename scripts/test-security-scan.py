"""Exercise exact outgoing Git trees and fail-closed scanner boundaries."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("security-scan.py")
SPEC = importlib.util.spec_from_file_location("security_scan", SCRIPT)
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


class SecurityScan(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q")
        (self.root / "package-lock.json").write_text('{"lockfileVersion":3}')
        (self.root / "code.js").write_text("committed")
        (self.root / ".gitattributes").write_text("code.js export-ignore\n")
        self.git("add", "-A")
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "source")
        self.sha = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args],
                                       env=self.env, text=True).strip()

    def test_push_scans_committed_blobs_even_when_export_ignored_or_worktree_differs(self):
        (self.root / "code.js").write_text("different worktree")
        inspected = []

        def inspect(tree):
            inspected.append((tree / "code.js").read_text())

        record = f"refs/heads/main {self.sha} refs/heads/main {'0' * 40}\n"
        with patch.object(SCAN, "secrets") as secrets, patch.object(SCAN, "structural"), \
                patch.object(SCAN, "source", side_effect=inspect):
            SCAN.push(self.root, record + record)
        self.assertEqual(inspected, ["committed"])
        self.assertEqual(secrets.call_count, 2)

    def test_deletion_scans_no_tree_and_malformed_records_fail(self):
        with patch.object(SCAN, "source") as source:
            SCAN.push(self.root, f"(delete) {'0' * 40} refs/heads/main {self.sha}\n")
            source.assert_not_called()
        with self.assertRaises(ValueError):
            SCAN.push(self.root, "refs/heads/main shell-injection refs/heads/main 0000")

    def test_cursor_scans_untracked_files_but_not_ignored_artifacts(self):
        (self.root / ".gitignore").write_text("ignored.txt\n")
        (self.root / "new.txt").write_text("new source")
        (self.root / "ignored.txt").write_text("ignored runtime artifact")
        seen = []

        def inspect(tree, *args):
            seen.append((tree / "new.txt").read_text())
            self.assertFalse((tree / "ignored.txt").exists())

        with patch.object(SCAN, "secrets", side_effect=inspect):
            SCAN.cursor(self.root, {"command": "git commit"})
        self.assertEqual(seen, ["new source"])

    def test_cursor_denies_malformed_input_and_failed_scanner_without_secret_output(self):
        tools = self.root / "tools"
        tools.mkdir()
        executable = tools / "gitleaks"
        executable.write_text('#!/bin/sh\nif [ "$1" = version ]; then echo 8.24.2; exit 0; fi\nexit 7\n')
        executable.chmod(0o755)
        for payload in ("not json", json.dumps({"command": "git push"})):
            with self.subTest(payload=payload):
                result = subprocess.run([sys.executable, str(SCRIPT), "cursor", "--root", str(self.root)],
                                        input=payload, text=True, capture_output=True,
                                        env={**self.env, "PATH": str(tools) + os.pathsep + os.defpath})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(result.stdout)["permission"], "deny")

    def test_semgrep_failure_prevents_a_successful_source_scan(self):
        with patch.object(SCAN, "python_tool", side_effect=subprocess.CalledProcessError(1, "semgrep")), \
                patch.object(SCAN.subprocess, "check_output") as output:
            with self.assertRaises(subprocess.CalledProcessError):
                SCAN.source(self.root)
            output.assert_not_called()

    def test_noninteractive_resolution_uses_mise_executable_layout(self):
        executable = self.root / "uv-x86_64-unknown-linux-gnu" / "uvx"
        executable.parent.mkdir()
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o755)
        with patch.object(SCAN.shutil, "which", return_value=None), \
                patch.object(SCAN.subprocess, "check_output", return_value=str(executable) + "\n") as query:
            self.assertEqual(SCAN.binary("uvx", "uv@0.12.22"), str(executable))
            query.assert_called_once_with(["mise", "which", "--tool", "uv@0.12.22", "uvx"], cwd="/", text=True)


if __name__ == "__main__":
    unittest.main()
