/**
 * Planogram renderer (slim fork): shelves + thumbnails from images_placeholder/<UPC>.png
 */
const Planogram = {
    currentData: null,
    currentBayIndex: 0,
    currentBay: null,
    highlightUpc: null,
    highlightBay: null,
    highlightShelf: null,
    highlightPosition: null,
    highlightElement: null,
    highlightGroup: null,
    onProductClick: null,
    _observer: null,

    imageUrlForUpc(upc) {
        return `images_placeholder/${upc}.png`;
    },

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
        this.highlightElement = null;
        this.highlightGroup = null;
    },

    activateHighlight() {
        if (this.highlightElement) {
            this.highlightElement.classList.add('highlight');
            if (this.highlightGroup) {
                this.highlightGroup.classList.add('highlight-group');
            }
        }
    },

    startBlinkHighlight() {
        if (this.highlightElement) {
            this.highlightElement.classList.add('highlight-blink');
            if (this.highlightGroup) {
                this.highlightGroup.classList.add('highlight-group-blink');
            }
        }
    },

    stopBlinkHighlight() {
        if (this.highlightElement) {
            this.highlightElement.classList.remove('highlight-blink');
            if (this.highlightGroup) {
                this.highlightGroup.classList.remove('highlight-group-blink');
            }
        }
    },

    deactivateHighlight() {
        if (this.highlightElement) {
            this.highlightElement.classList.remove('highlight', 'highlight-blink');
            this.highlightElement.classList.remove('highlight-target');
        }
        if (this.highlightGroup) {
            this.highlightGroup.classList.remove('highlight-group', 'highlight-group-blink');
        }
        this.highlightElement = null;
        this.highlightGroup = null;
    },

    loadPlanogram(pogData, targetBay = null) {
        this.currentData = pogData;

        if (!pogData.bays || pogData.bays.length === 0) return;

        if (targetBay != null) {
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
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }

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

            const totalRawWidth = shelf.products.reduce((sum, p) => {
                return sum + (p.width_inches || 2.5) * (p.facings || 1);
            }, 0);
            const widthScale = totalRawWidth > 0 ? bayWidthInches / totalRawWidth : 1;

            shelf.products.forEach((product, prodIdx) => {
                const totalFacings = product.facings || 1;
                const isMultiFacing = totalFacings > 1;
                const rawProductWidth = (product.width_inches || 2.5) * totalFacings;
                const scaledWidthPct = (rawProductWidth * widthScale / bayWidthInches) * 100;

                let groupWrap = null;
                if (isMultiFacing) {
                    groupWrap = document.createElement('div');
                    groupWrap.className = 'multi-facing-group';
                    groupWrap.style.width = scaledWidthPct + '%';
                    groupWrap.style.flexShrink = '0';

                    const countBadge = document.createElement('span');
                    countBadge.className = 'facing-count-badge';
                    countBadge.textContent = '\u00d7' + totalFacings;
                    groupWrap.appendChild(countBadge);
                }

                for (let f = 0; f < totalFacings; f++) {
                    const slot = document.createElement('div');
                    slot.className = 'product-slot';
                    if (isMultiFacing) slot.classList.add('multi-facing-slot');

                    if (isMultiFacing) {
                        slot.style.width = (100 / totalFacings) + '%';
                    } else {
                        slot.style.width = scaledWidthPct + '%';
                    }
                    slot.style.flexShrink = '0';

                    const desc = (product.description || '').toUpperCase();
                    const colorIdx = desc.charCodeAt(0) % 8;
                    slot.setAttribute('data-color', colorIdx);

                    const img = document.createElement('img');
                    img.className = 'slot-thumb';
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.dataset.src = this.imageUrlForUpc(product.upc);

                    img.onerror = () => {
                        img.style.display = 'none';
                        const fb = slot.querySelector('.slot-text');
                        if (fb) fb.style.display = '';
                    };

                    slot.appendChild(img);

                    const text = document.createElement('span');
                    text.className = 'slot-text';
                    text.textContent = (product.full_name || product.description || 'UNK').substring(0, 14);
                    text.style.display = 'none';
                    slot.appendChild(text);

                    if (f === 0) {
                        const posNum = document.createElement('span');
                        posNum.className = 'slot-position';
                        posNum.textContent = product.position;
                        slot.appendChild(posNum);
                    }

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
                        this.highlightElement = slot;
                        this.highlightGroup = groupWrap || null;
                        slot.classList.add('highlight-target');
                        setTimeout(() => {
                            const scrollTarget = groupWrap || slot;
                            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }

                    slot.onclick = () => {
                        if (this.onProductClick) {
                            this.onProductClick(product, shelfIdx, prodIdx, shelf, bayData);
                        }
                    };

                    if (groupWrap) {
                        groupWrap.appendChild(slot);
                    } else {
                        productsWrap.appendChild(slot);
                    }
                }

                if (groupWrap) {
                    productsWrap.appendChild(groupWrap);
                }
            });

            row.appendChild(productsWrap);
            unit.appendChild(row);
        });

        container.appendChild(unit);

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            delete img.dataset.src;
                        }
                        observer.unobserve(img);
                    }
                });
            }, { root: container, rootMargin: '100px' });

            this._observer = observer;

            container.querySelectorAll('img.slot-thumb[data-src]').forEach(img => {
                observer.observe(img);
            });
        }
    },

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
