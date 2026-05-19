"""
Kroger Product Image Downloader
Pulls every available product image (all perspectives, largest size) for the UPCs
across the four FM frozen/refrigerated pet food planograms.

Period Week: P02 W04 Y2026  |  Effective: 3/22/2026

Planograms covered:
  - Frozen Pet Freezer Slim GDM43           (DBKey 8788900)
  - Fresh Pet Two-Sided 4FT Cooler #2 TVM48 (DBKey 8721855)
  - Fresh Pet Two-Sided 4FT Cooler #1 TVM48 (DBKey 8721854)
  - Blue Buffalo Cooler 5-Shelf TKO39       (DBKey 8701005)

Required .env (same dir):
  KROGER_CLIENT_ID=...
  KROGER_CLIENT_SECRET=...

Setup:
  pip install requests python-dotenv

Run:
  python kroger_pog_image_downloader.py

Output:
  ./kroger_pog_images/<planogram>/<UPC>_<short_name>/<perspective>_<size>[_FEATURED].<ext>
  ./kroger_pog_images/_download_report.json
"""

import os
import time
import base64
import json
from pathlib import Path
import requests
from dotenv import load_dotenv

# ---------- CONFIG ----------
TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCTS_URL = "https://api.kroger.com/v1/products"
SCOPE = "product.compact"
OUTPUT_ROOT = Path("kroger_pog_images")
PREFERRED_SIZES = ["xlarge", "large", "medium", "small"]
API_DELAY_SEC = 0.25  # politeness between API calls; raise if you see 429s

# ---------- UPC LIST PER PLANOGRAM ----------
PLANOGRAMS = {
    "frozen_pet_freezer_slim_GDM43": {
        "dbkey": "8788900",
        "description": "FROZEN PET FREEZER SLIM_GDM43-SL-HC-TSL01",
        "products": [
            ("0007684000325", "BNJR PMKN CK DG DSRTS 4CT", False),
            ("0007684000324", "BJ PUP DOG IC PNT BTR PR", False),
            ("0089762900014", "DGSTERS CHZ_BCN DGTRT 4CT", False),
            ("0086789800040", "BRKLY BF CNTR CT MRRW BN", False),
            ("0086001005201", "BRKLYS BG CHKN RW FOOD 4LB", False),
            ("0086001005200", "BRKLYS BG BEEF RAW FOOD 4LB", False),
            ("0007274597667", "FLL MN FRZ FC BF DOG FOOD 4LB", False),
            ("0007274597666", "FLL MN FC FRZ BF DOG FOOD 24OZ", False),
            ("0089762900027", "DGSTERS PB BRKN ICECR SND", True),
            ("0089762900026", "DGSTRS DOG IC TRTS", True),
            ("0089762900019", "DGSTERS PMKN FLV DOG TRTS", True),
            ("0089762900002", "DOGSTER PBC SNOW CUP 4CT", True),
            ("0007493300001", "BLJC FROZEN DOG FOOD 5LB", True),
            ("0007493300002", "BLJC FROZEN DOG FOOD 2LB", True),
            ("0007493300020", "BILJAC COOL JACS DOG TRTS", True),
            ("0007274597663", "FULL MN FRSH CFT CHKN 4LB", False),
            ("0007274597662", "FULL MN FRSH CFT CHKN 24OZ", False),
            ("0007274597665", "FLL MN FRZN TURKEY DOG FD 4LB", False),
            ("0007274597664", "FULL MN FRSH CFT HMS TRK 24OZ", False),
        ],
    },
    "fresh_pet_two_sided_cooler_2_TVM48": {
        "dbkey": "8721855",
        "description": "FRZ REF FRESH PET_TWO SIDED (4FT) COOLER_2_TVM48",
        "products": [
            ("0062797501328", "FRPT HS CHKN TURKY RCP DF", False),
            ("0062797501291", "FRPT HMSTL CRTN CT RECP", False),
            ("0062797501343", "FRPT CMPLT NUTR CHCKN", True),
            ("0062797501341", "FRPT PUPPY MULTI PROTEIN", True),
            ("0062797501027", "DJOY TURKEY BACON TREAT", False),
            ("0062797501326", "FRPT CN CHK BR OAT CRT DF", True),
            ("0062797501337", "FRPT HLTHY SNR ADLT ROLL", False),
            ("0062797501232", "FRESHPET SLCT MULTI ROLL", False),
            ("0062797501004", "FRPT SLCT RSTD MEAL DOG 48OZ", False),
            ("0062797501247", "FRPT SLCT MULTI PRTN ROLL", False),
            ("0085189300118", "FRPT BF VG RCE ADLT DOG 96OZ", False),
            ("0062797501358", "FRPT HC BF CHK TRK RCPE", True),
            ("0062797501292", "FRPT HMSTL CN BCT RECP", False),
            ("0062797501338", "FRPT HMST CRTNS GR CH BTS", False),
            ("0062797501303", "DOG JOY CHICKEN TREATS", False),
            ("0062797501005", "FRPT SLCT CAT RSTD ML CKN", False),
            ("0062797501277", "FRPT SNSTV STOMACH ROLL", False),
            ("0062797501104", "FRPT SLCT CKN BF ROLL", False),
            ("0062797501110", "FRPT SLCT FRSH FROM KTCHN", True),
            ("0062797501167", "FRPT FFTK CHICKEN 3CT", True),
        ],
    },
    "fresh_pet_two_sided_cooler_1_TVM48": {
        "dbkey": "8721854",
        "description": "FRZ REF FRESH PET_TWO SIDED (4FT) COOLER_1_TVM48",
        "products": [
            ("0062797501293", "FRPT SLCT SD BS BFEG RCP", False),
            ("0062797501357", "FRPT SM DOG BF EGG RCPE", True),
            ("0062797501276", "FRPT MULTI PRO ROLL SM DG", False),
            ("0062797501275", "FRPT SLCT SM DOG CHK TRK", False),
            ("0062797501091", "FRPT SLCT GF CKN SPIN PTO", False),
            ("0085189300120", "FRPT BF VG RCE ADLT DOG 24OZ", False),
            ("0085189300129", "FRPT CHK TKY VEG ADLT DOG 24OZ", False),
            ("0062797501106", "FRPT SLCT GRN FREE RST ML", True),
            ("0062797501307", "FRPT SELECT LRG DG PT FD 5LB", True),
            ("0062797501191", "FRESHPET SELECT 5LB GRN FREE ROLL", True),
            ("0085189300116", "FRPT CHK VEG RCE ADLT DOG 96OZ", False),
            ("0062797501204", "FRPT SLCT RSTD MLS SML DG", False),
            ("0062797501327", "FRPT CHKN RCP SML DG FOOD", False),
            ("0085189300132", "FRPT CHICK VEG RICE DG FD 16OZ", False),
            ("0062797501347", "FRPT FRDG FRSH PK CHNK BF", True),
            ("0062797501346", "FRPT FRDG FRSH PK TND CHK", True),
            ("0062797501003", "FRPT SLCT RSTD MEAL DOG 1.75LB", False),
            ("0062797501056", "FRPT SLCT ROASTED MEALS 5.5LB", False),
        ],
    },
    "blue_buffalo_cooler_TKO39": {
        "dbkey": "8701005",
        "description": "FRZ REF BLUE BUFFALO COOLER_5 SHELVES_TKO39",
        "products": [
            ("0084024315866", "BLBF CCP SM BREED ADLT 1LB", True),
            ("0084024315864", "BLBF CHICKEN CARRT N PEAS 1.5LB", True),
            ("0084024315819", "BLBF LMF SB CHKN STEW TUB 16OZ", False),
            ("0084024316123", "BLBF CHCKN CRRT PEA 4LB", True),
            ("0084024315817", "BLBF LMF CHKN STEW TUB 16OZ", False),
            ("0084024315815", "BLBF LMF CHKN STEW TUB 32OZ", False),
            ("0084024315812", "BLBF LMF SB CHKN DOG FOOD 16OZ", False),
            ("0084024315810", "BLBF LMF CHKN DOG FOOD 16OZ", False),
            ("0084024315808", "BLBF LMF CHKN DOG FOOD 80OZ", False),
            ("0084024315865", "BLBF BEEF SM BREED ADULT 1LB", True),
            ("0084024315863", "BLBF BEEF ADULT DOG FOOD 1.5LB", True),
            ("0084024315818", "BLBF LMF SB BEEF STEW TUB 16OZ", False),
            ("0084024316122", "BLBF FRSH BEEF ADLT FD 4LB", True),
            ("0084024315816", "BLBF LMF BEEF STEW TUB 16OZ", False),
            ("0084024315814", "BLBF LMF BEEF STEW TUB 32OZ", False),
            ("0084024315813", "BLBF LMF SB BEEF DOG FOOD 16OZ", False),
            ("0084024315811", "BLBF LMF BEEF DOG FOOD 16OZ", False),
            ("0084024315809", "BLBF LMF BEEF DOG FOOD 5LB", False),
        ],
    },
}


# ---------- HELPERS ----------
def get_access_token(client_id: str, client_secret: str) -> str:
    creds = f"{client_id}:{client_secret}".encode("utf-8")
    auth_header = base64.b64encode(creds).decode("utf-8")
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"grant_type": "client_credentials", "scope": SCOPE}
    resp = requests.post(TOKEN_URL, headers=headers, data=data, timeout=30)
    resp.raise_for_status()
    return resp.json()["access_token"]


def fetch_product(token: str, upc: str) -> dict | None:
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    params = {"filter.productId": upc}
    resp = requests.get(PRODUCTS_URL, headers=headers, params=params, timeout=30)
    if resp.status_code == 401:
        raise PermissionError("Token rejected (401). Re-auth required.")
    if resp.status_code == 404:
        return None
    if resp.status_code == 429:
        time.sleep(2.0)
        resp = requests.get(PRODUCTS_URL, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    items = resp.json().get("data") or []
    return items[0] if items else None


def best_url_for_perspective(image_block: dict) -> tuple[str | None, str | None]:
    sizes = {s.get("size"): s.get("url") for s in image_block.get("sizes", []) if s.get("url")}
    for pref in PREFERRED_SIZES:
        if pref in sizes:
            return sizes[pref], pref
    return None, None


def safe_filename(s: str) -> str:
    keep = "-_."
    return "".join(c if c.isalnum() or c in keep else "_" for c in s)


def ext_from_url(url: str) -> str:
    lower = url.lower().split("?")[0]
    for candidate in (".png", ".webp", ".jpeg", ".jpg"):
        if lower.endswith(candidate):
            return ".jpg" if candidate == ".jpeg" else candidate
    return ".jpg"


def download_image(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    resp = requests.get(url, timeout=60)
    if resp.status_code != 200:
        return False
    dest.write_bytes(resp.content)
    return True


# ---------- MAIN ----------
def main() -> None:
    load_dotenv()
    client_id = os.getenv("KROGER_CLIENT_ID")
    client_secret = os.getenv("KROGER_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("Missing KROGER_CLIENT_ID / KROGER_CLIENT_SECRET in .env")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    print("Authenticating with Kroger...")
    token = get_access_token(client_id, client_secret)
    print("OK\n")

    summary = {
        "total_upcs": 0,
        "found": 0,
        "not_found": [],
        "no_images": [],
        "images_downloaded": 0,
        "by_planogram": {},
    }

    for pog_key, pog in PLANOGRAMS.items():
        pog_dir = OUTPUT_ROOT / pog_key
        pog_dir.mkdir(parents=True, exist_ok=True)
        pog_summary = {"dbkey": pog["dbkey"], "products": []}
        print(f"=== {pog['description']}  (DBKey {pog['dbkey']}) ===")

        for upc, name, is_new in pog["products"]:
            summary["total_upcs"] += 1
            tag = " [NEW]" if is_new else ""
            print(f"  {upc} {name}{tag}")

            try:
                product = fetch_product(token, upc)
            except PermissionError:
                print("    Token expired - refreshing...")
                token = get_access_token(client_id, client_secret)
                product = fetch_product(token, upc)
            except requests.HTTPError as e:
                print(f"    HTTP error: {e}")
                pog_summary["products"].append(
                    {"upc": upc, "name": name, "status": f"http_error:{e.response.status_code}"}
                )
                time.sleep(API_DELAY_SEC)
                continue

            if product is None:
                print("    NOT FOUND in Kroger catalog")
                summary["not_found"].append(f"{upc} | {name}")
                pog_summary["products"].append(
                    {"upc": upc, "name": name, "status": "not_found"}
                )
                time.sleep(API_DELAY_SEC)
                continue

            summary["found"] += 1
            images = product.get("images", []) or []
            if not images:
                print("    No images on product")
                summary["no_images"].append(f"{upc} | {name}")
                pog_summary["products"].append(
                    {"upc": upc, "name": name, "status": "no_images"}
                )
                time.sleep(API_DELAY_SEC)
                continue

            product_dir = pog_dir / f"{upc}_{safe_filename(name)[:40]}"
            product_dir.mkdir(parents=True, exist_ok=True)

            saved = []
            for img in images:
                perspective = img.get("perspective", "unknown")
                featured_tag = "_FEATURED" if img.get("featured") else ""
                url, size = best_url_for_perspective(img)
                if not url:
                    continue
                fname = f"{perspective}_{size}{featured_tag}{ext_from_url(url)}"
                dest = product_dir / fname
                if download_image(url, dest):
                    saved.append(fname)
                    summary["images_downloaded"] += 1

            print(f"    Saved {len(saved)} image(s): {', '.join(saved) if saved else '(none)'}")
            pog_summary["products"].append(
                {"upc": upc, "name": name, "status": "ok", "images": saved}
            )
            time.sleep(API_DELAY_SEC)

        summary["by_planogram"][pog_key] = pog_summary
        print()

    report_path = OUTPUT_ROOT / "_download_report.json"
    report_path.write_text(json.dumps(summary, indent=2))

    print("=" * 60)
    print(f"DONE. UPCs processed: {summary['total_upcs']}")
    print(f"  Found in catalog : {summary['found']}")
    print(f"  Not found        : {len(summary['not_found'])}")
    print(f"  No images        : {len(summary['no_images'])}")
    print(f"  Images downloaded: {summary['images_downloaded']}")
    print(f"  Report           : {report_path}")
    if summary["not_found"]:
        print("\nNot found UPCs:")
        for line in summary["not_found"]:
            print(f"  - {line}")
    if summary["no_images"]:
        print("\nUPCs with no images:")
        for line in summary["no_images"]:
            print(f"  - {line}")


if __name__ == "__main__":
    main()
