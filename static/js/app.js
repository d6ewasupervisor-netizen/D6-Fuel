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

        // Prune expired cached thumbnails
        if (typeof ImageCache !== 'undefined') {
            ImageCache.prune();
        }

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
            if (e.key === 'Enter') document.getElementById('password-input').focus();
        };
        document.getElementById('password-input').onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('store-input').focus();
        };

        // Password peek toggle
        const peekBtn = document.getElementById('password-peek');
        if (peekBtn) {
            peekBtn.addEventListener('click', () => {
                const pwInput = document.getElementById('password-input');
                const showIcon = peekBtn.querySelector('.peek-icon-show');
                const hideIcon = peekBtn.querySelector('.peek-icon-hide');
                if (pwInput.type === 'password') {
                    pwInput.type = 'text';
                    showIcon.style.display = 'none';
                    hideIcon.style.display = '';
                    peekBtn.setAttribute('aria-label', 'Hide password');
                } else {
                    pwInput.type = 'password';
                    showIcon.style.display = '';
                    hideIcon.style.display = 'none';
                    peekBtn.setAttribute('aria-label', 'Show password');
                }
            });
        }
        document.getElementById('store-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.submitLogin();
        };

        // Back buttons
        document.getElementById('back-to-login').onclick = () => {
            sessionStorage.clear();
            this.showView('login');
        };
        document.getElementById('back-to-type').onclick = () => this.showView('type-select');
        document.getElementById('back-from-search').onclick = async () => {
            await Scanner.stop();
            document.getElementById('toggle-scanner').textContent = 'Start camera scanner';
            document.getElementById('toggle-torch').classList.add('hidden');
            document.getElementById('scanner-hint').classList.add('hidden');
            this.releaseWakeLock();
            this.showView(this.previousView);
        };

        // Store badge clicks — navigate back to store selection
        document.getElementById('type-store-label').onclick = () => {
            sessionStorage.clear();
            this.showView('login');
        };
        document.getElementById('store-label').onclick = () => this.showView('type-select');
        document.getElementById('bay-store-label').onclick = () => this.showView('type-select');

        // Bay view actions
        document.getElementById('bay-camera-btn').onclick = () => this.openCameraScan('bay');
        document.getElementById('bay-notes-btn').onclick = () => this.openNotesForCurrentPlanogram();
        document.getElementById('bay-pdf-btn').onclick = () => this.openPdfForCurrentPlanogram();
        document.getElementById('bay-prev-arrow').onclick = () => Planogram.prevBay();
        document.getElementById('bay-next-arrow').onclick = () => Planogram.nextBay();

        // Bay inline UPC search
        document.getElementById('bay-upc-search').onclick = () => this.doBaySearch();
        document.getElementById('bay-upc-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.doBaySearch();
        };

        // Search (camera)
        document.getElementById('toggle-scanner').onclick = () => this.toggleScanner();
        document.getElementById('toggle-torch').onclick = () => this.toggleTorch();

        // Text search view
        document.getElementById('back-from-text-search').onclick = () => {
            this.showView(this.previousView);
        };
        document.getElementById('text-search-store-label').onclick = () => this.showView('type-select');
        document.getElementById('text-search-go').onclick = () => this.doTextSearch();
        document.getElementById('text-search-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.doTextSearch();
        };

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

        // Moving overlay
        document.getElementById('moving-dismiss').onclick = () => {
            document.getElementById('moving-overlay').classList.add('hidden');
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
        } else if (name === 'bay') {
            document.getElementById('bay-store-label').textContent = `Store #${this.storeId}`;
            document.getElementById('bay-upc-input').value = '';
        }

        if (name === 'search') {
            document.getElementById('store-label').textContent = `Store #${this.storeId}`;
            document.getElementById('search-error').classList.add('hidden');
            document.getElementById('search-spinner').classList.add('hidden');
            document.getElementById('search-results-list').classList.add('hidden');
        } else if (name === 'text-search') {
            document.getElementById('text-search-store-label').textContent = `Store #${this.storeId}`;
            document.getElementById('text-search-input').value = '';
            document.getElementById('text-search-error').classList.add('hidden');
            document.getElementById('text-search-spinner').classList.add('hidden');
            document.getElementById('text-search-results').classList.add('hidden');
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
        const passwordInput = document.getElementById('password-input');
        const storeInput = document.getElementById('store-input');
        const error = document.getElementById('store-error');

        const name = nameInput.value.trim();
        const password = passwordInput.value;
        const raw = storeInput.value.trim();

        if (!name) {
            error.textContent = 'Please enter your name';
            error.classList.remove('hidden');
            return;
        }
        if (!password) {
            error.textContent = 'Please enter a password';
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
            const data = await API.login(name, raw, password);
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
                : e.message === 'Invalid password'
                ? 'Invalid password.'
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

            // Planogram type cards
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

            // Scan UPC barcode card (camera)
            const cameraCard = document.createElement('button');
            cameraCard.className = 'type-card scan-card';
            cameraCard.setAttribute('data-category', 'scan-camera');
            cameraCard.innerHTML = `
                <div class="scan-card-image">
                    <img src="/static/images/search-upc-camera.png" alt="Scan UPC barcode" draggable="false">
                </div>
                <div class="type-card-text">
                    <h3 class="type-label">Scan UPC Barcode</h3>
                    <p class="type-desc">Use your camera to scan a product barcode</p>
                </div>
            `;
            cameraCard.onclick = () => this.openCameraScan('type-select');
            container.appendChild(cameraCard);

            // Enter last 4 of UPC card (text search)
            const textCard = document.createElement('button');
            textCard.className = 'type-card scan-card';
            textCard.setAttribute('data-category', 'scan-text');
            textCard.innerHTML = `
                <div class="scan-card-image">
                    <img src="/static/images/search-upc-text.png" alt="Enter last four of UPC" draggable="false">
                </div>
                <div class="type-card-text">
                    <p class="type-desc">Type in the last digits of the UPC to search</p>
                </div>
            `;
            textCard.onclick = () => this.openTextSearch('type-select');
            container.appendChild(textCard);

            if (data.types.length === 0) {
                container.insertAdjacentHTML('afterbegin',
                    '<p class="type-empty">No planograms available — use search options below.</p>');
            }
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

    // --- Scan entry points ---
    openCameraScan(fromView) {
        this.previousView = fromView || 'type-select';
        this.showView('search');
        setTimeout(() => this.toggleScanner(), 300);
    },

    openTextSearch(fromView) {
        this.previousView = fromView || 'type-select';
        this.showView('text-search');
        setTimeout(() => {
            const input = document.getElementById('text-search-input');
            if (input) input.focus();
        }, 300);
    },

    async doBaySearch() {
        const input = document.getElementById('bay-upc-input');
        const btn = document.getElementById('bay-upc-search');
        const upc = input.value.trim();

        if (!upc || upc.length < 4) {
            input.classList.add('bay-search-error');
            setTimeout(() => input.classList.remove('bay-search-error'), 800);
            return;
        }

        btn.disabled = true;
        btn.textContent = '...';

        API.logActivity('search', upc, { view_name: 'bay', meta: JSON.stringify({ digits: upc.length, source: 'bay_bar' }) });

        try {
            const data = await API.search(this.storeId, upc);

            const movingResults = (data.results || []).filter(r => r.is_moving);
            const deletedResults = (data.results || []).filter(r => r.is_deleted);
            const activeResults = (data.results || []).filter(r => !r.is_deleted && !r.is_moving);

            if (movingResults.length > 0) {
                this.showMovingOverlay(movingResults[0]);
            } else if (deletedResults.length > 0) {
                this.showDeletedOverlay(deletedResults[0]);
            }

            if (activeResults.length === 0 && deletedResults.length === 0 && movingResults.length === 0) {
                input.classList.add('bay-search-error');
                input.value = '';
                input.placeholder = 'Not found';
                setTimeout(() => {
                    input.classList.remove('bay-search-error');
                    input.placeholder = 'Last 4 of UPC';
                }, 1500);
                return;
            }

            input.value = '';

            if (activeResults.length === 1) {
                this.navigateToProduct(activeResults[0]);
                return;
            }

            if (activeResults.length > 0) {
                this.previousView = 'bay';
                this.showView('search');
                this.renderSearchResults(activeResults);
            }
        } catch {
            input.classList.add('bay-search-error');
            setTimeout(() => input.classList.remove('bay-search-error'), 800);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Search';
        }
    },

    // --- Text UPC Search ---
    async doTextSearch() {
        const input = document.getElementById('text-search-input');
        const btn = document.getElementById('text-search-go');
        const error = document.getElementById('text-search-error');
        const spinner = document.getElementById('text-search-spinner');
        const resultsList = document.getElementById('text-search-results');
        const upc = input.value.trim();

        if (!upc || upc.length < 4) {
            error.textContent = 'Enter at least 4 digits';
            error.classList.remove('hidden');
            return;
        }

        error.classList.add('hidden');
        spinner.classList.remove('hidden');
        resultsList.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Searching...';

        API.logActivity('search', upc, { view_name: 'text-search', meta: JSON.stringify({ digits: upc.length, source: 'text_entry' }) });

        try {
            const data = await API.search(this.storeId, upc);
            spinner.classList.add('hidden');

            const movingResults = (data.results || []).filter(r => r.is_moving);
            const deletedResults = (data.results || []).filter(r => r.is_deleted);
            const activeResults = (data.results || []).filter(r => !r.is_deleted && !r.is_moving);

            if (movingResults.length > 0) {
                this.showMovingOverlay(movingResults[0]);
            } else if (deletedResults.length > 0) {
                this.showDeletedOverlay(deletedResults[0]);
            }

            if (activeResults.length === 0 && deletedResults.length === 0 && movingResults.length === 0) {
                error.textContent = 'Product not found on any planogram for your store.';
                error.classList.remove('hidden');
                return;
            }

            if (activeResults.length === 1) {
                this.navigateToProduct(activeResults[0]);
                return;
            }

            if (activeResults.length > 0) {
                this.renderTextSearchResults(activeResults);
            }
        } catch (e) {
            spinner.classList.add('hidden');
            error.textContent = 'Search failed. Try again.';
            error.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Search';
        }
    },

    renderTextSearchResults(results) {
        const container = document.getElementById('text-search-results');
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

    // --- Camera Scanner ---
    async toggleScanner() {
        const btn = document.getElementById('toggle-scanner');
        const torchBtn = document.getElementById('toggle-torch');
        const hint = document.getElementById('scanner-hint');

        if (Scanner.isRunning) {
            await Scanner.stop();
            this.releaseWakeLock();
            btn.textContent = 'Start camera scanner';
            torchBtn.classList.add('hidden');
            torchBtn.classList.remove('torch-on');
            hint.classList.add('hidden');
        } else {
            btn.textContent = 'Stop scanner';
            API.logActivity('scanner_start', '', { view_name: 'search' });
            await this.requestWakeLock();
            await Scanner.start('scanner-region', async (code) => {
                await Scanner.stop();
                this.releaseWakeLock();
                btn.textContent = 'Start camera scanner';
                torchBtn.classList.add('hidden');
                torchBtn.classList.remove('torch-on');
                hint.classList.add('hidden');
                this.doSearch(code);
            });
            if (!Scanner.isRunning) {
                this.releaseWakeLock();
                btn.textContent = 'Camera unavailable';
            } else {
                hint.classList.remove('hidden');
                // Show torch button after a short delay so camera capabilities are ready
                setTimeout(() => {
                    if (Scanner.torchAvailable) torchBtn.classList.remove('hidden');
                }, 500);
            }
        }
    },

    async toggleTorch() {
        const torchBtn = document.getElementById('toggle-torch');
        const isOn = await Scanner.toggleTorch();
        torchBtn.classList.toggle('torch-on', isOn);
    },

    async doSearch(upcCode) {
        const upc = (upcCode || '').trim();
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

            // Check for moving / deleted items
            const movingResults = (data.results || []).filter(r => r.is_moving);
            const deletedResults = (data.results || []).filter(r => r.is_deleted);
            const activeResults = (data.results || []).filter(r => !r.is_deleted && !r.is_moving);

            if (movingResults.length > 0) {
                this.showMovingOverlay(movingResults[0]);
            } else if (deletedResults.length > 0) {
                this.showDeletedOverlay(deletedResults[0]);
            }

            if (activeResults.length === 0 && deletedResults.length === 0 && movingResults.length === 0) {
                error.textContent = 'Product not found on any planogram for your store.';
                error.classList.remove('hidden');
                return;
            }

            if (activeResults.length === 1) {
                // Single result: skip search results, navigate directly
                this.navigateToProduct(activeResults[0]);
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
        this.showLocationOverlay(result.bay, result.shelf, result.position);
    },

    showLocationOverlay(bay, shelf, position) {
        const existing = document.getElementById('location-flash-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'location-flash-overlay';
        overlay.className = 'location-flash-overlay';
        overlay.innerHTML = `
            <div class="location-flash-content location-flash-stacked">
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

        const FLASH_MS = 500;
        const HOLD_MS = 3000;
        const OVERLAY_TOTAL_MS = (FLASH_MS * 3) + HOLD_MS; // 4.5s
        const BORDER_TOTAL_MS = OVERLAY_TOTAL_MS * 2;       // 9s

        // Sequential flash: Bay → Shelf → Position
        const rows = overlay.querySelectorAll('.location-flash-row');
        rows.forEach((row, i) => {
            setTimeout(() => {
                row.classList.remove('location-flash-hidden');
                row.classList.add('location-flash-pop');
            }, FLASH_MS * i);
        });

        // After all 3 flashes, activate the item border highlight
        setTimeout(() => Planogram.activateHighlight(), FLASH_MS * 3);

        // Dismiss overlay after total time
        setTimeout(() => {
            overlay.classList.remove('visible');
            overlay.classList.add('fade-out');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 600);
        }, OVERLAY_TOTAL_MS);

        // Remove highlight border after 2x overlay duration
        setTimeout(() => Planogram.deactivateHighlight(), FLASH_MS * 3 + BORDER_TOTAL_MS);
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

    // --- Notes ---
    async openNotesForCurrentPlanogram() {
        if (!this.currentCategory) return;
        try {
            const info = await API.getNotesInfo(this.currentCategory);
            if (info && info.available && info.notes_url) {
                PDFViewer.open(info.notes_url, {
                    title: info.label || 'Section Notes',
                    returnView: 'bay',
                });
                API.logActivity('open_notes', info.label, {
                    view_name: 'bay',
                    meta: JSON.stringify({ category: this.currentCategory }),
                });
            }
        } catch (e) {
            console.error('Failed to open notes:', e);
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

        // Dynamic viewport height (fixes mobile keyboard shrinking issues)
        const setVh = () => {
            document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
        };
        setVh();
        window.addEventListener('resize', setVh);

        // Register service worker for offline caching
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/static/sw.js').catch(() => {});
        }

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
        overlay.classList.remove('flash');
        void overlay.offsetWidth;
        overlay.classList.add('flash');
    },

    // --- Moving Items ---
    showMovingOverlay(item) {
        const overlay = document.getElementById('moving-overlay');
        document.getElementById('moving-product-name').textContent = item.description || 'Unknown Product';
        document.getElementById('moving-product-upc').textContent = `UPC: ${item.upc}`;
        document.getElementById('moving-from').textContent = item.moving_from || 'Unknown';
        document.getElementById('moving-to').textContent = item.moving_to || 'Unknown';

        const locBlock = document.getElementById('moving-location');
        if (item.new_aisle) {
            document.getElementById('moving-loc-aisle').textContent = item.new_aisle;
            document.getElementById('moving-loc-bay').textContent = item.new_bay;
            document.getElementById('moving-loc-shelf').textContent = item.new_shelf;
            document.getElementById('moving-loc-position').textContent = item.new_position;
            locBlock.classList.remove('hidden');
        } else {
            locBlock.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
