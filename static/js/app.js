const App = {
    storeId: null,
    validStores: null,
    searchResults: [],
    resultIndex: 0,
    currentPlanogram: null,

    init() {
        this.bindEvents();
        // Restore store from session
        const saved = sessionStorage.getItem('storeId');
        if (saved) {
            this.storeId = saved;
            this.showView('search');
        }
    },

    bindEvents() {
        // Store entry
        const storeInput = document.getElementById('store-input');
        document.getElementById('store-submit').onclick = () => this.submitStore();
        storeInput.onkeydown = (e) => { if (e.key === 'Enter') this.submitStore(); };

        // Back buttons
        document.getElementById('back-to-store').onclick = () => this.showView('store');
        document.getElementById('back-to-search').onclick = () => {
            Scanner.stop();
            this.showView('search');
        };
        document.getElementById('back-to-results').onclick = () => this.showView('results');

        // Search
        document.getElementById('upc-submit').onclick = () => this.doSearch();
        document.getElementById('upc-input').onkeydown = (e) => { if (e.key === 'Enter') this.doSearch(); };

        // Scanner toggle
        document.getElementById('toggle-scanner').onclick = () => this.toggleScanner();

        // Results navigation
        document.getElementById('prev-result').onclick = () => this.navigateResult(-1);
        document.getElementById('next-result').onclick = () => this.navigateResult(1);
        document.getElementById('view-on-shelf').onclick = () => this.viewOnShelf();
        document.getElementById('search-again').onclick = () => this.showView('search');
        document.getElementById('results-search-again').onclick = () => this.showView('search');

        // Overlay close
        document.getElementById('close-overlay').onclick = () => {
            document.getElementById('product-overlay').classList.add('hidden');
        };
        document.getElementById('product-overlay').onclick = (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        };
    },

    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + name).classList.add('active');

        if (name === 'search') {
            document.getElementById('store-label').textContent = `Store #${this.storeId}`;
            document.getElementById('upc-input').value = '';
            document.getElementById('search-error').classList.add('hidden');
            document.getElementById('search-spinner').classList.add('hidden');
            document.getElementById('upc-input').focus();
        } else if (name === 'results') {
            document.getElementById('results-store-label').textContent = `Store #${this.storeId}`;
        }
    },

    async submitStore() {
        const input = document.getElementById('store-input');
        const error = document.getElementById('store-error');
        const raw = input.value.trim();
        if (!raw || !/^\d+$/.test(raw)) {
            error.textContent = 'Please enter a valid store number';
            error.classList.remove('hidden');
            return;
        }

        const padded = raw.padStart(5, '0');

        // Validate store exists
        try {
            if (!this.validStores) {
                this.validStores = await API.getStores();
            }
            if (!this.validStores.includes(padded)) {
                error.textContent = `Store ${padded} not found`;
                error.classList.remove('hidden');
                return;
            }
        } catch (e) {
            error.textContent = 'Failed to validate store. Try again.';
            error.classList.remove('hidden');
            return;
        }

        error.classList.add('hidden');
        this.storeId = padded;
        sessionStorage.setItem('storeId', padded);
        this.showView('search');
    },

    async toggleScanner() {
        const btn = document.getElementById('toggle-scanner');
        if (Scanner.isRunning) {
            await Scanner.stop();
            btn.textContent = 'Start Camera Scanner';
        } else {
            btn.textContent = 'Stop Scanner';
            await Scanner.start('scanner-region', (code) => {
                document.getElementById('upc-input').value = code;
                Scanner.stop();
                btn.textContent = 'Start Camera Scanner';
                this.doSearch();
            });
            if (!Scanner.isRunning) {
                btn.textContent = 'Camera unavailable';
            }
        }
    },

    async doSearch() {
        const upc = document.getElementById('upc-input').value.trim();
        const error = document.getElementById('search-error');
        const spinner = document.getElementById('search-spinner');

        if (!upc || upc.length < 4) {
            error.textContent = 'Enter at least 4 digits';
            error.classList.remove('hidden');
            return;
        }

        error.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const data = await API.search(this.storeId, upc);
            spinner.classList.add('hidden');
            this.searchResults = data.results || [];
            this.resultIndex = 0;
            this.showView('results');
            this.renderResults();
        } catch (e) {
            spinner.classList.add('hidden');
            error.textContent = 'Search failed. Try again.';
            error.classList.remove('hidden');
        }
    },

    renderResults() {
        const noResults = document.getElementById('no-results');
        const hasResults = document.getElementById('has-results');

        if (this.searchResults.length === 0) {
            noResults.classList.remove('hidden');
            hasResults.classList.add('hidden');
            return;
        }

        noResults.classList.add('hidden');
        hasResults.classList.remove('hidden');

        const r = this.searchResults[this.resultIndex];
        document.getElementById('result-name').textContent = r.description || 'Unknown Product';

        const badge = document.getElementById('result-badge');
        if (r.is_new) {
            badge.textContent = 'NEW';
            badge.className = 'badge badge-new';
            badge.style.display = '';
        } else if (r.is_changed) {
            badge.textContent = 'CHANGED';
            badge.className = 'badge badge-changed';
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }

        document.getElementById('result-upc').textContent = r.upc;
        document.getElementById('result-size').textContent = r.size || '-';
        document.getElementById('result-planogram').textContent = r.planogram_name || r.planogram_dbkey;
        document.getElementById('result-aisle').textContent =
            r.aisle ? `Aisle ${r.aisle}${r.orientation ? ' (' + r.orientation + ')' : ''}` : '-';
        document.getElementById('result-location').textContent =
            `Bay ${r.bay} / Shelf ${r.shelf} / Position ${r.position}`;

        document.getElementById('result-counter').textContent =
            `${this.resultIndex + 1} of ${this.searchResults.length}`;

        // Show/hide nav arrows
        document.getElementById('prev-result').style.visibility =
            this.searchResults.length > 1 ? 'visible' : 'hidden';
        document.getElementById('next-result').style.visibility =
            this.searchResults.length > 1 ? 'visible' : 'hidden';
    },

    navigateResult(delta) {
        this.resultIndex = (this.resultIndex + delta + this.searchResults.length) % this.searchResults.length;
        this.renderResults();
    },

    async viewOnShelf() {
        const r = this.searchResults[this.resultIndex];
        if (!r) return;

        try {
            const pog = await API.getPlanogram(r.planogram_dbkey);
            this.currentPlanogram = pog;

            document.getElementById('pog-name').textContent =
                `${pog.category || ''} - ${pog.description || pog.name}`.substring(0, 60);

            Planogram.setHighlight(r.upc, r.bay, r.shelf, r.position);

            // Render bay tabs
            const targetBay = r.bay;
            Planogram.renderBayTabs(pog.bays, targetBay, (bayNum) => {
                this.selectBay(bayNum);
            });

            // Render the target bay
            this.selectBay(targetBay);
            this.showView('planogram');
        } catch (e) {
            console.error('Failed to load planogram:', e);
        }
    },

    selectBay(bayNum) {
        if (!this.currentPlanogram) return;
        const bayData = this.currentPlanogram.bays.find(b => b.bay === bayNum);
        if (!bayData) return;

        Planogram.currentBay = bayNum;
        Planogram.renderBayTabs(this.currentPlanogram.bays, bayNum, (b) => this.selectBay(b));
        Planogram.renderBay(bayData);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
