/**
 * IndexedDB-based image cache for product thumbnails.
 * Stores fetched thumbnail blobs locally so bay view images
 * load instantly on repeat visits without network requests.
 */
const ImageCache = {
    DB_NAME: 'VitaminImageCache',
    DB_VERSION: 1,
    STORE_NAME: 'thumbnails',
    MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    _db: null,

    async open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'url' });
                }
            };
            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async get(url) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.get(url);
                req.onsuccess = () => {
                    const record = req.result;
                    if (record && (Date.now() - record.timestamp < this.MAX_AGE_MS)) {
                        resolve(record.blob);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            });
        } catch {
            return null;
        }
    },

    async put(url, blob) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                store.put({ url, blob, timestamp: Date.now() });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch {
            return false;
        }
    },

    /**
     * Load an image element: try cache first, then network (and cache the result).
     * Object URLs are revoked after the browser decodes the image to prevent
     * long-session memory growth on low-RAM mobile devices.
     */
    async loadImage(img, url) {
        // Try cached blob first
        const cached = await this.get(url);
        if (cached) {
            const objUrl = URL.createObjectURL(cached);
            img.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
            img.addEventListener('error', () => URL.revokeObjectURL(objUrl), { once: true });
            img.src = objUrl;
            return;
        }

        // Fetch from network
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('fetch failed');
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            img.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
            img.addEventListener('error', () => URL.revokeObjectURL(objUrl), { once: true });
            img.src = objUrl;
            // Store in cache (fire and forget)
            this.put(url, blob);
        } catch {
            // Trigger normal onerror fallback
            img.src = url;
        }
    },

    /**
     * Prune expired entries (call occasionally, e.g. on app init).
     */
    async prune() {
        try {
            const db = await this.open();
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (Date.now() - cursor.value.timestamp > this.MAX_AGE_MS) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
        } catch { /* non-critical */ }
    }
};
