"""Receipt recovery repairs stale manifests before validating their contents."""

from collections.abc import Callable
import json
from pathlib import Path
import runpy
from types import FunctionType
from typing import cast
from unittest.mock import patch


def test_receipt_recovery_repairs_incomplete_variant_manifest(tmp_path: Path) -> None:
    module = runpy.run_path(str(Path(__file__).parent / "blog/migrate-images.py"))
    function = module["migrate"]
    assert isinstance(function, FunctionType)
    migrate = cast(Callable[[Path], None], function)
    receipt = tmp_path / "receipt.json"
    variants = tmp_path / "variants.json"
    posts = tmp_path / "posts"
    posts.mkdir()
    image_path = "/blog/media/migrated/example.webp"
    receipt.write_text(json.dumps({"images": [{
        "source": "https://example.invalid/original.png", "sha256": "unused", "bytes": 1,
        "width": 10, "height": 20, "frames": 1, "durationCentiseconds": 0,
        "variants": [{"path": image_path, "width": 10, "height": 20,
                      "frames": 1, "durationCentiseconds": 0, "bytes": 1,
                      "sha256": "unused"}],
    }]}))
    variants.write_text(json.dumps({image_path: {"src": "stale.webp"}}))
    expected = {image_path: {"src": image_path, "srcset": f"{image_path} 10w",
                             "width": 10, "height": 20}}
    checked: list[bool] = []

    def check(*, allow_originals: bool = False) -> None:
        # Both recovery checks must observe a complete, repaired manifest.
        actual: object = json.loads(variants.read_text())
        assert actual == expected
        checked.append(allow_originals)

    with patch.dict(function.__globals__, {"RECEIPT": receipt, "VARIANTS": variants,
                                          "POSTS": posts, "check": check}):
        migrate(tmp_path / "unused-cache")
    assert checked == [True, False]
    assert not (tmp_path / "unused-cache").exists()
