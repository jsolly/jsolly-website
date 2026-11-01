"""Exercise the Cursor, CI and dependency-policy scanner boundaries, failing closed."""
from __future__ import annotations

import importlib.util
import copy
from datetime import date
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import ModuleType
from typing import Protocol, TypedDict, TypeGuard, cast


class PackageMetadata(TypedDict, total=False):
    name: str
    version: str
    integrity: str
    resolved: str
    dependencies: dict[str, str]


class PackageLock(TypedDict):
    packages: dict[str, PackageMetadata]


class PackageIdentity(TypedDict):
    name: str
    version: str
    ecosystem: str


class Vulnerability(TypedDict):
    id: str


class PackageFinding(TypedDict):
    package: PackageIdentity
    vulnerabilities: list[Vulnerability]


class ReportSource(TypedDict):
    path: str
    type: str


class ScanResult(TypedDict):
    source: ReportSource
    packages: list[PackageFinding]


class DependencyReport(TypedDict):
    results: list[ScanResult]


class ScannerAPI(Protocol):
    """Only the checked-in scanner interfaces exercised by these offline tests.

    The runner remains outside the strict slice because it is executable code
    in the separately reviewed hook snapshot. This interface does not establish
    that the runner's implementation itself has been type checked.
    """

    subprocess: ModuleType
    shutil: ModuleType

    def cursor(self, root: Path, payload: dict[str, str]) -> None: ...
    def source(self, root: Path) -> None: ...
    def binary(self, name: str, specification: str) -> str: ...
    def dependency_report(self, report: DependencyReport, lock: Path, *, today: date | None = None) -> int: ...
    def dependencies(self, scanner: str, root: Path) -> None: ...


def is_package(value: object) -> TypeGuard[PackageMetadata]:
    if not isinstance(value, dict):
        return False
    if any(key in value and not isinstance(value[key], str)
           for key in ("name", "version", "integrity", "resolved")):
        return False
    dependencies = value.get("dependencies", {})
    return isinstance(dependencies, dict) and all(
        isinstance(key, str) and isinstance(version, str)
        for key, version in dependencies.items()
    )


def read_lock() -> PackageLock:
    value: object = json.loads((SCRIPT.parent.parent / "package-lock.json").read_text())
    if (not isinstance(value, dict) or not isinstance(value.get("packages"), dict)
            or not all(isinstance(path, str) and is_package(metadata)
                       for path, metadata in value["packages"].items())):
        raise ValueError("Invalid package-lock fixture shape")
    return cast(PackageLock, value)


SCRIPT = Path(__file__).with_name("security-scan.py")
SPEC = importlib.util.spec_from_file_location("security_scan", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load the checked-in scanner test target")
SCANNER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCANNER_MODULE)
# The file and exported signatures are repository-owned and inspected above.
SCAN = cast(ScannerAPI, SCANNER_MODULE)


class SecurityScan(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        # main() resolves --root; macOS tempdirs sit behind /var -> /private/var.
        self.root = Path(self.scratch.name).resolve()
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q")
        (self.root / "package-lock.json").write_text('{"lockfileVersion":3}')
        self.git("add", "-A")
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "source")

    def git(self, *args: str) -> str:
        return subprocess.check_output(["git", "-C", str(self.root), *args],
                                       env=self.env, text=True).strip()

    def test_cursor_scans_untracked_files_but_not_ignored_artifacts(self) -> None:
        (self.root / ".gitignore").write_text("ignored.txt\n")
        (self.root / "new.txt").write_text("new source")
        (self.root / "ignored.txt").write_text("ignored runtime artifact")
        seen: list[str] = []

        def inspect(tree: Path, *args: str) -> None:
            seen.append((tree / "new.txt").read_text())
            self.assertFalse((tree / "ignored.txt").exists())

        with patch.object(SCAN, "secrets", side_effect=inspect):
            SCAN.cursor(self.root, {"command": "git commit"})
        self.assertEqual(seen, ["new source"])

    def test_cursor_denies_malformed_input_and_failed_scanner_without_secret_output(self) -> None:
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

    def test_semgrep_failure_prevents_a_successful_source_scan(self) -> None:
        with patch.object(SCAN, "python_tool", side_effect=subprocess.CalledProcessError(1, "semgrep")), \
                patch.object(SCAN.subprocess, "check_output") as output:
            with self.assertRaises(subprocess.CalledProcessError):
                SCAN.source(self.root)
            output.assert_not_called()

    def test_noninteractive_resolution_uses_mise_executable_layout(self) -> None:
        executable = self.root / "uv-x86_64-unknown-linux-gnu" / "uvx"
        executable.parent.mkdir()
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o755)
        with patch.object(SCAN.shutil, "which", return_value=None), \
                patch.object(SCAN.subprocess, "check_output", return_value=str(executable) + "\n") as query:
            self.assertEqual(SCAN.binary("uvx", "uv@0.12.22"), str(executable))
            query.assert_called_once_with(["mise", "which", "--tool", "uv@0.12.22", "uvx"], cwd="/", text=True)

    def advisory_fixture(self, name: str = "deepmerge", version: str = "4.3.1", advisory: str = "GHSA-gcqx-w48m-w2h4") -> tuple[PackageLock, Path, DependencyReport]:
        lock = read_lock()
        path = self.root / "package-lock.json"
        path.write_text(json.dumps(lock))
        report: DependencyReport = {"results": [{"source": {"path": str(path), "type": "lockfile"},
                               "packages": [{"package": {"name": name, "version": version, "ecosystem": "npm"},
                                             "vulnerabilities": [{"id": advisory}]}]}]}
        return lock, path, report

    def test_approved_findings_expire_after_november_27_inclusive(self) -> None:
        for name, version, advisory in (("deepmerge", "4.3.1", "GHSA-gcqx-w48m-w2h4"),
                                        ("zod", "3.22.4", "GHSA-mrhx-c7xc-m3w5")):
            _, path, report = self.advisory_fixture(name, version, advisory)
            self.assertEqual(SCAN.dependency_report(report, path, today=date(2026, 11, 27)), 1)
            with self.assertRaises(ValueError):
                SCAN.dependency_report(report, path, today=date(2026, 11, 28))

    def test_vercel_cli_glob_and_minimatch_findings_expire_after_november_30_inclusive(self) -> None:
        for name, version, advisory in (("glob", "13.0.6", "GHSA-3g3m-2fjr-6pw4"),
                                        ("minimatch", "10.2.6", "GHSA-g3hv-75wg-m249")):
            with self.subTest(name=name):
                _, path, report = self.advisory_fixture(name, version, advisory)
                self.assertEqual(SCAN.dependency_report(report, path, today=date(2026, 11, 30)), 1)
                with self.assertRaises(ValueError):
                    SCAN.dependency_report(report, path, today=date(2026, 12, 1))

    def test_sandbox_disposition_never_covers_the_old_project_or_other_advisories(self) -> None:
        _, path, report = self.advisory_fixture("sandbox", "4.4.0", "GHSA-fm4j-4xhm-xpwx")
        self.assertEqual(SCAN.dependency_report(report, path, today=date(2027, 1, 1)), 1)
        for version, advisory in (("0.8.2", "GHSA-fm4j-4xhm-xpwx"), ("4.4.0", "GHSA-new-finding")):
            _, path, report = self.advisory_fixture("sandbox", version, advisory)
            with self.assertRaises(ValueError):
                SCAN.dependency_report(report, path, today=date(2026, 10, 28))

    def test_identity_path_and_consumer_drift_block_existing_dispositions(self) -> None:
        original, path, report = self.advisory_fixture()
        for mutation in ("integrity", "resolved", "path", "caller", "new-caller"):
            with self.subTest(mutation=mutation):
                lock = copy.deepcopy(original)
                packages = lock["packages"]
                if mutation == "integrity":
                    packages["node_modules/deepmerge"]["integrity"] = "changed"
                elif mutation == "resolved":
                    packages["node_modules/deepmerge"]["resolved"] = "changed"
                elif mutation == "path":
                    packages["node_modules/new/node_modules/deepmerge"] = packages["node_modules/deepmerge"].copy()
                elif mutation == "caller":
                    packages["node_modules/@sveltejs/vite-plugin-svelte"]["version"] = "99.0.0"
                else:
                    packages["node_modules/new"] = {"version": "1.0.0", "dependencies": {"deepmerge": "4.3.1"}}
                path.write_text(json.dumps(lock))
                with self.assertRaises(ValueError):
                    SCAN.dependency_report(report, path, today=date(2026, 10, 28))

    def test_osv_errors_and_branch_supplied_ignore_config_cannot_pass(self) -> None:
        _, _, report = self.advisory_fixture()
        (self.root / "osv-scanner.toml").write_text('[[IgnoredVulns]]\nid = "GHSA-new-finding"\n')
        def scanner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
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

    def test_npm_aliases_cannot_inherit_a_deduplicated_osv_disposition(self) -> None:
        original, path, report = self.advisory_fixture("zod", "3.22.4", "GHSA-mrhx-c7xc-m3w5")
        for include_name, include_declaration in ((True, True), (False, True), (True, False), (False, False)):
            with self.subTest(include_name=include_name, include_declaration=include_declaration):
                lock = copy.deepcopy(original)
                metadata = lock["packages"]["node_modules/@vercel/backends/node_modules/zod"].copy()
                if include_name:
                    metadata["name"] = "zod"
                lock["packages"]["node_modules/review-zod-alias"] = metadata
                if include_declaration:
                    lock["packages"][""]["dependencies"]["review-zod-alias"] = "npm:zod@3.22.4"
                path.write_text(json.dumps(lock))
                with self.assertRaises(ValueError):
                    SCAN.dependency_report(report, path, today=date(2026, 10, 28))


if __name__ == "__main__":
    unittest.main()
