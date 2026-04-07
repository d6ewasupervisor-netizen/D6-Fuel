const Scanner = {
    isRunning: false,
    onScan: null,
    _mode: null,         // 'native' | 'legacy'
    _stream: null,
    _video: null,
    _detector: null,
    _rafId: null,
    _intervalId: null,
    _legacyInstance: null,
    _lastCode: '',
    _lastCodeTime: 0,
    _containerId: null,
    _torchOn: false,
    _canvas: null,
    _ctx: null,
    _audioCtx: null,     // Reused across scans to avoid per-scan AudioContext churn
    DEBOUNCE_MS: 1200,
    SCAN_INTERVAL_MS: 80,

    _dedupe(code) {
        const now = Date.now();
        if (code === this._lastCode && now - this._lastCodeTime < this.DEBOUNCE_MS) return true;
        this._lastCode = code;
        this._lastCodeTime = now;
        return false;
    },

    _onDetected(code) {
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
        try {
            // Reuse a single AudioContext across scans — creating one per scan
            // accumulates resources on mobile and can hit browser context limits.
            if (!this._audioCtx) this._audioCtx = new AudioContext();
            const ctx = this._audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 1800;
            gain.gain.value = 0.08;
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.08);
        } catch { /* audio not available */ }

        const container = document.getElementById(this._containerId);
        if (container) {
            container.classList.add('scan-success');
            setTimeout(() => container.classList.remove('scan-success'), 600);
        }

        if (this.onScan) this.onScan(code);
    },

    async start(elementId, callback) {
        this.onScan = callback;
        this._containerId = elementId;
        await this.stop();

        const container = document.getElementById(elementId);
        if (container) container.innerHTML = '';

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

        await this._startLegacy(elementId);
    },

    // --- Native BarcodeDetector path ---
    async _startNative(elementId, formats) {
        const container = document.getElementById(elementId);
        if (!container) return;

        this._detector = new BarcodeDetector({ formats });

        // Lower resolution reduces CPU, heat and battery on mobile.
        // 1280×720 is sufficient for UPC detection after downscaling to 640px.
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            });
        } catch (e) {
            console.warn('getUserMedia failed, falling back to legacy:', e);
            this._detector = null;
            if (container) container.innerHTML = '';
            await this._startLegacy(elementId);
            return;
        }

        // Apply continuous autofocus + torch readiness on the track
        const track = this._stream.getVideoTracks()[0];
        if (track) {
            try {
                const caps = track.getCapabilities?.() || {};
                const advanced = {};
                if (caps.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
                if (caps.zoom) advanced.zoom = caps.zoom.min;
                if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
            } catch { /* not all devices support these */ }
        }

        const video = document.createElement('video');
        video.srcObject = this._stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.setAttribute('muted', 'true');
        video.style.cssText = 'width:100%;border-radius:12px;display:block;';
        container.prepend(video);
        this._video = video;

        try {
            await video.play();
        } catch (e) {
            console.warn('Video play failed, falling back to legacy:', e);
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
            this._detector = null;
            video.remove();
            this._video = null;
            if (container) container.innerHTML = '';
            await this._startLegacy(elementId);
            return;
        }

        // Off-screen canvas for fast detection at reduced resolution
        this._canvas = document.createElement('canvas');
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });

        this._mode = 'native';
        this.isRunning = true;
        this._detecting = false;
        this._startScanLoop();
    },

    _startScanLoop() {
        // Fixed interval (not RAF) ensures consistent scan rate independent of
        // display refresh, which is critical when the tab is partially hidden or
        // the device throttles animations.
        this._intervalId = setInterval(() => this._scanTick(), this.SCAN_INTERVAL_MS);
    },

    async _scanTick() {
        if (!this.isRunning || !this._video || !this._detector || this._detecting) return;
        if (this._video.readyState < 2) return;

        this._detecting = true;
        try {
            const vw = this._video.videoWidth;
            const vh = this._video.videoHeight;
            if (!vw || !vh) return;

            // Scale down to ~640px wide for faster detection
            const scale = Math.min(1, 640 / vw);
            const cw = Math.round(vw * scale);
            const ch = Math.round(vh * scale);
            if (this._canvas.width !== cw) this._canvas.width = cw;
            if (this._canvas.height !== ch) this._canvas.height = ch;

            this._ctx.drawImage(this._video, 0, 0, cw, ch);

            const barcodes = await this._detector.detect(this._canvas);
            for (const bc of barcodes) {
                const code = (bc.rawValue || '').trim();
                if (code && !this._dedupe(code)) {
                    this._onDetected(code);
                    return;
                }
            }

            // If nothing found, also try a 180-degree rotated frame for upside-down barcodes
            if (barcodes.length === 0) {
                this._ctx.save();
                this._ctx.translate(cw, ch);
                this._ctx.rotate(Math.PI);
                this._ctx.drawImage(this._video, 0, 0, cw, ch);
                this._ctx.restore();

                const flipped = await this._detector.detect(this._canvas);
                for (const bc of flipped) {
                    const code = (bc.rawValue || '').trim();
                    if (code && !this._dedupe(code)) {
                        this._onDetected(code);
                        return;
                    }
                }
            }
        } catch { /* frame error, continue */ }
        finally { this._detecting = false; }
    },

    // --- Legacy html5-qrcode fallback ---
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
                    if (code && !this._dedupe(code)) {
                        this._onDetected(code);
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

    // --- Torch / flashlight ---
    async toggleTorch() {
        if (!this._stream) return false;
        const track = this._stream.getVideoTracks()[0];
        if (!track) return false;

        try {
            const caps = track.getCapabilities?.() || {};
            if (!caps.torch) return false;

            this._torchOn = !this._torchOn;
            await track.applyConstraints({ advanced: [{ torch: this._torchOn }] });
            return this._torchOn;
        } catch {
            return false;
        }
    },

    get torchAvailable() {
        if (!this._stream) return false;
        const track = this._stream.getVideoTracks()[0];
        return !!track?.getCapabilities?.()?.torch;
    },

    // --- Image scan (retained for future use) ---
    async scanImage(file, callback) {
        const img = new Image();
        const url = URL.createObjectURL(file);
        try {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });

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

            if (typeof Html5Qrcode !== 'undefined') {
                try {
                    const code = await Html5Qrcode.scanFile(file, false);
                    const trimmed = (code || '').trim();
                    if (trimmed) { callback(trimmed); return; }
                } catch { /* no barcode found */ }
            }

            callback(null);
        } finally {
            URL.revokeObjectURL(url);
        }
    },

    // --- Cleanup ---
    async stop() {
        this.isRunning = false;

        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this._torchOn && this._stream) {
            try {
                const track = this._stream.getVideoTracks()[0];
                if (track) await track.applyConstraints({ advanced: [{ torch: false }] });
            } catch { /* ok */ }
            this._torchOn = false;
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
        this._canvas = null;
        this._ctx = null;

        if (this._legacyInstance) {
            try {
                if (this._mode === 'legacy') await this._legacyInstance.stop();
                this._legacyInstance.clear();
            } catch { /* ok */ }
        }
        this._legacyInstance = null;

        if (this._audioCtx) {
            this._audioCtx.close().catch(() => {});
            this._audioCtx = null;
        }

        this._mode = null;
        this._lastCode = '';
        this._lastCodeTime = 0;
    },
};
