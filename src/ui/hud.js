/**
 * Format milliseconds into MM:SS.cc string.
 */
export function formatTime(ms) {
  if (!ms || ms <= 0) return '--:--.--';
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * In-race HUD controller: speed, nitro bar, Raftaar Pulse glow, minimap,
 * popups, countdown, wrong-way alert, and mobile touch overlay.
 */
export class HUD {
  constructor() {
    this.root = document.getElementById('hud-overlay');
    this.pulseEl = document.getElementById('raftaar-pulse');
    this.posEl = document.getElementById('hud-position');
    this.lapEl = document.getElementById('hud-lap');
    this.levelPillEl = document.getElementById('hud-level-pill');
    this.levelEl = document.getElementById('hud-level');
    this.timerEl = document.getElementById('hud-timer');
    this.bestLapEl = document.getElementById('hud-best-lap');
    this.coinsEl = document.getElementById('hud-coins');
    this.fpsEl = document.getElementById('hud-fps');
    this.speedEl = document.getElementById('hud-speed');
    this.nitroBarEl = document.getElementById('hud-nitro-bar');
    this.nitroPctEl = document.getElementById('hud-nitro-pct');
    this.countdownEl = document.getElementById('hud-countdown');
    this.alertEl = document.getElementById('hud-alert');
    this.popupsEl = document.getElementById('hud-popups');
    this.touchEl = document.getElementById('touch-controls');
    this.hintEl = document.getElementById('hud-controls-hint');
    this.minimapCanvas = document.getElementById('hud-minimap');
    this.minimapCtx = this.minimapCanvas?.getContext('2d');
    this.minimapBounds = null;

    this.pauseBtn = document.getElementById('btn-pause');
  }

  onPauseClick(fn) {
    this.pauseBtn?.addEventListener('click', fn);
  }

  show(trackData, coins, totalCars, showTouch, totalLaps = null, levelNumber = null) {
    this.root.classList.remove('hidden');
    this.coinsEl.textContent = String(coins);
    this.lapEl.innerHTML = `1<small>/${totalLaps || trackData.laps}</small>`;
    this.posEl.innerHTML = `1<small>/${totalCars}</small>`;
    if (this.levelPillEl && this.levelEl) {
      if (levelNumber) {
        this.levelEl.textContent = String(levelNumber);
        this.levelPillEl.classList.remove('hidden');
      } else {
        this.levelPillEl.classList.add('hidden');
      }
    }
    this.alertEl.classList.add('hidden');
    this.countdownEl.classList.add('hidden');

    if (showTouch) {
      this.touchEl.classList.remove('hidden');
      this.hintEl.classList.add('hidden');
    } else {
      this.touchEl.classList.add('hidden');
      this.hintEl.classList.remove('hidden');
    }
  }

  hide() {
    this.root.classList.add('hidden');
    this.setPulse(0);
  }

  setPulse(intensity) {
    if (!this.pulseEl) return;
    this.pulseEl.style.opacity = intensity > 0.05 ? String(Math.min(1, intensity)) : '0';
  }

  showCountdown(text) {
    if (!text) {
      this.countdownEl.classList.add('hidden');
      return;
    }
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('hidden');
    this.countdownEl.classList.remove('pop');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pop');
  }

  showPopup(text, color = '#00f5d4') {
    const el = document.createElement('div');
    el.className = 'hud-popup-item';
    el.textContent = text;
    el.style.color = color;
    this.popupsEl.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  update({ car, position, totalCars, totalLaps, raceTimeMs, coins, fps }) {
    this.posEl.innerHTML = `${position}<small>/${totalCars}</small>`;
    this.lapEl.innerHTML = `${Math.min(car.lap, totalLaps)}<small>/${totalLaps}</small>`;
    this.timerEl.textContent = formatTime(raceTimeMs);
    this.bestLapEl.textContent = formatTime(car.bestLapMs);
    this.coinsEl.textContent = String(coins);
    this.fpsEl.textContent = `${fps} FPS`;
    this.speedEl.textContent = String(car.getKmh());

    const nitroPct = Math.round((car.nitro / car.stats.nitroCapacity) * 100);
    this.nitroBarEl.style.width = `${nitroPct}%`;
    this.nitroBarEl.style.background = car.isBoosting
      ? `linear-gradient(90deg, ${car.data.colors.nitroFlame}, #ffffff)`
      : `linear-gradient(90deg, #ff6b35, ${car.data.colors.nitroFlame})`;
    this.nitroPctEl.textContent = `${nitroPct}%`;

    if (car.wrongWay) {
      this.alertEl.textContent = 'WRONG WAY';
      this.alertEl.classList.remove('hidden');
    } else if (car.stuckTimer > 1.3) {
      this.alertEl.textContent = 'HOLD R TO RESET';
      this.alertEl.classList.remove('hidden');
    } else {
      this.alertEl.classList.add('hidden');
    }
  }

  drawMinimapTrack(track) {
    if (!this.minimapCanvas) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      if (s.pos.x < minX) minX = s.pos.x;
      if (s.pos.x > maxX) maxX = s.pos.x;
      if (s.pos.z < minZ) minZ = s.pos.z;
      if (s.pos.z > maxZ) maxZ = s.pos.z;
    }
    const pad = 16;
    const w = this.minimapCanvas.width - pad * 2;
    const h = this.minimapCanvas.height - pad * 2;
    const scale = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxZ - minZ));
    this.minimapBounds = { minX, minZ, scale, pad, maxX, maxZ };

    // Pre-render static track loop once to offscreen buffer for zero per-frame path overhead
    const off = document.createElement('canvas');
    off.width = this.minimapCanvas.width;
    off.height = this.minimapCanvas.height;
    const octx = off.getContext('2d');
    octx.fillStyle = 'rgba(12, 10, 22, 0.72)';
    octx.fillRect(0, 0, off.width, off.height);
    octx.beginPath();
    for (let i = 0; i < track.samples.length; i += 2) {
      const s = track.samples[i];
      const mx = pad + (s.pos.x - minX) * scale;
      const my = pad + (s.pos.z - minZ) * scale;
      if (i === 0) octx.moveTo(mx, my);
      else octx.lineTo(mx, my);
    }
    octx.closePath();
    octx.strokeStyle = 'rgba(255,255,255,0.38)';
    octx.lineWidth = 4;
    octx.stroke();
    this.minimapBg = off;
  }

  updateMinimapCars(track, cars) {
    if (!this.minimapCtx || !this.minimapBounds || !this.minimapBg) return;
    const ctx = this.minimapCtx;
    const b = this.minimapBounds;
    const cw = this.minimapCanvas.width;
    const ch = this.minimapCanvas.height;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(this.minimapBg, 0, 0);

    // Car dots
    for (const car of cars) {
      const cx = b.pad + (car.pos.x - b.minX) * b.scale;
      const cy = b.pad + (car.pos.z - b.minZ) * b.scale;
      ctx.beginPath();
      ctx.arc(cx, cy, car.isPlayer ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = car.isPlayer ? '#00f5d4' : '#ff6b35';
      ctx.fill();
    }
  }
}
