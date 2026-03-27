#!/usr/bin/env python3
"""
Analyze a sample of product images to understand composition variety
before committing to a bulk crop strategy.

Runs rembg on N images and classifies each one:
  - CLEAN      : single foreground region, safe to auto-crop
  - SIDE_PANEL : two+ regions, largest clearly dominates (>60% of fg pixels)
  - AMBIGUOUS  : two+ regions with similar sizes — needs manual review
  - TINY       : very little foreground detected (mostly white / bad image)

Usage:
    python analyze_images.py              # sample 50 images
    python analyze_images.py --n 100      # sample 100
    python analyze_images.py --all        # all 1,213 (slow)
    python analyze_images.py --save-grid  # save a visual contact sheet
"""

import os
import sys
import argparse
import random
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    from rembg import remove
    import numpy as np
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run:  pip install Pillow rembg numpy")
    sys.exit(1)

IMAGE_DIR = Path(__file__).parent / "static" / "images" / "products"
REPORT_DIR = Path(__file__).parent / "static" / "images" / "_analysis"

ALPHA_THRESHOLD = 10    # below this = background
MIN_SEGMENT_PX  = 50    # ignore tiny alpha blobs narrower than this (in columns)
DOMINANT_RATIO  = 0.60  # largest region must be this fraction of total fg to be "clean"


def find_horizontal_segments(alpha_np):
    """Return list of (x_start, x_end, pixel_count) for each horizontal gap-separated region."""
    h, w = alpha_np.shape
    col_has_content = alpha_np.max(axis=0) > ALPHA_THRESHOLD
    segments = []
    in_seg = False
    seg_start = 0
    for x in range(w):
        if col_has_content[x] and not in_seg:
            in_seg = True
            seg_start = x
        elif not col_has_content[x] and in_seg:
            in_seg = False
            segments.append((seg_start, x - 1))
    if in_seg:
        segments.append((seg_start, w - 1))

    # Attach pixel counts and filter tiny blobs
    result = []
    for x1, x2 in segments:
        if (x2 - x1) < MIN_SEGMENT_PX:
            continue
        strip = alpha_np[:, x1:x2 + 1]
        px = int((strip > ALPHA_THRESHOLD).sum())
        result.append((x1, x2, px))

    return result


def classify(segments, total_fg):
    if not segments:
        return "TINY"
    if len(segments) == 1:
        return "CLEAN"
    largest_px = max(s[2] for s in segments)
    if total_fg == 0:
        return "TINY"
    ratio = largest_px / total_fg
    if ratio >= DOMINANT_RATIO:
        return "SIDE_PANEL"
    return "AMBIGUOUS"


def process_image(path: Path):
    img = Image.open(path).convert("RGBA")
    rgba = remove(img)
    alpha_np = np.array(rgba.split()[3])

    total_fg = int((alpha_np > ALPHA_THRESHOLD).sum())
    segments = find_horizontal_segments(alpha_np)
    label = classify(segments, total_fg)

    seg_summary = []
    for x1, x2, px in segments:
        pct = px / total_fg * 100 if total_fg else 0
        seg_summary.append(f"x{x1}-{x2} ({pct:.0f}%)")

    return {
        "file": path.name,
        "size": img.size,
        "total_fg_px": total_fg,
        "segments": segments,
        "seg_summary": ", ".join(seg_summary) or "none",
        "label": label,
        "rgba": rgba,
        "original": img,
    }


def save_contact_sheet(results, out_path: Path, thumb=120):
    """Save a grid of thumbnails annotated with their classification."""
    cols = 8
    rows = (len(results) + cols - 1) // cols
    pad = 4
    label_h = 18
    cell_w = thumb + pad * 2
    cell_h = thumb + pad * 2 + label_h

    COLORS = {
        "CLEAN":      "#2ecc71",
        "SIDE_PANEL": "#e67e22",
        "AMBIGUOUS":  "#e74c3c",
        "TINY":       "#95a5a6",
    }

    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "#1a1a2e")
    draw = ImageDraw.Draw(sheet)

    for i, r in enumerate(results):
        col = i % cols
        row = i // cols
        x = col * cell_w + pad
        y = row * cell_h + pad

        # Thumbnail on white background
        thumb_img = Image.new("RGB", (thumb, thumb), "white")
        orig = r["rgba"].convert("RGBA")
        orig.thumbnail((thumb, thumb), Image.LANCZOS)
        ox = (thumb - orig.width) // 2
        oy = (thumb - orig.height) // 2
        thumb_img.paste(orig, (ox, oy), mask=orig.split()[3])
        sheet.paste(thumb_img, (x, y))

        # Colored border by label
        color = COLORS.get(r["label"], "white")
        draw.rectangle([x - 2, y - 2, x + thumb + 1, y + thumb + 1], outline=color, width=2)

        # Label text
        short = r["file"].replace(".jpg", "")[-10:]
        draw.text((x, y + thumb + 2), f"{r['label'][:4]} {short}", fill=color)

    sheet.save(out_path, "PNG")
    print(f"\nContact sheet saved: {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Analyze product image composition variety")
    parser.add_argument("--n", type=int, default=50, help="Number of images to sample (default: 50)")
    parser.add_argument("--all", action="store_true", help="Process all images")
    parser.add_argument("--save-grid", action="store_true", help="Save a visual contact sheet")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for sampling")
    args = parser.parse_args()

    all_files = sorted(IMAGE_DIR.glob("*.jpg"))
    if not all_files:
        print(f"No images found in {IMAGE_DIR}")
        sys.exit(1)

    if args.all:
        files = all_files
    else:
        random.seed(args.seed)
        files = random.sample(all_files, min(args.n, len(all_files)))
        files.sort()

    total = len(files)
    print(f"\nAnalyzing {total} images from {IMAGE_DIR.name}/\n")
    print(f"  {'File':<22} {'Size':>9}  {'FG px':>7}  {'Segments':<38}  Label")
    print("  " + "-" * 90)

    counts = {"CLEAN": 0, "SIDE_PANEL": 0, "AMBIGUOUS": 0, "TINY": 0}
    results = []

    for i, f in enumerate(files, 1):
        try:
            r = process_image(f)
            results.append(r)
            counts[r["label"]] += 1
            w, h = r["size"]
            print(f"  [{i:>3}/{total}] {r['file']:<22} {w}x{h}  {r['total_fg_px']:>7}  "
                  f"{r['seg_summary']:<38}  {r['label']}")
        except Exception as e:
            print(f"  [{i:>3}/{total}] {f.name:<22} ERROR: {e}")

    # Summary
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  CLEAN      : {counts['CLEAN']:>4}  (single region — safe to auto-crop)")
    print(f"  SIDE_PANEL : {counts['SIDE_PANEL']:>4}  (extra panel removed by largest-region logic)")
    print(f"  AMBIGUOUS  : {counts['AMBIGUOUS']:>4}  (competing regions — review manually)")
    print(f"  TINY       : {counts['TINY']:>4}  (nearly blank — skip or re-download)")
    print(f"  Total      : {sum(counts.values()):>4}")

    if args.save_grid:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        out = REPORT_DIR / f"analysis_grid_{total}.png"
        save_contact_sheet(results, out)

    ambiguous = [r for r in results if r["label"] == "AMBIGUOUS"]
    if ambiguous:
        print(f"\n  AMBIGUOUS images to review manually:")
        for r in ambiguous:
            print(f"    {r['file']}  segments: {r['seg_summary']}")


if __name__ == "__main__":
    main()
