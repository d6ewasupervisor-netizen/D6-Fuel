/**
 * Gesture handler for the bay view:
 * - Two-finger pinch to zoom
 * - Three-finger swipe to switch bays
 * - Block pull-to-refresh without blocking scroll
 */
const Gestures = {
    container: null,
    scale: 1,
    minScale: 1,
    maxScale: 4,
    originX: 0,
    originY: 0,
    translateX: 0,
    translateY: 0,
    initialPinchDist: 0,
    initialScale: 1,
    threeFingerStartX: 0,
    onSwipeLeft: null,
    onSwipeRight: null,

    init(container, { onSwipeLeft, onSwipeRight } = {}) {
        this.container = container;
        this.onSwipeLeft = onSwipeLeft;
        this.onSwipeRight = onSwipeRight;
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;

        // Block pull-to-refresh via CSS
        container.style.overscrollBehaviorY = 'contain';
        container.style.touchAction = 'pan-y';

        container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        container.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: true });

        // Double-tap to reset zoom
        let lastTap = 0;
        container.addEventListener('touchend', (e) => {
            if (e.changedTouches.length !== 1) return;
            const now = Date.now();
            if (now - lastTap < 300) {
                this.resetZoom();
                e.preventDefault();
            }
            lastTap = now;
        });
    },

    _onTouchStart(e) {
        if (e.touches.length === 2) {
            // Pinch start
            e.preventDefault();
            this.initialPinchDist = this._getPinchDist(e.touches);
            this.initialScale = this.scale;
            const rect = this.container.getBoundingClientRect();
            this.originX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
            this.originY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        } else if (e.touches.length >= 3) {
            // Three-finger swipe start
            e.preventDefault();
            this.threeFingerStartX = this._getAvgX(e.touches);
        }
    },

    _onTouchMove(e) {
        if (e.touches.length === 2) {
            // Pinch move
            e.preventDefault();
            const dist = this._getPinchDist(e.touches);
            const ratio = dist / this.initialPinchDist;
            this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.initialScale * ratio));
            this._applyTransform();
        } else if (e.touches.length >= 3) {
            e.preventDefault();
        }
    },

    _onTouchEnd(e) {
        if (e.changedTouches.length >= 1 && this._lastTouchCount >= 3) {
            // Three-finger swipe end
            const endX = e.changedTouches[0].clientX;
            const delta = endX - this.threeFingerStartX;
            if (Math.abs(delta) > 50) {
                if (delta < 0 && this.onSwipeLeft) this.onSwipeLeft();
                if (delta > 0 && this.onSwipeRight) this.onSwipeRight();
            }
        }
        this._lastTouchCount = e.touches.length;

        // Snap back if zoomed out below 1
        if (this.scale < 1) {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this._applyTransform();
        }
    },

    _lastTouchCount: 0,

    _getPinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    _getAvgX(touches) {
        let sum = 0;
        for (let i = 0; i < touches.length; i++) sum += touches[i].clientX;
        return sum / touches.length;
    },

    _applyTransform() {
        if (!this.container) return;
        const target = this.container.querySelector('.shelf-unit') || this.container;
        target.style.transformOrigin = `${this.originX}px ${this.originY}px`;
        target.style.transform = `scale(${this.scale}) translate(${this.translateX}px, ${this.translateY}px)`;
    },

    resetZoom() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        if (this.container) {
            const target = this.container.querySelector('.shelf-unit') || this.container;
            target.style.transform = '';
            target.style.transformOrigin = '';
        }
    },

    // Track three-finger touches properly
    _initTouchTracking() {
        if (!this.container) return;
        this.container.addEventListener('touchstart', (e) => {
            this._lastTouchCount = e.touches.length;
        }, { passive: true });
    }
};

// Prevent pull-to-refresh globally on the bay view
document.addEventListener('DOMContentLoaded', () => {
    Gestures._initTouchTracking();
});
