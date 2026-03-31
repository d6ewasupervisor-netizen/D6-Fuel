/**
 * Planogram renderer: displays bay/shelf layout with product thumbnails.
 * - Full-width shelves, all visible in portrait
 * - Product thumbnails with lazy loading
 * - Click-to-detail with shelf navigation
 */
const Planogram = {
    currentData: null,        // Full planogram data
    currentBayIndex: 0,       // Index into bays array
    currentBay: null,         // Current bay data
    highlightUpc: null,
    highlightBay: null,
    highlightShelf: null,
    highlightPosition: null,
    onProductClick: null,
    onBayChange: null,        // Callback for bay change

    setHighlight(upc, bay, shelf, position) {
        this.highlightUpc = upc;
        this.highlightBay = bay;
        this.highlightShelf = shelf;
        this.highlightPosition = position;
    },

    clearHighlight() {
        this.highlightUpc = null;
        this.highlightBay = null;
        this.highlightShelf = null;
        this.highlightPosition = null;
    },

    /**
     * Load a planogram and render the first (or specified) bay
     */
    loadPlanogram(pogData, targetBay = null) {
        this.currentData = pogData;

        if (!pogData.bays || pogData.bays.length === 0) return;

        // Find target bay index
        if (targetBay) {
            this.currentBayIndex = pogData.bays.findIndex(b => b.bay === targetBay);
            if (this.currentBayIndex < 0) this.currentBayIndex = 0;
        } else {
            this.currentBayIndex = 0;
        }

        this.renderCurrentBay();
        this.updateBayIndicator();
        this.updateBayDots();
    },

    renderCurrentBay() {
        if (!this.currentData) return;
        const bayData = this.currentData.bays[this.currentBayIndex];
        if (!bayData) return;
        this.currentBay = bayData;
        this.renderBay(bayData);
    },

    renderBay(bayData) {
        const container = document.getElementById('bay-shelf-container');
        container.innerHTML = '';

        if (!bayData || !bayData.shelves || bayData.shelves.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:32px;">No shelf data</p>';
            return;
        }

        const bayWidthInches = (bayData.width_ft || 3) * 12;
        const unit = document.createElement('div');
        unit.className = 'shelf-unit';

        const shelves = [...bayData.shelves].sort((a, b) => a.shelf - b.shelf);

        const availableHeight = window.innerHeight - 140;
        const totalShelfHeight = shelves.reduce((sum, s) => {
            const maxH = Math.max(...s.products.map(p => p.height_inches || 5), 5);
            return sum + maxH;
        }, 0);
        const pixelsPerInch = Math.min(12, availableHeight / totalShelfHeight);

        const allProducts = [];
        shelves.forEach(shelf => {
            shelf.products.forEach(product => {
                allProducts.push(product);
            });
        });

        shelves.forEach((shelf, shelfIdx) => {
            const row = document.createElement('div');
            row.className = 'shelf-row';
            row.dataset.shelf = shelf.shelf;

            const maxH = Math.max(...shelf.products.map(p => p.height_inches || 5), 5);
            const rowHeight = Math.max(60, maxH * pixelsPerInch);
            row.style.height = rowHeight + 'px';

            const label = document.createElement('span');
            label.className = 'shelf-label';
            label.textContent = `S${shelf.shelf}`;
            row.appendChild(label);

            const productsWrap = document.createElement('div');
            productsWrap.className = 'shelf-products';

            shelf.products.forEach((product, prodIdx) => {
                const totalFacings = product.facings || 1;
                for (let f = 0; f < totalFacings; f++) {
                    const slot = document.createElement('div');
                    slot.className = 'product-slot';

                    const widthPct = ((product.width_inches || 2.5) / bayWidthInches) * 100;
                    slot.style.width = widthPct + '%';
                    slot.style.flexShrink = '0';

                    const desc = (product.description || '').toUpperCase();
                    const colorIdx = desc.charCodeAt(0) % 8;
                    slot.setAttribute('data-color', colorIdx);

                    const img = document.createElement('img');
                    img.className = 'slot-thumb';
                    img.alt = '';
                    img.src = `/static/images/products/${product.upc}.jpg`;

                    img.onerror = () => {
                        img.style.display = 'none';
                        const fb = slot.querySelector('.slot-text');
                        if (fb) fb.style.display = '';
                    };

                    slot.appendChild(img);

                    const text = document.createElement('span');
                    text.className = 'slot-text';
                    text.textContent = (product.full_name || product.description || 'UNK').substring(0, 12);
                    text.style.display = 'none';
                    slot.appendChild(text);

                    if (product.is_new) {
                        const badge = document.createElement('span');
                        badge.className = 'slot-badge slot-badge-new';
                        badge.textContent = 'N';
                        slot.appendChild(badge);
                    } else if (product.is_changed) {
                        const badge = document.createElement('span');
                        badge.className = 'slot-badge slot-badge-changed';
                        badge.textContent = 'C';
                        slot.appendChild(badge);
                    }

                    if (this.highlightUpc &&
                        product.upc === this.highlightUpc &&
                        product.bay === this.highlightBay &&
                        product.shelf === this.highlightShelf &&
                        product.position === this.highlightPosition) {
                        slot.classList.add('highlight');
                        setTimeout(() => {
                            slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }

                    slot.onclick = () => {
                        if (this.onProductClick) {
                            this.onProductClick(product, shelfIdx, prodIdx, shelf, bayData);
                        }
                    };

                    productsWrap.appendChild(slot);
                }
            });

            row.appendChild(productsWrap);
            unit.appendChild(row);
        });

        container.appendChild(unit);
    },

    // Bay navigation
    nextBay() {
        if (!this.currentData) return false;
        if (this.currentBayIndex < this.currentData.bays.length - 1) {
            this.currentBayIndex++;
            Gestures.resetZoom();
            this.renderCurrentBay();
            this.updateBayIndicator();
            this.updateBayDots();
            return true;
        }
        return false;
    },

    prevBay() {
        if (!this.currentData) return false;
        if (this.currentBayIndex > 0) {
            this.currentBayIndex--;
            Gestures.resetZoom();
            this.renderCurrentBay();
            this.updateBayIndicator();
            this.updateBayDots();
            return true;
        }
        return false;
    },

    goToBay(index) {
        if (!this.currentData || index < 0 || index >= this.currentData.bays.length) return;
        this.currentBayIndex = index;
        Gestures.resetZoom();
        this.renderCurrentBay();
        this.updateBayIndicator();
        this.updateBayDots();
    },

    updateBayIndicator() {
        if (!this.currentData) return;
        const total = this.currentData.bays.length;
        const current = this.currentBayIndex + 1;
        const bayNum = this.currentData.bays[this.currentBayIndex]?.bay || current;
        document.getElementById('bay-indicator').textContent = `Bay ${bayNum} of ${total}`;

        // Show/hide nav arrows
        document.getElementById('bay-prev-arrow').style.visibility =
            this.currentBayIndex > 0 ? 'visible' : 'hidden';
        document.getElementById('bay-next-arrow').style.visibility =
            this.currentBayIndex < total - 1 ? 'visible' : 'hidden';
    },

    updateBayDots() {
        if (!this.currentData) return;
        const container = document.getElementById('bay-dots');
        container.innerHTML = '';
        const total = this.currentData.bays.length;
        if (total <= 1) return;

        for (let i = 0; i < total; i++) {
            const btn = document.createElement('button');
            btn.className = 'bay-num' + (i === this.currentBayIndex ? ' active' : '');
            btn.textContent = this.currentData.bays[i].bay;
            btn.onclick = () => this.goToBay(i);
            container.appendChild(btn);
        }

        const activeBtn = container.querySelector('.bay-num.active');
        if (activeBtn) {
            activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
    },

    /**
     * Get navigation context for product detail overlay
     */
    getNavContext(shelfIdx, prodIdx, shelf, bayData) {
        const shelves = [...bayData.shelves].sort((a, b) => a.shelf - b.shelf);
        const products = shelf.products;

        const hasPrev = prodIdx > 0;
        const hasNext = prodIdx < products.length - 1;
        const hasShelfUp = shelfIdx < shelves.length - 1;
        const hasShelfDown = shelfIdx > 0;
        const hasNextBay = this.currentData && this.currentBayIndex < this.currentData.bays.length - 1;
        const hasPrevBay = this.currentData && this.currentBayIndex > 0;

        return {
            hasPrev, hasNext, hasShelfUp, hasShelfDown, hasNextBay, hasPrevBay,
            shelfIdx, prodIdx, shelf, bayData, shelves, products
        };
    }
};
