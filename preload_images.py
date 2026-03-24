#!/usr/bin/env python3
"""
Download product images from Kroger API and store locally for instant loading.

Uses batch API calls (50 UPCs per request) to minimize API usage.
With ~1,247 unique UPCs, this needs only ~25 API calls instead of 1,247.

Kroger location ID format: 3-digit division + 5-digit store number.
Example: division 701, store 351 -> 70100351

Usage:
    python preload_images.py --location 70100351          # Use specific store
    python preload_images.py --zip 99016                  # Find stores by zip
    python preload_images.py --flush --location 70100351  # Retry with fresh cache
    python preload_images.py --limit 10                   # Test with small batch
"""

import os
import sys
import time
import argparse
import sqlite3

import httpx
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), "db", "planograms.db")
IMAGE_DIR = os.path.join(os.path.dirname(__file__), "static", "images", "products")

BATCH_SIZE = 50  # Kroger API max for filter.productId

# Reuse auth and API logic from the app
from app.kroger_api import get_product_images_batch, _get_token, _get_location_id, lookup_location_by_zip


def get_unique_upcs():
    """Get all unique UPCs from the products table."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT DISTINCT upc FROM products ORDER BY upc").fetchall()
    conn.close()
    return [r[0] for r in rows]


def flush_empty_cache():
    """Remove cached entries with empty image URLs so they can be retried."""
    conn = sqlite3.connect(DB_PATH)
    deleted = conn.execute("DELETE FROM product_images WHERE image_url = ''").rowcount
    conn.commit()
    conn.close()
    return deleted


def download_image(url, filepath):
    """Download an image from a URL and save to filepath. Returns True on success."""
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if not content_type.startswith("image/") or len(resp.content) < 100:
            return False
        with open(filepath, "wb") as f:
            f.write(resp.content)
        return True
    except Exception:
        return False


def find_store_by_zip(zip_code):
    """Look up Kroger stores by zip code and let user pick one."""
    print(f"Looking up Kroger stores near {zip_code}...")
    locations = lookup_location_by_zip(zip_code)

    if not locations:
        print("No stores found. Check your zip code and API credentials.")
        return None

    print(f"\nFound {len(locations)} stores:\n")
    for i, loc in enumerate(locations, 1):
        print(f"  {i}. {loc['name']}")
        print(f"     Location ID: {loc['locationId']}  (div {loc['divisionNumber']}, store {loc['storeNumber']})")
        print(f"     {loc['address']}")
        print()

    while True:
        try:
            choice = input(f"Select a store (1-{len(locations)}), or 'q' to quit: ").strip()
            if choice.lower() == 'q':
                return None
            idx = int(choice) - 1
            if 0 <= idx < len(locations):
                selected = locations[idx]
                print(f"\nUsing: {selected['name']} ({selected['locationId']})")
                return selected['locationId']
        except (ValueError, EOFError):
            pass
        print("Invalid choice, try again.")


def preload(delay=1.0, limit=0):
    """Main preload loop: fetch image URLs in batches and download files."""
    # Verify credentials early
    token = _get_token()
    if not token:
        print("ERROR: Kroger API credentials not configured.")
        print("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.")
        sys.exit(1)

    location_id = _get_location_id()
    if location_id:
        print(f"Using Kroger location ID: {location_id}")
    else:
        print("WARNING: No KROGER_LOCATION_ID set. The API may return no results.")
        print("         Use --location 70100351 or --zip 99016 to set one.")
        print()

    os.makedirs(IMAGE_DIR, exist_ok=True)

    all_upcs = get_unique_upcs()
    total_in_db = len(all_upcs)

    if limit > 0:
        all_upcs = all_upcs[:limit]

    # Filter out UPCs that already have a local image file
    upcs_to_process = [
        upc for upc in all_upcs
        if not os.path.isfile(os.path.join(IMAGE_DIR, f"{upc}.jpg"))
    ]
    already = len(all_upcs) - len(upcs_to_process)

    num_batches = (len(upcs_to_process) + BATCH_SIZE - 1) // BATCH_SIZE if upcs_to_process else 0

    print(f"Found {total_in_db} unique UPCs in database")
    print(f"Processing: {len(all_upcs)}")
    print(f"Already downloaded: {already}")
    print(f"Remaining: {len(upcs_to_process)}")
    print(f"API batches needed: {num_batches} (50 UPCs per batch)")
    print(f"Delay between batches: {delay}s")
    print()

    if not upcs_to_process:
        print("Nothing to do!")
        return

    downloaded = 0
    no_image = 0
    errors = 0
    start_time = time.time()

    for batch_idx in range(0, len(upcs_to_process), BATCH_SIZE):
        batch = upcs_to_process[batch_idx:batch_idx + BATCH_SIZE]
        batch_num = batch_idx // BATCH_SIZE + 1

        print(f"[Batch {batch_num}/{num_batches}] Fetching {len(batch)} UPCs from Kroger API...")

        # Batch API call - gets image URLs for up to 50 UPCs at once
        url_map = get_product_images_batch(batch)

        if not url_map:
            print(f"  API call failed, skipping batch")
            errors += len(batch)
            time.sleep(delay)
            continue

        # Download each image
        for upc in batch:
            image_url = url_map.get(upc, "")
            filepath = os.path.join(IMAGE_DIR, f"{upc}.jpg")

            if not image_url:
                no_image += 1
                continue

            if download_image(image_url, filepath):
                size_kb = os.path.getsize(filepath) / 1024
                print(f"  {upc} ... downloaded ({size_kb:.1f} KB)")
                downloaded += 1
            else:
                print(f"  {upc} ... download failed")
                errors += 1

        # Rate limit between batches
        if batch_idx + BATCH_SIZE < len(upcs_to_process):
            time.sleep(delay)

    elapsed = time.time() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print()
    print("=" * 40)
    print("SUMMARY")
    print("=" * 40)
    print(f"Downloaded: {downloaded}")
    print(f"No image:   {no_image}")
    print(f"Errors:     {errors}")
    print(f"Skipped:    {already} (already existed)")
    print(f"Total time: {minutes}m {seconds}s")


def main():
    parser = argparse.ArgumentParser(description="Preload Kroger product images locally")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between batch API calls (default: 1.0)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max UPCs to process, 0 = all (default: 0)")
    parser.add_argument("--flush", action="store_true",
                        help="Clear cached empty results before running (retry previously missing images)")
    parser.add_argument("--location", type=str, default="",
                        help="Kroger location ID (8-digit: division + store, e.g. 70100351)")
    parser.add_argument("--zip", type=str, default="",
                        help="Look up Kroger stores by zip code to find location ID")
    args = parser.parse_args()

    print("=" * 40)
    print("KROGER IMAGE PRELOAD")
    print("=" * 40)
    print()

    # Verify credentials before anything else
    token = _get_token()
    if not token:
        print("ERROR: Kroger API credentials not configured.")
        print("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in your .env file.")
        sys.exit(1)

    # Handle location ID: --location flag > --zip lookup > env var
    if args.location:
        os.environ["KROGER_LOCATION_ID"] = args.location
        print(f"Location ID set to: {args.location}")
        print()
    elif args.zip:
        location_id = find_store_by_zip(args.zip)
        if not location_id:
            print("No store selected, exiting.")
            sys.exit(0)
        os.environ["KROGER_LOCATION_ID"] = location_id
        print()

    if args.flush:
        deleted = flush_empty_cache()
        print(f"Flushed {deleted} empty cache entries")
        print()

    preload(delay=args.delay, limit=args.limit)


if __name__ == "__main__":
    main()
