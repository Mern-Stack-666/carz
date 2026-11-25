/**
 * Unified keyboard and mobile touch input handler.
 * Supports WASD/Arrows, Space (drift), Shift (nitro), C (camera), R (reset), Esc (pause).
 */
export class InputSystem {
  constructor() {
    this.keys = new Set();
    this.touch = {
      left: false,
      right: false,
      gas: false,
      brake: false,
      drift: false,
      nitro: false,
    };
    this.listeners = {
      camera: [],
      reset: [],
      pause: [],
    };
    this.isTouchDevice =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;

    this._onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        // Prevent page scrolling when driving
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
      if (!e.repeat) {
        if (e.code === 'KeyC') this._emit('camera');
        if (e.code === 'KeyR') this._emit('reset');
        if (e.code === 'Escape') this._emit('pause');
      }
      this.keys.add(e.code);
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    this._onBlur = () => {
      this.keys.clear();
      Object.keys(this.touch).forEach((k) => {
        this.touch[k] = false;
      });
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  bindTouchControls() {
    const map = [
      ['touch-left', 'left'],
      ['touch-right', 'right'],
      ['touch-gas', 'gas'],
      ['touch-brake', 'brake'],
      ['touch-drift', 'drift'],
      ['touch-nitro', 'nitro'],
    ];

    map.forEach(([id, prop]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => {
        e.preventDefault();
        this.touch[prop] = true;
        el.classList.add('active');
      };
      const end = (e) => {
        e.preventDefault();
        this.touch[prop] = false;
        el.classList.remove('active');
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
    });
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
  }

  _emit(event) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((fn) => fn());
    }
  }

  getDriveState() {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.gas;
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touch.brake;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.left;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.right;
    const drift = this.keys.has('Space') || this.touch.drift;
    const nitro = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.nitro;

    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      drift,
      nitro,
    };
  }
}
