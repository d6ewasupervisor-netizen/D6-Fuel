#!/usr/bin/env python3
"""
Product Image Scraper v3
- Bing Images (reliable direct URLs)
- Smart multi-strategy search queries
- Built-in HTTP review server with server-side JPG conversion
- None option → not_found.txt
- Corrected brand expansions

Usage:
    python scrape_images.py                    # Scrape then launch review
    python scrape_images.py --review-only      # Skip scrape, just open review
    python scrape_images.py --output ./imgs    # Custom output dir
"""

import os
import re
import sys
import time
import json
import shutil
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


# ── Already found (round 1) — skip these ─────────────────────────────────────

ALREADY_FOUND = {
    "0002188830231",
    "0004746908541",
    "0070587580218",
    "0070619517049",
    "0081012666199",
    "0081012666245",
    "0081859401546",
    "0085664500847",
    "0086000455530",
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

# ── Corrected Brand Map ───────────────────────────────────────────────────────
# Each UPC prefix → human-readable search name override
# This is more reliable than trying to regex-expand abbreviations

MANUAL_SEARCH_NAMES = {
    "0002188830231": "Rainbow Light Kids One Multivitamin Tablets",
    "0003367415940": "Nateway Omega 3 Gummy Chews supplement",
    "0004126002608": "Simple Truth SAM-e 400mg supplement",
    "0004126002659": "Kroger Brain Support Gummy vitamins",
    "0004746908541": "Natrol Ultra Sleep Fast Dissolve Tablets melatonin",
    "0009070003379": "Herb Pharm Lions Mane with Reishi mushroom",
    "0070587580218": "Barlean's Vegan Omega Flax Algae Oil",
    "0070619510606": "Oregon's Wild Harvest Astragalus Organic capsules",
    "0070619510607": "Oregon's Wild Harvest Ashwagandha capsules",
    "0070619510610": "Oregon's Wild Harvest Milk Thistle capsules",
    "0070619517049": "Oregon's Wild Harvest Ashwagandha Biodynamic",
    "0073373901283": "NOW Foods Magnesium Capsules 400mg 180 count",
    "0081012666067": "Force Factor Ultra Blueberry Brain Capsules",
    "0081012666129": "Force Factor Magnesium Glycinate Powder",
    "0081012666196": "Force Factor Amazing Ashwagandha Complex",
    "0081012666199": "Force Factor Total Beets Soft Chews",
    "0081012666245": "Force Factor Liposomal Gummies supplement",
    "0081012666272": "Force Factor Hair Growth Chews",
    "0081012666296": "Force Factor Hair Growth Capsules",
    "0081012666308": "Force Factor Moringa Powder supplement",
    "0081012666310": "Force Factor Matcha Soft Chews",
    "0081012666315": "Force Factor Mighty Matcha supplement",
    "0081859401546": "Force Factor Total Beets Powder",
    "0084009312863": "Nature's Truth Beet Root Chews supplement",
    "0084009312867": "Nature's Truth Melatonin Magnesium Chews",
    "0084009312920": "Nature's Truth Magnesium Chews",
    "0085005976768": "Nello Super Balance Cranberry Apple Drink",
    "0085006858575": "Nucell Multi Cell Rose Vial supplement",
    "0085007479028": "Natural Vitality Magnesium Threonate supplement",
    "0085664500847": "Mary Ruth's Organic Adrenal Focus Liquid",
    "0086000455530": "PYM Original Mood Chews supplement",
    "0086000455532": "PYM Original Mood Chews supplement berry",
    "0542501039183": "Natural Factors BioSil Skin Hair Nails",
}


def get_search_name(upc, desc):
    """Get the best human-readable name for search."""
    return MANUAL_SEARCH_NAMES.get(upc, desc)


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


# ── Bing Images ───────────────────────────────────────────────────────────────

def search_bing_images(session, query, num=6):
    """Scrape Bing Images. Returns list of direct image URLs."""
    urls = []
    try:
        params = {"q": query, "form": "HDRSC2", "first": "1"}
        url = "https://www.bing.com/images/search?" + urllib.parse.urlencode(params)
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        seen = set()

        # Primary: JSON in 'm' attribute has full-res murl
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
                            return urls
                except (json.JSONDecodeError, KeyError):
                    pass

        # Fallback: regex for image URLs in raw HTML
        if len(urls) < num:
            for match in re.findall(r'"murl":"(https?://[^"]+)"', resp.text):
                if match not in seen:
                    seen.add(match)
                    urls.append(match)
                    if len(urls) >= num:
                        return urls

        # Fallback 2: img tags
        if len(urls) < num:
            for img in soup.find_all("img"):
                src = img.get("src", "") or img.get("data-src", "")
                if not src.startswith("http"):
                    continue
                if any(x in src.lower() for x in ["bing.com", "microsoft.com", "favicon", "pixel"]):
                    continue
                if src not in seen:
                    seen.add(src)
                    urls.append(src)
                    if len(urls) >= num:
                        break

    except Exception as e:
        print(f"    [Bing] Error: {e}")

    return urls[:num]


# ── Image Downloader ─────────────────────────────────────────────────────────

def download_image(session, img_url, save_path, timeout=15):
    """Download image. Returns True on success."""
    try:
        resp = session.get(img_url, timeout=timeout, stream=True)
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "").lower()
        if "image" not in ct and "octet" not in ct:
            return False
        data = resp.content
        if len(data) < 3000:
            return False
        # Verify it's actually an image
        try:
            img = Image.open(BytesIO(data))
            w, h = img.size
            if w < 80 or h < 80:
                return False
        except Exception:
            return False
        with open(save_path, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


# ── Scraper ───────────────────────────────────────────────────────────────────

def build_queries(upc, desc):
    """Build multiple search strategies for a product."""
    name = get_search_name(upc, desc)
    # Strip leading zeros for UPC search variants
    upc_short = upc.lstrip("0") or upc

    return [
        f'"{upc}" product',                         # Exact UPC match
        f'"{upc_short}" supplement',                 # Short UPC
        f"{name} product photo",                     # Full name
        f"{name} bottle",                            # Bottle shot
        f"{name} supplement image",                  # Generic product
    ]


def scrape_product(session, upc, desc, output_dir, delay=2.0, max_images=8):
    """Search Bing with multiple queries, download unique images."""
    product_dir = os.path.join(output_dir, upc)
    os.makedirs(product_dir, exist_ok=True)

    queries = build_queries(upc, desc)
    name = get_search_name(upc, desc)

    meta = {
        "upc": upc,
        "original_desc": desc,
        "search_name": name,
        "queries_used": queries,
        "images": [],
    }

    seen_urls = set()
    total = 0

    for qi, query in enumerate(queries):
        if total >= max_images:
            break

        print(f"    Q{qi + 1}: \"{query}\"")
        img_urls = search_bing_images(session, query, num=6)

        for i, img_url in enumerate(img_urls):
            if total >= max_images:
                break
            if img_url in seen_urls:
                continue
            seen_urls.add(img_url)

            ext = "jpg"
            url_lower = img_url.lower().split("?")[0]
            if url_lower.endswith(".png"):
                ext = "png"
            elif url_lower.endswith(".webp"):
                ext = "webp"

            filename = f"q{qi + 1}_{total + 1}.{ext}"
            save_path = os.path.join(product_dir, filename)

            if download_image(session, img_url, save_path):
                # Get actual dimensions
                try:
                    img = Image.open(save_path)
                    w, h = img.size
                except Exception:
                    w, h = 0, 0

                meta["images"].append({
                    "filename": filename,
                    "url": img_url,
                    "query_index": qi,
                    "width": w,
                    "height": h,
                    "size_kb": os.path.getsize(save_path) // 1024,
                })
                total += 1
                print(f"      ✓ {filename} ({w}x{h}, {meta['images'][-1]['size_kb']}KB)")

        time.sleep(delay)

    meta_path = os.path.join(product_dir, "_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    return total


# ── Review Server ─────────────────────────────────────────────────────────────

def convert_to_jpg(src_path, dst_path, quality=92):
    """Convert any image to JPG with white background."""
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
    """Build _review.html with all products."""
    products_data = []
    for upc_dir in sorted(os.listdir(output_dir)):
        meta_path = os.path.join(output_dir, upc_dir, "_meta.json")
        if not os.path.isfile(meta_path):
            continue
        with open(meta_path) as f:
            products_data.append(json.load(f))

    total_products = len(products_data)
    total_images = sum(len(m["images"]) for m in products_data)

    product_cards = []
    for meta in products_data:
        upc = meta["upc"]
        imgs_html = []
        for img in meta["images"]:
            rel = f"{upc}/{img['filename']}"
            dim = f"{img.get('width','?')}x{img.get('height','?')}"
            kb = img.get("size_kb", "?")
            imgs_html.append(
                f'<div class="img-card" data-upc="{upc}" data-path="{rel}" onclick="sel(this)">'
                f'<img src="{rel}" loading="lazy">'
                f'<div class="img-info">{dim} · {kb}KB</div>'
                f'<div class="img-file">{img["filename"]}</div>'
                f'</div>'
            )

        imgs_html.append(
            f'<div class="none-card" data-upc="{upc}" data-type="none" onclick="sel(this)">'
            f'<div class="none-icon">🚫</div>'
            f'<div class="none-label">None</div>'
            f'</div>'
        )

        name = meta.get("search_name", meta.get("expanded_desc", ""))
        product_cards.append(
            f'<div class="product" data-upc="{upc}">'
            f'<div class="prod-head">'
            f'<span class="upc">{upc}</span>'
            f'<span class="desc">{meta["original_desc"]}</span>'
            f'<span class="status" id="st-{upc}"></span>'
            f'</div>'
            f'<div class="name">{name}</div>'
            f'<div class="images">{"".join(imgs_html)}</div>'
            f'</div>'
        )

    products_json = json.dumps({m["upc"]: m.get("search_name", m["original_desc"]) for m in products_data})

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Image Review</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,sans-serif;background:#0c1929;color:#f1f5f9;padding:20px 20px 110px}}
h1{{text-align:center;color:#fbbf24;margin-bottom:6px}}
.info{{text-align:center;color:#94a3b8;font-size:.88rem;margin-bottom:20px;line-height:1.6}}
.info strong{{color:#34d399}}
.product{{background:#152238;border-radius:12px;padding:16px;margin-bottom:16px;border:2px solid rgba(148,163,184,.15)}}
.product.done{{border-color:rgba(52,211,153,.5)}}
.product.none-picked{{border-color:rgba(248,113,113,.4)}}
.prod-head{{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:2px}}
.upc{{font-size:1.05rem;font-weight:700;color:#fbbf24;font-family:monospace}}
.desc{{color:#94a3b8;font-size:.85rem}}
.status{{font-size:.78rem;font-weight:700}}
.name{{color:#34d399;font-size:.82rem;font-style:italic;margin-bottom:10px}}
.images{{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}}
.img-card{{text-align:center;background:#1e3a5f;border-radius:8px;padding:6px;width:170px;cursor:pointer;
  border:3px solid transparent;transition:all .15s;position:relative}}
.img-card:hover{{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.4)}}
.img-card.sel{{border-color:#34d399;background:#1a3a2f}}
.img-card.sel::after{{content:'✓';position:absolute;top:3px;right:6px;background:#34d399;color:#0c1929;
  width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.75rem}}
.img-card.dim{{opacity:.25}}.img-card.dim:hover{{opacity:.5}}
.img-card img{{width:155px;height:155px;object-fit:contain;border-radius:5px;background:#fff;pointer-events:none}}
.img-info{{font-size:.65rem;color:#64748b;margin-top:4px}}
.img-file{{font-size:.68rem;color:#94a3b8}}
.none-card{{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100px;min-height:180px;
  background:#2a1a1a;border-radius:8px;cursor:pointer;border:3px solid rgba(248,113,113,.2);transition:all .15s}}
.none-card:hover{{border-color:rgba(248,113,113,.5)}}
.none-card.sel{{border-color:#f87171;background:#3a1a1a}}
.none-card.sel::after{{content:'✗';position:absolute;top:3px;right:6px;background:#f87171;color:#fff;
  width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.75rem}}
.none-card.dim{{opacity:.25}}
.none-card{{position:relative}}
.none-icon{{font-size:2rem;margin-bottom:4px}}
.none-label{{font-size:.78rem;color:#f87171;font-weight:600}}
.bar{{position:fixed;bottom:0;left:0;right:0;background:rgba(12,25,41,.97);backdrop-filter:blur(12px);
  border-top:1px solid rgba(251,191,36,.25);padding:12px 20px;display:flex;align-items:center;
  justify-content:space-between;gap:12px;z-index:100;flex-wrap:wrap}}
.bar-info{{font-size:.9rem;color:#94a3b8}}.bar-info strong{{color:#fbbf24}}.bar-info .r{{color:#f87171}}
.bar-btns{{display:flex;gap:8px;flex-wrap:wrap}}
.btn{{padding:10px 18px;border:none;border-radius:10px;font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit}}
.btn:active{{transform:scale(.97)}}
.btn-p{{background:linear-gradient(180deg,#2563eb,#1d4ed8);color:#fff}}
.btn-p:hover{{filter:brightness(1.1)}}.btn-p:disabled{{opacity:.35;cursor:not-allowed}}
.btn-s{{background:#1e3a5f;color:#94a3b8;border:1px solid rgba(148,163,184,.2)}}
.btn-s:hover{{color:#fff}}
.btn-d{{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3)}}
.toast{{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#152238;border:1px solid rgba(52,211,153,.4);
  color:#34d399;padding:10px 24px;border-radius:10px;font-size:.9rem;font-weight:600;opacity:0;transition:opacity .3s;z-index:200;
  pointer-events:none}}
.toast.show{{opacity:1}}
</style></head><body>
<h1>Product Image Review</h1>
<div class="info">{total_products} products · {total_images} images<br>
<strong>Click</strong> an image to select · <strong style="color:#f87171">None</strong> = not found · <strong>Save</strong> exports JPGs + not_found.txt</div>
{"".join(product_cards)}
<div class="bar">
  <div class="bar-info"><strong id="ct">0</strong> selected · <span class="r" id="nc">0 none</span> · <span id="rm">{total_products} left</span></div>
  <div class="bar-btns">
    <button class="btn btn-d" onclick="clr()">Clear</button>
    <button class="btn btn-s" onclick="autoSel()">Auto-Select Largest</button>
    <button class="btn btn-p" id="saveBtn" onclick="save()">Save Images + Not Found</button>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const P={products_json};
const S={{}};
function upd(){{
  let ic=0,nc=0;
  for(const u in S){{if(S[u].t==='img')ic++;else nc++;}}
  const tot={total_products};
  document.getElementById('ct').textContent=ic;
  document.getElementById('nc').textContent=nc+' none';
  document.getElementById('rm').textContent=(tot-ic-nc)+' left';
  document.querySelectorAll('.product').forEach(p=>{{
    const u=p.dataset.upc,s=S[u],st=document.getElementById('st-'+u);
    p.classList.remove('done','none-picked');
    if(s&&s.t==='img'){{p.classList.add('done');st.textContent='✓';st.style.color='#34d399';}}
    else if(s&&s.t==='none'){{p.classList.add('none-picked');st.textContent='✗ None';st.style.color='#f87171';}}
    else{{st.textContent='';}}
  }});
}}
function sel(c){{
  const u=c.dataset.upc,pr=c.closest('.product'),all=pr.querySelectorAll('.img-card,.none-card');
  if(c.classList.contains('sel')){{
    c.classList.remove('sel');all.forEach(x=>x.classList.remove('dim'));delete S[u];upd();return;
  }}
  all.forEach(x=>x.classList.remove('sel','dim'));
  c.classList.add('sel');
  all.forEach(x=>{{if(x!==c)x.classList.add('dim');}});
  if(c.dataset.type==='none')S[u]={{t:'none'}};
  else S[u]={{t:'img',path:c.dataset.path}};
  upd();
}}
function clr(){{
  document.querySelectorAll('.img-card,.none-card').forEach(c=>c.classList.remove('sel','dim'));
  for(const k in S)delete S[k];upd();
}}
function autoSel(){{
  document.querySelectorAll('.product').forEach(pr=>{{
    const u=pr.dataset.upc;if(S[u])return;
    const cards=[...pr.querySelectorAll('.img-card')];if(!cards.length)return;
    let best=null,bs=0;
    cards.forEach(c=>{{const i=c.querySelector('img');const s=(i.naturalWidth||0)*(i.naturalHeight||0);if(s>bs){{bs=s;best=c;}};}});
    if(best&&bs>15000){{
      const all=pr.querySelectorAll('.img-card,.none-card');
      all.forEach(x=>x.classList.remove('sel','dim'));
      best.classList.add('sel');all.forEach(x=>{{if(x!==best)x.classList.add('dim');}});
      S[u]={{t:'img',path:best.dataset.path}};
    }}
  }});upd();
}}
function toast(msg){{const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}}
async function save(){{
  const imgs=[],nones=[],unrev=[];
  for(const u in P){{
    if(S[u]){{if(S[u].t==='img')imgs.push({{upc:u,path:S[u].path}});else nones.push(u);}}
    else unrev.push(u);
  }}
  if(!imgs.length&&!nones.length){{toast('Select at least one image or mark None');return;}}
  toast('Exporting...');
  try{{
    const resp=await fetch('/export',{{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{images:imgs,nones,unreviewed:unrev,products:P}})
    }});
    const data=await resp.json();
    if(data.ok)toast('Saved '+data.count+' images to exported/ folder');
    else toast('Error: '+data.error);
  }}catch(e){{toast('Export failed: '+e.message);}}
}}
</script></body></html>"""

    path = os.path.join(output_dir, "_review.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


class ReviewHandler(SimpleHTTPRequestHandler):
    """Serve files + handle /export POST."""

    def do_POST(self):
        if self.path == "/export":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            result = self._handle_export(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_error(404)

    def _handle_export(self, body):
        base = os.getcwd()
        export_dir = os.path.join(base, "exported")
        os.makedirs(export_dir, exist_ok=True)

        count = 0
        errors = []

        # Convert and save selected images as {upc}.jpg
        for entry in body.get("images", []):
            upc = entry["upc"]
            src = os.path.join(base, entry["path"])
            dst = os.path.join(export_dir, f"{upc}.jpg")
            try:
                convert_to_jpg(src, dst)
                count += 1
            except Exception as e:
                errors.append(f"{upc}: {e}")

        # Write not_found.txt
        nones = body.get("nones", [])
        unreviewed = body.get("unreviewed", [])
        products = body.get("products", {})

        if nones or unreviewed:
            lines = ["PRODUCT IMAGES NOT FOUND", "=" * 60, ""]
            if nones:
                lines.append(f"MARKED AS NONE ({len(nones)} items):")
                lines.append("-" * 40)
                for upc in sorted(nones):
                    lines.append(f"{upc}  {products.get(upc, '')}")
                lines.append("")
            if unreviewed:
                lines.append(f"NOT REVIEWED ({len(unreviewed)} items):")
                lines.append("-" * 40)
                for upc in sorted(unreviewed):
                    lines.append(f"{upc}  {products.get(upc, '')}")

            nf_path = os.path.join(export_dir, "not_found.txt")
            with open(nf_path, "w") as f:
                f.write("\n".join(lines))

        if errors:
            return {"ok": False, "error": "; ".join(errors[:3]), "count": count}
        return {"ok": True, "count": count, "nones": len(nones), "export_dir": export_dir}

    def log_message(self, fmt, *args):
        # Suppress routine request logging
        pass


def start_review_server(output_dir, port=8765):
    """Launch local HTTP server and open browser."""
    os.chdir(output_dir)
    generate_review_html(output_dir)

    server = HTTPServer(("127.0.0.1", port), ReviewHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = f"http://localhost:{port}/_review.html"
    print(f"\n  Review server: {url}")
    print(f"  Export folder: {os.path.join(output_dir, 'exported')}")
    print(f"  Press Ctrl+C to stop.\n")
    webbrowser.open(url)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Product Image Scraper v3")
    parser.add_argument("--output", default="./product_images_v3", help="Output directory")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between searches")
    parser.add_argument("--max-images", type=int, default=8, help="Max images per product")
    parser.add_argument("--start-at", type=int, default=0, help="Skip first N products")
    parser.add_argument("--include-found", action="store_true", help="Re-scrape already-found UPCs")
    parser.add_argument("--review-only", action="store_true", help="Skip scraping, just open review")
    parser.add_argument("--port", type=int, default=8765, help="Review server port")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    if not args.review_only:
        products = PRODUCTS if args.include_found else [(u, d) for u, d in PRODUCTS if u not in ALREADY_FOUND]

        print("=" * 60)
        print("  PRODUCT IMAGE SCRAPER v3 — Bing")
        print("=" * 60)
        print(f"  Total:       {len(PRODUCTS)}")
        print(f"  Skipping:    {len(ALREADY_FOUND)} already found")
        print(f"  To scrape:   {len(products)}")
        print(f"  Max/product: {args.max_images}")
        print(f"  Delay:       {args.delay}s")
        print(f"  Output:      {output_dir}")
        print("=" * 60)
        print()

        session = get_session()
        total_dl = 0
        t0 = time.time()

        for idx, (upc, desc) in enumerate(products):
            if idx < args.start_at:
                continue
            name = get_search_name(upc, desc)
            print(f"[{idx + 1}/{len(products)}] {upc} — {name}")
            count = scrape_product(session, upc, desc, output_dir, delay=args.delay, max_images=args.max_images)
            total_dl += count
            print(f"    → {count} images\n")

        elapsed = time.time() - t0
        print(f"\nScraping complete: {total_dl} images in {int(elapsed // 60)}m {int(elapsed % 60)}s")

    print("\nLaunching review server...")
    start_review_server(output_dir, port=args.port)


if __name__ == "__main__":
    main()
