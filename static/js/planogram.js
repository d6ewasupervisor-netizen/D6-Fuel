const Planogram = {
    currentData: null,
    currentBay: null,
    highlightUpc: null,
    highlightBay: null,
    highlightShelf: null,
    highlightPosition: null,

    setHighlight(upc, bay, shelf, position) {
        this.highlightUpc = upc;
        this.highlightBay = bay;
        this.highlightShelf = shelf;
        this.highlightPosition = position;
    },

    renderBayTabs(bays, activeBay, onSelect) {
        const container = document.getElementById('bay-tabs');
        container.innerHTML = '';
        bays.forEach(b => {
            const tab = document.createElement('button');
            tab.className = 'bay-tab' + (b.bay === activeBay ? ' active' : '');
            tab.textContent = b.bay;
            tab.onclick = () => onSelect(b.bay);
            container.appendChild(tab);
        });
    },

    renderBay(bayData) {
        const container = document.getElementById('shelf-container');
        container.innerHTML = '';

        if (!bayData || !bayData.shelves || bayData.shelves.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:32px;">No shelf data</p>';
            return;
        }

        const bayWidthInches = (bayData.width_ft || 3) * 12;
        const unit = document.createElement('div');
        unit.className = 'shelf-unit';

        // Shelves sorted ascending (bottom-to-top via column-reverse)
        const shelves = [...bayData.shelves].sort((a, b) => a.shelf - b.shelf);

        shelves.forEach(shelf => {
            const row = document.createElement('div');
            row.className = 'shelf-row';

            // Calculate shelf height based on product heights
            const maxH = Math.max(...shelf.products.map(p => p.height_inches || 5), 5);
            row.style.minHeight = Math.max(40, maxH * 5) + 'px';

            const label = document.createElement('span');
            label.className = 'shelf-label';
            label.textContent = `S${shelf.shelf}`;
            row.appendChild(label);

            shelf.products.forEach(product => {
                // Create one slot per facing
                const totalFacings = product.facings || 1;
                for (let f = 0; f < totalFacings; f++) {
                    const slot = document.createElement('div');
                    slot.className = 'product-slot';

                    // Proportional width
                    const widthPct = ((product.width_inches || 2.5) / bayWidthInches) * 100;
                    slot.style.width = widthPct + '%';
                    slot.style.height = Math.max(30, (product.height_inches || 4) * 5) + 'px';

                    // Color coding by brand
                    const desc = (product.description || '').toUpperCase();
                    const colorIdx = desc.charCodeAt(0) % 8;
                    slot.setAttribute('data-color', colorIdx);

                    // Text
                    const text = document.createElement('span');
                    text.className = 'slot-text';
                    text.textContent = (product.full_name || product.description || 'UNK').substring(0, 12);
                    slot.appendChild(text);

                    // Highlight check
                    if (this.highlightUpc &&
                        product.upc === this.highlightUpc &&
                        product.bay === this.highlightBay &&
                        product.shelf === this.highlightShelf &&
                        product.position === this.highlightPosition) {
                        slot.classList.add('highlight');
                        // Scroll into view after render
                        setTimeout(() => {
                            slot.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                        }, 100);
                    }

                    // Click handler
                    slot.onclick = () => this.showProductOverlay(product);
                    row.appendChild(slot);
                }
            });

            unit.appendChild(row);
        });

        container.appendChild(unit);
    },

    async showProductOverlay(product) {
        const overlay = document.getElementById('product-overlay');
        document.getElementById('overlay-name').textContent = product.full_name || product.description || 'Unknown';
        document.getElementById('overlay-upc').textContent = product.upc;
        document.getElementById('overlay-size').textContent = product.size || '-';
        document.getElementById('overlay-position').textContent =
            `Bay ${product.bay}, Shelf ${product.shelf}, Pos ${product.position}`;
        document.getElementById('overlay-facings').textContent = product.facings || 1;
        document.getElementById('overlay-dims').textContent =
            `${product.height_inches || '?'}" H x ${product.width_inches || '?'}" W`;

        // Image
        const imgContainer = document.getElementById('overlay-image');
        imgContainer.innerHTML = '<div class="placeholder-img">&#x1f48a;</div>';

        overlay.classList.remove('hidden');

        // Try loading image
        const imageUrl = await API.getProductImage(product.upc);
        if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = product.description || '';
            img.onerror = () => {
                imgContainer.innerHTML = '<div class="placeholder-img">&#x1f48a;</div>';
            };
            imgContainer.innerHTML = '';
            imgContainer.appendChild(img);
        }
    }
};
