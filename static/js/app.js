const App = {
    storeId: null,
    userName: null,
    sessionToken: null,
    validStores: null,
    currentPlanogram: null,
    currentPlanogramDbkey: null,
    currentCategory: null,
    previousView: 'bay',
    overlayNav: null, // current navigation context for overlay
    _viewEnterTime: 0,
    _currentView: null,

    init() {
        this.bindEvents();
        PDFViewer.init();
        this.loadStoreList();
        this.initMobileOptimizations();

        // Restore session
        const saved = sessionStorage.getItem('sessionToken');
        const savedStore = sessionStorage.getItem('storeId');
        const savedName = sessionStorage.getItem('userName');
        if (saved && savedStore && savedName) {
            this.sessionToken = saved;
            this.storeId = savedStore;
            this.userName = savedName;
            API.sessionToken = saved;
            this.showView('type-select');
        }
    },

    bindEvents() {
        // Login
        document.getElementById('store-submit').onclick = () => this.submitLogin();
        document.getElementById('name-input').onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('store-input').focus();
        };
        document.getElementById('store-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.submitLogin();
        };

        // Back buttons
        document.getElementById('back-to-login').onclick = () => {
            sessionStorage.clear();
            this.showView('login');
        };
        document.getElementById('back-to-type').onclick = () => this.showView('type-select');
        document.getElementById('back-from-search').onclick = () => {
            Scanner.stop();
            this.showView(this.previousView);
        };

        // Bay view actions
        document.getElementById('bay-search-btn').onclick = () => {
            this.previousView = 'bay';
            this.showView('search');
        };
        document.getElementById('bay-pdf-btn').onclick = () => this.openPdfForCurrentPlanogram();
        document.getElementById('bay-prev-arrow').onclick = () => Planogram.prevBay();
        document.getElementById('bay-next-arrow').onclick = () => Planogram.nextBay();

        // Search
        document.getElementById('upc-submit').onclick = () => this.doSearch();
        document.getElementById('upc-input').onkeydown = (e) => { if (e.key === 'Enter') this.doSearch(); };
        document.getElementById('toggle-scanner').onclick = () => this.toggleScanner();

        // Product overlay
        document.getElementById('close-overlay').onclick = () => this.closeOverlay();
        document.getElementById('product-overlay').onclick = (e) => {
            if (e.target === e.currentTarget) this.closeOverlay();
        };
        document.getElementById('overlay-prev').onclick = () => this.overlayNavigate(-1);
        document.getElementById('overlay-next').onclick = () => this.overlayNavigate(1);
        document.getElementById('overlay-pdf-btn').onclick = () => this.openPdfFromOverlay();

        // Deleted overlay
        document.getElementById('deleted-dismiss').onclick = () => {
            document.getElementById('deleted-overlay').classList.add('hidden');
        };

        // Image lightbox
        const lightbox = document.getElementById('image-lightbox');
        document.getElementById('lightbox-close').onclick = () => lightbox.classList.add('hidden');
        lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); };

        // Planogram callbacks
        Planogram.onProductClick = (product, shelfIdx, prodIdx, shelf, bayData) => {
            this.showProductOverlay(product, shelfIdx, prodIdx, shelf, bayData);
        };
    },

    showView(name) {
        // Log duration of previous view
        if (this._currentView && this._viewEnterTime) {
            const duration = Date.now() - this._viewEnterTime;
            API.logActivity('view_exit', this._currentView, {
                view_name: this._currentView,
                duration_ms: duration,
            });
        }
        this._currentView = name;
        this._viewEnterTime = Date.now();

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + name).classList.add('active');

        if (name === 'type-select') {
            document.getElementById('type-store-label').textContent = `Store #${this.storeId}`;
            this.loadPlanogramTypes();
        } else if (name === 'search') {
            document.getElementById('store-label').textContent = `Store #${this.storeId}`;
            document.getElementById('upc-input').value = '';
            document.getElementById('search-error').classList.add('hidden');
            document.getElementById('search-spinner').classList.add('hidden');
            document.getElementById('search-results-list').classList.add('hidden');
            document.getElementById('upc-input').focus();
        } else if (name === 'bay') {
            // Init gestures on bay container
            const container = document.getElementById('bay-shelf-container');
            Gestures.init(container, {
                onSwipeLeft: () => Planogram.nextBay(),
                onSwipeRight: () => Planogram.prevBay(),
            });
        }

        API.logActivity('view', name, { view_name: name });
    },

    async submitLogin() {
        const nameInput = document.getElementById('name-input');
        const storeInput = document.getElementById('store-input');
        const error = document.getElementById('store-error');

        const name = nameInput.value.trim();
        const raw = storeInput.value.trim();

        if (!name) {
            error.textContent = 'Please enter your name';
            error.classList.remove('hidden');
            return;
        }
        if (!raw || !/^\d+$/.test(raw)) {
            error.textContent = 'Please enter a valid store number';
            error.classList.remove('hidden');
            return;
        }

        error.classList.add('hidden');

        try {
            const data = await API.login(name, raw);
            this.storeId = data.store_id;
            this.userName = data.user_name;
            this.sessionToken = data.session_token;
            sessionStorage.setItem('sessionToken', data.session_token);
            sessionStorage.setItem('storeId', data.store_id);
            sessionStorage.setItem('userName', data.user_name);
            this.showView('type-select');
        } catch (e) {
            error.textContent = e.message === 'Store not found'
                ? `Store ${raw} not found in planogram data.`
                : 'Login failed. Try again.';
            error.classList.remove('hidden');
        }
    },

    async loadStoreList() {
        const hint = document.getElementById('store-list-hint');
        const dl = document.getElementById('store-list');
        if (!hint || !dl) return;

        try {
            const res = await fetch('/api/stores');
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            const stores = data.stores || [];
            this.validStores = stores;
            dl.innerHTML = stores.map(id => `<option value="${Number(id)}">`).join('');
            hint.textContent = stores.length
                ? 'Select your store number to begin'
                : 'No stores loaded yet. Contact your supervisor.';
        } catch {
            hint.textContent = 'Could not connect to server. Try refreshing.';
        }
    },

    async loadPlanogramTypes() {
        const container = document.getElementById('type-cards');
        container.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';

        try {
            const data = await API.getPlanogramTypes(this.storeId);
            container.innerHTML = '';

            if (data.types.length === 0) {
                container.innerHTML = '<p class="type-empty">No planograms available for this store.</p>';
                return;
            }

            // If only one type, auto-select
            if (data.types.length === 1) {
                this.selectPlanogramType(data.types[0]);
                return;
            }

            data.types.forEach(type => {
                const card = document.createElement('button');
                card.className = 'type-card';
                card.setAttribute('data-category', type.category);

                const icon = type.category === 'C678' ? '&#127807;' : '&#128138;';
                const iconClass = type.category === 'C678' ? 'type-icon-natural' : 'type-icon-regular';

                card.innerHTML = `
                    <div class="type-icon ${iconClass}">${icon}</div>
                    <div class="type-card-text">
                        <h3 class="type-label">${type.label}</h3>
                        <p class="type-desc">${type.description}</p>
                        <span class="type-meta">${type.num_bays || '?'} bays</span>
                    </div>
                `;
                card.onclick = () => this.selectPlanogramType(type);
                container.appendChild(card);
            });
        } catch (e) {
            container.innerHTML = '<p class="error">Failed to load planogram types.</p>';
        }
    },

    async selectPlanogramType(type) {
        this.currentPlanogramDbkey = type.planogram_dbkey;
        this.currentCategory = type.category;

        API.logActivity('select_type', `${type.category} - ${type.label}`, {
            view_name: 'type-select',
            meta: JSON.stringify({ dbkey: type.planogram_dbkey, bays: type.num_bays }),
        });

        // Load the planogram
        try {
            const pog = await API.getPlanogram(type.planogram_dbkey);
            this.currentPlanogram = pog;

            const pogName = type.label;
            document.getElementById('bay-pog-name').textContent = pogName;

            Planogram.clearHighlight();
            Planogram.loadPlanogram(pog);
            this.showView('bay');
        } catch (e) {
            console.error('Failed to load planogram:', e);
        }
    },

    // --- Search ---
    async toggleScanner() {
        const btn = document.getElementById('toggle-scanner');
        if (Scanner.isRunning) {
            await Scanner.stop();
            this.releaseWakeLock();
            btn.textContent = 'Start camera scanner';
        } else {
            btn.textContent = 'Stop scanner';
            API.logActivity('scanner_start', '', { view_name: 'search' });
            await this.requestWakeLock();
            await Scanner.start('scanner-region', (code) => {
                document.getElementById('upc-input').value = code;
                Scanner.stop();
                this.releaseWakeLock();
                btn.textContent = 'Start camera scanner';
                this.doSearch();
            });
            if (!Scanner.isRunning) {
                this.releaseWakeLock();
                btn.textContent = 'Camera unavailable';
            }
        }
    },

    async doSearch() {
        const upc = document.getElementById('upc-input').value.trim();
        const error = document.getElementById('search-error');
        const spinner = document.getElementById('search-spinner');
        const resultsList = document.getElementById('search-results-list');

        if (!upc || upc.length < 4) {
            error.textContent = 'Enter at least 4 digits';
            error.classList.remove('hidden');
            return;
        }

        error.classList.add('hidden');
        spinner.classList.remove('hidden');
        resultsList.classList.add('hidden');

        API.logActivity('search', upc, { view_name: 'search', meta: JSON.stringify({ digits: upc.length }) });

        try {
            const data = await API.search(this.storeId, upc);
            spinner.classList.add('hidden');

            // Check for deleted items
            const deletedResults = (data.results || []).filter(r => r.is_deleted);
            const activeResults = (data.results || []).filter(r => !r.is_deleted);

            if (deletedResults.length > 0) {
                this.showDeletedOverlay(deletedResults[0]);
            }

            if (activeResults.length === 0 && deletedResults.length === 0) {
                error.textContent = 'Product not found on any planogram for your store.';
                error.classList.remove('hidden');
                return;
            }

            if (activeResults.length > 0) {
                this.renderSearchResults(activeResults);
            }
        } catch (e) {
            spinner.classList.add('hidden');
            error.textContent = 'Search failed. Try again.';
            error.classList.remove('hidden');
        }
    },

    renderSearchResults(results) {
        const container = document.getElementById('search-results-list');
        container.innerHTML = '';
        container.classList.remove('hidden');

        results.forEach(r => {
            const card = document.createElement('button');
            const isOtherPlanogram = this.currentPlanogramDbkey && r.planogram_dbkey !== this.currentPlanogramDbkey;
            card.className = 'search-result-card' + (isOtherPlanogram ? ' search-result-other-pog' : '');
            const badgeHtml = r.is_new ? '<span class="badge badge-new">NEW</span>'
                : r.is_changed ? '<span class="badge badge-changed">CHANGED</span>' : '';
            const pogLabel = r.category === 'C678' ? 'Natural Vitamins' : 'Regular Vitamins';
            const pogClass = r.category === 'C678' ? 'pog-tag-natural' : 'pog-tag-regular';
            const otherHint = isOtherPlanogram ? ' <span class="pog-tag-other">OTHER POG</span>' : '';
            card.innerHTML = `
                <div class="search-result-info">
                    <h3 class="search-result-name">${r.full_name || r.description || 'Unknown'} ${badgeHtml}</h3>
                    <p class="search-result-detail">UPC: ${r.upc} | ${r.size || '-'}</p>
                    <p class="search-result-location">Aisle ${r.aisle || '?'} &bull; Bay ${r.bay} / Shelf ${r.shelf} / Pos ${r.position}</p>
                    <p class="search-result-pog"><span class="pog-tag ${pogClass}">${pogLabel}</span>${otherHint}</p>
                </div>
                <span class="search-result-arrow">&rsaquo;</span>
            `;
            card.onclick = () => this.navigateToProduct(r);
            container.appendChild(card);
        });
    },

    async navigateToProduct(result) {
        // Load the planogram if needed
        if (!this.currentPlanogram || this.currentPlanogramDbkey !== result.planogram_dbkey) {
            try {
                const pog = await API.getPlanogram(result.planogram_dbkey);
                this.currentPlanogram = pog;
                this.currentPlanogramDbkey = result.planogram_dbkey;
                document.getElementById('bay-pog-name').textContent =
                    result.planogram_name || result.category || 'Planogram';
            } catch (e) {
                console.error('Failed to load planogram:', e);
                return;
            }
        }

        Planogram.setHighlight(result.upc, result.bay, result.shelf, result.position);
        Planogram.loadPlanogram(this.currentPlanogram, result.bay);
        this.showView('bay');
    },

    // --- Product Overlay ---
    async showProductOverlay(product, shelfIdx, prodIdx, shelf, bayData) {
        const overlay = document.getElementById('product-overlay');
        document.getElementById('overlay-name').textContent = product.full_name || product.description || 'Unknown';
        document.getElementById('overlay-upc').textContent = product.upc;
        document.getElementById('overlay-size').textContent = product.size || '-';
        document.getElementById('overlay-pos-detail').textContent =
            `Bay ${product.bay}, Shelf ${product.shelf}, Pos ${product.position}`;
        document.getElementById('overlay-facings').textContent = product.facings || 1;
        document.getElementById('overlay-dims').textContent =
            `${product.height_inches || '?'}" H x ${product.width_inches || '?'}" W`;

        // Badge
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

        // Position label
        const nav = Planogram.getNavContext(shelfIdx, prodIdx, shelf, bayData);
        this.overlayNav = nav;
        document.getElementById('overlay-position-label').textContent =
            `${prodIdx + 1} of ${shelf.products.length} on Shelf ${shelf.shelf}`;

        // Nav arrows
        document.getElementById('overlay-prev').style.visibility = nav.hasPrev ? 'visible' : 'hidden';
        document.getElementById('overlay-next').style.visibility = nav.hasNext ? 'visible' : 'hidden';

        // Nav hints
        const hints = document.getElementById('overlay-nav-hints');
        hints.innerHTML = '';
        if (!nav.hasNext && nav.hasNextBay) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `Continue to Bay ${this.currentPlanogram.bays[Planogram.currentBayIndex + 1]?.bay || '?'} →`;
            btn.onclick = () => {
                this.closeOverlay();
                Planogram.nextBay();
            };
            hints.appendChild(btn);
        }
        if (nav.hasShelfUp) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `↑ Shelf ${nav.shelves[shelfIdx + 1]?.shelf || '?'}`;
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
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = `↓ Shelf ${nav.shelves[shelfIdx - 1]?.shelf || '?'}`;
            btn.onclick = () => {
                const prevShelf = nav.shelves[shelfIdx - 1];
                if (prevShelf && prevShelf.products.length > 0) {
                    this.showProductOverlay(prevShelf.products[0], shelfIdx - 1, 0, prevShelf, bayData);
                }
            };
            hints.appendChild(btn);
        }

        // Image — load directly from static JPGs, no API call
        const imgContainer = document.getElementById('overlay-image');
        const imgSrc = `/static/images/products/${product.upc}.jpg`;
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = product.description || '';
        img.onerror = () => {
            imgContainer.innerHTML = '<div class="placeholder-img">&#x1f48a;</div>';
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

        API.logActivity('view_product', `${product.upc} - ${product.description}`, {
            view_name: 'bay',
            meta: JSON.stringify({ bay: product.bay, shelf: product.shelf, pos: product.position }),
        });
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

    // --- PDF ---
    async openPdfForCurrentPlanogram() {
        if (!this.currentPlanogramDbkey) return;
        try {
            const info = await API.getPdfInfo(this.currentPlanogramDbkey);
            if (info && info.pdf_url) {
                PDFViewer.open(info.pdf_url, {
                    title: info.name || 'Planogram PDF',
                    returnView: 'bay',
                });
                API.logActivity('open_pdf', info.name, { view_name: 'bay', meta: JSON.stringify({ dbkey: this.currentPlanogramDbkey }) });
            }
        } catch (e) {
            console.error('Failed to open PDF:', e);
        }
    },

    async openPdfFromOverlay() {
        if (!this.currentPlanogramDbkey) return;
        const product = this.overlayNav?.products[this.overlayNav?.prodIdx];
        try {
            const info = await API.getPdfInfo(this.currentPlanogramDbkey);
            if (info && info.pdf_url) {
                this.closeOverlay();
                PDFViewer.open(info.pdf_url, {
                    title: info.name || 'Planogram PDF',
                    returnView: 'bay',
                    highlightContext: product ? {
                        bay: product.bay,
                        shelf: product.shelf,
                        position: product.position,
                        upc: product.upc,
                    } : null,
                });
                API.logActivity('open_pdf_product', `${product?.upc || 'unknown'}`);
            }
        } catch (e) {
            console.error('Failed to open PDF:', e);
        }
    },

    // --- Mobile Optimizations ---
    initMobileOptimizations() {
        // Lock to portrait if available (PWA mode)
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('portrait-primary').catch(() => {});
        }

        // Prevent pull-to-refresh on mobile
        document.body.addEventListener('touchmove', (e) => {
            if (document.scrollingElement.scrollTop === 0 && e.touches[0].clientY > 0) {
                // Only prevent if at top of page and pulling down
                const target = e.target.closest('.bay-shelf-container, .overlay-content, .pdf-canvas-container');
                if (!target) e.preventDefault();
            }
        }, { passive: false });

        // Keep screen awake during scanner use
        this._wakeLock = null;
    },

    async requestWakeLock() {
        if ('wakeLock' in navigator && !this._wakeLock) {
            try {
                this._wakeLock = await navigator.wakeLock.request('screen');
                this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
            } catch { /* not critical */ }
        }
    },

    releaseWakeLock() {
        if (this._wakeLock) {
            this._wakeLock.release().catch(() => {});
            this._wakeLock = null;
        }
    },

    // --- Deleted Items ---
    showDeletedOverlay(item) {
        const overlay = document.getElementById('deleted-overlay');
        document.getElementById('deleted-product-name').textContent = item.description || 'Unknown Product';
        document.getElementById('deleted-product-upc').textContent = `UPC: ${item.upc}`;
        overlay.classList.remove('hidden');
        // Trigger flash animation
        overlay.classList.remove('flash');
        void overlay.offsetWidth; // force reflow
        overlay.classList.add('flash');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
