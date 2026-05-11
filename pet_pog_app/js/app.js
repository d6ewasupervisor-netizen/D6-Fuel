/**
 * Slim static client for frozen/refrigerated pet planograms (P02 W04 Y2026).
 * Data: window.PET_POG_PLANOGRAMS from planograms-data.js (regenerate via tools/build_pet_pog_data.py).
 */
const PetPogApp = {
    flatIndex: [],
    currentPog: null,
    currentPogMeta: null,
    overlayNav: null,
    _navToken: null,

    init() {
        const root = window.PET_POG_PLANOGRAMS;
        if (!root || !root.planograms) {
            document.getElementById('type-cards').innerHTML =
                '<p class="error">Missing planogram data. Run <code>python tools/build_pet_pog_data.py</code>.</p>';
            return;
        }

        this.flatIndex = this._flatten(root.planograms);
        this._bind();
        this._renderTypeCards(root.planograms);
        this._initMobile();
    },

    _flatten(planograms) {
        const out = [];
        for (const pog of planograms) {
            for (const bay of pog.bays) {
                for (const sh of bay.shelves) {
                    for (const p of sh.products) {
                        out.push({
                            ...p,
                            _sourcePog: pog,
                        });
                    }
                }
            }
        }
        return out;
    },

    _bind() {
        document.getElementById('back-to-type').onclick = () => this.showView('type-select');

        document.getElementById('bay-prev-arrow').onclick = () => Planogram.prevBay();
        document.getElementById('bay-next-arrow').onclick = () => Planogram.nextBay();

        document.getElementById('bay-upc-search').onclick = () => this.doBaySearch();
        document.getElementById('bay-upc-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.doBaySearch();
        };

        document.getElementById('close-overlay').onclick = () => this.closeOverlay();
        document.getElementById('product-overlay').onclick = (e) => {
            if (e.target === e.currentTarget) this.closeOverlay();
        };
        document.getElementById('overlay-prev').onclick = () => this.overlayNavigate(-1);
        document.getElementById('overlay-next').onclick = () => this.overlayNavigate(1);

        const lightbox = document.getElementById('image-lightbox');
        document.getElementById('lightbox-close').onclick = () => lightbox.classList.add('hidden');
        lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); };

        document.getElementById('back-from-search').onclick = () => this.showView('bay');

        Planogram.onProductClick = (product, shelfIdx, prodIdx, shelf, bayData) => {
            this.showProductOverlay(product, shelfIdx, prodIdx, shelf, bayData);
        };
    },

    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + name).classList.add('active');

        if (name === 'bay') {
            const container = document.getElementById('bay-shelf-container');
            Gestures.init(container, {
                onSwipeLeft: () => Planogram.nextBay(),
                onSwipeRight: () => Planogram.prevBay(),
            });
        }
    },

    _renderTypeCards(planograms) {
        const container = document.getElementById('type-cards');
        container.innerHTML = '';
        planograms.forEach((pog, i) => {
            const nBays = pog.bays?.length || 0;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'type-card';
            card.innerHTML = `
                <div class="type-icon type-icon-regular">${i === 0 ? '&#10052;' : '&#127846;'}</div>
                <div class="type-card-text">
                    <h3 class="type-label">${this._shortTitle(pog.label)}</h3>
                    <p class="type-desc">${pog.sheet_name || ''}</p>
                    <span class="type-meta">${nBays} bay${nBays === 1 ? '' : 's'} &middot; DBKey ${pog.planogram_dbkey || '?'}</span>
                </div>
            `;
            card.onclick = () => this.selectPlanogram(pog);
            container.appendChild(card);
        });
    },

    _shortTitle(label) {
        const s = (label || '').replace(/^FRZ REF\s+/i, '').trim();
        return s || label || 'Planogram';
    },

    selectPlanogram(pog) {
        this.currentPog = pog;
        this.currentPogMeta = {
            label: pog.label,
            dbkey: pog.planogram_dbkey,
        };
        document.getElementById('bay-pog-name').textContent = this._shortTitle(pog.label);
        const shelfContainer = document.getElementById('bay-shelf-container');
        shelfContainer.innerHTML = '';
        Planogram.clearHighlight();
        Planogram.loadPlanogram({ bays: pog.bays });
        this.showView('bay');
        document.getElementById('bay-upc-input').value = '';
    },

    _matchUpc(queryDigits, upc) {
        const u = (upc || '').replace(/\D/g, '');
        const q = (queryDigits || '').replace(/\D/g, '');
        if (q.length < 4) return false;
        return u.endsWith(q) || u.includes(q);
    },

    doBaySearch() {
        const input = document.getElementById('bay-upc-input');
        const raw = input.value.trim();
        const q = raw.replace(/\D/g, '');
        if (q.length < 4) {
            input.classList.add('bay-search-error');
            setTimeout(() => input.classList.remove('bay-search-error'), 800);
            return;
        }

        const matches = this.flatIndex.filter(p => this._matchUpc(q, p.upc));

        if (matches.length === 0) {
            input.classList.add('bay-search-error');
            input.value = '';
            input.placeholder = 'Not found';
            setTimeout(() => {
                input.classList.remove('bay-search-error');
                input.placeholder = 'Last digits of UPC';
            }, 1500);
            return;
        }

        input.value = '';

        if (matches.length === 1) {
            this.navigateToProduct(matches[0]);
            return;
        }

        this._renderSearchResults(matches);
        this.showView('search');
    },

    _renderSearchResults(matches) {
        const container = document.getElementById('search-results-list');
        container.innerHTML = '';

        matches.forEach(m => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'search-result-card';
            const short = this._shortTitle(m._sourcePog.label);
            const newBadge = m.is_new ? '<span class="badge badge-new">NEW</span>' : '';
            card.innerHTML = `
                <div class="search-result-info">
                    <h3 class="search-result-name">${m.full_name || m.description || 'Unknown'} ${newBadge}</h3>
                    <p class="search-result-detail">UPC: ${m.upc} &middot; ${m.size || '-'}</p>
                    <p class="search-result-location">Bay ${m.bay} / Shelf ${m.shelf} / Pos ${m.position}</p>
                    <p class="search-result-pog"><span class="pog-tag pog-tag-regular">${short}</span></p>
                </div>
                <span class="search-result-arrow">&rsaquo;</span>
            `;
            card.onclick = () => this.navigateToProduct(m);
            container.appendChild(card);
        });
    },

    navigateToProduct(hit) {
        const navToken = Symbol();
        this._navToken = navToken;

        const pog = hit._sourcePog;
        if (!this.currentPog || this.currentPog.planogram_dbkey !== pog.planogram_dbkey) {
            this.currentPog = pog;
            this.currentPogMeta = { label: pog.label, dbkey: pog.planogram_dbkey };
            document.getElementById('bay-pog-name').textContent = this._shortTitle(pog.label);
        }

        if (this._navToken !== navToken) return;

        Planogram.clearHighlight();
        Planogram.setHighlight(hit.upc, hit.bay, hit.shelf, hit.position);
        Planogram.loadPlanogram({ bays: pog.bays }, hit.bay);
        this.showView('bay');
        this.showLocationOverlay(this._shortTitle(pog.label), hit.bay, hit.shelf, hit.position);
    },

    showLocationOverlay(categoryLabel, bay, shelf, position) {
        const existing = document.getElementById('location-flash-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'location-flash-overlay';
        overlay.className = 'location-flash-overlay';
        overlay.innerHTML = `
            <div class="location-flash-content location-flash-stacked">
                <div class="location-flash-row location-flash-hidden location-flash-category-row" data-flash="category">
                    <span class="location-flash-category-text">${categoryLabel}</span>
                </div>
                <div class="location-flash-row location-flash-hidden" data-flash="bay">
                    <span class="location-flash-label">BAY</span>
                    <span class="location-flash-value">${bay}</span>
                </div>
                <div class="location-flash-row location-flash-hidden" data-flash="shelf">
                    <span class="location-flash-label">SHELF</span>
                    <span class="location-flash-value">${shelf}</span>
                </div>
                <div class="location-flash-row location-flash-hidden" data-flash="position">
                    <span class="location-flash-label">POSITION</span>
                    <span class="location-flash-value">${position}</span>
                </div>
            </div>
        `;

        const bayContainer = document.querySelector('.bay-view-container');
        bayContainer.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const FLASH_MS = 1000;
        const HOLD_MS = 5000;
        const NUM_ROWS = 4;
        const ROWS_TOTAL = FLASH_MS * NUM_ROWS;
        const OVERLAY_TOTAL_MS = ROWS_TOTAL + HOLD_MS;
        const BLINK_MS = 2000;
        const STATIC_MS = 2000;

        const rows = overlay.querySelectorAll('.location-flash-row');
        rows.forEach((row, i) => {
            setTimeout(() => {
                row.classList.remove('location-flash-hidden');
                row.classList.add('location-flash-pop');
            }, FLASH_MS * i);
        });

        setTimeout(() => Planogram.activateHighlight(), ROWS_TOTAL);

        setTimeout(() => {
            overlay.classList.remove('visible');
            overlay.classList.add('fade-out');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 600);
        }, OVERLAY_TOTAL_MS);

        setTimeout(() => Planogram.startBlinkHighlight(), OVERLAY_TOTAL_MS);
        setTimeout(() => Planogram.stopBlinkHighlight(), OVERLAY_TOTAL_MS + BLINK_MS);
        setTimeout(() => Planogram.deactivateHighlight(), OVERLAY_TOTAL_MS + BLINK_MS + STATIC_MS);
    },

    showProductOverlay(product, shelfIdx, prodIdx, shelf, bayData) {
        const overlay = document.getElementById('product-overlay');
        document.getElementById('overlay-name').textContent = product.full_name || product.description || 'Unknown';
        document.getElementById('overlay-upc').textContent = product.upc;
        document.getElementById('overlay-size').textContent = product.size || '-';
        document.getElementById('overlay-pos-detail').textContent =
            `Bay ${product.bay}, Shelf ${product.shelf}, Pos ${product.position}`;
        document.getElementById('overlay-facings').textContent = product.facings || 1;
        document.getElementById('overlay-dims').textContent =
            `${product.height_inches ?? '?'}\" H x ${product.width_inches ?? '?'}\" W`;

        const badge = document.getElementById('overlay-badge');
        if (product.is_new) {
            badge.textContent = 'NEW';
            badge.className = 'badge badge-new';
            badge.style.display = '';
        } else if (product.is_changed) {
            badge.textContent = 'CHANGED';
            badge.className = 'badge badge-changed';
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }

        const nav = Planogram.getNavContext(shelfIdx, prodIdx, shelf, bayData);
        this.overlayNav = nav;
        document.getElementById('overlay-position-label').textContent =
            `${prodIdx + 1} of ${shelf.products.length} on Shelf ${shelf.shelf}`;

        document.getElementById('overlay-prev').style.visibility = nav.hasPrev ? 'visible' : 'hidden';
        document.getElementById('overlay-next').style.visibility = nav.hasNext ? 'visible' : 'hidden';

        const hints = document.getElementById('overlay-nav-hints');
        hints.innerHTML = '';
        if (!nav.hasNext && nav.hasNextBay) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `Continue to Bay ${this.currentPog.bays[Planogram.currentBayIndex + 1]?.bay || '?'} \u2192`;
            btn.onclick = () => {
                this.closeOverlay();
                Planogram.nextBay();
            };
            hints.appendChild(btn);
        }
        if (nav.hasShelfUp) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `\u2191 Shelf ${nav.shelves[shelfIdx + 1]?.shelf || '?'}`;
            btn.onclick = () => {
                const nextShelf = nav.shelves[shelfIdx + 1];
                if (nextShelf && nextShelf.products.length > 0) {
                    this.showProductOverlay(nextShelf.products[0], shelfIdx + 1, 0, nextShelf, bayData);
                }
            };
            hints.appendChild(btn);
        }
        if (nav.hasShelfDown) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `\u2193 Shelf ${nav.shelves[shelfIdx - 1]?.shelf || '?'}`;
            btn.onclick = () => {
                const prevShelf = nav.shelves[shelfIdx - 1];
                if (prevShelf && prevShelf.products.length > 0) {
                    this.showProductOverlay(prevShelf.products[0], shelfIdx - 1, 0, prevShelf, bayData);
                }
            };
            hints.appendChild(btn);
        }

        const imgSrc = Planogram.imageUrlForUpc(product.upc);
        const imgContainer = document.getElementById('overlay-image');
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = product.description || '';
        img.onerror = () => {
            imgContainer.innerHTML = '<div class="placeholder-img">&#128054;</div>';
        };
        img.onclick = () => {
            const lb = document.getElementById('image-lightbox');
            document.getElementById('lightbox-img').src = imgSrc;
            document.getElementById('lightbox-img').alt = product.description || '';
            lb.classList.remove('hidden');
        };
        imgContainer.innerHTML = '';
        imgContainer.appendChild(img);
        overlay.classList.remove('hidden');
    },

    closeOverlay() {
        document.getElementById('product-overlay').classList.add('hidden');
        this.overlayNav = null;
    },

    overlayNavigate(delta) {
        if (!this.overlayNav) return;
        const nav = this.overlayNav;
        const newIdx = nav.prodIdx + delta;

        if (newIdx >= 0 && newIdx < nav.products.length) {
            const product = nav.products[newIdx];
            this.showProductOverlay(product, nav.shelfIdx, newIdx, nav.shelf, nav.bayData);
        }
    },

    _initMobile() {
        const setVh = () => {
            document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
        };
        setVh();
        window.addEventListener('resize', setVh);
    }
};

document.addEventListener('DOMContentLoaded', () => PetPogApp.init());
