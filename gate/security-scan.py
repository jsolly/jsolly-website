#!/usr/bin/env python3
"""Pinned scanners shared by trusted Git hooks, Cursor and pull-request CI."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


VERSIONS = {"semgrep": "1.182.1", "zizmor": "1.31.1", "cfn-lint": "1.58.0"}
OSV_VERSION = "2.7.0"
# Gitleaks reads a .gitleaks.toml (without --config) and a .gitleaksignore (always) from the root it
# scans, so the scan passes this policy and refuses to run beside either file (REPOSITORY_GITLEAKS_FILES). This is
# GATE_GITLEAKS_POLICY in gate/gate-lib.sh (the pinned release's default rules, no ignore list);
# change both together.
GITLEAKS_POLICY = 'title = "jsolly-website gate"\n\n[extend]\nuseDefault = true\n'
REPOSITORY_GITLEAKS_FILES = (".gitleaks.toml", ".gitleaksignore")

def dependency_report(report, lock):
    """Fail on every OSV finding; repository ignore files cannot accept risk."""
    findings = blocked = 0
    for result in report["results"]:
        if result["source"]["type"] != "lockfile" or Path(result["source"]["path"]).resolve() != lock.resolve():
            raise ValueError("Unexpected OSV source")
        for entry in result["packages"]:
            package = entry["package"]
            if entry.get("groups") and not entry.get("vulnerabilities"):
                raise ValueError("OSV findings missing advisory details")
            for vulnerability in entry["vulnerabilities"]:
                advisory = vulnerability["id"]
                if not isinstance(advisory, str) or not advisory:
                    raise ValueError("Invalid OSV advisory")
                print(f"security: BLOCKED: {package['name']}@{package['version']} {advisory}", file=sys.stderr)
                findings += 1
                blocked += 1
    if blocked:
        raise ValueError(f"OSV reported {blocked} unaccepted findings")
    return findings


def dependencies(scanner, root):
    # Disable repository-supplied ignore files, even in an outgoing branch.
    with tempfile.TemporaryDirectory(prefix="website-osv-policy-") as directory:
        config = Path(directory) / "empty.toml"
        config.write_text("")
        command = [scanner, "scan", "source", "--lockfile", "package-lock.json",
                   "--config", str(config), "--all-vulns", "--format", "json"]
        print("security: " + " ".join(command), file=sys.stderr)
        result = subprocess.run(command, cwd=root, stdout=subprocess.PIPE, text=True)
        if result.returncode not in (0, 1):
            raise subprocess.CalledProcessError(result.returncode, command)
        report = json.loads(result.stdout)
        if not isinstance(report, dict) or not isinstance(report.get("results"), list):
            raise ValueError("Malformed OSV report")
        findings = dependency_report(report, root / "package-lock.json")
        if result.returncode == 1 and not findings:
            raise ValueError("OSV failed without advisory findings")


def binary(name, specification):
    """Resolve setup-installed tools for noninteractive Git clients too."""
    found = shutil.which(name)
    if found:
        return found
    candidate = Path(subprocess.check_output(
        ["mise", "which", "--tool", specification, name], cwd="/", text=True,
    ).strip())
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    raise ValueError(f"Missing {name}; run reviewed repository setup")


def run(args, root, **kwargs):
    print("security: " + " ".join(map(str, args)), file=sys.stderr)
    subprocess.run(args, cwd=root, check=True, stdout=sys.stderr, **kwargs)


def python_tool(name, args, root):
    run([binary("uvx", "uv@0.12.22"), "--from", f"{name}=={VERSIONS[name]}", name, *args], root)


def structural(root):
    python_tool("zizmor", ["--offline", ".github/workflows"], root)
    templates = sorted(str(p.relative_to(root)) for p in (root / "config/aws").rglob("template.json"))
    if templates:
        python_tool("cfn-lint", templates, root)


def source(root):
    """Required CI source scans; findings and scanner errors always fail."""
    python_tool("semgrep", ["scan", "--config", "p/default", "--error",
                           "--metrics", "off", "--disable-version-check", "--no-git-ignore",
                           # Semgrep's built-in ignore list skips tests/ and build/; scan them.
                           "--x-ignore-semgrepignore-files",
                           "--exclude", "node_modules", "--exclude", "public/notebooks",
                           "--exclude", "docs/recipes-evidence", "."], root)
    scanner = binary("osv-scanner", f"osv-scanner@{OSV_VERSION}")
    version = subprocess.check_output([scanner, "--version"], text=True)
    if not re.search(rf"\b{re.escape(OSV_VERSION)}\b", version):
        raise ValueError(f"Install osv-scanner {OSV_VERSION} with repository setup")
    dependencies(scanner, root)


def secrets(root, *args):
    """Gitleaks under the gate's own policy, never a .gitleaks.toml or .gitleaksignore in root."""
    scanner = binary("gitleaks", "gitleaks@8.24.2")
    version = subprocess.check_output([scanner, "version"], text=True)
    if version.strip().removeprefix("v") != "8.24.2":
        raise ValueError("Install repository-pinned gitleaks 8.24.2")
    found = [name for name in REPOSITORY_GITLEAKS_FILES if os.path.lexists(root / name)]
    if found:
        raise ValueError(f"Remove {' and '.join(found)}: the scan reads only the gate's own gitleaks "
                         "policy (GITLEAKS_POLICY here and in gate/gate-lib.sh)")
    with tempfile.TemporaryDirectory(prefix="website-gitleaks-policy-") as policy:
        config = Path(policy) / "gitleaks.toml"
        config.write_text(GITLEAKS_POLICY)
        run([scanner, *args, "--redact", "--no-banner", "--config", str(config)], root)


def git(root, *args):
    return subprocess.check_output(["git", "--no-replace-objects", "-C", str(root), *args])


def working_tree(root, tree):
    """Copy tracked and unignored files without following links outside the repo."""
    paths = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    for raw in set(paths.split(b"\0")) - {b""}:
        path = Path(raw.decode())
        original = root / path
        if path.is_absolute() or ".." in path.parts or original.is_symlink():
            raise ValueError("Unsafe path in security scan")
        if not original.exists():
            continue
        if not original.resolve().is_relative_to(root):
            raise ValueError("Security scan path escapes the repository")
        target = tree / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)


def cursor(root, payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("command"), str):
        raise ValueError("Malformed Cursor shell-hook input")
    with tempfile.TemporaryDirectory(prefix="website-cursor-scan-") as directory:
        tree = Path(directory)
        working_tree(root, tree)
        secrets(tree, "dir", str(tree))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("commit", "ci", "cursor"))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    try:
        if args.phase == "cursor":
            cursor(root, json.load(sys.stdin))
            print(json.dumps({"permission": "allow"}))
        elif args.phase == "commit":
            structural(root)
        else:
            secrets(root, "git", "--log-opts=--text --diff-merges=remerge --no-color --no-textconv --all")
            with tempfile.TemporaryDirectory(prefix="website-ci-scan-") as directory:
                tree = Path(directory)
                working_tree(root, tree)
                structural(tree)
                source(tree)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"security scan failed: {error}", file=sys.stderr)
        if args.phase == "cursor":
            print(json.dumps({"permission": "deny", "user_message": "Secrets scan failed. Inspect the scanner output before retrying."}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
