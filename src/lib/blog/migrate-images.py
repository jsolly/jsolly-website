#!/usr/bin/env python3
"""Rehost the existing blog images. Download and verify all inputs before rewriting posts.

Requires curl, ImageMagick 7 and Inkscape for --write. --check uses only the Python standard
library and the committed SHA-256 receipts. Originals stay in the external cache;
this command does not delete or change the retained AWS resources.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[3]
POSTS = ROOT / "src/content/blog/posts"
RECEIPT = ROOT / "docs/blog-image-migration.json"
VARIANTS = ROOT / "src/lib/blog/image-variants.json"
ORIGIN = "https://d1d7p8ufhgz4ld.cloudfront.net"
HERO = re.compile(r"^image: (.+)$", re.M)
IMAGE_SRC = re.compile(r"(<img\b[^>]*?\bsrc=)([\"'])([^\"']+)(\2)", re.I)
MARKDOWN_IMAGE = re.compile(r"(!\[[^\]]*\]\()([^\s)]+)")
SIZES = (480, 960, 1440)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def authored_sources(text):
    hero = HERO.search(text)
    return ([hero[1]] if hero else []) + [match[3] for match in IMAGE_SRC.finditer(text)] + [match[2] for match in MARKDOWN_IMAGE.finditer(text)]


def dimensions(path):
    rows = run("magick", "identify", "-ping", "-format", "%w %h %n\n", str(path)).splitlines()
    width, height, frames = map(int, rows[0].split())
    if width < 1 or height < 1 or width * height > 100_000_000:
        raise ValueError(f"Invalid or excessive image canvas: {path}")
    return width, height, frames


def duration(path):
    return sum(int(value) for value in run("magick", "identify", "-format", "%T\n", str(path)).splitlines())


def webp_canvas(data):
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP" or int.from_bytes(data[4:8], "little") + 8 != len(data):
        raise ValueError("Invalid WebP container")
    canvas = None
    frames = 0
    milliseconds = 0
    offset = 12
    while offset < len(data):
        kind = data[offset:offset + 4]
        length = int.from_bytes(data[offset + 4:offset + 8], "little")
        chunk = data[offset + 8:offset + 8 + length]
        if len(chunk) != length:
            raise ValueError("Truncated WebP chunk")
        if kind == b"VP8X":
            canvas = (int.from_bytes(chunk[4:7], "little") + 1, int.from_bytes(chunk[7:10], "little") + 1)
        elif kind == b"VP8 " and canvas is None:
            canvas = (int.from_bytes(chunk[6:8], "little") & 0x3fff, int.from_bytes(chunk[8:10], "little") & 0x3fff)
        elif kind == b"VP8L" and canvas is None:
            bits = int.from_bytes(chunk[1:5], "little")
            canvas = ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        elif kind == b"ANMF":
            frames += 1
            milliseconds += int.from_bytes(chunk[12:15], "little")
        offset += 8 + length + length % 2
    if not canvas or min(canvas) < 1:
        raise ValueError("WebP has no canvas")
    return canvas, frames or 1, milliseconds


def check(allow_originals=False):
    receipt = json.loads(RECEIPT.read_text())
    variants = json.loads(VARIANTS.read_text())
    expected = {}
    for image in receipt["images"]:
        candidates = image["variants"]
        widths = [candidate["width"] for candidate in candidates]
        if widths != sorted(set(widths)) or any(width > 1440 for width in widths):
            raise ValueError(f"Invalid responsive widths: {image['source']}")
        if max(widths) != min(1440, image["width"]):
            raise ValueError(f"Missing largest candidate: {image['source']}")
        for candidate in candidates:
            path = candidate["path"]
            if not re.fullmatch(r"/blog/media/migrated/[a-z0-9-]+\.webp", path):
                raise ValueError(f"Unsafe output path: {path}")
            data = (ROOT / "public" / path[1:]).read_bytes()
            if digest(data) != candidate["sha256"] or len(data) != candidate["bytes"]:
                raise ValueError(f"Image bytes differ from receipt: {path}")
            canvas, frames, milliseconds = webp_canvas(data)
            if canvas != (candidate["width"], candidate["height"]) or frames != candidate["frames"]:
                raise ValueError(f"Output dimensions or frames differ: {path}")
            if image["frames"] > 1 and milliseconds != image["durationCentiseconds"] * 10:
                raise ValueError(f"Animation duration differs: {path}")
        fallback = next((candidate for candidate in reversed(candidates) if candidate["width"] <= 960), candidates[0])
        attributes = {
            "src": fallback["path"],
            "srcset": ", ".join(f"{candidate['path']} {candidate['width']}w" for candidate in candidates),
            "width": fallback["width"],
            "height": fallback["height"],
        }
        for candidate in candidates:
            expected[candidate["path"]] = attributes
    if expected != variants:
        raise ValueError("Runtime variant manifest differs from migration receipt")
    originals = {image["source"] for image in receipt["images"]}
    refs = 0
    for post in sorted(POSTS.glob("*.md")):
        for source in authored_sources(post.read_text()):
            if source not in variants and not (allow_originals and source in originals):
                if not source.startswith("/blog/media/") or source.startswith("/blog/media/migrated/") or ".." in source.split("/") or not (ROOT / "public" / source[1:]).is_file():
                    raise ValueError(f"Unmigrated image in {post.name}: {source}")
            refs += 1
    print(f"Verified {refs} authored references, {len(receipt['images'])} original images, {len(variants)} responsive WebPs")


def migrate(cache):
    if RECEIPT.exists():
        # A receipt is written only after all converted assets are verified.
        # Repair an interrupted authored-file rewrite from that immutable mapping.
        receipt = json.loads(RECEIPT.read_text())
        runtime = {}
        by_source = {}
        for image in receipt["images"]:
            candidates = image["variants"]
            fallback = next((candidate for candidate in reversed(candidates) if candidate["width"] <= 960), candidates[0])
            attributes = {"src": fallback["path"], "srcset": ", ".join(f"{candidate['path']} {candidate['width']}w" for candidate in candidates), "width": fallback["width"], "height": fallback["height"]}
            by_source[image["source"]] = attributes
            for candidate in candidates:
                runtime[candidate["path"]] = attributes
        if not VARIANTS.exists() or json.loads(VARIANTS.read_text()) != runtime:
            VARIANTS.write_text(json.dumps(dict(sorted(runtime.items())), indent="\t") + "\n")
        check(allow_originals=True)
        rewrite_posts({path: path.read_text() for path in sorted(POSTS.glob("*.md"))}, by_source)
        check()
        return
    posts = {path: path.read_text() for path in sorted(POSTS.glob("*.md"))}
    sources = sorted({source for text in posts.values() for source in authored_sources(text)})
    if any(not source.startswith(f"{ORIGIN}/media/") for source in sources):
        raise ValueError("Initial migration expects only the inventoried CloudFront media sources")
    cache.mkdir(parents=True, exist_ok=True)

    def download(source):
        suffix = Path(source.split("?")[0]).suffix.lower()
        path = cache / f"{digest(source.encode())}{suffix}"
        if not path.exists():
            temporary = path.with_suffix(f"{suffix}.part")
            # Inherits the session proxy and CA trust. Never accept HTTP redirects.
            final = run("curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--retry", "2", "--max-time", "60", "--max-filesize", "33554432", "--output", str(temporary), "--write-out", "%{url_effective}", quote(source, safe=":/%?=&"))
            if not final.startswith(f"{ORIGIN}/media/"):
                temporary.unlink(missing_ok=True)
                raise ValueError(f"Unexpected redirect for {source}")
            temporary.replace(path)
        return source, path

    # A failed download aborts before any post or final manifest changes.
    with ThreadPoolExecutor(max_workers=6) as pool:
        downloaded = dict(pool.map(download, sources))
    output = ROOT / "public/blog/media/migrated"
    output.mkdir(parents=True, exist_ok=True)
    images = []
    runtime = {}
    local_by_source = {}
    def convert(source):
        original = downloaded[source]
        original_digest = digest(original.read_bytes())
        conversion_input = original
        if original.suffix.lower() == ".svg":
            conversion_input = cache / f"{original_digest}.png"
            if not conversion_input.exists():
                run("inkscape", str(original), "--export-type=png", f"--export-filename={conversion_input}")
        width, height, frames = dimensions(conversion_input)
        centiseconds = duration(conversion_input)
        stem = f"image-{original_digest[:24]}"
        candidates = []
        for size in sorted({min(width, target) for target in SIZES}):
            path = output / f"{stem}-{size}.webp"
            if not path.exists():
                temporary = path.with_suffix(".tmp.webp")
                # Coalesce preserves GIF animation and per-frame delays. No crop,
                # no enlargement, and auto-orientation before aspect-preserving resize. WebP may merge duplicate frames with equivalent timing.
                run("magick", "-limit", "thread", "1", str(conversion_input), "-coalesce", "-auto-orient", "-resize", f"{size}x>", "-colorspace", "sRGB", "-strip", "-quality", "82", "-define", "webp:method=6", str(temporary))
                temporary.replace(path)
            out_width, out_height, out_frames = dimensions(path)
            if out_width != size or (frames > 1 and out_frames < 2) or duration(path) != centiseconds or abs(out_height - height * size / width) > 1:
                raise ValueError(f"Converted canvas or animation changed: {source}")
            data = path.read_bytes()
            candidates.append({"path": f"/blog/media/migrated/{path.name}", "width": out_width, "height": out_height, "frames": out_frames, "durationCentiseconds": duration(path), "bytes": len(data), "sha256": digest(data)})
        fallback = next((candidate for candidate in reversed(candidates) if candidate["width"] <= 960), candidates[0])
        attributes = {"src": fallback["path"], "srcset": ", ".join(f"{candidate['path']} {candidate['width']}w" for candidate in candidates), "width": fallback["width"], "height": fallback["height"]}
        return {"source": source, "sha256": original_digest, "bytes": original.stat().st_size, "width": width, "height": height, "frames": frames, "durationCentiseconds": centiseconds, "variants": candidates}, attributes

    # Identical source bytes share one conversion writer and one output family.
    source_hashes = {source: digest(path.read_bytes()) for source, path in downloaded.items()}
    unique = {value: source for source, value in source_hashes.items()}
    with ThreadPoolExecutor(max_workers=4) as pool:
        converted = {}
        for index, (image, attributes) in enumerate(pool.map(convert, unique.values())):
            converted[image["sha256"]] = image, attributes
            print(f"Converted {index + 1}/{len(unique)} image families", flush=True)
    for source in sources:
        image, attributes = converted[source_hashes[source]]
        local_by_source[source] = attributes
        for candidate in image["variants"]:
            runtime[candidate["path"]] = attributes
        images.append({**image, "source": source})
    receipt = {"version": 1, "converter": run("magick", "-version").splitlines()[0], "policy": "WebP quality 82, sRGB, orientation corrected, no crop or enlargement; retain animation timing; widths 480/960/1440 capped at original width", "authoredReferences": sum(len(authored_sources(text)) for text in posts.values()), "images": images}
    RECEIPT.write_text(json.dumps(receipt, indent="\t") + "\n")
    VARIANTS.write_text(json.dumps(dict(sorted(runtime.items())), indent="\t") + "\n")
    rewrite_posts(posts, local_by_source)
    check()


def rewrite_posts(posts, local_by_source):
    # Prepare the complete replacement set before changing any authored bytes.
    replacements = {}
    for path, text in posts.items():
        hero = HERO.search(text)
        if hero and hero[1] in local_by_source:
            attributes = local_by_source[hero[1]]
            text = HERO.sub(f"image: {attributes['src']}", text, count=1)
            for field in ("width", "height"):
                key = f"image{field.title()}"
                text = re.sub(rf"^{key}: .+$", f"{key}: {attributes[field]}", text, flags=re.M)
        text = IMAGE_SRC.sub(lambda match: f"{match[1]}{match[2]}{local_by_source.get(match[3], {'src': match[3]})['src']}{match[4]}", text)
        text = MARKDOWN_IMAGE.sub(lambda match: f"{match[1]}{local_by_source.get(match[2], {'src': match[2]})['src']}", text)
        replacements[path] = text
    for path, text in replacements.items():
        if path.read_text() != text:
            path.write_text(text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--write", action="store_true")
    parser.add_argument("--cache", type=Path)
    options = parser.parse_args()
    if options.check:
        check()
    else:
        if not options.cache or not options.cache.is_absolute():
            parser.error("--write requires an absolute --cache outside the repository")
        if ROOT == options.cache or ROOT in options.cache.parents:
            parser.error("keep the original-image cache outside the repository")
        migrate(options.cache)
