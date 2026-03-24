const API = {
    async getStores() {
        const res = await fetch('/api/stores');
        if (!res.ok) throw new Error('Failed to load stores');
        return (await res.json()).stores;
    },

    async search(store, upc) {
        const res = await fetch(`/api/search?store=${encodeURIComponent(store)}&upc=${encodeURIComponent(upc)}`);
        if (res.status === 404) return { results: [], count: 0 };
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

    async getProductImage(upc) {
        try {
            const res = await fetch(`/api/product-image/${encodeURIComponent(upc)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.image_url || null;
        } catch {
            return null;
        }
    }
};
