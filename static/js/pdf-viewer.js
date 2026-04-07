/**
 * PDF Viewer using PDF.js with accurate text-layer search highlighting.
 *
 * Layer 1: renderTextLayer() creates positioned invisible text over the canvas
 * Layer 2: Unicode normalizer handles soft hyphens, zero-width chars, typographic dashes
 * Layer 3: Character-level index map from normalized string back to original items
 * Layer 4: Inject highlight <span>s into the text layer divs
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
    highlightContext: null,
    pdfjsLib: null,

    currentTextItems: null,
    currentTextDivs: null,
    _activeQuery: '',

    async init() {
        if (!this.pdfjsLib) {
            try {
                this.pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
                this.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
            } catch {
                if (window.pdfjsLib) {
                    this.pdfjsLib = window.pdfjsLib;
                } else {
                    console.error('PDF.js not available');
                    return;
                }
            }
        }
        this._bindEvents();
        window.addEventListener('resize', () => this._positionTextLayer());
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
        document.getElementById('pdf-search-go').onclick = () => this.doSearch();
        document.getElementById('pdf-search-next').onclick = () => this.nextSearchResult();
        document.getElementById('pdf-search-prev').onclick = () => this.prevSearchResult();

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
        this._activeQuery = '';
        this.currentTextItems = null;
        this.currentTextDivs = null;

        document.getElementById('pdf-title').textContent = title;
        document.getElementById('pdf-search-bar').classList.add('hidden');
        document.getElementById('pdf-search-count').textContent = '';
        document.getElementById('pdf-search-input').value = '';

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-pdf').classList.add('active');

        // Show loading state while the document fetches and parses
        const canvasContainer = document.getElementById('pdf-canvas-container');
        const canvas = document.getElementById('pdf-canvas');
        const textLayer = document.getElementById('pdf-text-layer');
        canvas.style.display = 'none';
        textLayer.style.display = 'none';

        let loadSpinner = document.getElementById('pdf-load-spinner');
        if (!loadSpinner) {
            loadSpinner = document.createElement('div');
            loadSpinner.id = 'pdf-load-spinner';
            loadSpinner.style.cssText = 'display:flex;justify-content:center;align-items:center;padding:80px 0;';
            loadSpinner.innerHTML = '<div class="spinner"></div>';
            canvasContainer.appendChild(loadSpinner);
        }
        loadSpinner.style.display = 'flex';
        document.getElementById('pdf-page-info').textContent = 'Loading…';

        try {
            if (!this.pdfjsLib) await this.init();
            const loadingTask = this.pdfjsLib.getDocument(pdfUrl);
            this.pdfDoc = await loadingTask.promise;
            this.totalPages = this.pdfDoc.numPages;
            this._updatePageInfo();

            if (highlightContext) {
                if (highlightContext.upc) {
                    const found = await this._findUpcPage(highlightContext.upc);
                    if (found) {
                        this._activeQuery = highlightContext.upc;
                        document.getElementById('pdf-search-input').value = highlightContext.upc;
                    }
                }
                if (!this._activeQuery && highlightContext.bay) {
                    await this._findBayPage(highlightContext.bay);
                }
            }

            // Reveal canvas before rendering so dimensions resolve correctly
            loadSpinner.style.display = 'none';
            canvas.style.display = '';
            textLayer.style.display = '';

            await this.renderPage(this.currentPage);
        } catch (err) {
            console.error('Failed to load PDF:', err);
            loadSpinner.style.display = 'none';
            canvas.style.display = '';
            textLayer.style.display = '';
            canvasContainer.innerHTML =
                '<p style="color:var(--danger);text-align:center;padding:40px;">Failed to load PDF. Please go back and try again.</p>';
        }
    },

    close() {
        this.pdfDoc = null;
        this.currentTextItems = null;
        this.currentTextDivs = null;
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
            const layer = document.getElementById('pdf-text-layer');

            const unscaledVP = page.getViewport({ scale: 1.0 });
            this.baseScale = (container.clientWidth - 20) / unscaledVP.width;
            const viewport = page.getViewport({ scale: this.baseScale * this.scale });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: ctx, viewport }).promise;
            this.currentPage = pageNum;
            this._updatePageInfo();

            await this._renderTextLayer(page, viewport, canvas, layer);

            if (this._activeQuery) {
                this._highlightOnCurrentPage(this._activeQuery);
            }
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

    // --- Layer 1: Render invisible text layer over the canvas ---

    _positionTextLayer() {
        const layer = document.getElementById('pdf-text-layer');
        const canvas = document.getElementById('pdf-canvas');
        if (!layer || !canvas) return;
        layer.style.left = canvas.offsetLeft + 'px';
        layer.style.top = canvas.offsetTop + 'px';
        layer.style.width = canvas.offsetWidth + 'px';
        layer.style.height = canvas.offsetHeight + 'px';
    },

    async _renderTextLayer(page, viewport, canvas, layer) {
        layer.innerHTML = '';
        this.currentTextItems = null;
        this.currentTextDivs = null;

        try {
            const textContent = await page.getTextContent();
            const textDivs = [];

            layer.style.setProperty('--scale-factor', viewport.scale);
            layer.style.left = canvas.offsetLeft + 'px';
            layer.style.top = canvas.offsetTop + 'px';
            layer.style.width = canvas.offsetWidth + 'px';
            layer.style.height = canvas.offsetHeight + 'px';

            const renderTextLayer = this.pdfjsLib.renderTextLayer || window.pdfjsLib?.renderTextLayer;
            if (renderTextLayer) {
                const task = renderTextLayer({
                    textContent,
                    container: layer,
                    viewport,
                    textDivs,
                    enhanceTextSelection: false,
                });
                if (task && task.promise) await task.promise;
                else if (task && typeof task.then === 'function') await task;
            } else {
                this._manualTextLayer(textContent, viewport, layer, textDivs);
            }

            // Re-apply pixel positions after renderTextLayer may have
            // overwritten with calc() expressions
            layer.style.left = canvas.offsetLeft + 'px';
            layer.style.top = canvas.offsetTop + 'px';
            layer.style.width = canvas.offsetWidth + 'px';
            layer.style.height = canvas.offsetHeight + 'px';

            this.currentTextItems = textContent.items;
            this.currentTextDivs = textDivs;
        } catch (err) {
            console.warn('Text layer render failed, using manual fallback:', err);
            try {
                const textContent = await page.getTextContent();
                const textDivs = [];
                this._manualTextLayer(textContent, viewport, layer, textDivs);
                this.currentTextItems = textContent.items;
                this.currentTextDivs = textDivs;
            } catch (e2) {
                console.error('Manual text layer also failed:', e2);
            }
        }
    },

    _manualTextLayer(textContent, viewport, layer, textDivs) {
        layer.innerHTML = '';
        const items = textContent.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.str) {
                textDivs.push(document.createElement('span'));
                continue;
            }

            const tx = this.pdfjsLib.Util.transform(viewport.transform, item.transform);
            const span = document.createElement('span');
            span.textContent = item.str;

            const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
            const angle = Math.atan2(tx[1], tx[0]);

            span.style.position = 'absolute';
            span.style.left = tx[4] + 'px';
            span.style.top = (tx[5] - fontHeight) + 'px';
            span.style.fontSize = fontHeight + 'px';
            span.style.fontFamily = item.fontName || 'sans-serif';
            span.style.whiteSpace = 'pre';
            span.style.color = 'transparent';

            if (item.width) {
                const scaleX = (item.width * viewport.scale) / (span.offsetWidth || item.str.length * fontHeight * 0.6);
                if (scaleX > 0 && isFinite(scaleX)) {
                    span.style.transform = `scaleX(${scaleX})`;
                    span.style.transformOrigin = '0% 0%';
                }
            }

            if (angle !== 0) {
                span.style.transform = (span.style.transform || '') + ` rotate(${angle}rad)`;
            }

            layer.appendChild(span);
            textDivs.push(span);
        }
    },

    // --- Layer 2: Unicode normalizer ---

    _normalizeSearchChar(ch) {
        if (ch === '\u00ad' || ch === '\u200b' || ch === '\u200c' || ch === '\u200d' || ch === '\ufeff') return '';
        if (ch === '\u00a0') return ' ';
        if (/\s/.test(ch)) return ' ';
        if (ch >= '\u2010' && ch <= '\u2014') return '-';
        if (ch === '\u2018' || ch === '\u2019' || ch === '\u201a' || ch === '\u201b') return "'";
        if (ch === '\u201c' || ch === '\u201d' || ch === '\u201e' || ch === '\u201f') return '"';
        return ch.toLowerCase();
    },

    _normalizeQuery(query) {
        let result = '';
        let lastWasSpace = false;
        for (let i = 0; i < query.length; i++) {
            const n = this._normalizeSearchChar(query[i]);
            if (!n) continue;
            if (n === ' ') {
                if (!result.length || lastWasSpace) continue;
                result += ' ';
                lastWasSpace = true;
            } else {
                result += n;
                lastWasSpace = false;
            }
        }
        result = result.trim();

        // UPC-aware: if query is purely digits (possibly with dashes/spaces),
        // collapse to digits-only so "0 12345 67890" matches "0123456789"
        const digitsOnly = result.replace(/[\s\-]/g, '');
        if (/^\d{4,}$/.test(digitsOnly)) return digitsOnly;

        return result;
    },

    // --- Layer 3: Build character-level map from normalized positions back to original items ---

    _buildNormalizedIndex(items) {
        const map = [];
        let normalized = '';
        let lastWasSpace = false;

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const text = items[itemIndex]?.str || '';

            if (normalized.length && !lastWasSpace) {
                normalized += ' ';
                map.push(null);
                lastWasSpace = true;
            }

            for (let charIndex = 0; charIndex < text.length; charIndex++) {
                const n = this._normalizeSearchChar(text[charIndex]);
                if (!n) continue;
                if (n === ' ') {
                    if (!normalized.length || lastWasSpace) continue;
                    normalized += ' ';
                    map.push(null);
                    lastWasSpace = true;
                    continue;
                }
                normalized += n;
                map.push({ itemIndex, charIndex });
                lastWasSpace = false;
            }
        }
        return { normalized, map };
    },

    _buildHighlightRanges(items, query, matchIndex) {
        const rangesByItem = new Map();
        const normalizedQuery = this._normalizeQuery(query);
        if (!normalizedQuery) return rangesByItem;

        const { normalized, map } = this._buildNormalizedIndex(items);

        // For UPC queries (all digits), also build a digits-only version
        // of the normalized text to find UPCs split across items/spaces
        const isUpcQuery = /^\d{4,}$/.test(normalizedQuery);
        let searchText = normalized;
        let searchMap = map;

        if (isUpcQuery) {
            // Build digits-only string with mapping back to original map
            const digitText = [];
            const digitMap = [];
            for (let i = 0; i < normalized.length; i++) {
                const ch = normalized[i];
                if (ch >= '0' && ch <= '9') {
                    digitText.push(ch);
                    digitMap.push(i);
                }
            }
            searchText = digitText.join('');
            searchMap = digitMap.map(i => map[i]);
        }

        let start = 0;
        let matchCount = 0;

        while (start < searchText.length) {
            const idx = searchText.indexOf(normalizedQuery, start);
            if (idx === -1) break;
            const endIdx = idx + normalizedQuery.length;

            if (matchIndex == null || matchCount === matchIndex) {
                for (let i = idx; i < endIdx; i++) {
                    const entry = isUpcQuery ? searchMap[i] : map[i];
                    if (!entry) continue;
                    const { itemIndex, charIndex } = entry;
                    const ranges = rangesByItem.get(itemIndex) || [];
                    const last = ranges[ranges.length - 1];
                    if (last && charIndex === last.end) {
                        last.end += 1;
                    } else {
                        ranges.push({ start: charIndex, end: charIndex + 1 });
                    }
                    rangesByItem.set(itemIndex, ranges);
                }
            }

            matchCount++;
            start = endIdx;
        }
        return rangesByItem;
    },

    // --- Layer 4: Inject highlight spans into text layer ---

    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _applyRangesToText(text, ranges) {
        let html = '';
        let lastIndex = 0;
        for (const range of ranges) {
            html += this._escapeHtml(text.slice(lastIndex, range.start));
            html += `<span class="search-text-hit">${this._escapeHtml(text.slice(range.start, range.end))}</span>`;
            lastIndex = range.end;
        }
        html += this._escapeHtml(text.slice(lastIndex));
        return html;
    },

    _highlightOnCurrentPage(query) {
        if (!this.currentTextItems || !this.currentTextDivs) return;

        // Reset all divs to plain text first
        for (let i = 0; i < this.currentTextDivs.length; i++) {
            const div = this.currentTextDivs[i];
            const text = this.currentTextItems[i]?.str || '';
            if (div) div.textContent = text;
        }

        const rangesByItem = this._buildHighlightRanges(this.currentTextItems, query, null);

        for (const [itemIndex, ranges] of rangesByItem.entries()) {
            const div = this.currentTextDivs[itemIndex];
            const text = this.currentTextItems[itemIndex]?.str || '';
            if (div) {
                div.innerHTML = this._applyRangesToText(text, ranges);
            }
        }

        // Scroll first hit into view
        requestAnimationFrame(() => {
            const hit = document.querySelector('#pdf-text-layer .search-text-hit');
            if (hit) {
                const container = document.getElementById('pdf-canvas-container');
                if (container) {
                    const containerRect = container.getBoundingClientRect();
                    const hitRect = hit.getBoundingClientRect();
                    const delta = hitRect.top - containerRect.top;
                    container.scrollTop += delta - Math.max(24, Math.round(container.clientHeight * 0.25));
                }
            }
        });
    },

    _clearHighlights() {
        if (!this.currentTextItems || !this.currentTextDivs) return;
        for (let i = 0; i < this.currentTextDivs.length; i++) {
            const div = this.currentTextDivs[i];
            const text = this.currentTextItems[i]?.str || '';
            if (div) div.textContent = text;
        }
    },

    // --- Search ---

    async doSearch() {
        const query = document.getElementById('pdf-search-input').value.trim();
        if (!query || !this.pdfDoc) return;

        this.searchResults = [];
        this.searchIndex = -1;
        this._activeQuery = query;
        const normalizedQuery = this._normalizeQuery(query);
        if (!normalizedQuery) return;

        for (let i = 1; i <= this.totalPages; i++) {
            try {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const { normalized } = this._buildNormalizedIndex(textContent.items);
                if (normalized.includes(normalizedQuery)) {
                    this.searchResults.push(i);
                }
            } catch { /* skip page */ }
        }

        const countEl = document.getElementById('pdf-search-count');
        if (this.searchResults.length > 0) {
            this.searchIndex = 0;
            const targetPage = this.searchResults[0];
            countEl.textContent = `1 of ${this.searchResults.length}`;
            if (targetPage === this.currentPage) {
                this._highlightOnCurrentPage(query);
            } else {
                await this.renderPage(targetPage);
            }
        } else {
            countEl.textContent = 'No results';
            this._clearHighlights();
        }
    },

    async nextSearchResult() {
        if (this.searchResults.length === 0) return;
        this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
        document.getElementById('pdf-search-count').textContent =
            `${this.searchIndex + 1} of ${this.searchResults.length}`;
        const targetPage = this.searchResults[this.searchIndex];
        if (targetPage === this.currentPage) {
            this._highlightOnCurrentPage(this._activeQuery);
        } else {
            await this.renderPage(targetPage);
        }
    },

    async prevSearchResult() {
        if (this.searchResults.length === 0) return;
        this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        document.getElementById('pdf-search-count').textContent =
            `${this.searchIndex + 1} of ${this.searchResults.length}`;
        const targetPage = this.searchResults[this.searchIndex];
        if (targetPage === this.currentPage) {
            this._highlightOnCurrentPage(this._activeQuery);
        } else {
            await this.renderPage(targetPage);
        }
    },

    async _findUpcPage(upc) {
        const normalizedUpc = this._normalizeQuery(upc);
        if (!normalizedUpc) return false;

        for (let i = 1; i <= this.totalPages; i++) {
            try {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const { normalized } = this._buildNormalizedIndex(textContent.items);
                if (normalized.includes(normalizedUpc)) {
                    this.currentPage = i;
                    return true;
                }
            } catch { /* skip */ }
        }
        return false;
    },

    async _findBayPage(bayNum) {
        const searchStr = `bay # ${bayNum} `;
        const searchStr2 = `bay ${bayNum} -`;
        for (let i = 1; i <= this.totalPages; i++) {
            try {
                const page = await this.pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const { normalized } = this._buildNormalizedIndex(textContent.items);
                if (normalized.includes(searchStr) || normalized.includes(searchStr2)) {
                    this.currentPage = i;
                    return;
                }
            } catch { /* skip */ }
        }
    },

    // --- Navigation & UI ---

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
        } else {
            this._activeQuery = '';
            this._clearHighlights();
            document.getElementById('pdf-search-count').textContent = '';
        }
    },

    _updatePageInfo() {
        document.getElementById('pdf-page-info').textContent =
            `${this.currentPage} / ${this.totalPages}`;
    }
};
