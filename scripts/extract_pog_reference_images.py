"""Extract first-page reference images from the 4 audit POG PDFs.

These images are shown to team members during a cooler audit so they can
visually identify which fixture is which before photographing the live cooler.

Output: public/fixture_refs/{key}.png  (one image per fixture)
"""
from __future__ import annotations

import io
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "public"
OUT = PUB / "fixture_refs"

# Source PDFs (in public/) -> output key used by the front-end.
PDF_MAP: dict[str, str] = {
    "csd":     "D701_L00000_D58_C142_V898_D001_MX - GDM 9- CSD.pdf",
    "bev":     "D701_L00000_D58_C142_V899_D001_MX - GDM 9- ALL BEVERAGE.pdf",
    "monster": "D701_L00000_D58_C142_V670_D002_MX - HABCO MONSTER COOLER 12 FT ASSORTMENT.pdf",
    "redbull": "D701_L00000_D58_C142_V664_D002_MX - HABCO- RED BULL COOLER 12 FT ASSORTMENT.pdf",
}

# Render at ~2x for crisp display on retina phones.
ZOOM = 2.0


def render_first_page(pdf_path: Path, out_path: Path) -> None:
    """Render page 1 cropped to the title + cooler diagram region.

    The Kroger POG cover page is a landscape sheet where the cooler diagram
    sits roughly in the upper-middle 55% of the page. Cropping there yields
    a focused reference image without the metadata table or Kroger logo.
    """
    doc = fitz.open(pdf_path)
    try:
        page = doc.load_page(0)
        r = page.rect

        # Crop: full width, top ~55% (just past the planogram diagram).
        clip = fitz.Rect(r.x0, r.y0, r.x1, r.y0 + r.height * 0.55)

        mat = fitz.Matrix(ZOOM, ZOOM)
        pix = page.get_pixmap(matrix=mat, alpha=False, clip=clip)
        pix.save(out_path)
        print(f"  {pdf_path.name} -> {out_path.relative_to(ROOT)}  ({pix.width}x{pix.height})")
    finally:
        doc.close()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Output dir: {OUT}")

    missing = []
    for key, name in PDF_MAP.items():
        src = PUB / name
        if not src.exists():
            missing.append(name)
            continue
        render_first_page(src, OUT / f"{key}.png")

    if missing:
        print("\nMISSING PDFs:")
        for m in missing:
            print(f"  - {m}")
        return 1

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
