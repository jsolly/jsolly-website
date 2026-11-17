"""Exercise the Cursor, CI and dependency-policy scanner boundaries, failing closed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parent.parent / "gate/security-scan.py"
SPEC = importlib.util.spec_from_file_location("security_scan", SCRIPT)
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


class SecurityScan(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        # main() resolves --root; macOS tempdirs sit behind /var -> /private/var.
        self.root = Path(self.scratch.name).resolve()
        # A hook or caller's GIT_DIR, GIT_INDEX_FILE and the like would point both the fixture's
        # git and the scanner's in-process git at another repository; patch.dict restores them.
        isolated = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        environ = patch.dict(os.environ, isolated)
        environ.start()
        self.addCleanup(environ.stop)
        for key in [key for key in os.environ if key.startswith("GIT_") and key not in isolated]:
            del os.environ[key]
        self.env = dict(os.environ)
        self.git("init", "-q")
        (self.root / "package-lock.json").write_text('{"lockfileVersion":3}')
        self.git("add", "-A")
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "source")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args],
                                       env=self.env, text=True).strip()

    def test_a_hook_environment_pointing_at_another_repository_leaves_it_untouched(self):
        decoy = self.root / "decoy"
        subprocess.check_call(["git", "init", "-q", str(decoy)], env=self.env)
        hook = {"GIT_DIR": str(decoy / ".git"), "GIT_INDEX_FILE": str(decoy / ".git/index"),
                "GIT_WORK_TREE": str(decoy)}
        with patch.dict(os.environ, hook):
            fixture = SecurityScan("test_cursor_scans_untracked_files_but_not_ignored_artifacts")
            fixture.setUp()
            try:
                self.assertEqual(fixture.git("rev-parse", "--show-toplevel"), str(fixture.root))
                self.assertEqual(fixture.git("rev-list", "--count", "HEAD"), "1")
            finally:
                fixture.doCleanups()
            # The fixture's cleanup puts the caller's variables back.
            self.assertEqual(os.environ["GIT_DIR"], hook["GIT_DIR"])
        self.assertEqual(subprocess.run(["git", "-C", str(decoy), "rev-parse", "--verify", "HEAD"],
                                        env=self.env, capture_output=True).returncode, 128)

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

    def test_secrets_scans_under_the_gate_policy_and_refuses_a_repository_policy(self):
        lib = SCRIPT.parent / "gate-lib.sh"
        shell = subprocess.check_output(
            ["bash", "-c", 'source "$1" >/dev/null && printf "%s\\n" "$GATE_GITLEAKS_POLICY"', "_", str(lib)],
            cwd=self.root, env=self.env, text=True)
        self.assertEqual(shell, SCAN.GITLEAKS_POLICY)
        seen = []

        def scanner(args, root, **kwargs):
            seen.append((Path(args[args.index("--config") + 1]).read_text(), root))

        with patch.object(SCAN, "binary", return_value="gitleaks"), \
                patch.object(SCAN.subprocess, "check_output", return_value="8.24.2\n"), \
                patch.object(SCAN, "run", side_effect=scanner):
            SCAN.secrets(self.root, "dir", str(self.root))
            self.assertEqual(seen, [(SCAN.GITLEAKS_POLICY, self.root)])
            for name in (".gitleaks.toml", ".gitleaksignore"):
                for form in ("file", "dangling symlink"):
                    with self.subTest(name=name, form=form):
                        path = self.root / name
                        if form == "file":
                            path.write_text("")
                        else:
                            path.symlink_to(self.root / "missing-policy")
                        with self.assertRaisesRegex(ValueError, "Remove " + name.replace(".", r"\.")):
                            SCAN.secrets(self.root, "dir", str(self.root))
                        path.unlink()
        self.assertEqual(len(seen), 1)

    def test_ci_scans_all_history_through_the_gate_policy_first(self):
        calls = []
        with patch.object(sys, "argv", ["security-scan.py", "ci", "--root", str(self.root)]), \
                patch.object(SCAN, "secrets", side_effect=lambda *args: calls.append(("secrets", *args))), \
                patch.object(SCAN, "working_tree", side_effect=lambda *args: calls.append(("tree",))), \
                patch.object(SCAN, "structural", side_effect=lambda *args: calls.append(("structural",))), \
                patch.object(SCAN, "source", side_effect=lambda *args: calls.append(("source",))):
            self.assertEqual(SCAN.main(), 0)
        self.assertEqual(calls[0], ("secrets", self.root, "git",
                                    "--log-opts=--text --diff-merges=remerge --no-color --no-textconv --all"))
        self.assertEqual([call[0] for call in calls[1:]], ["tree", "structural", "source"])

    def test_ci_range_scan_refuses_a_repository_policy_then_scans_under_the_gate_policy(self):
        # gate/ci-secrets-scan.sh installs gitleaks with sudo, so its scan is pinned by contract here
        # and the two helpers it calls are exercised by tests/test-repo-hooks.py.
        lines = (SCRIPT.parent / "ci-secrets-scan.sh").read_text().splitlines()
        refuse = lines.index("gate_gitleaks_refuse_repo_policy HEAD")
        scans = [number for number, line in enumerate(lines)
                 if "gitleaks " in line and not line.lstrip().startswith(("#", "sudo ", "echo "))
                 and "gate_gitleaks_refuse_repo_policy" not in line]
        self.assertEqual(len(scans), 1, scans)
        self.assertGreater(scans[0], refuse)
        self.assertTrue(lines[scans[0]].startswith("gate_gitleaks_run /usr/local/bin/gitleaks git "))
        self.assertIn('source "$ROOT/gate/gate-lib.sh"', lines[:refuse])

    def test_semgrep_failure_prevents_a_successful_source_scan(self):
        with patch.object(SCAN, "python_tool", side_effect=subprocess.CalledProcessError(1, "semgrep")), \
                patch.object(SCAN.subprocess, "check_output") as output:
            with self.assertRaises(subprocess.CalledProcessError):
                SCAN.source(self.root)
            output.assert_not_called()

    def test_semgrep_scope_is_owned_by_the_scanner_and_keeps_tests_and_build(self):
        with patch.object(SCAN, "python_tool", side_effect=subprocess.CalledProcessError(1, "semgrep")) as tool:
            with self.assertRaises(subprocess.CalledProcessError):
                SCAN.source(self.root)
        tool.assert_called_once_with("semgrep", [
            "scan", "--config", "p/default", "--error",
            "--metrics", "off", "--disable-version-check", "--no-git-ignore",
            "--x-ignore-semgrepignore-files",
            "--exclude", "node_modules", "--exclude", "public/notebooks",
            "--exclude", "docs/recipes-evidence", "."], self.root)

    def test_noninteractive_resolution_uses_mise_executable_layout(self):
        executable = self.root / "uv-x86_64-unknown-linux-gnu" / "uvx"
        executable.parent.mkdir()
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o755)
        with patch.object(SCAN.shutil, "which", return_value=None), \
                patch.object(SCAN.subprocess, "check_output", return_value=str(executable) + "\n") as query:
            self.assertEqual(SCAN.binary("uvx", "uv@0.12.22"), str(executable))
            query.assert_called_once_with(["mise", "which", "--tool", "uv@0.12.22", "uvx"], cwd="/", text=True)

    def advisory_fixture(self, name="deepmerge", version="4.3.1", advisory="GHSA-gcqx-w48m-w2h4"):
        lock = json.loads((SCRIPT.parent.parent / "package-lock.json").read_text())
        path = self.root / "package-lock.json"
        path.write_text(json.dumps(lock))
        report = {"results": [{"source": {"path": str(path), "type": "lockfile"},
                               "packages": [{"package": {"name": name, "version": version, "ecosystem": "npm"},
                                             "vulnerabilities": [{"id": advisory}]}]}]}
        return lock, path, report

    def test_every_advisory_blocks_including_retired_risk_acceptances(self):
        # These exact advisories were previously accepted. They must now fail,
        # even if a future lockfile reintroduces the original package versions.
        cases = (("deepmerge", "4.3.1", "GHSA-gcqx-w48m-w2h4"),
                 ("zod", "3.22.4", "GHSA-mrhx-c7xc-m3w5"),
                 ("glob", "13.0.6", "GHSA-3g3m-2fjr-6pw4"),
                 ("minimatch", "10.2.6", "GHSA-g3hv-75wg-m249"),
                 ("sandbox", "4.4.0", "GHSA-fm4j-4xhm-xpwx"),
                 ("sandbox", "4.4.0", "GHSA-gc25-3vc5-2jf9"),
                 ("new-package", "1.0.0", "GHSA-new-finding"))
        for name, version, advisory in cases:
            with self.subTest(name=name, advisory=advisory):
                _, path, report = self.advisory_fixture(name, version, advisory)
                with self.assertRaisesRegex(ValueError, "1 unaccepted findings"):
                    SCAN.dependency_report(report, path)

    def test_clean_report_passes_without_an_exception_policy(self):
        path = self.root / "package-lock.json"
        report = {"results": [{"source": {"path": str(path), "type": "lockfile"}, "packages": []}]}
        self.assertEqual(SCAN.dependency_report(report, path), 0)

    def test_osv_errors_and_branch_supplied_ignore_config_cannot_pass(self):
        _, _, report = self.advisory_fixture()
        (self.root / "osv-scanner.toml").write_text('[[IgnoredVulns]]\nid = "GHSA-new-finding"\n')
        def scanner(command, **kwargs):
            config = Path(command[command.index("--config") + 1])
            self.assertEqual(config.read_text(), "")
            self.assertNotEqual(config.parent, self.root)
            self.assertIn("--all-vulns", command)
            return subprocess.CompletedProcess(command, 1, json.dumps(report))
        with patch.object(SCAN.subprocess, "run", side_effect=scanner), \
                patch.object(SCAN, "dependency_report", return_value=1):
            SCAN.dependencies("osv-scanner", self.root)
        for code, output in ((1, '{"results":[]}'), (128, '{"results":[]}'),
                             (0, 'not json'), (0, '{}')):
            with self.subTest(code=code, output=output), \
                    patch.object(SCAN.subprocess, "run", return_value=subprocess.CompletedProcess([], code, output)):
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    SCAN.dependencies("osv-scanner", self.root)



if __name__ == "__main__":
    unittest.main()
