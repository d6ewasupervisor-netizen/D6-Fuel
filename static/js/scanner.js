const Scanner = {
    isRunning: false,
    onScan: null,
    _mode: null,         // 'native' | 'legacy'
    _stream: null,
    _video: null,
    _detector: null,
    _rafId: null,
    _legacyInstance: null,
    _lastCode: '',
    _lastCodeTime: 0,
    _containerId: null,
    DEBOUNCE_MS: 1500,

    _dedupe(code) {
        const now = Date.now();
        if (code === this._lastCode && now - this._lastCodeTime < this.DEBOUNCE_MS) return true;
        this._lastCode = code;
        this._lastCodeTime = now;
        return false;
    },

    async start(elementId, callback) {
        this.onScan = callback;
        this._containerId = elementId;
        await this.stop();

        const container = document.getElementById(elementId);
        if (container) container.innerHTML = '';

        // Try native BarcodeDetector first (handles all angles/orientations)
        if ('BarcodeDetector' in window) {
            try {
                const formats = await BarcodeDetector.getSupportedFormats();
                const wanted = ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'];
                const supported = wanted.filter(f => formats.includes(f));
                if (supported.length > 0) {
                    await this._startNative(elementId, supported);
                    return;
                }
            } catch (e) {
                console.warn('Native BarcodeDetector failed, falling back:', e);
                // Clean up partially-acquired resources before legacy fallback
                if (this._stream) {
                    this._stream.getTracks().forEach(t => t.stop());
                    this._stream = null;
                }
                if (this._video) {
                    this._video.remove();
                    this._video = null;
                }
                this._detector = null;
                if (container) container.innerHTML = '';
            }
        }

        // Fallback: html5-qrcode with optimized settings
        await this._startLegacy(elementId);
    },

    // --- Native BarcodeDetector (primary) ---
    async _startNative(elementId, formats) {
        const container = document.getElementById(elementId);
        if (!container) return;

        this._detector = new BarcodeDetector({ formats });
        this._stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        });

        const video = document.createElement('video');
        video.srcObject = this._stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.style.cssText = 'width:100%;max-width:300px;border-radius:10px;display:block;margin:0 auto;';
        container.prepend(video);
        this._video = video;
        await video.play();

        this._mode = 'native';
        this.isRunning = true;
        this._scanLoop();
    },

    async _scanLoop() {
        if (!this.isRunning || !this._video || !this._detector) return;
        try {
            if (this._video.readyState >= 2) {
                const barcodes = await this._detector.detect(this._video);
                for (const bc of barcodes) {
                    const code = (bc.rawValue || '').trim();
                    if (code && !this._dedupe(code)) {
                        if (this.onScan) this.onScan(code);
                        return;
                    }
                }
            }
        } catch { /* frame error, continue */ }
        this._rafId = requestAnimationFrame(() => this._scanLoop());
    },

    // --- Legacy html5-qrcode (fallback) ---
    async _startLegacy(elementId) {
        this._legacyInstance = new Html5Qrcode(elementId, {
            formatsToSupport: [
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
            ],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        try {
            await this._legacyInstance.start(
                { facingMode: 'environment' },
                {
                    fps: 15,
                    qrbox: undefined,
                    aspectRatio: 16 / 9,
                    disableFlip: false,
                },
                (decodedText) => {
                    const code = (decodedText || '').trim();
                    if (code && !this._dedupe(code) && this.onScan) {
                        this.onScan(code);
                    }
                },
                () => {},
            );
            this._mode = 'legacy';
            this.isRunning = true;
        } catch (err) {
            console.warn('Scanner start failed:', err);
            this.isRunning = false;
        }
    },

    async scanImage(file, callback) {
        const img = new Image();
        const url = URL.createObjectURL(file);
        try {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });

            // Try native BarcodeDetector first
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await BarcodeDetector.getSupportedFormats();
                    const wanted = ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'];
                    const supported = wanted.filter(f => formats.includes(f));
                    if (supported.length > 0) {
                        const detector = new BarcodeDetector({ formats: supported });
                        const barcodes = await detector.detect(img);
                        for (const bc of barcodes) {
                            const code = (bc.rawValue || '').trim();
                            if (code) { callback(code); return; }
                        }
                    }
                } catch { /* fall through to legacy */ }
            }

            // Fallback: html5-qrcode scanFile
            if (typeof Html5Qrcode !== 'undefined') {
                try {
                    const code = await Html5Qrcode.scanFile(file, /* showImage */ false);
                    const trimmed = (code || '').trim();
                    if (trimmed) { callback(trimmed); return; }
                } catch { /* no barcode found */ }
            }

            callback(null);
        } finally {
            URL.revokeObjectURL(url);
        }
    },

    async stop() {
        this.isRunning = false;

        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this._video) {
            this._video.pause();
            this._video.srcObject = null;
            this._video.remove();
            this._video = null;
        }

        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }

        this._detector = null;

        if (this._legacyInstance) {
            try {
                if (this._mode === 'legacy') await this._legacyInstance.stop();
                this._legacyInstance.clear();
            } catch { /* ok */ }
        }
        this._legacyInstance = null;

        this._mode = null;
        this._lastCode = '';
        this._lastCodeTime = 0;
    },
};
