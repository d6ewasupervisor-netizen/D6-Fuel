/**
 * PDF Viewer using PDF.js
 * Features: page navigation, zoom, search, swipe between pages
 */
const PDFViewer = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    baseScale: 1.0,
    rendering: false,
    pendingPage: null,
    searchResults: [],
    searchIndex: -1,
    pdfUrl: null,
    returnView: null,
    highlightContext: null, // { bay, shelf, position, upc }
    pdfjsLib: null,

    async init() {
        // Load PDF.js dynamically
        if (!this.pdfjsLib) {
            try {
                this.pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
                this.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
            } catch {
                // Fallback: try window.pdfjsLib
                if (window.pdfjsLib) {
                    this.pdfjsLib = window.pdfjsLib;
                } else {
                    console.error('PDF.js not available');
                    return;
                }
            }
        }
        this._bindEvents();
    },

    _bindEvents() {
        document.getElementById('pdf-close').onclick = () => this.close();
        document.getElementById('pdf-prev-page').onclick = () => this.prevPage();
        document.getElementById('pdf-next-page').onclick = () => this.nextPage();
        document.getElementById('pdf-zoom-in').onclick = () => this.zoomIn();
        document.getElementById('pdf-zoom-out').onclick = () => this.zoomOut();
        document.getElementById('pdf-search-toggle').onclick = () => this.toggleSearch();
        document.getElementById('pdf-search-close').onclick = () => this.toggleSearch();
        document.getElementById('pdf-search-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.doSearch();
        };
        document.getElementById('pdf-search-next').onclick = () => this.nextSearchResult();
        document.getElementById('pdf-search-prev').onclick = () => this.prevSearchResult();

        // Swipe between pages
        const container = document.getElementById('pdf-canvas-container');
        let startX = 0;
        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) startX = e.touches[0].clientX;
        }, { passive: true });
        container.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1) {
                const delta = e.changedTouches[0].clientX - startX;
                if (Math.abs(delta) > 60) {
                    if (delta < 0) this.nextPage();
                    else this.prevPage();
                }
            }
        }, { passive: true });
    },

    async open(pdfUrl, { title = 'PDF', returnView = null, highlightContext = null } = {}) {
        this.pdfUrl = pdfUrl;
        this.returnView = returnView;
        this.highlightContext = highlightContext;
        this.currentPage = 1;
        this.scale = 1.0;
        this.searchResults = [];
        this.searchIndex = -1;

        document.getElementById('pdf-title').textContent = title;
        document.getElementById('pdf-search-bar').classList.add('hidden');

        // Show the view
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-pdf').classList.add('active');

        // Load the PDF
        try {
            if (!this.pdfjsLib) await this.init();
            const loadingTask = this.pdfjsLib.getDocument(pdfUrl);
            this.pdfDoc = await loadingTask.promise;
            this.totalPages = this.pdfDoc.numPages;
            this._updatePageInfo();

            // If we have highlight context, try to find the right page
            if (highlightContext && highlightContext.bay) {
                await this._findBayPage(highlightContext.bay);
            }

            await this.renderPage(this.currentPage);
        } catch (err) {
            console.error('Failed to load PDF:', err);
            document.getElementById('pdf-canvas-container').innerHTML =
                '<p style="color:var(--danger);text-align:center;padding:40px;">Failed to load PDF</p>';
        }
    },

    close() {
        this.pdfDoc = null;
        if (this.returnView) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + this.returnView).classList.add('active');
        }
    },

    async renderPage(pageNum) {
        if (this.rendering) {
            this.pendingPage = pageNum;
            return;
        }
        this.rendering = true;

        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const canvas = document.getElementById('pdf-canvas');
            const ctx = canvas.getContext('2d');
            const container = document.getElementById('pdf-canvas-container');

            // Calculate scale to fit width
            const viewport = page.getViewport({ scale: 1.0 });
            this.baseScale = (container.clientWidth - 20) / viewport.width;
            const scaledViewport = page.getViewport({ scale: this.baseScale * this.scale });

            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;

            await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
            this.currentPage = pageNum;
            this._updatePageInfo();
        } catch (err) {
            console.error('Render error:', err);
        }

        this.rendering = false;
        if (this.pendingPage !== null) {
            const p = this.pendingPage;
            this.pendingPage = null;
            await this.renderPage(p);
        }
    },

    prevPage() {
        if (this.currentPage > 1) this.renderPage(this.currentPage - 1);
    },

    nextPage() {
        if (this.currentPage < this.totalPages) this.renderPage(this.currentPage + 1);
    },

    zoomIn() {
        this.scale = Math.min(4.0, this.scale + 0.25);
        this.renderPage(this.currentPage);
    },

    zoomOut() {
        this.scale = Math.max(0.5, this.scale - 0.25);
        this.renderPage(this.currentPage);
    },

    toggleSearch() {
        const bar = document.getElementById('pdf-search-bar');
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
            document.getElementById('pdf-search-input').focus();
        }
    },

    async doSearch() {
        const query = document.getElementById('pdf-search-input').value.trim();
        if (!query || !this.pdfDoc) return;

        this.searchResults = [];
        this.searchIndex = -1;
        const queryLower = query.toLowerCase();

        for (let i = 1; i <= this.totalPages; i++) {
            try {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ').toLowerCase();
                if (text.includes(queryLower)) {
                    this.searchResults.push(i);
                }
            } catch { /* skip page */ }
        }

        const countEl = document.getElementById('pdf-search-count');
        if (this.searchResults.length > 0) {
            this.searchIndex = 0;
            countEl.textContent = `1 of ${this.searchResults.length}`;
            await this.renderPage(this.searchResults[0]);
        } else {
            countEl.textContent = 'No results';
        }
    },

    async nextSearchResult() {
        if (this.searchResults.length === 0) return;
        this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
        document.getElementById('pdf-search-count').textContent =
            `${this.searchIndex + 1} of ${this.searchResults.length}`;
        await this.renderPage(this.searchResults[this.searchIndex]);
    },

    async prevSearchResult() {
        if (this.searchResults.length === 0) return;
        this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        document.getElementById('pdf-search-count').textContent =
            `${this.searchIndex + 1} of ${this.searchResults.length}`;
        await this.renderPage(this.searchResults[this.searchIndex]);
    },

    async _findBayPage(bayNum) {
        // Search for the page containing "Bay # X of Y" matching our target bay
        const searchStr = `Bay # ${bayNum} `;
        for (let i = 1; i <= this.totalPages; i++) {
            try {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');
                if (text.includes(searchStr) || text.includes(`Bay ${bayNum} -`)) {
                    this.currentPage = i;
                    return;
                }
            } catch { /* skip */ }
        }
    },

    _updatePageInfo() {
        document.getElementById('pdf-page-info').textContent =
            `${this.currentPage} / ${this.totalPages}`;
    }
};
