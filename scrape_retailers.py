#!/usr/bin/env python3
"""
Product Image Scraper v4 — Retailer-targeted
Searches iHerb, Amazon, Walmart, Vitacost for clean product shots.
Two-phase: 1) find product pages via Bing site: search, 2) extract main image from page.
Built-in review server with server-side JPG export.

Usage:
    python scrape_retailers.py                    # Scrape + review
    python scrape_retailers.py --review-only      # Just open review
"""

import os
import re
import sys
import time
import json
import argparse
import urllib.parse
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from io import BytesIO

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup

try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image


# ── Already found ─────────────────────────────────────────────────────────────

ALREADY_FOUND = {
    "0002188830231", "0004746908541", "0070587580218", "0070619517049",
    "0081012666199", "0081012666245", "0081859401546", "0085664500847",
    "0086000455530",
}

# ── Product search names (hand-verified) ──────────────────────────────────────

PRODUCTS = {
    "0003367415940": {
        "desc": "NTWY OMEGA 3 GMM CHEW",
        "names": ["Nateway Omega 3 Gummy Chews", "Nateway Omega-3 gummies"],
        "brand": "Nateway",
    },
    "0004126002608": {
        "desc": "ST SAM-E 400MG",
        "names": ["Simple Truth SAM-e 400mg", "Simple Truth SAMe 400 mg tablets"],
        "brand": "Simple Truth",
    },
    "0004126002659": {
        "desc": "KRO BRAIN SUPPORT GUMMY",
        "names": ["Kroger Brain Support Gummy", "Kroger brain support gummies vitamins"],
        "brand": "Kroger",
    },
    "0009070003379": {
        "desc": "HPHA LIONS MANE W/ REISHI",
        "names": ["Herb Pharm Lion's Mane with Reishi", "Herb Pharm Lions Mane Reishi mushroom extract"],
        "brand": "Herb Pharm",
    },
    "0070619510606": {
        "desc": "OWHV ASTRAGALUS ORGANIC",
        "names": ["Oregon's Wild Harvest Astragalus Organic", "Oregons Wild Harvest Organic Astragalus capsules"],
        "brand": "Oregon's Wild Harvest",
    },
    "0070619510607": {
        "desc": "OWH WLD HRVST ASHWGNDHA",
        "names": ["Oregon's Wild Harvest Ashwagandha", "Oregons Wild Harvest Organic Ashwagandha capsules"],
        "brand": "Oregon's Wild Harvest",
    },
    "0070619510610": {
        "desc": "OWH WLD HRVST MLK THSTL",
        "names": ["Oregon's Wild Harvest Milk Thistle", "Oregons Wild Harvest Organic Milk Thistle capsules"],
        "brand": "Oregon's Wild Harvest",
    },
    "0073373901283": {
        "desc": "NOW MAGNSMCPS 400 MG 180",
        "names": ["NOW Foods Magnesium Caps 400mg 180", "NOW Magnesium 400mg 180 capsules"],
        "brand": "NOW Foods",
    },
    "0081012666067": {
        "desc": "FRCFCTR ULT BRBRN CAP",
        "names": ["Force Factor Ultra Blueberry Brain Capsules", "Force Factor Blueberry Brain supplement"],
        "brand": "Force Factor",
    },
    "0081012666129": {
        "desc": "FRC FCTR MAG GLYC PWDR",
        "names": ["Force Factor Magnesium Glycinate Powder", "Force Factor Mag Glycinate powder supplement"],
        "brand": "Force Factor",
    },
    "0081012666196": {
        "desc": "FRCFCTR AMZ ASHW COMP",
        "names": ["Force Factor Amazing Ashwagandha Complex", "Force Factor Ashwagandha supplement"],
        "brand": "Force Factor",
    },
    "0081012666272": {
        "desc": "FRC FCTR HAIR GRWTH CHWS",
        "names": ["Force Factor Hair Growth Chews", "Force Factor Hair Growth soft chews supplement"],
        "brand": "Force Factor",
    },
    "0081012666296": {
        "desc": "FRC FCTR HAIR GRWTH CAPS",
        "names": ["Force Factor Hair Growth Capsules", "Force Factor Hair Growth capsules supplement"],
        "brand": "Force Factor",
    },
    "0081012666308": {
        "desc": "FRCFCTR MORINGA POWDER",
        "names": ["Force Factor Moringa Powder", "Force Factor Organic Moringa supplement"],
        "brand": "Force Factor",
    },
    "0081012666310": {
        "desc": "FRC FCTR MTCHA SFT CHEWS",
        "names": ["Force Factor Matcha Soft Chews", "Force Factor Matcha soft chews supplement"],
        "brand": "Force Factor",
    },
    "0081012666315": {
        "desc": "FRC FCTR MGHTY MTCHA",
        "names": ["Force Factor Mighty Matcha", "Force Factor Mighty Matcha energy supplement"],
        "brand": "Force Factor",
    },
    "0084009312863": {
        "desc": "NTRS TRTH BEET ROOT CHWS",
        "names": ["Nature's Truth Beet Root Chews", "Natures Truth Beet Root gummy supplement"],
        "brand": "Nature's Truth",
    },
    "0084009312867": {
        "desc": "NTRS TRTH MLTN MAGN CHWS",
        "names": ["Nature's Truth Melatonin Magnesium Chews", "Natures Truth Melatonin Magnesium gummy"],
        "brand": "Nature's Truth",
    },
    "0084009312920": {
        "desc": "NTRS TRTH MAGNSM CHEWS",
        "names": ["Nature's Truth Magnesium Chews", "Natures Truth Magnesium gummy supplement"],
        "brand": "Nature's Truth",
    },
    "0085005976768": {
        "desc": "NELLO SPR BAL CRN APL DR",
        "names": ["Nello Super Balance Cranberry Apple Drink", "Nello Super Balance supplement drink"],
        "brand": "Nello",
    },
    "0085006858575": {
        "desc": "NCLL MLTI CLL RSE VIAL",
        "names": ["Nucell Multi Cell Rose Vial", "Nucell Multi Cell supplement vial"],
        "brand": "Nucell",
    },
    "0085007479028": {
        "desc": "NAT VTY MGNSM THRNATE",
        "names": ["Natural Vitality Magnesium Threonate", "Natural Vitality Calm Magnesium L-Threonate"],
        "brand": "Natural Vitality",
    },
    "0086000455532": {
        "desc": "PYM ORGNL MOOD CHEWS SUPP",
        "names": ["PYM Original Mood Chews", "PYM Mood Chews supplement"],
        "brand": "PYM",
    },
    "0542501039183": {
        "desc": "NATF BIOSIL SKIN/HAIR/NLS",
        "names": ["Natural Factors BioSil Skin Hair Nails", "BioSil by Natural Factors ch-OSA Advanced Collagen"],
        "brand": "Natural Factors BioSil",
    },
}

# ── Retailer-specific extractors ──────────────────────────────────────────────

RETAILERS = [
    {
        "name": "iHerb",
        "site": "iherb.com",
        "img_selectors": [
            ("img", {"id": "iherb-product-image"}),
            ("img", {"class": re.compile(r"product-image", re.I)}),
            ("img", {"data-large-img": True}),
        ],
        "img_attrs": ["data-large-img", "src", "data-src"],
    },
    {
        "name": "Amazon",
        "site": "amazon.com",
        "img_selectors": [
            ("img", {"id": "landingImage"}),
            ("img", {"id": "imgBlkFront"}),
            ("img", {"class": re.compile(r"a-dynamic-image", re.I)}),
        ],
        "img_attrs": ["data-old-hires", "data-a-dynamic-image", "src"],
    },
    {
        "name": "Walmart",
        "site": "walmart.com",
        "img_selectors": [
            ("img", {"data-testid": re.compile(r"hero-image", re.I)}),
            ("img", {"class": re.compile(r"db.*hero", re.I)}),
        ],
        "img_attrs": ["src", "data-src"],
    },
    {
        "name": "Vitacost",
        "site": "vitacost.com",
        "img_selectors": [
            ("img", {"class": re.compile(r"product.*image", re.I)}),
            ("img", {"id": re.compile(r"product.*image", re.I)}),
        ],
        "img_attrs": ["src", "data-src"],
    },
    {
        "name": "iHerb",
        "site": "swansonvitamins.com",
        "img_selectors": [
            ("img", {"class": re.compile(r"product", re.I)}),
        ],
        "img_attrs": ["src", "data-src"],
    },
]


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


# ── Bing site-specific search ─────────────────────────────────────────────────

def bing_image_search(session, query, num=6):
    """Direct Bing Image search — extract murl from JSON."""
    urls = []
    try:
        params = {"q": query, "form": "HDRSC2", "first": "1"}
        url = "https://www.bing.com/images/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()

        seen = set()
        # Primary: murl from JSON in 'm' attribute
        for match in re.findall(r'"murl"\s*:\s*"(https?://[^"]+)"', resp.text):
            clean = match.replace("\\u0026", "&").replace("\\/", "/")
            if clean not in seen and not any(x in clean.lower() for x in ["bing.", "microsoft.", "favicon"]):
                seen.add(clean)
                urls.append(clean)
                if len(urls) >= num:
                    return urls

        # Fallback: a.iusc tags
        soup = BeautifulSoup(resp.text, "html.parser")
        for a_tag in soup.find_all("a", class_="iusc"):
            m = a_tag.get("m", "")
            if m:
                try:
                    mj = json.loads(m)
                    murl = mj.get("murl", "")
                    if murl and murl not in seen:
                        seen.add(murl)
                        urls.append(murl)
                        if len(urls) >= num:
                            return urls
                except Exception:
                    pass

    except Exception as e:
        print(f"      [Bing] Error: {e}")
    return urls[:num]


def bing_web_search(session, query, num=5):
    """Bing web search — returns page URLs."""
    urls = []
    try:
        params = {"q": query}
        url = "https://www.bing.com/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        for a in soup.select("li.b_algo h2 a"):
            href = a.get("href", "")
            if href.startswith("http"):
                urls.append(href)
                if len(urls) >= num:
                    break
    except Exception as e:
        print(f"      [Bing Web] Error: {e}")
    return urls


def extract_product_image_from_page(session, page_url, retailer=None):
    """Fetch a product page and try to extract the main product image."""
    try:
        resp = session.get(page_url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: Open Graph image (works on most retailer sites)
        og = soup.find("meta", property="og:image")
        if og and og.get("content", "").startswith("http"):
            img_url = og["content"]
            if _looks_like_product_image(img_url):
                return img_url

        # Strategy 2: Twitter card image
        tc = soup.find("meta", attrs={"name": "twitter:image"})
        if tc and tc.get("content", "").startswith("http"):
            img_url = tc["content"]
            if _looks_like_product_image(img_url):
                return img_url

        # Strategy 3: JSON-LD product schema
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                if isinstance(data, list):
                    data = data[0] if data else {}
                img = data.get("image")
                if isinstance(img, list):
                    img = img[0] if img else None
                if isinstance(img, dict):
                    img = img.get("url") or img.get("contentUrl")
                if img and isinstance(img, str) and img.startswith("http"):
                    return img
            except Exception:
                pass

        # Strategy 4: Large images in the page
        candidates = []
        for img in soup.find_all("img"):
            src = img.get("src", "") or img.get("data-src", "") or img.get("data-large-img", "")
            if not src.startswith("http"):
                continue
            if not _looks_like_product_image(src):
                continue
            # Prefer images with "product" in class/id/alt
            score = 0
            attrs_text = " ".join([
                img.get("class", [""])[0] if isinstance(img.get("class"), list) else str(img.get("class", "")),
                str(img.get("id", "")),
                str(img.get("alt", "")),
            ]).lower()
            if "product" in attrs_text:
                score += 10
            if "hero" in attrs_text or "main" in attrs_text:
                score += 5
            if "thumb" in attrs_text or "icon" in attrs_text:
                score -= 10

            # Width/height hints
            w = img.get("width", "")
            h = img.get("height", "")
            try:
                if int(w) >= 300 or int(h) >= 300:
                    score += 5
            except (ValueError, TypeError):
                pass

            candidates.append((score, src))

        if candidates:
            candidates.sort(key=lambda x: -x[0])
            return candidates[0][1]

    except Exception:
        pass
    return None


def _looks_like_product_image(url):
    """Quick filter for URLs that are probably product images."""
    low = url.lower()
    if any(x in low for x in ["favicon", "logo", "icon", "pixel", "1x1", "spacer", "blank", "sprite"]):
        return False
    if any(low.endswith(x) for x in [".svg", ".gif"]):
        return False
    return True


# ── Image download + validation ───────────────────────────────────────────────

def download_and_validate(session, img_url, save_path, min_size=100):
    """Download image, validate with Pillow, save. Returns (ok, width, height)."""
    try:
        resp = session.get(img_url, timeout=15)
        resp.raise_for_status()
        data = resp.content
        if len(data) < 3000:
            return False, 0, 0

        img = Image.open(BytesIO(data))
        w, h = img.size
        if w < min_size or h < min_size:
            return False, 0, 0

        with open(save_path, "wb") as f:
            f.write(data)
        return True, w, h
    except Exception:
        return False, 0, 0


# ── Product scraper ───────────────────────────────────────────────────────────

def scrape_product(session, upc, product_info, output_dir, delay=2.0, max_images=10):
    """Multi-strategy search for one product."""
    product_dir = os.path.join(output_dir, upc)
    os.makedirs(product_dir, exist_ok=True)

    names = product_info["names"]
    brand = product_info["brand"]
    desc = product_info["desc"]

    meta = {
        "upc": upc,
        "original_desc": desc,
        "search_name": names[0],
        "brand": brand,
        "images": [],
    }

    seen_urls = set()
    total = 0
    img_idx = 0

    def save_if_new(img_url, source_label):
        nonlocal total, img_idx
        if total >= max_images or img_url in seen_urls:
            return
        seen_urls.add(img_url)

        ext = "jpg"
        ul = img_url.lower().split("?")[0]
        if ul.endswith(".png"):
            ext = "png"
        elif ul.endswith(".webp"):
            ext = "webp"

        img_idx += 1
        filename = f"{img_idx:02d}_{source_label}.{ext}"
        save_path = os.path.join(product_dir, filename)

        ok, w, h = download_and_validate(session, img_url, save_path)
        if ok:
            meta["images"].append({
                "filename": filename,
                "url": img_url,
                "source": source_label,
                "width": w,
                "height": h,
                "size_kb": os.path.getsize(save_path) // 1024,
            })
            total += 1
            print(f"      ✓ {filename} ({w}x{h}, {meta['images'][-1]['size_kb']}KB) [{source_label}]")
        else:
            # Clean up failed download
            if os.path.exists(save_path):
                os.remove(save_path)

    # ── Strategy 1: Bing image search with site: filters ──
    retailer_sites = ["iherb.com", "amazon.com", "walmart.com", "vitacost.com", "swansonvitamins.com"]
    for site in retailer_sites:
        if total >= max_images:
            break
        query = f'site:{site} "{names[0]}"'
        print(f"    [{site}] Image search: {names[0]}")
        results = bing_image_search(session, query, num=3)
        for url in results:
            save_if_new(url, site.split(".")[0])
        time.sleep(delay * 0.5)

    # ── Strategy 2: UPC-based image search ──
    if total < max_images:
        upc_short = upc.lstrip("0")
        for q in [f'"{upc}" supplement product', f'"{upc_short}" supplement']:
            if total >= max_images:
                break
            print(f"    [UPC] {q}")
            results = bing_image_search(session, q, num=3)
            for url in results:
                save_if_new(url, "upc")
            time.sleep(delay * 0.5)

    # ── Strategy 3: Brand site image search ──
    if total < max_images:
        for name_variant in names[:2]:
            if total >= max_images:
                break
            q = f'{name_variant} supplement product image'
            print(f"    [Brand] {q}")
            results = bing_image_search(session, q, num=4)
            for url in results:
                save_if_new(url, "brand")
            time.sleep(delay * 0.5)

    # ── Strategy 4: Find product pages, extract main image ──
    if total < max_images:
        for name_variant in names[:2]:
            if total >= max_images:
                break
            for site in ["iherb.com", "amazon.com", "walmart.com"]:
                if total >= max_images:
                    break
                q = f'site:{site} {name_variant}'
                print(f"    [Page→Img] {site}: {name_variant}")
                page_urls = bing_web_search(session, q, num=2)
                for page_url in page_urls:
                    if total >= max_images:
                        break
                    img_url = extract_product_image_from_page(session, page_url)
                    if img_url:
                        save_if_new(img_url, f"page_{site.split('.')[0]}")
                time.sleep(delay * 0.5)

    # ── Strategy 5: Generic brand + product search ──
    if total < 3:
        q = f'{brand} {desc} supplement'
        print(f"    [Generic] {q}")
        results = bing_image_search(session, q, num=4)
        for url in results:
            save_if_new(url, "generic")
        time.sleep(delay * 0.5)

    meta_path = os.path.join(product_dir, "_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    return total


# ── Review Server (same as v3) ────────────────────────────────────────────────

def convert_to_jpg(src_path, dst_path, quality=92):
    img = Image.open(src_path)
    if img.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.save(dst_path, "JPEG", quality=quality, optimize=True)


def generate_review_html(output_dir):
    products_data = []
    for upc_dir in sorted(os.listdir(output_dir)):
        meta_path = os.path.join(output_dir, upc_dir, "_meta.json")
        if not os.path.isfile(meta_path):
            continue
        with open(meta_path) as f:
            products_data.append(json.load(f))

    total_products = len(products_data)
    total_images = sum(len(m["images"]) for m in products_data)

    cards = []
    for meta in products_data:
        upc = meta["upc"]
        imgs = []
        for img in meta["images"]:
            rel = f"{upc}/{img['filename']}"
            dim = f"{img.get('width','?')}x{img.get('height','?')}"
            kb = img.get("size_kb", "?")
            src_tag = img.get("source", "?")
            imgs.append(
                f'<div class="ic" data-upc="{upc}" data-path="{rel}" onclick="sel(this)">'
                f'<div class="src-tag">{src_tag}</div>'
                f'<img src="{rel}" loading="lazy">'
                f'<div class="ii">{dim} · {kb}KB</div>'
                f'</div>'
            )
        imgs.append(
            f'<div class="nc" data-upc="{upc}" data-type="none" onclick="sel(this)">'
            f'<div class="ni">🚫</div><div class="nl">None</div></div>'
        )
        name = meta.get("search_name", meta.get("original_desc", ""))
        cards.append(
            f'<div class="p" data-upc="{upc}">'
            f'<div class="ph"><span class="u">{upc}</span><span class="d">{meta["original_desc"]}</span>'
            f'<span class="st" id="st-{upc}"></span></div>'
            f'<div class="nm">{name}</div>'
            f'<div class="ims">{"".join(imgs)}</div></div>'
        )

    pjson = json.dumps({m["upc"]: m.get("search_name", m["original_desc"]) for m in products_data})

    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Image Review v4</title><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,sans-serif;background:#0c1929;color:#f1f5f9;padding:20px 20px 110px}}
h1{{text-align:center;color:#fbbf24;margin-bottom:6px;font-size:1.4rem}}
.inf{{text-align:center;color:#94a3b8;font-size:.85rem;margin-bottom:18px;line-height:1.5}}
.inf strong{{color:#34d399}}
.p{{background:#152238;border-radius:12px;padding:16px;margin-bottom:14px;border:2px solid rgba(148,163,184,.15)}}
.p.ok{{border-color:rgba(52,211,153,.5)}}.p.no{{border-color:rgba(248,113,113,.4)}}
.ph{{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:2px}}
.u{{font-size:1rem;font-weight:700;color:#fbbf24;font-family:monospace}}
.d{{color:#94a3b8;font-size:.82rem}}.st{{font-size:.75rem;font-weight:700}}
.nm{{color:#34d399;font-size:.8rem;font-style:italic;margin-bottom:8px}}
.ims{{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}}
.ic{{text-align:center;background:#1e3a5f;border-radius:8px;padding:6px;width:165px;cursor:pointer;
border:3px solid transparent;transition:all .15s;position:relative}}
.ic:hover{{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.4)}}
.ic.s{{border-color:#34d399;background:#1a3a2f}}
.ic.s::after{{content:'✓';position:absolute;top:3px;right:6px;background:#34d399;color:#0c1929;
width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.75rem}}
.ic.dm{{opacity:.2}}.ic.dm:hover{{opacity:.45}}
.ic img{{width:150px;height:150px;object-fit:contain;border-radius:5px;background:#fff;pointer-events:none}}
.ii{{font-size:.6rem;color:#64748b;margin-top:3px}}
.src-tag{{font-size:.6rem;font-weight:700;color:#fbbf24;background:rgba(251,191,36,.12);
padding:1px 6px;border-radius:3px;display:inline-block;margin-bottom:3px}}
.nc{{display:flex;flex-direction:column;align-items:center;justify-content:center;width:80px;min-height:170px;
background:#2a1a1a;border-radius:8px;cursor:pointer;border:3px solid rgba(248,113,113,.2);position:relative}}
.nc:hover{{border-color:rgba(248,113,113,.5)}}.nc.s{{border-color:#f87171;background:#3a1a1a}}
.nc.s::after{{content:'✗';position:absolute;top:3px;right:6px;background:#f87171;color:#fff;
width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.75rem}}
.nc.dm{{opacity:.2}}.ni{{font-size:1.8rem}}.nl{{font-size:.72rem;color:#f87171;font-weight:600}}
.bar{{position:fixed;bottom:0;left:0;right:0;background:rgba(12,25,41,.97);backdrop-filter:blur(12px);
border-top:1px solid rgba(251,191,36,.25);padding:12px 20px;display:flex;align-items:center;
justify-content:space-between;gap:12px;z-index:100;flex-wrap:wrap}}
.bi{{font-size:.88rem;color:#94a3b8}}.bi strong{{color:#fbbf24}}.bi .r{{color:#f87171}}
.bb{{display:flex;gap:8px;flex-wrap:wrap}}
.b{{padding:10px 16px;border:none;border-radius:10px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit}}
.b:active{{transform:scale(.97)}}
.bp{{background:linear-gradient(180deg,#2563eb,#1d4ed8);color:#fff}}.bp:hover{{filter:brightness(1.1)}}
.bs{{background:#1e3a5f;color:#94a3b8;border:1px solid rgba(148,163,184,.2)}}.bs:hover{{color:#fff}}
.bd{{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3)}}
.toast{{position:fixed;bottom:75px;left:50%;transform:translateX(-50%);background:#152238;border:1px solid rgba(52,211,153,.4);
color:#34d399;padding:10px 24px;border-radius:10px;font-size:.88rem;font-weight:600;opacity:0;transition:opacity .3s;z-index:200;pointer-events:none;white-space:nowrap}}
.toast.show{{opacity:1}}
</style></head><body>
<h1>Product Image Review v4</h1>
<div class="inf">{total_products} products · {total_images} images<br>
<strong>Click</strong> to select · <strong style="color:#f87171">None</strong> = not found · <strong>Save</strong> exports JPGs to <code>exported/</code></div>
{"".join(cards)}
<div class="bar">
<div class="bi"><strong id="ct">0</strong> selected · <span class="r" id="nc2">0 none</span> · <span id="rm">{total_products} left</span></div>
<div class="bb">
<button class="b bd" onclick="clr()">Clear</button>
<button class="b bs" onclick="au()">Auto-Largest</button>
<button class="b bp" onclick="sv()">Save Images + Not Found</button>
</div></div>
<div class="toast" id="toast"></div>
<script>
const P={pjson};const S={{}};
function upd(){{let ic=0,nc=0;for(const u in S){{if(S[u].t==='i')ic++;else nc++;}};const t={total_products};
document.getElementById('ct').textContent=ic;document.getElementById('nc2').textContent=nc+' none';
document.getElementById('rm').textContent=(t-ic-nc)+' left';
document.querySelectorAll('.p').forEach(p=>{{const u=p.dataset.upc,s=S[u],st=document.getElementById('st-'+u);
p.classList.remove('ok','no');if(s&&s.t==='i'){{p.classList.add('ok');st.textContent='✓';st.style.color='#34d399';}}
else if(s&&s.t==='none'){{p.classList.add('no');st.textContent='✗';st.style.color='#f87171';}}
else st.textContent='';}});}}
function sel(c){{const u=c.dataset.upc,pr=c.closest('.p'),all=pr.querySelectorAll('.ic,.nc');
if(c.classList.contains('s')){{c.classList.remove('s');all.forEach(x=>x.classList.remove('dm'));delete S[u];upd();return;}}
all.forEach(x=>x.classList.remove('s','dm'));c.classList.add('s');all.forEach(x=>{{if(x!==c)x.classList.add('dm');}});
S[u]=c.dataset.type==='none'?{{t:'none'}}:{{t:'i',path:c.dataset.path}};upd();}}
function clr(){{document.querySelectorAll('.ic,.nc').forEach(c=>c.classList.remove('s','dm'));for(const k in S)delete S[k];upd();}}
function au(){{document.querySelectorAll('.p').forEach(pr=>{{const u=pr.dataset.upc;if(S[u])return;
const cs=[...pr.querySelectorAll('.ic')];if(!cs.length)return;let b=null,bs=0;
cs.forEach(c=>{{const i=c.querySelector('img');const s=(i.naturalWidth||0)*(i.naturalHeight||0);if(s>bs){{bs=s;b=c;}}}});
if(b&&bs>15000){{const all=pr.querySelectorAll('.ic,.nc');all.forEach(x=>x.classList.remove('s','dm'));
b.classList.add('s');all.forEach(x=>{{if(x!==b)x.classList.add('dm');}});S[u]={{t:'i',path:b.dataset.path}};}}}});upd();}}
function toast(m){{const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3500);}}
async function sv(){{const imgs=[],nones=[],unrev=[];
for(const u in P){{if(S[u]){{if(S[u].t==='i')imgs.push({{upc:u,path:S[u].path}});else nones.push(u);}}else unrev.push(u);}}
if(!imgs.length&&!nones.length){{toast('Select at least one');return;}}
toast('Exporting...');
try{{const r=await fetch('/export',{{method:'POST',headers:{{'Content-Type':'application/json'}},
body:JSON.stringify({{images:imgs,nones,unreviewed:unrev,products:P}})}});
const d=await r.json();if(d.ok)toast('Saved '+d.count+' images → exported/');else toast('Error: '+d.error);
}}catch(e){{toast('Failed: '+e.message);}}}}
</script></body></html>"""

    path = os.path.join(output_dir, "_review.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


class ReviewHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/export":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            result = self._export(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_error(404)

    def _export(self, body):
        base = os.getcwd()
        export_dir = os.path.join(base, "exported")
        os.makedirs(export_dir, exist_ok=True)

        count = 0
        errors = []
        for entry in body.get("images", []):
            upc = entry["upc"]
            src = os.path.join(base, entry["path"])
            dst = os.path.join(export_dir, f"{upc}.jpg")
            try:
                convert_to_jpg(src, dst)
                count += 1
            except Exception as e:
                errors.append(f"{upc}: {e}")

        nones = body.get("nones", [])
        unreviewed = body.get("unreviewed", [])
        products = body.get("products", {})

        if nones or unreviewed:
            lines = ["PRODUCT IMAGES NOT FOUND", "=" * 60, ""]
            if nones:
                lines.append(f"MARKED AS NONE ({len(nones)}):")
                lines.append("-" * 40)
                for u in sorted(nones):
                    lines.append(f"{u}  {products.get(u, '')}")
                lines.append("")
            if unreviewed:
                lines.append(f"NOT REVIEWED ({len(unreviewed)}):")
                lines.append("-" * 40)
                for u in sorted(unreviewed):
                    lines.append(f"{u}  {products.get(u, '')}")
            with open(os.path.join(export_dir, "not_found.txt"), "w") as f:
                f.write("\n".join(lines))

        return {"ok": not errors, "count": count, "error": "; ".join(errors[:3]) if errors else ""}

    def log_message(self, fmt, *args):
        pass


def start_review_server(output_dir, port=8765):
    os.chdir(output_dir)
    generate_review_html(output_dir)
    server = HTTPServer(("127.0.0.1", port), ReviewHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://localhost:{port}/_review.html"
    print(f"\n  Review:  {url}")
    print(f"  Export:  {os.path.join(output_dir, 'exported')}")
    print(f"  Ctrl+C to stop.\n")
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nDone.")
        server.shutdown()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Product Image Scraper v4 — Retailer-targeted")
    parser.add_argument("--output", default="./product_images_v4", help="Output directory")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between requests")
    parser.add_argument("--max-images", type=int, default=10, help="Max images per product")
    parser.add_argument("--start-at", type=int, default=0, help="Skip first N products")
    parser.add_argument("--review-only", action="store_true", help="Skip scraping, open review")
    parser.add_argument("--port", type=int, default=8765, help="Review server port")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    if not args.review_only:
        to_scrape = {k: v for k, v in PRODUCTS.items() if k not in ALREADY_FOUND}

        print("=" * 60)
        print("  PRODUCT IMAGE SCRAPER v4 — Retailer-Targeted")
        print("=" * 60)
        print(f"  Total products:  {len(PRODUCTS)}")
        print(f"  Already found:   {len(ALREADY_FOUND)}")
        print(f"  To scrape:       {len(to_scrape)}")
        print(f"  Max per product: {args.max_images}")
        print(f"  Delay:           {args.delay}s")
        print(f"  Output:          {output_dir}")
        print()
        print("  Search strategy per product:")
        print("    1. Bing Images site:iherb/amazon/walmart/vitacost/swanson")
        print("    2. UPC-based image search")
        print("    3. Brand + product name image search")
        print("    4. Product page → extract main image (og:image, JSON-LD)")
        print("    5. Generic fallback search")
        print("=" * 60)
        print()

        session = get_session()
        total_dl = 0
        t0 = time.time()

        items = list(to_scrape.items())
        for idx, (upc, info) in enumerate(items):
            if idx < args.start_at:
                continue
            print(f"[{idx + 1}/{len(items)}] {upc} — {info['names'][0]}")
            count = scrape_product(session, upc, info, output_dir, delay=args.delay, max_images=args.max_images)
            total_dl += count
            print(f"    → {count} images\n")

        elapsed = time.time() - t0
        print(f"\nScraping done: {total_dl} images in {int(elapsed // 60)}m {int(elapsed % 60)}s")

    print("\nStarting review server...")
    start_review_server(output_dir, port=args.port)


if __name__ == "__main__":
    main()
