#!/usr/bin/env python3
"""
Crop product images: isolate the product with a transparent background.

Outputs square PNG files with full transparency — no white padding, no canvas
fill — so products sit cleanly on any dark or coloured app background.

Algorithm (--rembg mode, recommended):
  1. rembg (U2-Net AI) removes background -> RGBA alpha mask
  2. Largest-region + shape-CV logic discards side label panels
  3. Tight crop to alpha bounding box (zero padding by default)
  4. Resize to square transparent PNG — product centred, no fill

Algorithm (whitespace mode, fallback):
  1. Diff against pure white, boost contrast to handle JPEG artifacts
  2. Crop to bounding box, save as transparent PNG

Usage:
    python crop_images.py                         # Dry run — no writes
    python crop_images.py --apply --rembg         # AI isolation -> transparent PNG
    python crop_images.py --apply                 # Whitespace trim -> transparent PNG
    python crop_images.py --apply --out-dir cropped   # Save to separate folder
    python crop_images.py --apply --size 400      # 400x400 output canvas
    python crop_images.py --upc 0001111034302 --apply --rembg  # Single image test
"""

import os
import sys
import argparse
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image, ImageChops, ImageEnhance
except ImportError:
    print("ERROR: Pillow not installed. Run:  pip install Pillow")
    sys.exit(1)

IMAGE_DIR = Path(__file__).parent / "static" / "images" / "products"
BACKUP_DIR = Path(__file__).parent / "static" / "images" / "products_original"

DEFAULT_SIZE = 400       # Output canvas size in pixels (square)
DEFAULT_PADDING = 0      # No padding — product fills the crop tightly
DEFAULT_THRESHOLD = 235  # 0–255; pixels brighter than this on all channels = background
DIFF_BOOST = 8           # Amplify the white-diff to catch near-white pixels


def crop_whitespace(img: Image.Image, threshold: int, padding: int) -> Image.Image:
    """
    Remove white/near-white border from a PIL Image.
    Returns the cropped image (original if no crop is detected).
    """
    rgb = img.convert("RGB")

    # Build a pure-white reference the same size, then diff against it
    white_ref = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white_ref)

    # Boost contrast so JPEG-compressed near-white edges become visible
    diff = ImageEnhance.Brightness(diff).enhance(DIFF_BOOST)

    # Threshold: keep only pixels that differ enough from white
    diff_gray = diff.convert("L")
    mask = diff_gray.point(lambda p: 255 if p > (255 - threshold) else 0)

    bbox = mask.getbbox()
    if not bbox:
        return img  # Image is entirely white — return as-is

    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(rgb.width, x2 + padding)
    y2 = min(rgb.height, y2 + padding)

    return rgb.crop((x1, y1, x2, y2))


def flood_fill_remove_bg(img: Image.Image, threshold: int = 240) -> Image.Image:
    """
    Remove background by flood-filling outward from every edge pixel.

    Works by finding all near-white pixels (all channels >= threshold) that are
    reachable from the image border, then marking them transparent. Pixels inside
    the product body are never reached — even if they are white (e.g. a white
    label surrounded by a coloured bottle body) — because the product body blocks
    the flood-fill path.

    Returns an RGBA image with the background transparent.
    """
    import numpy as np
    from scipy import ndimage

    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]

    # Near-white mask: every channel must be >= threshold
    near_white = np.all(arr >= threshold, axis=2)

    # Label connected near-white regions
    labeled, _ = ndimage.label(near_white)

    # Collect labels that touch any edge pixel
    edge_labels: set[int] = set()
    edge_labels.update(int(l) for l in labeled[0, :])       # top row
    edge_labels.update(int(l) for l in labeled[h - 1, :])   # bottom row
    edge_labels.update(int(l) for l in labeled[:, 0])       # left col
    edge_labels.update(int(l) for l in labeled[:, w - 1])   # right col
    edge_labels.discard(0)  # 0 = non-white pixels in labeled array

    if edge_labels:
        bg_mask = np.isin(labeled, list(edge_labels))
    else:
        bg_mask = np.zeros((h, w), dtype=bool)

    alpha = (~bg_mask).astype(np.uint8) * 255
    rgba = img.convert("RGBA")
    rgba.putalpha(Image.fromarray(alpha))
    return rgba


def _largest_connected_bbox(alpha_np) -> tuple | None:
    """
    Find the bounding box of the best foreground region in an alpha mask.

    Strategy (in priority order):
      1. Single region  -> use it.
      2. One region has >60% of fg pixels -> it clearly dominates, use it.
      3. Ambiguous (roughly equal sizes) -> use the region with the highest
         shape CV (coefficient of variation of column sums). A round product
         (bottle, jar) produces a bell-curve alpha profile -> high CV.
         A flat rectangular label panel produces a uniform profile -> low CV.
         If CVs are tied, prefer the leftmost region (retail photo convention:
         main product is typically on the left).
    """
    import numpy as np

    h, w = alpha_np.shape
    threshold = 10
    min_seg_cols = 30  # ignore blobs narrower than this

    # --- Split horizontally at zero-alpha column gaps ---
    col_has_content = alpha_np.max(axis=0) > threshold
    raw_segs: list[tuple[int, int]] = []
    in_seg, seg_start = False, 0
    for x in range(w):
        if col_has_content[x] and not in_seg:
            in_seg, seg_start = True, x
        elif not col_has_content[x] and in_seg:
            in_seg = False
            if (x - 1 - seg_start) >= min_seg_cols:
                raw_segs.append((seg_start, x - 1))
    if in_seg and (w - 1 - seg_start) >= min_seg_cols:
        raw_segs.append((seg_start, w - 1))

    if not raw_segs:
        return None

    def seg_metrics(x1, x2):
        strip = alpha_np[:, x1: x2 + 1]
        col_sums = (strip > threshold).sum(axis=0).astype(float)
        total = float(col_sums.sum())
        mean = col_sums.mean()
        cv = float(col_sums.std() / mean) if mean > 0 else 0.0
        return total, cv

    segs = [(x1, x2, *seg_metrics(x1, x2)) for x1, x2 in raw_segs]
    # segs items: (x1, x2, pixel_count, shape_cv)

    if len(segs) == 1:
        x1, x2 = segs[0][0], segs[0][1]
    else:
        total_px = sum(s[2] for s in segs)

        # Rule 1: one region clearly dominates (>60% of fg pixels)
        dominant = [s for s in segs if s[2] / total_px >= 0.60]
        if dominant:
            best = max(dominant, key=lambda s: s[2])
        else:
            # Rule 2: most organic shape (highest CV) — bottle vs. rectangular panel
            max_cv = max(s[3] for s in segs)
            organic = [s for s in segs if s[3] >= max_cv * 0.80]
            # Rule 3: if still tied, prefer leftmost (retail photo convention)
            best = min(organic, key=lambda s: s[0])

        x1, x2 = best[0], best[1]

    # --- Find vertical bounds within chosen x range ---
    col_strip = alpha_np[:, x1: x2 + 1]
    row_has_content = col_strip.max(axis=1) > threshold
    ys = [y for y in range(h) if row_has_content[y]]
    if not ys:
        return None

    return (x1, ys[0], x2 + 1, ys[-1] + 1)


def crop_rembg(img: Image.Image, padding: int) -> Image.Image:
    """
    Isolate the product with a transparent background using a two-stage strategy:

    Stage 1 — AI (rembg / U2-Net):
      Runs the neural net to remove the background. Works well on coloured or
      complex backgrounds and cleanly separates multi-region compositions
      (bottle + side label).

    Stage 2 — Flood-fill fallback (automatic):
      If rembg keeps >80% of pixels as foreground (model failed to find the
      background) or removes >85% (over-aggressively cut the product), we fall
      back to flood_fill_remove_bg which traces connected near-white regions
      from every edge pixel outward. Reliable for white/near-white studio
      backgrounds regardless of AI model behaviour.

    Both paths then apply the largest-connected-region logic to discard any
    remaining side label panels before the final tight crop.
    """
    try:
        from rembg import remove
        import numpy as np
    except ImportError:
        print("  [rembg not installed]  Falling back to flood-fill.")
        rgba = flood_fill_remove_bg(img)
        alpha_np = np.array(rgba.split()[3])
        bbox = _largest_connected_bbox(alpha_np) or rgba.split()[3].getbbox()
        if not bbox:
            return img.convert("RGBA")
        return rgba.crop(bbox)

    import numpy as np

    rgba = remove(img.convert("RGBA"))
    alpha_np = np.array(rgba.split()[3])
    fg_ratio = float((alpha_np > 10).sum()) / alpha_np.size

    if fg_ratio > 0.80 or fg_ratio < 0.15:
        # rembg failed — too much or too little foreground detected
        rgba = flood_fill_remove_bg(img)
        alpha_np = np.array(rgba.split()[3])

    # Largest-connected-region: discard side label panels
    bbox = _largest_connected_bbox(alpha_np)
    if not bbox:
        bbox = rgba.split()[3].getbbox()
    if not bbox:
        return img.convert("RGBA")

    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(rgba.width, x2 + padding)
    y2 = min(rgba.height, y2 + padding)

    return rgba.crop((x1, y1, x2, y2))


def to_square_canvas(img: Image.Image, size: int) -> Image.Image:
    """
    Resize the cropped product into a square transparent canvas,
    centred, preserving aspect ratio. Output is always RGBA.
    """
    rgba = img.convert("RGBA")
    rgba.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))  # fully transparent
    x_off = (size - rgba.width) // 2
    y_off = (size - rgba.height) // 2
    canvas.paste(rgba, (x_off, y_off), mask=rgba.split()[3])
    return canvas


def process_image(
    path: Path,
    out_path: Path,
    size: int,
    padding: int,
    threshold: int,
    use_rembg: bool,
    apply: bool,
    backup: bool,
) -> dict:
    """Process one image file. Returns a result dict."""
    result = {"file": path.name, "status": "ok", "note": ""}
    try:
        img = Image.open(path)
        orig_size = img.size

        if use_rembg:
            cropped = crop_rembg(img, padding)
        else:
            cropped = crop_whitespace(img, threshold, padding)

        final = to_square_canvas(cropped, size)

        crop_w = cropped.width
        crop_h = cropped.height
        result["note"] = (
            f"{orig_size[0]}x{orig_size[1]} -> crop {crop_w}x{crop_h} -> {size}x{size}"
        )

        if apply:
            png_path = out_path.with_suffix(".png")
            if backup and png_path.parent == path.parent:
                BACKUP_DIR.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, BACKUP_DIR / path.name)
            png_path.parent.mkdir(parents=True, exist_ok=True)
            final.save(png_path, "PNG", optimize=True)

    except Exception as exc:
        result["status"] = "error"
        result["note"] = str(exc)

    return result


def main():
    parser = argparse.ArgumentParser(description="Crop product images to remove whitespace")
    parser.add_argument("--apply", action="store_true",
                        help="Write cropped files (default: dry run, no writes)")
    parser.add_argument("--out-dir", type=str, default="",
                        help="Save cropped images here instead of overwriting originals")
    parser.add_argument("--size", type=int, default=DEFAULT_SIZE,
                        help=f"Output canvas size in px (default: {DEFAULT_SIZE})")
    parser.add_argument("--padding", type=int, default=DEFAULT_PADDING,
                        help=f"Pixels of padding around product (default: {DEFAULT_PADDING})")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD,
                        help=f"White detection threshold 0-255 (default: {DEFAULT_THRESHOLD}; "
                             "lower = stricter, higher = more aggressive trim)")
    parser.add_argument("--rembg", action="store_true",
                        help="Use AI background removal (requires: pip install rembg). "
                             "Slower but works on non-white backgrounds.")
    parser.add_argument("--upc", type=str, default="",
                        help="Process a single UPC only (for testing)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel worker threads (default: 4; ignored with --rembg)")
    parser.add_argument("--no-backup", action="store_true",
                        help="Skip backing up originals when overwriting in place")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only the first N images (for testing)")
    args = parser.parse_args()

    if not IMAGE_DIR.exists():
        print(f"ERROR: Image directory not found: {IMAGE_DIR}")
        sys.exit(1)

    out_dir = Path(args.out_dir) if args.out_dir else None

    # Collect files to process
    if args.upc:
        files = [IMAGE_DIR / f"{args.upc}.jpg"]
        files = [f for f in files if f.exists()]
        if not files:
            print(f"No image found for UPC {args.upc} in {IMAGE_DIR}")
            sys.exit(1)
    else:
        files = sorted(IMAGE_DIR.glob("*.jpg"))
        if args.limit > 0:
            files = files[: args.limit]

    total = len(files)
    mode = "APPLY" if args.apply else "DRY RUN"
    dest = str(out_dir) if out_dir else "in place"
    backup_note = "" if args.no_backup or out_dir else f" (originals -> {BACKUP_DIR.name}/)"

    print("=" * 56)
    print(f"  PRODUCT IMAGE CROP  [{mode}]")
    print("=" * 56)
    print(f"  Images     : {total}")
    print(f"  Output     : {dest}{backup_note}")
    print(f"  Canvas     : {args.size}×{args.size} px")
    print(f"  Padding    : {args.padding} px")
    print(f"  Threshold  : {args.threshold}")
    print(f"  Method     : {'rembg (AI)' if args.rembg else 'whitespace diff'}")
    print(f"  Workers    : {1 if args.rembg else args.workers}")
    if not args.apply:
        print()
        print("  NOTE: This is a dry run. Pass --apply to save files.")
    print()

    ok = errors = 0

    def build_out_path(src: Path) -> Path:
        return (out_dir / src.name) if out_dir else src

    def run_one(f):
        return process_image(
            path=f,
            out_path=build_out_path(f),
            size=args.size,
            padding=args.padding,
            threshold=args.threshold,
            use_rembg=args.rembg,
            apply=args.apply,
            backup=not args.no_backup,
        )

    # rembg is not thread-safe for model loading; use single thread
    workers = 1 if args.rembg else args.workers

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(run_one, f): f for f in files}
        done = 0
        for fut in as_completed(futures):
            done += 1
            res = fut.result()
            status_icon = "OK" if res["status"] == "ok" else "!!"
            print(f"  [{done:>4}/{total}] {status_icon} {res['file']}  {res['note']}")
            if res["status"] == "ok":
                ok += 1
            else:
                errors += 1

    print()
    print("=" * 56)
    print(f"  Done — OK: {ok}  Errors: {errors}")
    if not args.apply:
        print("  No files written (dry run). Add --apply to save.")
    print("=" * 56)


if __name__ == "__main__":
    main()
