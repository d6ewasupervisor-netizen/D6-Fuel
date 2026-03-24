#!/usr/bin/env python3
"""
Fetch missing product images from alternative free sources.

For UPCs where the Kroger API returned no image, this script tries:
  1. Open Food Facts API (free, no key needed)
  2. UPC Item DB (free trial, 100 requests/day)
  3. Prints Google Images search URLs for any remaining failures

Usage:
    python fetch_missing_images.py                    # Fetch all missing
    python fetch_missing_images.py --dry-run          # Just list missing UPCs
    python fetch_missing_images.py --source openfoodfacts  # Try one source only
    python fetch_missing_images.py --delay 2.0        # Slower rate limiting
"""

import os
import sys
import time
import argparse
import sqlite3
from urllib.parse import quote_plus

import httpx
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), "db", "planograms.db")
IMAGE_DIR = os.path.join(os.path.dirname(__file__), "static", "images", "products")

# Reuse helpers from preload script
from preload_images import download_image, get_unique_upcs


def get_missing_upcs():
    """Return UPCs that have no local image file."""
    all_upcs = get_unique_upcs()
    return [
        upc for upc in all_upcs
        if not os.path.isfile(os.path.join(IMAGE_DIR, f"{upc}.jpg"))
    ]


def get_product_description(upc):
    """Look up a product's description from the database."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT description FROM products WHERE upc = ? LIMIT 1", (upc,)
    ).fetchone()
    conn.close()
    return row[0] if row else ""


def try_open_food_facts(upc):
    """Try Open Food Facts API. Free, no key needed.

    Returns an image URL on success, empty string on failure.
    """
    # Try the UPC as-is (zero-padded) and stripped of leading zeros
    candidates = [upc]
    stripped = upc.lstrip("0")
    if stripped != upc:
        candidates.append(stripped)

    for barcode in candidates:
        try:
            resp = httpx.get(
                f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json",
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            data = resp.json()
            if data.get("status") != 1:
                continue
            product = data.get("product", {})
            image_url = (
                product.get("image_front_url")
                or product.get("image_url")
                or ""
            )
            if image_url:
                return image_url
        except Exception:
            continue
    return ""


def try_upc_itemdb(upc):
    """Try UPC Item DB free trial API (100 requests/day).

    Returns an image URL on success, empty string on failure.
    """
    try:
        resp = httpx.get(
            "https://api.upcitemdb.com/prod/trial/lookup",
            params={"upc": upc},
            headers={"Accept": "application/json"},
            timeout=15,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        items = data.get("items", [])
        if items:
            images = items[0].get("images", [])
            if images:
                return images[0]
    except Exception:
        pass
    return ""


def generate_search_url(upc, description):
    """Generate a Google Images search URL for manual lookup."""
    query = f"{upc} {description} supplement product"
    return f"https://www.google.com/search?tbm=isch&q={quote_plus(query)}"


def update_cache(upc, image_url):
    """Update the product_images cache table with a local path."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT OR REPLACE INTO product_images (upc, image_url, fetched_at) "
            "VALUES (?, ?, datetime('now'))",
            (upc, image_url),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


# Source registry
ALL_SOURCES = [
    ("Open Food Facts", try_open_food_facts),
    ("UPC Item DB", try_upc_itemdb),
]


def fetch_missing(delay=1.5, dry_run=False, sources=None):
    """Main loop: find missing UPCs and try alternative sources."""
    os.makedirs(IMAGE_DIR, exist_ok=True)

    all_upcs = get_unique_upcs()
    missing = get_missing_upcs()

    print(f"Total UPCs in database: {len(all_upcs)}")
    print(f"Missing local images:   {len(missing)}")
    print()

    if dry_run:
        print("Missing UPCs:")
        for upc in missing:
            desc = get_product_description(upc)
            print(f"  {upc}  {desc}")
        return

    if not missing:
        print("All images present!")
        return

    active_sources = sources or ALL_SOURCES

    downloaded = 0
    still_missing = []
    start_time = time.time()

    for i, upc in enumerate(missing, 1):
        desc = get_product_description(upc)
        print(f"[{i}/{len(missing)}] {upc} - {desc}")

        image_url = ""
        source_name = ""

        for name, source_fn in active_sources:
            print(f"  Trying {name}...", end=" ", flush=True)
            try:
                image_url = source_fn(upc)
            except Exception as e:
                print(f"error: {e}")
                continue

            if image_url:
                print("found!")
                source_name = name
                break
            else:
                print("no image")

        if image_url:
            filepath = os.path.join(IMAGE_DIR, f"{upc}.jpg")
            if download_image(image_url, filepath):
                size_kb = os.path.getsize(filepath) / 1024
                print(f"  Downloaded from {source_name} ({size_kb:.1f} KB)")
                update_cache(upc, f"/static/images/products/{upc}.jpg")
                downloaded += 1
            else:
                print(f"  Download failed (bad content or too small)")
                still_missing.append((upc, desc))
        else:
            still_missing.append((upc, desc))

        # Rate limit between requests
        if i < len(missing):
            time.sleep(delay)

    elapsed = time.time() - start_time

    print()
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"Downloaded:     {downloaded}")
    print(f"Still missing:  {len(still_missing)}")
    print(f"Time:           {int(elapsed)}s")

    if still_missing:
        print()
        print("Manual search URLs for remaining UPCs:")
        print("(Open these in a browser, save the image as {upc}.jpg")
        print(f" into static/images/products/)")
        print()
        for upc, desc in still_missing:
            print(f"  {upc} - {desc}")
            print(f"    {generate_search_url(upc, desc)}")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch missing product images from alternative free sources"
    )
    parser.add_argument(
        "--delay", type=float, default=1.5,
        help="Seconds between requests (default: 1.5)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Just list missing UPCs without downloading",
    )
    parser.add_argument(
        "--source", choices=["all", "openfoodfacts", "upcitemdb"], default="all",
        help="Which source to try (default: all)",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("FETCH MISSING IMAGES (Alternative Sources)")
    print("=" * 50)
    print()

    # Filter sources if requested
    sources = None
    if args.source == "openfoodfacts":
        sources = [("Open Food Facts", try_open_food_facts)]
    elif args.source == "upcitemdb":
        sources = [("UPC Item DB", try_upc_itemdb)]

    fetch_missing(delay=args.delay, dry_run=args.dry_run, sources=sources)


if __name__ == "__main__":
    main()
