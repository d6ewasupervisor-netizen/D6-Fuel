"""
fetch_pog_images.py
Reads Fuel_Center_POG_Products.xlsx, fetches product images from Kroger API,
downloads each angle at the largest size available (xlarge, then large, …),
writes ./images/{upc}.jpg (front, or first angle if no front) plus
./images/{upc}_{angle}.jpg for other perspectives, and outputs products.json.

Usage:
  pip install requests pandas openpyxl
  python fetch_pog_images.py
"""

import json
import os
import re
import time
import base64
import requests
import pandas as pd

# ── Credentials ───────────────────────────────────────────────────────────────
CLIENT_ID     = "supplementalintelligence-bbcd8xrv"
CLIENT_SECRET = "h0sdQSHQFkHFjHA8WArWiR30E6DIDd_vsI2Xs5nd"

# ── Config ────────────────────────────────────────────────────────────────────
EXCEL_FILE    = "Fuel_Center_POG_Products.xlsx"
OUTPUT_FILE   = "products.json"
IMAGES_DIR    = "images"
BATCH_SIZE    = 50
DELAY         = 0.5   # seconds between batch requests

TOKEN_URL     = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCT_URL   = "https://api.kroger.com/v1/products"

# ── Auth ──────────────────────────────────────────────────────────────────────
def get_token():
    creds = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    resp = requests.post(
        TOKEN_URL,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Authorization": f"Basic {creds}"},
        data={"grant_type": "client_credentials", "scope": "product.compact"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]

# ── Image extraction ──────────────────────────────────────────────────────────
# Prefer largest asset Kroger lists for each angle (API may add new labels; unknowns fall through to first URL).
SIZE_PREF = ["xlarge", "large", "medium", "small", "thumbnail"]


def best_url(sizes):
    """Highest-quality URL for one perspective (case-insensitive size names)."""
    if not sizes:
        return ""
    by_name = {}
    for s in sizes:
        name = str(s.get("size", "")).strip().lower()
        if name:
            by_name[name] = s.get("url", "")
    for p in SIZE_PREF:
        if by_name.get(p):
            return by_name[p]
    return sizes[0].get("url", "") if sizes else ""


def safe_perspective(persp):
    s = str(persp or "unknown").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "unknown"


def collect_perspective_urls(product):
    """(safe_name, url) for each angle that has a URL (duplicate API labels get _2, _3, …)."""
    out = []
    seen = {}
    for img in product.get("images", []) or []:
        url = best_url(img.get("sizes", []) or [])
        if not url:
            continue
        base = safe_perspective(img.get("perspective"))
        n = seen.get(base, 0)
        sp = base if n == 0 else f"{base}_{n + 1}"
        seen[base] = n + 1
        out.append((sp, url))
    return out


def download_all_angles_for_upc(upc, product):
    """
    Writes images/{upc}.jpg from front (or first angle if no front).
    Writes images/{upc}_{angle}.jpg for every other angle (no duplicate for primary angle).
    """
    entries = collect_perspective_urls(product)
    if not entries:
        return False

    primary_url = None
    primary_p = None
    for sp, u in entries:
        if sp == "front":
            primary_url, primary_p = u, sp
            break
    if primary_url is None:
        primary_url, primary_p = entries[0][1], entries[0][0]

    primary_rel = os.path.join(IMAGES_DIR, f"{upc}.jpg")
    if not os.path.exists(primary_rel):
        if not download_image_url(primary_url, primary_rel):
            return False

    for sp, u in entries:
        if sp == primary_p:
            continue
        side_rel = os.path.join(IMAGES_DIR, f"{upc}_{sp}.jpg")
        if os.path.exists(side_rel):
            continue
        download_image_url(u, side_rel)

    return True

# ── Batch fetch from API ──────────────────────────────────────────────────────
def fetch_batch(upcs, token):
    resp = requests.get(
        PRODUCT_URL,
        params={"filter.productId": ",".join(upcs), "filter.limit": BATCH_SIZE},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    results = {}
    for product in resp.json().get("data", []):
        pid = product.get("productId", "")
        results[pid] = {
            "product": product,
            "full_name": product.get("description", ""),
        }
    return results

# ── Download image to disk ────────────────────────────────────────────────────
def download_image_url(url, dest_path):
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(resp.content)
        return dest_path
    except Exception as e:
        print(f"    WARNING: Failed to download {dest_path}: {e}")
        return None

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(IMAGES_DIR, exist_ok=True)

    print("Reading Excel...")
    df = pd.read_excel(EXCEL_FILE, header=1)
    df.columns = ["pog", "upc", "description", "size"]
    df = df.dropna(subset=["upc"])
    df["upc"]         = df["upc"].astype(str).str.strip().str.zfill(13)
    df["size"]        = df["size"].fillna("").astype(str).str.strip()
    df["description"] = df["description"].fillna("").astype(str).str.strip()

    all_upcs = df["upc"].unique().tolist()
    print(f"Found {len(all_upcs)} unique UPCs across {df['pog'].nunique()} POG sections")

    print("Authenticating with Kroger API...")
    token = get_token()
    print("Token OK")

    # Step 1: Fetch metadata + image URLs in batches
    api_map = {}
    for i in range(0, len(all_upcs), BATCH_SIZE):
        batch = all_upcs[i:i + BATCH_SIZE]
        print(f"  Fetching metadata batch {i // BATCH_SIZE + 1} ({len(batch)} UPCs)...")
        try:
            results = fetch_batch(batch, token)
            api_map.update(results)
        except Exception as e:
            print(f"  WARNING: Batch failed: {e}")
        time.sleep(DELAY)

    found_any = sum(
        1
        for v in api_map.values()
        if collect_perspective_urls(v.get("product") or {})
    )
    print(f"\nProducts with at least one image angle: {found_any} / {len(all_upcs)}")

    # Step 2: Download all angles to ./images/ (best URL per angle from Kroger)
    print(f"\nDownloading images to ./{IMAGES_DIR}/...")
    new_primary = 0
    skipped_primary = 0
    failed = 0

    for upc, data in api_map.items():
        product = data.get("product")
        if not product:
            failed += 1
            continue
        entries = collect_perspective_urls(product)
        if not entries:
            failed += 1
            continue

        primary_dest = os.path.join(IMAGES_DIR, f"{upc}.jpg")
        had_primary = os.path.exists(primary_dest)

        ok = download_all_angles_for_upc(upc, product)
        if not ok:
            failed += 1
            continue

        if had_primary:
            skipped_primary += 1
        else:
            new_primary += 1

        time.sleep(0.1)

    print(
        f"  New primary files: {new_primary}  |  Primary already on disk: {skipped_primary}  |  No images / failed: {failed}"
    )
    print("  Extra angles: images/{upc}_{angle}.jpg — re-run skips existing files.")

    # Step 3: Build products.json with local image paths
    output = {}
    for _, row in df.iterrows():
        section  = row["pog"]
        upc      = row["upc"]
        api_data = api_map.get(upc, {})
        img_path = f"images/{upc}.jpg" if os.path.exists(os.path.join(IMAGES_DIR, f"{upc}.jpg")) else ""
        entry = {
            "upc":         upc,
            "description": row["description"],
            "full_name":   api_data.get("full_name", row["description"]),
            "size":        row["size"],
            "image":       img_path,
        }
        output.setdefault(section, []).append(entry)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaved {OUTPUT_FILE}")
    for section, items in output.items():
        with_img = sum(1 for p in items if p["image"])
        print(f"  {section}: {len(items)} products, {with_img} with images")

    print("\nNext: commit images/ and products.json to your repo.")

if __name__ == "__main__":
    main()
