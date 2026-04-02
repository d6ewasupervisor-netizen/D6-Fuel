#!/usr/bin/env python3
"""
Extract selected product images from scraper output folders.
Place this script in the product_images/ directory and run it.

Creates an 'exported/' subfolder with properly named {upc}.jpg files.
"""

import os
import sys
import shutil

try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

# Selections mapped from the review screenshots
# Format: (upc, subfolder_filename)
SELECTIONS = [
    ("0002188830231", "bing_q2_1.jpg"),      # Rainbow Light Kids One
    ("0004746908541", "bing_q2_3.jpg"),       # Natrol Melatonin 1mg Fast Dissolve
    ("0070587580218", "bing_q2_2.png"),       # Barlean's Vegan Omega
    ("0070619517049", "bing_q2_1.png"),       # Oregon's Wild Harvest Ashwagandha Biodynamic
    ("0081012666199", "bing_q2_3.jpg"),       # Force Factor Total Beets Chews
    ("0081012666245", "bing_q2_2.png"),       # Force Factor Liposomal Gummies (Total Beets)
    ("0081859401546", "bing_q2_2.jpg"),       # Force Factor Total Beets Powder
    ("0085664500847", "bing_q2_1.png"),       # Mary Ruth's Organic Adrenal Focus
    ("0086000455530", "bing_q2_3.jpg"),       # PYM Mood Chews
]


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    export_dir = os.path.join(script_dir, "exported")
    os.makedirs(export_dir, exist_ok=True)

    print("=" * 50)
    print("  EXTRACT SELECTED PRODUCT IMAGES")
    print("=" * 50)
    print(f"  Source: {script_dir}")
    print(f"  Export: {export_dir}")
    print(f"  Images: {len(SELECTIONS)}")
    print("=" * 50)
    print()

    success = 0
    failed = 0

    for upc, filename in SELECTIONS:
        src = os.path.join(script_dir, upc, filename)
        dst = os.path.join(export_dir, f"{upc}.jpg")

        if not os.path.isfile(src):
            print(f"  MISS  {upc} — {filename} not found")
            failed += 1
            continue

        try:
            img = Image.open(src)
            # Convert to RGB (handles PNG with alpha, WEBP, etc.)
            if img.mode in ("RGBA", "P", "LA"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                background.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")

            img.save(dst, "JPEG", quality=92, optimize=True)
            size_kb = os.path.getsize(dst) // 1024
            print(f"  OK    {upc}.jpg  ({img.size[0]}x{img.size[1]}, {size_kb}KB)")
            success += 1
        except Exception as e:
            print(f"  FAIL  {upc} — {e}")
            failed += 1

    print()
    print("=" * 50)
    print(f"  Exported: {success}")
    print(f"  Failed:   {failed}")
    print(f"  Output:   {export_dir}")
    print()
    print("  Copy the exported/ folder contents into")
    print("  static/images/products/ in your app repo.")
    print("=" * 50)


if __name__ == "__main__":
    main()
