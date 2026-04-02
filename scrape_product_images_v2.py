#!/usr/bin/env python3
"""
Product Image Scraper v2 — Google-focused
Corrected brand expansions. Click-to-select review with None option.
Exports selected as {upc}.jpg + not_found.txt for items without matches.

Usage:
    python scrape_product_images_v2.py
    python scrape_product_images_v2.py --output ./product_images_v2
    python scrape_product_images_v2.py --delay 2.5
"""

import os
import re
import sys
import time
import json
import argparse
import urllib.parse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup


# ── Already found (from round 1) — skip these ────────────────────────────────

ALREADY_FOUND = {
    "0002188830231",  # Rainbow Light Kids One
    "0004746908541",  # Natrol Melatonin Fast Dissolve
    "0070587580218",  # Barlean's Vegan Omega
    "0070619517049",  # Oregon's Wild Harvest Ashwagandha Biodynamic
    "0081012666199",  # Force Factor Total Beets Chews
    "0081012666245",  # Force Factor Liposomal Gummies
    "0081859401546",  # Force Factor Total Beets Powder
    "0085664500847",  # Mary Ruth's Organic Adrenal Focus
    "0086000455530",  # PYM Mood Chews
}


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

# Filter out already found
PRODUCTS_TO_SCRAPE = [(u, d) for u, d in PRODUCTS if u not in ALREADY_FOUND]


# ── Corrected Brand Expansion Map ────────────────────────────────────────────

BRAND_EXPANSIONS = {
    "RNBW": "Rainbow Light",
    "NTWY": "Nateway",
    "ST ": "Simple Truth ",           # FIXED: was Nature Made
    "KRO ": "Kroger ",
    "NTRL": "Natrol",
    "HPHA": "Herb Pharm",             # FIXED: was Host Defense
    "BRLN": "Barlean's",
    "OWHV": "Oregon's Wild Harvest",
    "OWH": "Oregon's Wild Harvest",
    "NOW ": "NOW Foods ",
    "FRCFCTR": "Force Factor",
    "FRC FCTR": "Force Factor",
    "NTRS TRTH": "Nature's Truth",
    "NELLO": "Nello",
    "NCLL": "Nucell",
    "NAT VTY": "Natural Vitality",
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
    for abbr, full in sorted(BRAND_EXPANSIONS.items(), key=lambda x: -len(x[0])):
        result = result.replace(abbr, full)
    for abbr, full in sorted(WORD_EXPANSIONS.items(), key=lambda x: -len(x[0])):
        result = result.replace(abbr, full)
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

def search_google_images(session, query, num=5):
    """Scrape Google Images for image URLs."""
    urls = []
    try:
        params = {
            "q": query,
            "tbm": "isch",
            "tbs": "isz:m",
        }
        url = "https://www.google.com/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
        text = resp.text

        img_urls = re.findall(
            r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"',
            text,
            re.IGNORECASE,
        )

        seen = set()
        for img_url in img_urls:
            if any(skip in img_url.lower() for skip in [
                "google.com", "gstatic.com", "googleapis.com",
                "favicon", "logo", "icon", "pixel", "1x1",
                "encrypted-tbn", "data:image",
            ]):
                continue
            if img_url in seen or len(img_url) > 2000:
                continue
            seen.add(img_url)
            urls.append(img_url)
            if len(urls) >= num:
                break

        # Fallback: img tags
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


# ── Image Downloader ─────────────────────────────────────────────────────────

def download_image(session, img_url, save_path, timeout=15):
    """Download a single image. Returns True on success."""
    try:
        resp = session.get(img_url, timeout=timeout, stream=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "image" not in content_type and "octet-stream" not in content_type:
            return False
        content = resp.content
        if len(content) < 5000:
            return False
        with open(save_path, "wb") as f:
            f.write(content)
        return True
    except Exception:
        return False


# ── Main Scraper ─────────────────────────────────────────────────────────────

def scrape_product(session, upc, desc, output_dir, delay=2.0, images_per_query=5):
    """Search and download images for one product."""
    expanded = expand_description(desc)

    queries = [
        f"{upc} supplement product",
        f"{expanded} supplement bottle",
        f"{expanded} vitamin product image",
    ]

    product_dir = os.path.join(output_dir, upc)
    os.makedirs(product_dir, exist_ok=True)

    meta = {
        "upc": upc,
        "original_desc": desc,
        "expanded_desc": expanded,
        "queries_used": queries,
        "images": [],
    }

    total_downloaded = 0
    seen_urls = set()

    for qi, query in enumerate(queries):
        if total_downloaded >= images_per_query * 2:
            break

        print(f"    Query {qi + 1}: \"{query}\"")

        g_urls = search_google_images(session, query, num=images_per_query)
        for i, img_url in enumerate(g_urls):
            if img_url in seen_urls:
                continue
            seen_urls.add(img_url)

            ext = "jpg"
            if ".png" in img_url.lower().split("?")[0]:
                ext = "png"
            elif ".webp" in img_url.lower().split("?")[0]:
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
                size_kb = os.path.getsize(save_path) // 1024
                print(f"      ✓ [{filename}] ({size_kb}KB)")
            else:
                print(f"      ✗ skipped (too small or not an image)")

        time.sleep(delay)

    meta_path = os.path.join(product_dir, "_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    return total_downloaded


def generate_review_html(output_dir):
    """Generate interactive review HTML with click-to-select, None option, and working export."""
    html_header = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Product Image Review v2</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0c1929; color: #f1f5f9; padding: 24px; padding-bottom: 120px; }
    h1 { text-align: center; margin-bottom: 8px; color: #fbbf24; }
    .stats { text-align: center; color: #94a3b8; margin-bottom: 8px; font-size: 0.9rem; }
    .instructions { text-align: center; color: #cbd5e1; margin-bottom: 24px; font-size: 0.88rem; line-height: 1.6; max-width: 700px; margin-left: auto; margin-right: auto; }
    .instructions strong { color: #34d399; }
    .instructions code { background: rgba(148,163,184,0.15); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }

    .product { background: #152238; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 2px solid rgba(148,163,184,0.15); transition: border-color 0.2s; }
    .product.has-selection { border-color: rgba(52,211,153,0.5); }
    .product.has-none { border-color: rgba(248,113,113,0.4); }
    .product-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; flex-wrap: wrap; gap: 8px; }
    .upc { font-size: 1.1rem; font-weight: 700; color: #fbbf24; font-family: monospace; }
    .desc { color: #94a3b8; font-size: 0.9rem; }
    .status-label { font-size: 0.8rem; font-weight: 700; display: none; }
    .product.has-selection .status-label { display: inline; color: #34d399; }
    .product.has-none .status-label { display: inline; color: #f87171; }
    .expanded { color: #34d399; font-size: 0.85rem; font-style: italic; margin-bottom: 12px; display: block; }

    .images { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
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
    .img-card.dimmed { opacity: 0.3; }
    .img-card.dimmed:hover { opacity: 0.6; }
    .img-card img {
        width: 160px; height: 160px; object-fit: contain; border-radius: 6px;
        background: #fff; pointer-events: none;
    }
    .img-label { font-size: 0.72rem; color: #94a3b8; margin-top: 6px; }

    /* None card */
    .none-card {
        text-align: center; background: #2a1a1a; border-radius: 8px; padding: 8px;
        width: 180px; cursor: pointer; transition: all 0.2s; position: relative;
        border: 3px solid rgba(248,113,113,0.3); display: flex; flex-direction: column;
        align-items: center; justify-content: center; min-height: 200px;
    }
    .none-card:hover { border-color: rgba(248,113,113,0.6); transform: translateY(-2px); }
    .none-card.selected { border-color: #f87171; background: #3a1a1a; }
    .none-card.selected::after {
        content: '✗'; position: absolute; top: 4px; right: 8px;
        background: #f87171; color: #fff; width: 24px; height: 24px;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-weight: 900; font-size: 0.8rem;
    }
    .none-card.dimmed { opacity: 0.3; }
    .none-icon { font-size: 2.5rem; margin-bottom: 8px; }
    .none-label { font-size: 0.82rem; color: #f87171; font-weight: 600; }
    .none-sublabel { font-size: 0.7rem; color: #94a3b8; margin-top: 4px; }

    .no-images { color: #f87171; font-style: italic; padding: 12px; }

    .save-bar {
        position: fixed; bottom: 0; left: 0; right: 0;
        background: rgba(12,25,41,0.97); backdrop-filter: blur(12px);
        border-top: 1px solid rgba(251,191,36,0.25);
        padding: 14px 24px; display: flex; align-items: center;
        justify-content: space-between; gap: 16px; z-index: 100; flex-wrap: wrap;
    }
    .save-info { display: flex; flex-direction: column; gap: 2px; }
    .save-count { font-size: 0.95rem; color: #94a3b8; font-weight: 600; }
    .save-count strong { color: #fbbf24; }
    .save-count .none-count { color: #f87171; }
    .save-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
        padding: 10px 20px; border: none; border-radius: 10px;
        font-size: 0.9rem; font-weight: 700; cursor: pointer;
        transition: all 0.15s; font-family: inherit;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary { background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #fff; box-shadow: 0 4px 14px rgba(37,99,235,0.35); }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
    .btn-secondary { background: #1e3a5f; color: #94a3b8; border: 1px solid rgba(148,163,184,0.2); }
    .btn-secondary:hover { color: #f1f5f9; background: #243b5e; }
    .btn-danger { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
    .btn-danger:hover { background: rgba(239,68,68,0.25); }

    .progress-overlay {
        display: none; position: fixed; inset: 0; z-index: 200;
        background: rgba(12,25,41,0.92); backdrop-filter: blur(8px);
        align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    }
    .progress-overlay.show { display: flex; }
    .progress-text { font-size: 1.1rem; color: #fbbf24; font-weight: 600; }
    .progress-sub { font-size: 0.85rem; color: #94a3b8; }
</style>
</head>
<body>
<h1>Product Image Review v2</h1>
"""

    html_parts = [html_header]

    total_products = 0
    total_images = 0
    products_data = []

    for upc_dir in sorted(os.listdir(output_dir)):
        meta_path = os.path.join(output_dir, upc_dir, "_meta.json")
        if not os.path.isfile(meta_path):
            continue

        with open(meta_path) as f:
            meta = json.load(f)

        total_products += 1
        total_images += len(meta["images"])
        products_data.append(meta)

    stats = f'<div class="stats">{total_products} products · {total_images} images downloaded</div>'
    instructions = """<div class="instructions">
    <strong>Click an image</strong> to select the best one per product (one per row).<br>
    Click <strong style="color:#f87171">None</strong> if no image is correct — it will be added to <code>not_found.txt</code>.<br>
    Hit <strong>Save</strong> at the bottom to download all selected as <code>{upc}.jpg</code> files + the not-found list.
</div>"""

    html_parts.append(stats)
    html_parts.append(instructions)

    for meta in products_data:
        upc = meta["upc"]
        html_parts.append(f'<div class="product" data-upc="{upc}">')
        html_parts.append(f'<div class="product-header">')
        html_parts.append(f'  <span class="upc">{upc}</span>')
        html_parts.append(f'  <span class="desc">{meta["original_desc"]}</span>')
        html_parts.append(f'  <span class="status-label" id="status-{upc}">—</span>')
        html_parts.append(f'</div>')
        html_parts.append(f'<span class="expanded">{meta["expanded_desc"]}</span>')
        html_parts.append(f'<div class="images">')

        if meta["images"]:
            for img in meta["images"]:
                rel_path = f"{upc}/{img['filename']}"
                html_parts.append(f'  <div class="img-card" data-upc="{upc}" data-path="{rel_path}" data-type="image" onclick="selectCard(this)">')
                html_parts.append(f'    <img src="{rel_path}" alt="{upc}" loading="lazy">')
                html_parts.append(f'    <div class="img-label">{img["filename"]}</div>')
                html_parts.append(f'  </div>')

        # Always add a None card
        html_parts.append(f'  <div class="none-card" data-upc="{upc}" data-type="none" onclick="selectCard(this)">')
        html_parts.append(f'    <div class="none-icon">🚫</div>')
        html_parts.append(f'    <div class="none-label">None Match</div>')
        html_parts.append(f'    <div class="none-sublabel">Add to not_found.txt</div>')
        html_parts.append(f'  </div>')

        html_parts.append(f'</div></div>')

    # Build product lookup for JS
    products_json = json.dumps({m["upc"]: m["original_desc"] + " | " + m["expanded_desc"] for m in products_data})

    html_parts.append(f"""
<div class="save-bar">
    <div class="save-info">
        <div class="save-count"><strong id="selectedCount">0</strong> selected · <span class="none-count" id="noneCount">0</span> marked none · <span id="remainCount">{total_products}</span> remaining</div>
    </div>
    <div class="save-actions">
        <button class="btn btn-danger" onclick="clearAll()">Clear All</button>
        <button class="btn btn-secondary" onclick="autoSelectLargest()">Auto-Select Largest</button>
        <button class="btn btn-primary" id="saveBtn" onclick="saveAll()">Save Selected + Not Found</button>
    </div>
</div>

<div class="progress-overlay" id="progressOverlay">
    <div class="progress-text" id="progressText">Processing...</div>
    <div class="progress-sub" id="progressSub"></div>
</div>

<script>
const productLookup = {products_json};
const selections = {{}};  // upc -> {{ type: 'image'|'none', path?: string }}

function updateCounts() {{
    let imgCount = 0, noneCount = 0;
    for (const upc in selections) {{
        if (selections[upc].type === 'image') imgCount++;
        else noneCount++;
    }}
    const total = {total_products};
    document.getElementById('selectedCount').textContent = imgCount;
    document.getElementById('noneCount').textContent = noneCount + ' none';
    document.getElementById('remainCount').textContent = (total - imgCount - noneCount) + ' remaining';

    document.querySelectorAll('.product').forEach(p => {{
        const upc = p.dataset.upc;
        const sel = selections[upc];
        p.classList.remove('has-selection', 'has-none');
        const label = document.getElementById('status-' + upc);
        if (sel && sel.type === 'image') {{
            p.classList.add('has-selection');
            if (label) {{ label.textContent = '✓ Selected'; label.style.color = '#34d399'; }}
        }} else if (sel && sel.type === 'none') {{
            p.classList.add('has-none');
            if (label) {{ label.textContent = '✗ None'; label.style.color = '#f87171'; }}
        }} else {{
            if (label) {{ label.textContent = ''; }}
        }}
    }});
}}

function selectCard(card) {{
    const upc = card.dataset.upc;
    const type = card.dataset.type;
    const product = card.closest('.product');
    const allCards = product.querySelectorAll('.img-card, .none-card');

    if (card.classList.contains('selected')) {{
        card.classList.remove('selected');
        allCards.forEach(c => c.classList.remove('dimmed'));
        delete selections[upc];
        updateCounts();
        return;
    }}

    allCards.forEach(c => c.classList.remove('selected', 'dimmed'));
    card.classList.add('selected');
    allCards.forEach(c => {{ if (c !== card) c.classList.add('dimmed'); }});

    if (type === 'none') {{
        selections[upc] = {{ type: 'none' }};
    }} else {{
        selections[upc] = {{ type: 'image', path: card.dataset.path }};
    }}
    updateCounts();
}}

function clearAll() {{
    document.querySelectorAll('.img-card, .none-card').forEach(c => c.classList.remove('selected', 'dimmed'));
    for (const key in selections) delete selections[key];
    updateCounts();
}}

function autoSelectLargest() {{
    document.querySelectorAll('.product').forEach(product => {{
        const upc = product.dataset.upc;
        if (selections[upc]) return;
        const cards = product.querySelectorAll('.img-card');
        if (!cards.length) return;
        let best = null, bestSize = 0;
        cards.forEach(card => {{
            const img = card.querySelector('img');
            const size = (img.naturalWidth || 0) * (img.naturalHeight || 0);
            if (size > bestSize) {{ bestSize = size; best = card; }}
        }});
        if (best && bestSize > 10000) {{
            const allCards = product.querySelectorAll('.img-card, .none-card');
            allCards.forEach(c => c.classList.remove('selected', 'dimmed'));
            best.classList.add('selected');
            allCards.forEach(c => {{ if (c !== best) c.classList.add('dimmed'); }});
            selections[upc] = {{ type: 'image', path: best.dataset.path }};
        }}
    }});
    updateCounts();
}}

async function saveAll() {{
    const overlay = document.getElementById('progressOverlay');
    const text = document.getElementById('progressText');
    const sub = document.getElementById('progressSub');
    overlay.classList.add('show');

    const imageEntries = [];
    const noneEntries = [];
    const unreviewed = [];

    for (const upc in productLookup) {{
        if (selections[upc]) {{
            if (selections[upc].type === 'image') imageEntries.push({{ upc, path: selections[upc].path }});
            else noneEntries.push(upc);
        }} else {{
            unreviewed.push(upc);
        }}
    }}

    // Build not_found.txt content
    let notFoundText = 'NOT FOUND — Product images to source manually\\n';
    notFoundText += '='.repeat(60) + '\\n\\n';
    if (noneEntries.length) {{
        notFoundText += 'MARKED AS NONE (no match found):\\n';
        notFoundText += '-'.repeat(40) + '\\n';
        noneEntries.forEach(upc => {{
            notFoundText += upc + '  ' + (productLookup[upc] || '') + '\\n';
        }});
        notFoundText += '\\n';
    }}
    if (unreviewed.length) {{
        notFoundText += 'NOT REVIEWED:\\n';
        notFoundText += '-'.repeat(40) + '\\n';
        unreviewed.forEach(upc => {{
            notFoundText += upc + '  ' + (productLookup[upc] || '') + '\\n';
        }});
    }}

    // Download each selected image, convert to JPG via canvas, then trigger individual downloads
    text.textContent = `Processing ${{imageEntries.length}} images...`;
    let done = 0;

    for (const entry of imageEntries) {{
        sub.textContent = `${{done + 1}} / ${{imageEntries.length}} — ${{entry.upc}}`;
        try {{
            const blob = await fetchAndConvertToJpg(entry.path);
            triggerDownload(blob, entry.upc + '.jpg');
            await sleep(200);
        }} catch (e) {{
            console.error('Failed:', entry.upc, e);
            // Fallback: download raw file
            try {{
                const resp = await fetch(entry.path);
                const blob = await resp.blob();
                triggerDownload(blob, entry.upc + '.jpg');
            }} catch (e2) {{ console.error('Fallback failed:', e2); }}
        }}
        done++;
    }}

    // Download not_found.txt
    if (noneEntries.length || unreviewed.length) {{
        const txtBlob = new Blob([notFoundText], {{ type: 'text/plain' }});
        triggerDownload(txtBlob, 'not_found.txt');
    }}

    text.textContent = 'Done!';
    sub.textContent = `${{imageEntries.length}} images + not_found.txt`;
    setTimeout(() => overlay.classList.remove('show'), 2000);
}}

function sleep(ms) {{ return new Promise(r => setTimeout(r, ms)); }}

function triggerDownload(blob, filename) {{
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}}

async function fetchAndConvertToJpg(path) {{
    return new Promise((resolve, reject) => {{
        const img = new Image();
        img.onload = () => {{
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {{
                if (blob) resolve(blob);
                else reject(new Error('toBlob failed'));
            }}, 'image/jpeg', 0.92);
        }};
        img.onerror = () => reject(new Error('Load failed'));
        img.src = path;
    }});
}}

document.addEventListener('keydown', e => {{ if (e.key === 'Escape') clearAll(); }});
</script>
</body></html>""")

    review_path = os.path.join(output_dir, "_review.html")
    with open(review_path, "w", encoding="utf-8") as f:
        f.write("\n".join(html_parts))

    return review_path


def main():
    parser = argparse.ArgumentParser(description="Scrape Google for product images (v2)")
    parser.add_argument("--output", default="./product_images_v2", help="Output directory")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between searches")
    parser.add_argument("--per-query", type=int, default=5, help="Images per query")
    parser.add_argument("--start-at", type=int, default=0, help="Skip first N products")
    parser.add_argument("--include-found", action="store_true", help="Include already-found UPCs")
    args = parser.parse_args()

    products = PRODUCTS if args.include_found else PRODUCTS_TO_SCRAPE
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("  PRODUCT IMAGE SCRAPER v2 — Google")
    print("=" * 60)
    print(f"  Total products:    {len(PRODUCTS)}")
    print(f"  Already found:     {len(ALREADY_FOUND)}")
    print(f"  To scrape:         {len(products)}")
    print(f"  Images per query:  {args.per_query}")
    print(f"  Delay:             {args.delay}s")
    print(f"  Output:            {output_dir}")
    print("=" * 60)
    print()

    session = get_session()
    total_downloaded = 0
    start_time = time.time()

    for idx, (upc, desc) in enumerate(products):
        if idx < args.start_at:
            continue
        expanded = expand_description(desc)
        print(f"[{idx + 1}/{len(products)}] {upc} — {desc}")
        print(f"    Expanded: {expanded}")
        count = scrape_product(session, upc, desc, output_dir, delay=args.delay, images_per_query=args.per_query)
        total_downloaded += count
        print(f"    → {count} images saved\n")

    elapsed = time.time() - start_time
    mins = int(elapsed // 60)
    secs = int(elapsed % 60)

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
    print("  2. Click the best image per product (or None)")
    print("  3. Hit Save — downloads {upc}.jpg files + not_found.txt")
    print("  4. Move the .jpg files into static/images/products/")
    print("=" * 60)


if __name__ == "__main__":
    main()
