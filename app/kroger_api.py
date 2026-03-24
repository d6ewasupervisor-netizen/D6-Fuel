import os
import time
import httpx
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "db", "planograms.db")
TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCT_URL = "https://api.kroger.com/v1/products"
LOCATIONS_URL = "https://api.kroger.com/v1/locations"

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


def _extract_description(product):
    """Extract the consumer-facing description from a Kroger product object."""
    return product.get("description", "")


def _get_cached_description(upc):
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute(
            "SELECT full_name FROM product_descriptions WHERE upc = ?", (upc,)
        ).fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


def _cache_description(upc, full_name):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT OR REPLACE INTO product_descriptions (upc, full_name, fetched_at) "
            "VALUES (?, ?, datetime('now'))",
            (upc, full_name),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _extract_image_url(product):
    """Extract the best image URL from a Kroger product object."""
    images = product.get("images", [])
    if not images:
        return ""
    # Prefer "front" perspective
    for img in images:
        if img.get("perspective") == "front":
            sizes = img.get("sizes", [])
            for s in sizes:
                if s.get("size") == "medium":
                    return s.get("url", "")
            if sizes:
                return sizes[0].get("url", "")
    # Fall back to first image
    sizes = images[0].get("sizes", [])
    for s in sizes:
        if s.get("size") == "medium":
            return s.get("url", "")
    if sizes:
        return sizes[0].get("url", "")
    return ""


def _get_location_id():
    """Get optional Kroger location ID (8-digit store identifier).

    Format: 3-digit division number + 5-digit store number.
    Example: division 701, store 351 -> '70100351'
    """
    return os.environ.get("KROGER_LOCATION_ID", "")


def lookup_location_by_zip(zip_code, chain="Kroger"):
    """Look up Kroger store locations by zip code.

    Returns a list of dicts with locationId, name, storeNumber, divisionNumber, address.
    """
    token = _get_token()
    if not token:
        return []

    try:
        params = {
            "filter.zipCode.near": zip_code,
            "filter.chain": chain,
            "filter.limit": 10,
            "filter.radiusInMiles": 25,
        }
        resp = httpx.get(
            LOCATIONS_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        locations = []
        for loc in data.get("data", []):
            addr = loc.get("address", {})
            locations.append({
                "locationId": loc.get("locationId", ""),
                "name": loc.get("name", ""),
                "storeNumber": loc.get("storeNumber", ""),
                "divisionNumber": loc.get("divisionNumber", ""),
                "address": f"{addr.get('addressLine1', '')}, {addr.get('city', '')}, {addr.get('state', '')} {addr.get('zipCode', '')}",
            })
        return locations
    except Exception:
        return []


def _build_product_params(extra_params=None):
    """Build query params dict, including locationId if configured."""
    params = extra_params or {}
    location_id = _get_location_id()
    if location_id:
        params["filter.locationId"] = location_id
    return params


def get_product_image(upc):
    cached = _get_cached_image(upc)
    if cached is not None:
        return cached

    token = _get_token()
    if not token:
        return None

    try:
        params = _build_product_params({"filter.productId": upc})
        resp = httpx.get(
            PRODUCT_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        products = data.get("data", [])
        if products:
            url = _extract_image_url(products[0])
            _cache_image(upc, url)
            return url
        _cache_image(upc, "")
        return ""
    except Exception:
        return None


def get_product_description(upc):
    """Fetch the full consumer-facing product name for a UPC."""
    cached = _get_cached_description(upc)
    if cached is not None:
        return cached

    token = _get_token()
    if not token:
        return None

    try:
        params = _build_product_params({"filter.productId": upc})
        resp = httpx.get(
            PRODUCT_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        products = resp.json().get("data", [])
        if products:
            name = _extract_description(products[0])
            _cache_description(upc, name)
            return name
        _cache_description(upc, "")
        return ""
    except Exception:
        return None


def get_product_descriptions_batch(upcs):
    """Fetch full product names for up to 50 UPCs in a single API call.

    Returns a dict mapping UPC -> full_name (or empty string if not found).
    """
    token = _get_token()
    if not token:
        return {}

    results = {}
    try:
        params = _build_product_params({
            "filter.productId": ",".join(upcs),
            "filter.limit": 50,
        })
        resp = httpx.get(
            PRODUCT_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        for product in data.get("data", []):
            pid = product.get("productId", "")
            name = _extract_description(product)
            results[pid] = name
            _cache_description(pid, name)

        for upc in upcs:
            if upc not in results:
                results[upc] = ""
                _cache_description(upc, "")
    except Exception:
        pass

    return results


def get_product_images_batch(upcs):
    """Fetch image URLs for up to 50 UPCs in a single API call.

    Returns a dict mapping UPC -> image URL (or empty string if no image).
    Also caches product descriptions as a side effect.
    """
    token = _get_token()
    if not token:
        return {}

    results = {}
    try:
        params = _build_product_params({
            "filter.productId": ",".join(upcs),
            "filter.limit": 50,
        })
        resp = httpx.get(
            PRODUCT_URL,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        # Map returned products by productId
        for product in data.get("data", []):
            pid = product.get("productId", "")
            url = _extract_image_url(product)
            results[pid] = url
            _cache_image(pid, url)
            # Also cache description as a side effect
            name = _extract_description(product)
            _cache_description(pid, name)

        # Mark UPCs not returned by API as having no image
        for upc in upcs:
            if upc not in results:
                results[upc] = ""
                _cache_image(upc, "")

    except Exception:
        pass

    return results
