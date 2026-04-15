#!/usr/bin/env python3
"""
UPC image tools: (1) rename view-suffix files to {upc}.jpg, (2) remove background,
tight-crop to the product, center on canvas, export high-quality JPEG on white.

Rename: extra angles (_back, _left, …) are moved to --archive-dir so nothing is lost.
The kept image is {upc}.jpg when it already exists; otherwise the best remaining angle
by priority: plain UPC > _back > _left > _right > _top > _bottom.

Process: uses rembg model isnet-general-use (good general products), JPEG 4:4:4 at
--quality (default 95). Default output is a square frame; use --no-square to keep
natural aspect ratio. Review a sample batch before overwriting production files.

The web app loads images as images/<upc>.jpg — output stays compatible.

Setup (once):
  pip install -r scripts/requirements-upc-images.txt

Examples:
  python scripts/upc_image_pipeline.py rename --images-dir public/images --dry-run
  python scripts/upc_image_pipeline.py rename --images-dir public/images
  python scripts/upc_image_pipeline.py process --images-dir public/images --out-dir public/images/processed
  python scripts/upc_image_pipeline.py process --images-dir public/images --out-dir public/images --in-place-backup public/images/_backup_pre_process
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Rename: *_back|left|right|top|bottom -> {upc}.jpg
# ---------------------------------------------------------------------------

VIEW_SUFFIXES = ("_back", "_left", "_right", "_top", "_bottom")
# Prefer the undecorated hero file when present; else a stable product-photo order.
VIEW_PRIORITY = {None: 0, "_back": 1, "_left": 2, "_right": 3, "_top": 4, "_bottom": 5}


def _parse_image_name(name: str) -> tuple[str, str | None, str] | None:
    """Return (upc, view_suffix_or_None, extension_lower) for supported files."""
    base, ext = os.path.splitext(name)
    ext_l = ext.lower()
    if ext_l not in (".jpg", ".jpeg"):
        return None
    if not re.fullmatch(r"\d+(?:_(?:back|left|right|top|bottom))?", base):
        return None
    for suf in VIEW_SUFFIXES:
        if base.endswith(suf):
            return base[: -len(suf)], suf, ext_l
    if base.isdigit():
        return base, None, ext_l
    return None


def _priority(path: Path) -> tuple[int, str]:
    parsed = _parse_image_name(path.name)
    assert parsed is not None
    _upc, view, _ext = parsed
    return (VIEW_PRIORITY[view], path.name)


def iter_rename_targets(images_dir: Path) -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = {}
    for p in images_dir.iterdir():
        if not p.is_file():
            continue
        if p.name.startswith("."):
            continue
        parsed = _parse_image_name(p.name)
        if not parsed:
            continue
        upc, _view, _ext = parsed
        groups.setdefault(upc, []).append(p)
    return groups


def cmd_rename(args: argparse.Namespace) -> int:
    images_dir: Path = args.images_dir
    if not images_dir.is_dir():
        print(f"Not a directory: {images_dir}", file=sys.stderr)
        return 1

    archive_dir: Path = args.archive_dir
    groups = iter_rename_targets(images_dir)
    plans: list[tuple[Path, Path, list[Path]]] = []

    for upc, paths in sorted(groups.items()):
        paths_sorted = sorted(paths, key=_priority)
        winner = paths_sorted[0]
        losers = paths_sorted[1:]
        target = images_dir / f"{upc}.jpg"
        # Normalize extension to .jpg for the canonical name
        if winner.name.lower() != f"{upc}.jpg":
            plans.append((winner, target, losers))
        elif losers:
            plans.append((winner, target, losers))  # winner already canonical; only archive losers
        # else: lone canonical file, nothing to do

    if args.dry_run:
        print(f"[dry-run] images_dir={images_dir} archive_dir={archive_dir}")
        n_work = 0
        for winner, target, losers in plans:
            if winner.resolve() == target.resolve() and not losers:
                continue
            n_work += 1
            upc = target.stem
            print(f"  UPC {upc}:")
            print(f"    keep: {winner.name}")
            for lp in sorted(losers, key=_priority):
                dest = archive_dir / f"{upc}__{lp.stem}{lp.suffix.lower()}"
                print(f"    archive: {lp.name} -> {dest}")
            if winner.resolve() != target.resolve():
                print(f"    rename: {winner.name} -> {target.name}")
        print(f"[dry-run] {n_work} UPC groups with work")
        return 0

    archive_dir.mkdir(parents=True, exist_ok=True)

    for winner, target, losers in plans:
        upc = target.stem
        for lp in sorted(losers, key=_priority):
            dest = archive_dir / f"{upc}__{lp.stem}{lp.suffix.lower()}"
            if dest.exists():
                raise SystemExit(f"Refusing to overwrite archive file: {dest}")
            shutil.move(str(lp), str(dest))
            print(f"Archived {lp.name} -> {dest.name}")

        if winner.resolve() != target.resolve():
            if target.exists():
                raise SystemExit(f"Target exists after archiving losers: {target}")
            shutil.move(str(winner), str(target))
            print(f"Renamed {winner.name} -> {target.name}")

    return 0


# ---------------------------------------------------------------------------
# Process: rembg + crop + square + JPEG
# ---------------------------------------------------------------------------

def _try_import_process_deps():
    import numpy as np
    from PIL import Image
    from rembg import new_session, remove

    return np, Image, new_session, remove


def _alpha_bbox(arr: "np.ndarray", alpha_threshold: int) -> tuple[int, int, int, int]:
    """Return (left, top, right, bottom) inclusive bounds of opaque pixels."""
    import numpy as np

    if arr.shape[2] < 4:
        h, w = arr.shape[:2]
        return 0, 0, w - 1, h - 1
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > alpha_threshold)
    if ys.size == 0:
        h, w = arr.shape[:2]
        return 0, 0, w - 1, h - 1
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _expand_box(
    left: int,
    top: int,
    right: int,
    bottom: int,
    pad_px: int,
    max_w: int,
    max_h: int,
) -> tuple[int, int, int, int]:
    left = max(0, left - pad_px)
    top = max(0, top - pad_px)
    right = min(max_w - 1, right + pad_px)
    bottom = min(max_h - 1, bottom + pad_px)
    return left, top, right, bottom


def _center_paste_square(rgba: "Image.Image", margin_ratio: float) -> "Image.Image":
    """Crop to alpha bbox, add margin, paste centered on square transparent canvas."""
    import numpy as np
    from PIL import Image

    arr = np.array(rgba.convert("RGBA"))
    h, w = arr.shape[:2]
    l, t, r, bt = _alpha_bbox(arr, alpha_threshold=24)
    cw, ch = r - l + 1, bt - t + 1
    pad = int(max(cw, ch) * margin_ratio)
    l, t, r, bt = _expand_box(l, t, r, bt, pad, w, h)
    cropped = rgba.crop((l, t, r + 1, bt + 1))
    cw, ch = cropped.size
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    return canvas


def _rgba_to_white_jpeg(rgba: "Image.Image") -> "Image.Image":
    from PIL import Image

    rgb = Image.new("RGB", rgba.size, (255, 255, 255))
    rgb.paste(rgba, mask=rgba.split()[3])
    return rgb


def _crop_margin_white_square(rgba: "Image.Image", margin_ratio: float) -> "Image.Image":
    """Square canvas, subject centered (default shelf look)."""
    sq = _center_paste_square(rgba, margin_ratio=margin_ratio)
    return _rgba_to_white_jpeg(sq)


def _crop_margin_white_natural(rgba: "Image.Image", margin_ratio: float) -> "Image.Image":
    """Keep aspect ratio: tight bbox + margin on white (no letterboxing)."""
    import numpy as np
    from PIL import Image

    arr = np.array(rgba.convert("RGBA"))
    h, w = arr.shape[:2]
    l, t, r, bt = _alpha_bbox(arr, alpha_threshold=24)
    cw, ch = r - l + 1, bt - t + 1
    pad = int(max(cw, ch) * margin_ratio)
    l, t, r, bt = _expand_box(l, t, r, bt, pad, w, h)
    cropped = rgba.crop((l, t, r + 1, bt + 1))
    rgb = Image.new("RGB", cropped.size, (255, 255, 255))
    rgb.paste(cropped, mask=cropped.split()[3])
    return rgb


def cmd_process(args: argparse.Namespace) -> int:
    try:
        np, Image, new_session, remove = _try_import_process_deps()
    except ImportError as e:
        print("Missing dependencies. Run: pip install -r scripts/requirements-upc-images.txt", file=sys.stderr)
        print(e, file=sys.stderr)
        return 1

    images_dir: Path = args.images_dir
    out_dir: Path = args.out_dir
    if not images_dir.is_dir():
        print(f"Not a directory: {images_dir}", file=sys.stderr)
        return 1

    backup_dir: Path | None = args.in_place_backup
    if backup_dir:
        backup_dir.mkdir(parents=True, exist_ok=True)

    out_dir.mkdir(parents=True, exist_ok=True)

    session = new_session(args.model)

    files = sorted(
        p
        for p in images_dir.iterdir()
        if p.is_file()
        and p.suffix.lower() in (".jpg", ".jpeg")
        and not p.name.startswith(".")
        and p.stem.isdigit()
    )

    if args.limit:
        files = files[: args.limit]

    try:
        from tqdm import tqdm
    except ImportError:
        tqdm = lambda x, **kw: x  # noqa: E731

    errors: list[str] = []
    for p in tqdm(files, desc="process", unit="img"):
        try:
            im = Image.open(p).convert("RGB")
            rgba = remove(im, session=session)
            if not isinstance(rgba, Image.Image):
                import io

                rgba = Image.open(io.BytesIO(rgba))
            if args.no_square:
                rgb = _crop_margin_white_natural(rgba, margin_ratio=args.margin)
            else:
                rgb = _crop_margin_white_square(rgba, margin_ratio=args.margin)
            out_path = out_dir / f"{p.stem}.jpg"
            if backup_dir and out_path.resolve() == p.resolve():
                bak = backup_dir / p.name
                if not bak.exists():
                    shutil.copy2(p, bak)
            rgb.save(
                out_path,
                "JPEG",
                quality=args.quality,
                optimize=True,
                subsampling=0,  # 4:4:4 — best for product edges
            )
        except Exception as ex:  # noqa: BLE001 — collect and report at end
            errors.append(f"{p.name}: {ex}")

    if errors:
        print("\nErrors:", file=sys.stderr)
        for e in errors[:50]:
            print(f"  {e}", file=sys.stderr)
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="UPC image rename and process pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    r = sub.add_parser("rename", help="Rename *_view.jpg files to {upc}.jpg; archive extras")
    r.add_argument("--images-dir", type=Path, default=Path("public/images"))
    r.add_argument(
        "--archive-dir",
        type=Path,
        default=Path("public/images/_upc_variant_archive"),
        help="Losers (non-chosen angles) move here as {upc}__{original_stem}.jpg",
    )
    r.add_argument("--dry-run", action="store_true")
    r.set_defaults(func=cmd_rename)

    p = sub.add_parser("process", help="Remove background, square crop, white JPEG")
    p.add_argument("--images-dir", type=Path, default=Path("public/images"))
    p.add_argument("--out-dir", type=Path, default=Path("public/images/processed"))
    p.add_argument(
        "--in-place-backup",
        type=Path,
        default=None,
        help="If --out-dir matches a source file, copy original here first",
    )
    p.add_argument(
        "--model",
        default="isnet-general-use",
        help="rembg model (default: isnet-general-use)",
    )
    p.add_argument("--margin", type=float, default=0.08, help="Extra padding around bbox, fraction of max bbox size")
    p.add_argument(
        "--no-square",
        action="store_true",
        help="Do not pad to a square; keep natural aspect on white (still cropped to subject)",
    )
    p.add_argument("--quality", type=int, default=95, help="JPEG quality 1-100")
    p.add_argument("--limit", type=int, default=0, help="Process at most N files (0=all)")
    p.set_defaults(func=cmd_process)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
