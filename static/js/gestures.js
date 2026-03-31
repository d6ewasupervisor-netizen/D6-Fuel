/**
 * Gesture handler for the bay view:
 * - Single-finger horizontal swipe to switch bays
 * - Two-finger pinch to zoom
 * - Double-tap to reset zoom
 * - Block pull-to-refresh without blocking vertical scroll
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
    onSwipeLeft: null,
    onSwipeRight: null,

    _swipeStartX: 0,
    _swipeStartY: 0,
    _swipeTracking: false,
    _swipeLocked: null,
    _touchCount: 0,

    init(container, { onSwipeLeft, onSwipeRight } = {}) {
        if (this.container === container) {
            this.onSwipeLeft = onSwipeLeft;
            this.onSwipeRight = onSwipeRight;
            return;
        }

        this.container = container;
        this.onSwipeLeft = onSwipeLeft;
        this.onSwipeRight = onSwipeRight;
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;

        container.style.overscrollBehaviorY = 'contain';

        container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        container.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });

        let lastTap = 0;
        container.addEventListener('touchend', (e) => {
            if (e.changedTouches.length !== 1 || this._touchCount !== 1) return;
            const now = Date.now();
            if (now - lastTap < 300) {
                this.resetZoom();
                e.preventDefault();
            }
            lastTap = now;
        });
    },

    _onTouchStart(e) {
        this._touchCount = e.touches.length;

        if (e.touches.length === 1 && this.scale <= 1) {
            this._swipeStartX = e.touches[0].clientX;
            this._swipeStartY = e.touches[0].clientY;
            this._swipeTracking = true;
            this._swipeLocked = null;
        } else if (e.touches.length === 2) {
            e.preventDefault();
            this._swipeTracking = false;
            this.initialPinchDist = this._getPinchDist(e.touches);
            this.initialScale = this.scale;
            const rect = this.container.getBoundingClientRect();
            this.originX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
            this.originY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        } else {
            this._swipeTracking = false;
        }
    },

    _onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = this._getPinchDist(e.touches);
            const ratio = dist / this.initialPinchDist;
            this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.initialScale * ratio));
            this._applyTransform();
            return;
        }

        if (e.touches.length === 1 && this._swipeTracking) {
            const dx = e.touches[0].clientX - this._swipeStartX;
            const dy = e.touches[0].clientY - this._swipeStartY;

            if (this._swipeLocked === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                this._swipeLocked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
            }

            if (this._swipeLocked === 'h') {
                e.preventDefault();
            }
        }
    },

    _onTouchEnd(e) {
        if (this._swipeTracking && this._swipeLocked === 'h' && e.changedTouches.length === 1) {
            const dx = e.changedTouches[0].clientX - this._swipeStartX;
            if (Math.abs(dx) > 50) {
                if (dx < 0 && this.onSwipeLeft) this.onSwipeLeft();
                if (dx > 0 && this.onSwipeRight) this.onSwipeRight();
            }
        }

        this._swipeTracking = false;
        this._swipeLocked = null;
        this._touchCount = e.touches.length;

        if (this.scale < 1) {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this._applyTransform();
        }
    },

    _getPinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
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
    }
};
