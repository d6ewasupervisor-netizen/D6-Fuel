#!/usr/bin/env python3
"""
Extract product images from Kroger planogram PDFs.

Kroger bay-detail pages embed small product thumbnails (~30x60px) in a
shelf diagram on the right side of each page. This script:

1. Parses ALL pages to build a complete bay/shelf/position/UPC map
2. Identifies which pages contain bay diagrams (right-side image grids)
3. Groups diagram images into shelf rows by Y coordinate
4. Deduplicates facings (same xref placed N times side-by-side)
5. Correlates shelf-row image order with product-table position order
6. Saves matched images as {upc}.jpg (upscaled 4x with Lanczos)

Usage:
    python extract_pdf_images.py path/to/planogram.pdf
    python extract_pdf_images.py path/to/*.pdf --only-missing
    python extract_pdf_images.py path/to/*.pdf --output ./extracted --upscale 6
"""

import os
import re
import sys
import glob
import argparse
from collections import defaultdict
from io import BytesIO

try:
    import fitz  # PyMuPDF
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyMuPDF"])
    import fitz

try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image


# ── Configuration ─────────────────────────────────────────────────────
# UPCs that are known to be missing product images.
# Update this set as needed; pass --all-upcs to ignore it.
MISSING_UPCS = {
    "0002188830231", "0003367415940", "0004126002608", "0004126002659",
    "0004746908541", "0009070003379", "0070587580218", "0070619510606",
    "0070619510607", "0070619510610", "0070619517049", "0073373901283",
    "0081012666067", "0081012666129", "0081012666196", "0081012666199",
    "0081012666245", "0081012666272", "0081012666296", "0081012666308",
    "0081012666310", "0081012666315", "0081859401546", "0084009312863",
    "0084009312867", "0084009312920", "0085005976768", "0085006858575",
    "0085007479028", "0085664500847", "0086000455530", "0086000455532",
    "0542501039183",
}

EXISTING_IMAGES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "static", "images", "products"
)


# ── Helpers ───────────────────────────────────────────────────────────

def extract_pil(doc, xref):
    """Extract a PDF image xref as a PIL Image (RGB)."""
    try:
        pix = fitz.Pixmap(doc, xref)
        if pix.n - pix.alpha > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        if pix.alpha:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        return Image.open(BytesIO(pix.tobytes("png")))
    except Exception:
        return None


def save_jpg(img, path, upscale=4, quality=92):
    """Upscale + save as white-background JPG."""
    if upscale > 1:
        w, h = img.size
        img = img.resize((w * upscale, h * upscale), Image.LANCZOS)
    if img.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.save(path, "JPEG", quality=quality, optimize=True)


# ── PDF Parsing ───────────────────────────────────────────────────────

def parse_all_products(doc):
    """
    Walk every page, tracking current Bay and Shelf headers.
    Return list of {bay, shelf, pos, upc} for every product record.
    """
    products = []
    cur_bay = None
    cur_shelf = None

    for pg_idx in range(len(doc)):
        lines = [l.strip() for l in doc[pg_idx].get_text().split("\n")]

        for i, line in enumerate(lines):
            # Bay header: "Bay 3  -  4 ft wide"
            bm = re.match(r"Bay\s+(\d+)\s+-\s+\d+\s+ft", line)
            if bm:
                cur_bay = int(bm.group(1))
                continue

            # Shelf header: "Shelf 5  -  37.00 inches from Base Shelf"
            sm = re.match(r"Shelf\s+(\d+)\s+-\s+[\d.]+\s+inches", line)
            if sm:
                cur_shelf = int(sm.group(1))
                continue

            # UPC: exactly 13 digits alone on a line
            if re.match(r"^\d{13}$", line) and cur_bay and cur_shelf:
                pos = None
                for j in range(i - 1, max(i - 4, 0), -1):
                    if re.match(r"^\d{1,2}$", lines[j]):
                        pos = int(lines[j])
                        break
                products.append({
                    "bay": cur_bay,
                    "shelf": cur_shelf,
                    "pos": pos,
                    "upc": line,
                })

    return products


def find_bay_diagram_pages(doc):
    """
    Return {bay_number: page_index} for each bay's first diagram page.
    A diagram page has "Bay # N of M" text and >10 images on the right.
    """
    bay_pages = {}
    for pg_idx in range(len(doc)):
        text = doc[pg_idx].get_text()
        m = re.search(r"Bay\s*#?\s*(\d+)\s+of\s+\d+", text)
        if not m:
            continue
        bay_num = int(m.group(1))
        if bay_num in bay_pages:
            continue
        imgs = doc[pg_idx].get_image_info()
        right_count = sum(
            1 for im in imgs if im["bbox"][0] > 400 and im["width"] >= 12
        )
        if right_count > 10:
            bay_pages[bay_num] = pg_idx
    return bay_pages


def extract_shelf_rows(page):
    """
    From a bay diagram page, extract product images grouped by shelf row.
    Returns {y_center: [deduped image info dicts]} sorted top to bottom.
    """
    pw = page.rect.width
    all_imgs = page.get_image_info(xrefs=True)

    product_imgs = [
        i for i in all_imgs
        if i["bbox"][0] > pw * 0.55
        and i["width"] >= 12
        and i["height"] >= 18
        and i["bbox"][1] > 80
        and (i["bbox"][3] - i["bbox"][1]) > 12
    ]

    rows = defaultdict(list)
    for img in product_imgs:
        y = (img["bbox"][1] + img["bbox"][3]) / 2
        placed = False
        for ry in list(rows.keys()):
            if abs(y - ry) < 18:
                rows[ry].append(img)
                placed = True
                break
        if not placed:
            rows[y].append(img)

    result = {}
    for y in sorted(rows.keys()):
        imgs = sorted(rows[y], key=lambda i: i["bbox"][0])
        deduped = []
        last_xref = None
        for img in imgs:
            if img["xref"] != last_xref:
                deduped.append(img)
            last_xref = img["xref"]
        result[y] = deduped

    return result


# ── Main Extraction ───────────────────────────────────────────────────

def process_pdf(pdf_path, output_dir, only_missing=False, upscale=4):
    """Process one planogram PDF.  Returns {upc: output_path}."""
    doc = fitz.open(pdf_path)
    name = os.path.basename(pdf_path)
    print(f"\n{'─'*60}")
    print(f"  {name}  ({doc.page_count} pages)")
    print(f"{'─'*60}")

    all_products = parse_all_products(doc)
    if not all_products:
        print("  No product records found.")
        doc.close()
        return {}

    bay_shelf_prods = defaultdict(lambda: defaultdict(list))
    for p in all_products:
        bay_shelf_prods[p["bay"]][p["shelf"]].append(p)
    for b in bay_shelf_prods:
        for s in bay_shelf_prods[b]:
            bay_shelf_prods[b][s].sort(key=lambda x: x["pos"] or 0)

    bays = sorted(bay_shelf_prods.keys())
    print(f"  {len(all_products)} products across {len(bays)} bays")

    bay_pages = find_bay_diagram_pages(doc)
    print(f"  {len(bay_pages)} bay diagrams detected")

    extracted = {}
    matched = skipped = failed = 0

    for bay_num in sorted(bay_pages.keys()):
        pg_idx = bay_pages[bay_num]
        page = doc[pg_idx]
        shelf_rows = extract_shelf_rows(page)
        sorted_ys = sorted(shelf_rows.keys())

        shelves_desc = sorted(bay_shelf_prods[bay_num].keys(), reverse=True)
        n_match = min(len(shelves_desc), len(sorted_ys))

        for i in range(n_match):
            shelf_num = shelves_desc[i]
            y = sorted_ys[i]
            prods = bay_shelf_prods[bay_num][shelf_num]
            imgs = shelf_rows[y]

            for j in range(min(len(prods), len(imgs))):
                upc = prods[j]["upc"]

                if only_missing and upc not in MISSING_UPCS:
                    skipped += 1
                    continue
                if only_missing and os.path.isdir(EXISTING_IMAGES_DIR):
                    if os.path.isfile(
                        os.path.join(EXISTING_IMAGES_DIR, f"{upc}.jpg")
                    ):
                        skipped += 1
                        continue
                if upc in extracted:
                    skipped += 1
                    continue

                pil = extract_pil(doc, imgs[j]["xref"])
                if not pil:
                    failed += 1
                    continue

                w, h = pil.size
                out_path = os.path.join(output_dir, f"{upc}.jpg")
                try:
                    save_jpg(pil, out_path, upscale=upscale)
                    extracted[upc] = out_path
                    matched += 1
                    print(
                        f"    ✓ {upc}  B{bay_num} S{shelf_num} "
                        f"P{prods[j]['pos']}  {w}x{h}→{w*upscale}x{h*upscale}"
                    )
                except Exception as e:
                    failed += 1
                    print(f"    ✗ {upc}: {e}")

    doc.close()
    print(f"  ── {matched} extracted, {skipped} skipped, {failed} failed")
    return extracted


def main():
    ap = argparse.ArgumentParser(
        description="Extract product images from Kroger planogram PDFs"
    )
    ap.add_argument("pdf", nargs="+", help="PDF file(s) or glob patterns")
    ap.add_argument("--output", default="./pdf_extracted_images")
    ap.add_argument("--only-missing", action="store_true",
                    help="Only extract UPCs in MISSING_UPCS set")
    ap.add_argument("--all-upcs", action="store_true",
                    help="Extract ALL product images")
    ap.add_argument("--upscale", type=int, default=4, help="Upscale factor")
    args = ap.parse_args()

    out = os.path.abspath(args.output)
    os.makedirs(out, exist_ok=True)

    pdfs = []
    for pat in args.pdf:
        expanded = glob.glob(pat)
        pdfs.extend(
            expanded if expanded else ([pat] if os.path.isfile(pat) else [])
        )
    if not pdfs:
        print("No PDF files found.")
        sys.exit(1)

    mode = (
        "All products" if args.all_upcs
        else ("Missing only" if args.only_missing else "All products")
    )
    print(f"\n  PLANOGRAM PDF IMAGE EXTRACTOR")
    print(f"  PDFs: {len(pdfs)}  |  Mode: {mode}  |  Upscale: {args.upscale}x")
    print(f"  Output: {out}")

    all_extracted = {}
    for pdf_path in sorted(pdfs):
        result = process_pdf(
            pdf_path, out,
            only_missing=(args.only_missing and not args.all_upcs),
            upscale=args.upscale,
        )
        all_extracted.update(result)

    print(f"\n{'═'*60}")
    print(f"  DONE — {len(all_extracted)} unique UPCs extracted")
    print(f"  Output: {out}")
    if args.only_missing and not args.all_upcs:
        still = MISSING_UPCS - set(all_extracted.keys())
        if still:
            print(f"  Still missing: {len(still)}")
            for u in sorted(still):
                print(f"    {u}")
        else:
            print(f"  All {len(MISSING_UPCS)} target UPCs covered!")
    print(f"{'═'*60}\n")


if __name__ == "__main__":
    main()
