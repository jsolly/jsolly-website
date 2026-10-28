#!/usr/bin/env python3
"""Pinned scanners shared by trusted Git hooks, Cursor and pull-request CI."""
import argparse
import io
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
    run([scanner, "scan", "source", "--lockfile", "package-lock.json"], root)


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
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"security scan failed: {error}", file=sys.stderr)
        if args.phase == "cursor":
            print(json.dumps({"permission": "deny", "user_message": "Secrets scan failed. Inspect the scanner output before retrying."}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
