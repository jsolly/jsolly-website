#!/usr/bin/env python3
"""Pinned scanners shared by trusted Git hooks, Cursor and pull-request CI."""
import argparse
from datetime import datetime, date
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo


VERSIONS = {"semgrep": "1.182.1", "zizmor": "1.31.1", "cfn-lint": "1.58.0"}
OSV_VERSION = "2.7.0"

# John approved these exact dispositions in chat: deepmerge, sandbox and zod on
# 2026-10-28; glob and minimatch on 2026-10-31.
# Changing this policy changes the verified hook bundle and requires review.
DEPENDENCY_DISPOSITIONS = {
    ('deepmerge', '4.3.1'): {
        "paths": [
            "node_modules/deepmerge",
        ],
        "integrity": "sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==",
        "resolved": "https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz",
        "consumers": "f92403060bcbc4ada674a24784624493d4e96d4cbfd14ae917dc69338265e287",
        "advisories": {
            "GHSA-gcqx-w48m-w2h4": '2026-11-27',
        },
    },
    ('sandbox', '4.4.0'): {
        "paths": [
            "node_modules/sandbox",
        ],
        "integrity": "sha512-8DlAEKlHbOQmz5R05dAYE+P1wNQ44nEvAnf1jnWtF0LZWHiu/F48USSMKyY8Ib8iE1MCfo3Yvhmky8bUppLaWA==",
        "resolved": "https://registry.npmjs.org/sandbox/-/sandbox-4.4.0.tgz",
        "consumers": "3414fa7a560353ef94e74912eeba5a1307a82d0d9e9039a948409e12afc667f0",
        "advisories": {
            "GHSA-fm4j-4xhm-xpwx": None,
            "GHSA-gc25-3vc5-2jf9": None,
        },
    },
    ('zod', '3.22.4'): {
        "paths": [
            "node_modules/@vercel/backends/node_modules/zod",
            "node_modules/@vercel/express/node_modules/zod",
            "node_modules/@vercel/hono/node_modules/zod",
            "node_modules/@vercel/python-analysis/node_modules/zod",
        ],
        "integrity": "sha512-iC+8Io04lddc+mVqQ9AZ7OQ2MrUKGN+oIQyq1vemgt46jwCwLfhq7/pwnBnNXXXZb8VTVLKwp9EDkx+ryxIWmg==",
        "resolved": "https://registry.npmjs.org/zod/-/zod-3.22.4.tgz",
        "consumers": "76d1aaae6c4eb022599aaec276a37ea16cc9ad20d525ea6a953b93a1b4143ca2",
        "advisories": {
            "GHSA-mrhx-c7xc-m3w5": '2026-11-27',
        },
    },
    ('glob', '13.0.6'): {
        "paths": [
            "node_modules/glob",
        ],
        "integrity": "sha512-Wjlyrolmm8uDpm/ogGyXZXb1Z+Ca2B8NbJwqBVg0axK9GbBeoS7yGV6vjXnYdGm6X53iehEuxxbyiKp8QmN4Vw==",
        "resolved": "https://registry.npmjs.org/glob/-/glob-13.0.6.tgz",
        "consumers": "9299eab18b8f3385b2908b28e6b4e136f2475bd293ba19df2eff16a7c29461a3",
        "advisories": {
            "GHSA-3g3m-2fjr-6pw4": '2026-11-30',
        },
    },
    ('minimatch', '10.2.6'): {
        "paths": [
            "node_modules/minimatch",
        ],
        "integrity": "sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==",
        "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz",
        "consumers": "598942bc901580392de5c20a17cf92c3323e18748c669461739e7d0498bda147",
        "advisories": {
            "GHSA-g3hv-75wg-m249": '2026-11-30',
        },
    },
}


def dependency_consumers(packages, name, version):
    """Fingerprint callers that resolve this exact package, including peers."""
    consumers = []
    for path, metadata in packages.items():
        for kind in ("dependencies", "optionalDependencies", "peerDependencies"):
            requested = metadata.get(kind, {}).get(name)
            if requested is None:
                continue
            current = Path(path)
            while True:
                resolved = packages.get(str(current / "node_modules" / name))
                if resolved is not None:
                    if resolved.get("version") == version:
                        consumers.append([path, metadata.get("version"), metadata.get("integrity"), kind, requested])
                    break
                if current == Path("."):
                    break
                current = current.parent
    return hashlib.sha256(json.dumps(sorted(consumers), separators=(",", ":")).encode()).hexdigest()


def disposition(packages, name, version, advisory, today):
    policy = DEPENDENCY_DISPOSITIONS.get((name, version))
    if policy is None or advisory not in policy["advisories"]:
        return False
    expires = policy["advisories"][advisory]
    if expires and today > date.fromisoformat(expires):
        return False
    # OSV deduplicates npm aliases into the same package/version finding.
    # A new alias must not inherit an existing location/caller approval.
    for metadata in packages.values():
        for kind in ("dependencies", "optionalDependencies", "peerDependencies"):
            for requested in metadata.get(kind, {}).values():
                if isinstance(requested, str) and (requested == f"npm:{name}" or requested.startswith(f"npm:{name}@")):
                    return False
    paths = {path for path, metadata in packages.items()
             if (path.endswith("/node_modules/" + name) or path == "node_modules/" + name
                 or metadata.get("name") == name or metadata.get("resolved") == policy["resolved"])
             if metadata.get("version") == version}
    if paths != set(policy["paths"]):
        return False
    for path in paths:
        metadata = packages[path]
        if metadata.get("integrity") != policy["integrity"] or metadata.get("resolved") != policy["resolved"]:
            return False
    return dependency_consumers(packages, name, version) == policy["consumers"]


def dependency_report(report, lock, *, today=None):
    """Keep raw OSV findings visible; allow only reviewed exact identities."""
    today = today or datetime.now(ZoneInfo("America/New_York")).date()
    packages = json.loads(lock.read_text())["packages"]
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
                allowed = package["ecosystem"] == "npm" and disposition(
                    packages, package["name"], package["version"], advisory, today)
                label = "reviewed disposition" if allowed else "BLOCKED"
                print(f"security: {label}: {package['name']}@{package['version']} {advisory}", file=sys.stderr)
                findings += 1
                blocked += not allowed
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
    python_tool("semgrep", ["scan", "--config", "p/default", "--error",
                           "--metrics", "off", "--disable-version-check", "--no-git-ignore",
                           "--exclude", "node_modules", "--exclude", "public/notebooks",
                           "--exclude", "docs/recipes-evidence", "."], root)
    scanner = binary("osv-scanner", f"osv-scanner@{OSV_VERSION}")
    version = subprocess.check_output([scanner, "--version"], text=True)
    if not re.search(rf"\b{re.escape(OSV_VERSION)}\b", version):
        raise ValueError(f"Install osv-scanner {OSV_VERSION} with repository setup")
    dependencies(scanner, root)


def secrets(root, *args):
    scanner = binary("gitleaks", "gitleaks@8.24.2")
    version = subprocess.check_output([scanner, "version"], text=True)
    if version.strip().removeprefix("v") != "8.24.2":
        raise ValueError("Install repository-pinned gitleaks 8.24.2")
    run([scanner, *args, "--redact", "--no-banner"], root)


def git(root, *args):
    return subprocess.check_output(["git", "--no-replace-objects", "-C", str(root), *args])


def export_tree(root, revision, target):
    """Read Git blobs directly: export-ignore attributes must not hide code."""
    entries = []
    for record in git(root, "ls-tree", "-rz", "--full-tree", revision).split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, kind, object_id = metadata.decode().split()
        path = Path(raw_path.decode())
        if kind != "blob" or mode not in {"100644", "100755", "120000"}:
            raise ValueError("Unsupported Git tree entry; inspect submodules separately")
        if path.is_absolute() or any(part in {"..", ".git"} for part in path.parts):
            raise ValueError("Unsafe Git tree path")
        entries.append((path, object_id))
    objects = subprocess.check_output(
        ["git", "--no-replace-objects", "-C", str(root), "cat-file", "--batch"],
        input="".join(object_id + "\n" for _, object_id in entries).encode(),
    )
    stream = io.BytesIO(objects)
    for path, object_id in entries:
        header = stream.readline().decode().split()
        if len(header) != 3 or header[:2] != [object_id, "blob"]:
            raise ValueError("Git blob read failed")
        size = int(header[2])
        data = stream.read(size)
        if len(data) != size or stream.read(1) != b"\n":
            raise ValueError("Truncated Git blob")
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Symlink targets are scanned as inert text; never follow source links.
        destination.write_bytes(data)


def push(root, records):
    """Scan each exact outgoing tree, including non-HEAD and multiple refs."""
    scanned = set()
    for line in records.splitlines():
        parts = line.split()
        if len(parts) != 4 or not all(re.fullmatch(r"[0-9a-f]{40}", parts[n]) for n in (1, 3)):
            raise ValueError("Malformed pre-push ref record")
        local, remote = parts[1], parts[3]
        if local == "0" * 40:
            continue
        history = local
        if remote != "0" * 40:
            exists = subprocess.run(["git", "-C", str(root), "cat-file", "-e", remote],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if exists.returncode == 0:
                history = f"{remote}..{local}"
        secrets(root, "git", "--log-opts=--no-color --no-textconv " + history)
        if local in scanned:
            continue
        scanned.add(local)
        with tempfile.TemporaryDirectory(prefix="website-push-scan-") as directory:
            tree = Path(directory)
            export_tree(root, local, tree)
            structural(tree)
            source(tree)


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
    parser.add_argument("phase", choices=("commit", "push", "ci", "cursor"))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    try:
        if args.phase == "cursor":
            cursor(root, json.load(sys.stdin))
            print(json.dumps({"permission": "allow"}))
        elif args.phase == "push":
            push(root, sys.stdin.read())
        elif args.phase == "commit":
            structural(root)
        else:
            secrets(root, "git", "--log-opts=--no-color --no-textconv --all")
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
