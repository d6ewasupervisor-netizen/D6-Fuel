#!/usr/bin/env python3
"""
Product Image Scraper — Google + Bing
Fetches up to 3 images per source for manual review.

Usage:
    python scrape_product_images.py
    python scrape_product_images.py --output ./product_images
    python scrape_product_images.py --delay 2.5
"""

import os
import re
import sys
import time
import json
import hashlib
import argparse
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup


# ── Product Data ──────────────────────────────────────────────────────────────

PRODUCTS = [
    ("0002188830231", "RNBW KIDS ONE MLTVTMN TBL"),
    ("0003367415940", "NTWY OMEGA 3 GMM CHEW"),
    ("0004126002608", "ST SAM-E 400MG"),
    ("0004126002659", "KRO BRAIN SUPPORT GUMMY"),
    ("0004746908541", "NTRL ULTRA SLEEP F/D TAB"),
    ("0009070003379", "HPHA LIONS MANE W/ REISHI"),
    ("0070587580218", "BRLN VGN OMEG FLX ALG OIL"),
    ("0070619510606", "OWHV ASTRAGALUS ORGANIC"),
    ("0070619510607", "OWH WLD HRVST ASHWGNDHA"),
    ("0070619510610", "OWH WLD HRVST MLK THSTL"),
    ("0070619517049", "OWHV ASHWAGANDHA BDYNMC"),
    ("0073373901283", "NOW MAGNSMCPS 400 MG 180"),
    ("0081012666067", "FRCFCTR ULT BRBRN CAP"),
    ("0081012666129", "FRC FCTR MAG GLYC PWDR"),
    ("0081012666196", "FRCFCTR AMZ ASHW COMP"),
    ("0081012666199", "FRC FCTR TOTAL BEETS CHWS"),
    ("0081012666245", "FRCFCTR LIPSOMAL GUMMIES"),
    ("0081012666272", "FRC FCTR HAIR GRWTH CHWS"),
    ("0081012666296", "FRC FCTR HAIR GRWTH CAPS"),
    ("0081012666308", "FRCFCTR MORINGA POWDER"),
    ("0081012666310", "FRC FCTR MTCHA SFT CHEWS"),
    ("0081012666315", "FRC FCTR MGHTY MTCHA"),
    ("0081859401546", "FRCFCTR TOTAL BEETS POWDR"),
    ("0084009312863", "NTRS TRTH BEET ROOT CHWS"),
    ("0084009312867", "NTRS TRTH MLTN MAGN CHWS"),
    ("0084009312920", "NTRS TRTH MAGNSM CHEWS"),
    ("0085005976768", "NELLO SPR BAL CRN APL DR"),
    ("0085006858575", "NCLL MLTI CLL RSE VIAL"),
    ("0085007479028", "NAT VTY MGNSM THRNATE"),
    ("0085664500847", "MRYRTHS ORG ADRN FCS LQ"),
    ("0086000455530", "PYM ORIGINAL MD CHEW SUPP"),
    ("0086000455532", "PYM ORGNL MOOD CHEWS SUPP"),
    ("0542501039183", "NATF BIOSIL SKIN/HAIR/NLS"),
]

# ── Brand Expansion Map ───────────────────────────────────────────────────────
# Abbreviations → full brand/product names for better search results

BRAND_EXPANSIONS = {
    "RNBW": "Rainbow Light",
    "NTWY": "Natrol Nateway",
    "ST ": "Nature Made SAM-e ",
    "KRO ": "Kroger ",
    "NTRL": "Natrol",
    "HPHA": "Host Defense Fungi Perfecti",
    "BRLN": "Barlean's",
    "OWHV": "Oregon's Wild Harvest",
    "OWH": "Oregon's Wild Harvest",
    "NOW ": "NOW Foods ",
    "FRCFCTR": "Force Factor",
    "FRC FCTR": "Force Factor",
    "NTRS TRTH": "Nature's Truth",
    "NELLO": "Nello",
    "NCLL": "Nucell",
    "NAT VTY": "Nature's Vitality",
    "MRYRTHS": "Mary Ruth's",
    "PYM": "PYM",
    "NATF": "Natural Factors",
}

WORD_EXPANSIONS = {
    "MLTVTMN": "Multivitamin",
    "TBL": "Tablets",
    "GMM": "Gummy",
    "CHEW": "Chews",
    "CHWS": "Chews",
    "GMY": "Gummy",
    "TAB": "Tablets",
    "CAP": "Capsules",
    "CAPS": "Capsules",
    "PWDR": "Powder",
    "VGN": "Vegan",
    "OMEG": "Omega",
    "FLX": "Flax",
    "ALG": "Algae",
    "OIL": "Oil",
    "ASHWGNDHA": "Ashwagandha",
    "ASHW": "Ashwagandha",
    "MLK": "Milk",
    "THSTL": "Thistle",
    "BDYNMC": "Biodynamic",
    "MAGNSMCPS": "Magnesium Capsules",
    "MAGNSM": "Magnesium",
    "MGNSM": "Magnesium",
    "BRBRN": "Blueberry Brain",
    "MAG": "Magnesium",
    "GLYC": "Glycinate",
    "AMZ": "Amazing",
    "COMP": "Complex",
    "GRWTH": "Growth",
    "MTCHA": "Matcha",
    "SFT": "Soft",
    "MGHTY": "Mighty",
    "LIPSOMAL": "Liposomal",
    "MLTN": "Melatonin",
    "MAGN": "Magnesium",
    "SPR BAL": "Super Balance",
    "CRN APL": "Cranberry Apple",
    "DR": "Drink",
    "MLTI": "Multi",
    "CLL": "Cell",
    "RSE": "Rose",
    "THRNATE": "Threonate",
    "ORG": "Organic",
    "ADRN": "Adrenal",
    "FCS": "Focus",
    "LQ": "Liquid",
    "MD": "Mood",
    "ORGNL": "Original",
    "SUPP": "Supplement",
    "NLS": "Nails",
    "F/D": "Fast Dissolve",
    "W/": "with ",
    "ULT": "Ultra",
}


def expand_description(desc):
    """Turn abbreviated planogram description into a searchable product name."""
    result = desc

    # Brand expansions first (order matters — longer matches first)
    for abbr, full in sorted(BRAND_EXPANSIONS.items(), key=lambda x: -len(x[0])):
        result = result.replace(abbr, full)

    # Word expansions
    for abbr, full in sorted(WORD_EXPANSIONS.items(), key=lambda x: -len(x[0])):
        result = result.replace(abbr, full)

    # Clean up extra spaces
    result = re.sub(r"\s+", " ", result).strip()
    return result


# ── HTTP Session ──────────────────────────────────────────────────────────────

def get_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    return s


# ── Google Images Scraper ─────────────────────────────────────────────────────

def search_google_images(session, query, num=3):
    """Scrape Google Images search results for image URLs."""
    urls = []
    try:
        params = {
            "q": query,
            "tbm": "isch",
            "tbs": "isz:m",  # medium size — good for product shots
        }
        url = "https://www.google.com/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()

        # Google embeds image URLs in script tags as JSON-like data
        # Look for full-res URLs in the page source
        text = resp.text

        # Method 1: Extract from data attributes and script blocks
        img_urls = re.findall(
            r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"',
            text,
            re.IGNORECASE,
        )

        # Filter out Google's own assets and tiny thumbnails
        seen = set()
        for img_url in img_urls:
            if any(skip in img_url.lower() for skip in [
                "google.com", "gstatic.com", "googleapis.com",
                "favicon", "logo", "icon", "pixel", "1x1",
                "encrypted-tbn", "data:image",
            ]):
                continue
            if img_url in seen:
                continue
            if len(img_url) > 2000:
                continue
            seen.add(img_url)
            urls.append(img_url)
            if len(urls) >= num:
                break

        # Method 2: Fallback — parse thumbnail src from img tags
        if len(urls) < num:
            soup = BeautifulSoup(text, "html.parser")
            for img in soup.find_all("img"):
                src = img.get("src", "") or img.get("data-src", "")
                if src.startswith("http") and "gstatic" not in src and "google" not in src:
                    if src not in seen:
                        seen.add(src)
                        urls.append(src)
                        if len(urls) >= num:
                            break

    except Exception as e:
        print(f"    [Google] Error: {e}")

    return urls[:num]


# ── Bing Images Scraper ──────────────────────────────────────────────────────

def search_bing_images(session, query, num=3):
    """Scrape Bing Images search results for image URLs."""
    urls = []
    try:
        params = {
            "q": query,
            "form": "HDRSC2",
            "first": "1",
            "tsc": "ImageBasicHover",
        }
        url = "https://www.bing.com/images/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        seen = set()

        # Method 1: Extract from 'm' attribute (JSON with murl field)
        for a_tag in soup.find_all("a", class_="iusc"):
            m_data = a_tag.get("m", "")
            if m_data:
                try:
                    m_json = json.loads(m_data)
                    murl = m_json.get("murl", "")
                    if murl and murl not in seen:
                        seen.add(murl)
                        urls.append(murl)
                        if len(urls) >= num:
                            break
                except (json.JSONDecodeError, KeyError):
                    pass

        # Method 2: Fallback — img tags with src
        if len(urls) < num:
            for img in soup.find_all("img"):
                src = img.get("src", "") or img.get("data-src", "")
                if not src or not src.startswith("http"):
                    continue
                if any(skip in src.lower() for skip in [
                    "bing.com", "microsoft.com", "favicon", "logo",
                    "pixel", "1x1", "data:image",
                ]):
                    continue
                if src not in seen:
                    seen.add(src)
                    urls.append(src)
                    if len(urls) >= num:
                        break

        # Method 3: Regex fallback on raw HTML
        if len(urls) < num:
            img_urls = re.findall(
                r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"',
                resp.text,
                re.IGNORECASE,
            )
            for img_url in img_urls:
                if any(skip in img_url.lower() for skip in [
                    "bing.com", "microsoft.com", "favicon",
                    "logo", "icon", "pixel",
                ]):
                    continue
                if img_url not in seen:
                    seen.add(img_url)
                    urls.append(img_url)
                    if len(urls) >= num:
                        break

    except Exception as e:
        print(f"    [Bing] Error: {e}")

    return urls[:num]


# ── Image Downloader ─────────────────────────────────────────────────────────

def download_image(session, img_url, save_path, timeout=15):
    """Download a single image. Returns True on success."""
    try:
        resp = session.get(img_url, timeout=timeout, stream=True)
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")
        if "image" not in content_type and "octet-stream" not in content_type:
            return False

        # Check minimum size (skip tiny icons)
        content = resp.content
        if len(content) < 5000:  # < 5KB probably not a real product photo
            return False

        with open(save_path, "wb") as f:
            f.write(content)
        return True

    except Exception:
        return False


# ── Main Scraper ─────────────────────────────────────────────────────────────

def scrape_product(session, upc, desc, output_dir, delay=1.5, images_per_source=3):
    """Search and download images for one product."""
    expanded = expand_description(desc)

    # Build search queries — try multiple strategies
    queries = [
        f"{upc} supplement",                    # UPC direct
        f"{expanded} supplement product",        # Expanded name
        f"{expanded} vitamin bottle",            # Product shot
    ]

    product_dir = os.path.join(output_dir, upc)
    os.makedirs(product_dir, exist_ok=True)

    # Write metadata file for review
    meta = {
        "upc": upc,
        "original_desc": desc,
        "expanded_desc": expanded,
        "queries_used": queries,
        "images": [],
    }

    total_downloaded = 0

    for qi, query in enumerate(queries):
        if total_downloaded >= images_per_source * 2:
            break

        print(f"    Query {qi + 1}: \"{query}\"")

        # Google
        if total_downloaded < images_per_source * 2:
            g_urls = search_google_images(session, query, num=images_per_source)
            for i, img_url in enumerate(g_urls):
                ext = "jpg"
                if ".png" in img_url.lower():
                    ext = "png"
                elif ".webp" in img_url.lower():
                    ext = "webp"

                filename = f"google_q{qi + 1}_{i + 1}.{ext}"
                save_path = os.path.join(product_dir, filename)

                if download_image(session, img_url, save_path):
                    meta["images"].append({
                        "source": "google",
                        "query": query,
                        "url": img_url,
                        "filename": filename,
                    })
                    total_downloaded += 1
                    print(f"      ✓ Google [{filename}] ({len(open(save_path, 'rb').read()) // 1024}KB)")
                else:
                    print(f"      ✗ Google — skipped (too small or not an image)")

            time.sleep(delay)

        # Bing
        if total_downloaded < images_per_source * 2:
            b_urls = search_bing_images(session, query, num=images_per_source)
            for i, img_url in enumerate(b_urls):
                ext = "jpg"
                if ".png" in img_url.lower():
                    ext = "png"
                elif ".webp" in img_url.lower():
                    ext = "webp"

                filename = f"bing_q{qi + 1}_{i + 1}.{ext}"
                save_path = os.path.join(product_dir, filename)

                if download_image(session, img_url, save_path):
                    meta["images"].append({
                        "source": "bing",
                        "query": query,
                        "url": img_url,
                        "filename": filename,
                    })
                    total_downloaded += 1
                    print(f"      ✓ Bing  [{filename}] ({len(open(save_path, 'rb').read()) // 1024}KB)")
                else:
                    print(f"      ✗ Bing  — skipped (too small or not an image)")

            time.sleep(delay)

    # Save metadata
    meta_path = os.path.join(product_dir, "_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    return total_downloaded


def generate_review_html(output_dir):
    """Generate an interactive HTML review page: click to select one image per product, then export as {upc}.jpg zip."""
    html_header = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Product Image Review</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0c1929; color: #f1f5f9; padding: 24px; padding-bottom: 120px; }
    h1 { text-align: center; margin-bottom: 8px; color: #fbbf24; }
    .stats { text-align: center; color: #94a3b8; margin-bottom: 20px; font-size: 0.9rem; }
    .instructions { text-align: center; color: #cbd5e1; margin-bottom: 24px; font-size: 0.92rem; line-height: 1.6; }
    .instructions strong { color: #34d399; }

    .product { background: #152238; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid rgba(148,163,184,0.15); transition: border-color 0.2s; }
    .product.has-selection { border-color: rgba(52,211,153,0.4); }
    .product-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; flex-wrap: wrap; gap: 8px; }
    .upc { font-size: 1.1rem; font-weight: 700; color: #fbbf24; font-family: monospace; }
    .desc { color: #94a3b8; font-size: 0.9rem; }
    .expanded { color: #34d399; font-size: 0.85rem; font-style: italic; margin-bottom: 12px; display: block; }
    .selected-label { font-size: 0.78rem; color: #34d399; font-weight: 700; display: none; }
    .product.has-selection .selected-label { display: inline; }

    .images { display: flex; flex-wrap: wrap; gap: 12px; }
    .img-card {
        text-align: center; background: #1e3a5f; border-radius: 8px; padding: 8px;
        width: 180px; cursor: pointer; transition: all 0.2s; position: relative;
        border: 3px solid transparent;
    }
    .img-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
    .img-card.selected { border-color: #34d399; background: #1a3a2f; }
    .img-card.selected::after {
        content: '✓'; position: absolute; top: 4px; right: 8px;
        background: #34d399; color: #0c1929; width: 24px; height: 24px;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-weight: 900; font-size: 0.8rem;
    }
    .img-card.dimmed { opacity: 0.35; }
    .img-card.dimmed:hover { opacity: 0.7; }
    .img-card img {
        width: 160px; height: 160px; object-fit: contain; border-radius: 6px;
        background: #fff; pointer-events: none;
    }
    .img-label { font-size: 0.72rem; color: #94a3b8; margin-top: 6px; }
    .source-tag {
        display: inline-block; font-size: 0.65rem; font-weight: 700; padding: 2px 6px;
        border-radius: 4px; margin-bottom: 4px;
    }
    .source-tag.google { background: #4285f4; color: #fff; }
    .source-tag.bing { background: #f25022; color: #fff; }
    .no-images { color: #f87171; font-style: italic; padding: 12px; }

    /* Sticky bottom bar */
    .save-bar {
        position: fixed; bottom: 0; left: 0; right: 0;
        background: rgba(12,25,41,0.97); backdrop-filter: blur(12px);
        border-top: 1px solid rgba(251,191,36,0.25);
        padding: 14px 24px; display: flex; align-items: center;
        justify-content: space-between; gap: 16px; z-index: 100;
    }
    .save-bar .count {
        font-size: 0.95rem; color: #94a3b8; font-weight: 600;
    }
    .save-bar .count strong { color: #fbbf24; }
    .save-bar .actions { display: flex; gap: 10px; }
    .btn {
        padding: 10px 20px; border: none; border-radius: 10px;
        font-size: 0.9rem; font-weight: 700; cursor: pointer;
        transition: all 0.15s; font-family: inherit;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary {
        background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #fff;
        box-shadow: 0 4px 14px rgba(37,99,235,0.35);
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
    .btn-secondary {
        background: #1e3a5f; color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);
    }
    .btn-secondary:hover { color: #f1f5f9; background: #243b5e; }
    .btn-danger {
        background: rgba(239,68,68,0.15); color: #f87171;
        border: 1px solid rgba(239,68,68,0.3);
    }
    .btn-danger:hover { background: rgba(239,68,68,0.25); }

    .progress-overlay {
        display: none; position: fixed; inset: 0; z-index: 200;
        background: rgba(12,25,41,0.92); backdrop-filter: blur(8px);
        align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    }
    .progress-overlay.show { display: flex; }
    .progress-text { font-size: 1.1rem; color: #fbbf24; font-weight: 600; }
    .progress-sub { font-size: 0.85rem; color: #94a3b8; }
    .progress-bar-track { width: 300px; height: 6px; background: rgba(148,163,184,0.2); border-radius: 6px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #2563eb, #34d399); border-radius: 6px; transition: width 0.2s; width: 0%; }
</style>
</head>
<body>
<h1>Product Image Review</h1>
"""

    html_parts = [html_header]

    total_products = 0
    total_images = 0
    products_with_images = 0

    product_rows = []

    for upc_dir in sorted(os.listdir(output_dir)):
        meta_path = os.path.join(output_dir, upc_dir, "_meta.json")
        if not os.path.isfile(meta_path):
            continue

        with open(meta_path) as f:
            meta = json.load(f)

        total_products += 1
        total_images += len(meta["images"])
        if meta["images"]:
            products_with_images += 1

        row = []
        row.append(f'<div class="product" data-upc="{meta["upc"]}">')
        row.append(f'<div class="product-header">')
        row.append(f'  <span class="upc">{meta["upc"]}</span>')
        row.append(f'  <span class="desc">{meta["original_desc"]}</span>')
        row.append(f'  <span class="selected-label">✓ Selected</span>')
        row.append(f'</div>')
        row.append(f'<span class="expanded">{meta["expanded_desc"]}</span>')
        row.append(f'<div class="images">')

        if meta["images"]:
            for img in meta["images"]:
                rel_path = f"{meta['upc']}/{img['filename']}"
                source = img["source"]
                row.append(f'  <div class="img-card" data-upc="{meta["upc"]}" data-path="{rel_path}" onclick="selectImage(this)">')
                row.append(f'    <span class="source-tag {source}">{source.upper()}</span>')
                row.append(f'    <img src="{rel_path}" alt="{meta["upc"]}" loading="lazy">')
                row.append(f'    <div class="img-label">{img["filename"]}</div>')
                row.append(f'  </div>')
        else:
            row.append(f'  <div class="no-images">No images found</div>')

        row.append(f'</div></div>')
        product_rows.append("\n".join(row))

    stats = f'<div class="stats">{total_products} products · {total_images} images · {products_with_images} with results</div>'
    instructions = """<div class="instructions">
    <strong>Click an image</strong> to select it for each product. One selection per product.<br>
    Click again to deselect. When done, hit <strong>Save Selected Images</strong> to download a ZIP of <code>{upc}.jpg</code> files.
</div>"""

    html_parts.append(stats)
    html_parts.append(instructions)

    for row in product_rows:
        html_parts.append(row)

    # Bottom save bar + progress overlay + JavaScript
    html_parts.append(f"""
<div class="save-bar">
    <div class="count"><strong id="selectedCount">0</strong> of {products_with_images} products selected</div>
    <div class="actions">
        <button class="btn btn-danger" onclick="clearAll()">Clear All</button>
        <button class="btn btn-secondary" onclick="selectBest()">Auto-Select Largest</button>
        <button class="btn btn-primary" id="saveBtn" onclick="saveSelected()" disabled>Save Selected Images</button>
    </div>
</div>

<div class="progress-overlay" id="progressOverlay">
    <div class="progress-text" id="progressText">Preparing images...</div>
    <div class="progress-bar-track"><div class="progress-bar-fill" id="progressBar"></div></div>
    <div class="progress-sub" id="progressSub">0 / 0</div>
</div>

<script>
const selections = {{}};  // upc -> {{ path, card }}

function updateCount() {{
    const n = Object.keys(selections).length;
    document.getElementById('selectedCount').textContent = n;
    document.getElementById('saveBtn').disabled = n === 0;

    // Update product card borders
    document.querySelectorAll('.product').forEach(p => {{
        p.classList.toggle('has-selection', !!selections[p.dataset.upc]);
    }});
}}

function selectImage(card) {{
    const upc = card.dataset.upc;
    const path = card.dataset.path;
    const product = card.closest('.product');
    const siblings = product.querySelectorAll('.img-card');

    // If this card is already selected, deselect it
    if (card.classList.contains('selected')) {{
        card.classList.remove('selected');
        siblings.forEach(s => s.classList.remove('dimmed'));
        delete selections[upc];
        updateCount();
        return;
    }}

    // Deselect any previous selection for this product
    siblings.forEach(s => {{
        s.classList.remove('selected', 'dimmed');
    }});

    // Select this one, dim the rest
    card.classList.add('selected');
    siblings.forEach(s => {{
        if (s !== card) s.classList.add('dimmed');
    }});

    selections[upc] = {{ path }};
    updateCount();
}}

function clearAll() {{
    document.querySelectorAll('.img-card').forEach(c => {{
        c.classList.remove('selected', 'dimmed');
    }});
    for (const key in selections) delete selections[key];
    updateCount();
}}

function selectBest() {{
    // For each product, pick the image with the largest natural dimensions
    document.querySelectorAll('.product').forEach(product => {{
        const cards = product.querySelectorAll('.img-card');
        if (!cards.length) return;

        let best = null;
        let bestSize = 0;

        cards.forEach(card => {{
            const img = card.querySelector('img');
            const size = (img.naturalWidth || 0) * (img.naturalHeight || 0);
            if (size > bestSize) {{
                bestSize = size;
                best = card;
            }}
        }});

        if (best) {{
            // Clear previous
            cards.forEach(c => c.classList.remove('selected', 'dimmed'));
            // Select best
            best.classList.add('selected');
            cards.forEach(c => {{ if (c !== best) c.classList.add('dimmed'); }});
            selections[best.dataset.upc] = {{ path: best.dataset.path }};
        }}
    }});
    updateCount();
}}

async function imgToJpgBlob(imgEl, quality) {{
    return new Promise((resolve, reject) => {{
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Use a fresh Image to avoid tainted canvas issues
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {{
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            // White background (for PNGs with transparency)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {{
                if (blob) resolve(blob);
                else reject(new Error('Canvas toBlob failed'));
            }}, 'image/jpeg', quality || 0.92);
        }};
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = imgEl.src;
    }});
}}

async function fetchAsBlob(path) {{
    const resp = await fetch(path);
    if (!resp.ok) throw new Error('Fetch failed: ' + path);
    return await resp.blob();
}}

async function saveSelected() {{
    const entries = Object.entries(selections);
    if (!entries.length) return;

    const overlay = document.getElementById('progressOverlay');
    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    const sub = document.getElementById('progressSub');

    overlay.classList.add('show');
    text.textContent = 'Converting images to JPG...';
    bar.style.width = '0%';

    const zip = new JSZip();
    let done = 0;

    for (const [upc, data] of entries) {{
        sub.textContent = `${{done + 1}} / ${{entries.length}} — ${{upc}}`;
        bar.style.width = `${{Math.round((done / entries.length) * 100)}}%`;

        try {{
            // Try canvas conversion to JPG first
            const card = document.querySelector(`.img-card[data-upc="${{upc}}"].selected`);
            const imgEl = card ? card.querySelector('img') : null;

            let blob;
            if (imgEl && imgEl.naturalWidth > 0) {{
                try {{
                    blob = await imgToJpgBlob(imgEl, 0.92);
                }} catch {{
                    // Fallback: fetch raw file
                    blob = await fetchAsBlob(data.path);
                }}
            }} else {{
                blob = await fetchAsBlob(data.path);
            }}

            zip.file(`${{upc}}.jpg`, blob);
        }} catch (e) {{
            console.error(`Failed to process ${{upc}}:`, e);
        }}

        done++;
    }}

    text.textContent = 'Building ZIP...';
    bar.style.width = '95%';
    sub.textContent = 'Compressing...';

    try {{
        const blob = await zip.generateAsync({{ type: 'blob' }}, (meta) => {{
            bar.style.width = `${{95 + Math.round(meta.percent * 0.05)}}%`;
        }});

        bar.style.width = '100%';
        text.textContent = 'Done!';
        sub.textContent = `${{entries.length}} images ready`;

        saveAs(blob, 'product_images.zip');

        setTimeout(() => overlay.classList.remove('show'), 1500);
    }} catch (e) {{
        text.textContent = 'Error creating ZIP';
        sub.textContent = e.message;
        setTimeout(() => overlay.classList.remove('show'), 3000);
    }}
}}

// Keyboard: Escape to clear
document.addEventListener('keydown', e => {{
    if (e.key === 'Escape') clearAll();
}});
</script>
""")

    html_parts.append("</body></html>")

    review_path = os.path.join(output_dir, "_review.html")
    with open(review_path, "w", encoding="utf-8") as f:
        f.write("\n".join(html_parts))

    return review_path


def main():
    parser = argparse.ArgumentParser(description="Scrape Google/Bing for product images")
    parser.add_argument("--output", default="./product_images", help="Output directory (default: ./product_images)")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between searches (default: 2.0)")
    parser.add_argument("--per-source", type=int, default=3, help="Images per source per product (default: 3)")
    parser.add_argument("--start-at", type=int, default=0, help="Skip first N products (resume after interruption)")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("  PRODUCT IMAGE SCRAPER — Google + Bing")
    print("=" * 60)
    print(f"  Products:     {len(PRODUCTS)}")
    print(f"  Per source:   {args.per_source} images")
    print(f"  Delay:        {args.delay}s between searches")
    print(f"  Output:       {output_dir}")
    if args.start_at > 0:
        print(f"  Resuming at:  product #{args.start_at + 1}")
    print("=" * 60)
    print()

    session = get_session()
    total_downloaded = 0
    start_time = time.time()

    for idx, (upc, desc) in enumerate(PRODUCTS):
        if idx < args.start_at:
            continue

        expanded = expand_description(desc)
        print(f"[{idx + 1}/{len(PRODUCTS)}] {upc} — {desc}")
        print(f"    Expanded: {expanded}")

        count = scrape_product(
            session, upc, desc, output_dir,
            delay=args.delay,
            images_per_source=args.per_source,
        )
        total_downloaded += count
        print(f"    → {count} images saved\n")

    elapsed = time.time() - start_time
    mins = int(elapsed // 60)
    secs = int(elapsed % 60)

    # Generate review page
    print("Generating review page...")
    review_path = generate_review_html(output_dir)

    print()
    print("=" * 60)
    print("  COMPLETE")
    print("=" * 60)
    print(f"  Total images: {total_downloaded}")
    print(f"  Time:         {mins}m {secs}s")
    print(f"  Output:       {output_dir}")
    print(f"  Review:       {review_path}")
    print()
    print("  1. Open _review.html in your browser")
    print("  2. Click to select the best image per product")
    print("  3. Hit 'Save Selected Images' to download a ZIP")
    print("  4. Extract the ZIP into static/images/products/")
    print("=" * 60)


if __name__ == "__main__":
    main()
