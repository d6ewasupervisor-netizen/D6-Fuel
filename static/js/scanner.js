const Scanner = {
    instance: null,
    isRunning: false,
    onScan: null,

    async start(elementId, callback) {
        this.onScan = callback;
        if (this.instance) {
            await this.stop();
        }

        this.instance = new Html5Qrcode(elementId);
        try {
            await this.instance.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 100 },
                    formatsToSupport: [
                        Html5QrcodeSupportedFormats.UPC_A,
                        Html5QrcodeSupportedFormats.UPC_E,
                        Html5QrcodeSupportedFormats.EAN_13,
                        Html5QrcodeSupportedFormats.EAN_8,
                    ],
                },
                (decodedText) => {
                    if (this.onScan) {
                        this.onScan(decodedText);
                    }
                },
                () => {} // ignore errors
            );
            this.isRunning = true;
        } catch (err) {
            console.warn("Scanner start failed:", err);
            this.isRunning = false;
        }
    },

    async stop() {
        if (this.instance && this.isRunning) {
            try {
                await this.instance.stop();
            } catch {}
            this.isRunning = false;
        }
    }
};
