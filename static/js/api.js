const API = {
    sessionToken: null,

    async login(userName, storeId, password) {
        const deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile'
            : /Tablet|iPad/i.test(navigator.userAgent) ? 'tablet' : 'desktop';
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: userName,
                store_id: storeId,
                password: password,
                user_agent: navigator.userAgent,
                screen_width: window.screen.width,
                screen_height: window.screen.height,
                device_type: deviceType,
            }),
        });
        if (res.status === 404) throw new Error('Store not found');
        if (res.status === 401) throw new Error('Invalid password');
        if (!res.ok) throw new Error('Login failed');
        const data = await res.json();
        this.sessionToken = data.session_token;
        return data;
    },

    async logActivity(action, detail = '', extra = {}) {
        if (!this.sessionToken) return;
        try {
            await fetch('/api/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_token: this.sessionToken,
                    action,
                    detail,
                    view_name: extra.view_name || '',
                    duration_ms: extra.duration_ms || 0,
                    meta: extra.meta || '',
                }),
            });
        } catch { /* non-blocking */ }
    },

    async getStores() {
        const res = await fetch('/api/stores');
        if (!res.ok) throw new Error('Failed to load stores');
        return (await res.json()).stores;
    },

    async getPlanogramTypes(storeId) {
        const res = await fetch(`/api/store/${encodeURIComponent(storeId)}/planogram-types`);
        if (!res.ok) throw new Error('Failed to load planogram types');
        return res.json();
    },

    async search(store, upc) {
        const res = await fetch(`/api/search?store=${encodeURIComponent(store)}&upc=${encodeURIComponent(upc)}`);
        if (res.status === 404) return { results: [], count: 0, has_deleted: false };
        if (!res.ok) throw new Error('Search failed');
        return res.json();
    },

    async getPlanogram(dbkey) {
        const res = await fetch(`/api/planogram/${dbkey}`);
        if (!res.ok) throw new Error('Failed to load planogram');
        return res.json();
    },

    async getBay(dbkey, bayNum) {
        const res = await fetch(`/api/planogram/${dbkey}/bay/${bayNum}`);
        if (!res.ok) throw new Error('Failed to load bay');
        return res.json();
    },

    /**
     * @param {string} upc
     * @param {'detail'|'shelf'} [context='detail'] detail = only products/{upc}.jpg; shelf = only products_original/{upc}.png
     */
    async getProductImage(upc, context = 'detail') {
        try {
            const q = context === 'shelf' ? '?context=shelf' : '';
            const res = await fetch(`/api/product-image/${encodeURIComponent(upc)}${q}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.image_url || null;
        } catch {
            return null;
        }
    },

    async getBatchProductImages(upcs) {
        try {
            const res = await fetch('/api/product-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upcs }),
            });
            if (!res.ok) return {};
            const data = await res.json();
            return data.images || {};
        } catch {
            return {};
        }
    },

    async getPdfInfo(dbkey) {
        const res = await fetch(`/api/planogram/${dbkey}/pdf-info`);
        if (!res.ok) return null;
        return res.json();
    },

    async checkDeleted(upc) {
        try {
            const res = await fetch(`/api/deleted-check/${encodeURIComponent(upc)}`);
            if (!res.ok) return { is_deleted: false };
            return res.json();
        } catch {
            return { is_deleted: false };
        }
    },

    async getNotesInfo(category) {
        try {
            const res = await fetch(`/api/notes-info/${encodeURIComponent(category)}`);
            if (!res.ok) return null;
            return res.json();
        } catch {
            return null;
        }
    }
};
