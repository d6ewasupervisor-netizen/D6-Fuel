import os
import time
import httpx
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "db", "planograms.db")
TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCT_URL = "https://api.kroger.com/v1/products"

_token_cache = {"token": None, "expires_at": 0}


def _get_credentials():
    client_id = os.environ.get("KROGER_CLIENT_ID", "")
    client_secret = os.environ.get("KROGER_CLIENT_SECRET", "")
    return client_id, client_secret


def _get_token():
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    client_id, client_secret = _get_credentials()
    if not client_id or not client_secret:
        return None

    try:
        resp = httpx.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials", "scope": "product.compact"},
            auth=(client_id, client_secret),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _token_cache["token"] = data["access_token"]
        _token_cache["expires_at"] = now + data.get("expires_in", 1800)
        return _token_cache["token"]
    except Exception:
        return None


def _get_cached_image(upc):
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute(
            "SELECT image_url FROM product_images WHERE upc = ?", (upc,)
        ).fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


def _cache_image(upc, url):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT OR REPLACE INTO product_images (upc, image_url, fetched_at) VALUES (?, ?, datetime('now'))",
            (upc, url),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def get_product_image(upc):
    cached = _get_cached_image(upc)
    if cached is not None:
        return cached

    token = _get_token()
    if not token:
        return None

    try:
        resp = httpx.get(
            PRODUCT_URL,
            params={"filter.term": upc},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        products = data.get("data", [])
        if products:
            images = products[0].get("images", [])
            if images:
                sizes = images[0].get("sizes", [])
                for s in sizes:
                    if s.get("size") == "medium":
                        url = s.get("url", "")
                        _cache_image(upc, url)
                        return url
                if sizes:
                    url = sizes[0].get("url", "")
                    _cache_image(upc, url)
                    return url
        _cache_image(upc, "")
        return ""
    except Exception:
        return None
