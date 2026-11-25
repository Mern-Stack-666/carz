import { CONFIG } from '../config.js';

/**
 * Versioned localStorage save manager with safe validation,
 * best-lap ghost persistence, and save-code export/import.
 */
function createDefaultSave() {
  return {
    version: CONFIG.saveVersion,
    coins: 0,
    ownedCars: ['jugnu'],
    selectedCar: 'jugnu',
    unlockedTracks: ['dhool_valley'],
    highestLevel: 1,     // 1..1000
    levelStars: {},      // { [levelNumber]: 1|2|3 }
    bestTimes: {},       // { [trackId]: { totalMs, bestLapMs } }
    ghosts: {},          // { [trackId]: Array<{ t, x, y, z, ry }> }
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.45,
      sfxVolume: 0.85,
      graphics: 'medium',
      difficulty: 'medium',
      mode2D: false,
      showTouchControls: false,
    },
  };
}

function sanitizeSave(raw) {
  const def = createDefaultSave();
  if (!raw || typeof raw !== 'object') return def;

  const ownedCars = Array.isArray(raw.ownedCars)
    ? raw.ownedCars.filter((id) => typeof id === 'string')
    : def.ownedCars;
  if (!ownedCars.includes('jugnu')) ownedCars.unshift('jugnu');

  const unlockedTracks = Array.isArray(raw.unlockedTracks)
    ? raw.unlockedTracks.filter((id) => typeof id === 'string')
    : def.unlockedTracks;
  if (!unlockedTracks.includes('dhool_valley')) unlockedTracks.unshift('dhool_valley');

  const selectedCar =
    typeof raw.selectedCar === 'string' && ownedCars.includes(raw.selectedCar)
      ? raw.selectedCar
      : 'jugnu';

  const settings = { ...def.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
  settings.masterVolume = clampNum(settings.masterVolume, 0, 1, def.settings.masterVolume);
  settings.musicVolume = clampNum(settings.musicVolume, 0, 1, def.settings.musicVolume);
  settings.sfxVolume = clampNum(settings.sfxVolume, 0, 1, def.settings.sfxVolume);
  if (!['low', 'medium', 'high'].includes(settings.graphics)) settings.graphics = def.settings.graphics;
  if (!['easy', 'medium', 'hard'].includes(settings.difficulty)) settings.difficulty = def.settings.difficulty;
  settings.mode2D = Boolean(settings.mode2D);
  settings.showTouchControls = Boolean(settings.showTouchControls);

  return {
    version: CONFIG.saveVersion,
    coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
    ownedCars: [...new Set(ownedCars)],
    selectedCar,
    unlockedTracks: [...new Set(unlockedTracks)],
    highestLevel: clampNum(Math.floor(Number(raw.highestLevel) || 1), 1, 1000, 1),
    levelStars: raw.levelStars && typeof raw.levelStars === 'object' ? raw.levelStars : {},
    bestTimes: raw.bestTimes && typeof raw.bestTimes === 'object' ? raw.bestTimes : {},
    ghosts: raw.ghosts && typeof raw.ghosts === 'object' ? raw.ghosts : {},
    settings,
  };
}

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

class SaveSystem {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const str = localStorage.getItem(CONFIG.saveKey);
      if (!str) return createDefaultSave();
      return sanitizeSave(JSON.parse(str));
    } catch {
      return createDefaultSave();
    }
  }

  save() {
    try {
      localStorage.setItem(CONFIG.saveKey, JSON.stringify(this.data));
    } catch {
      // Ignore quota errors (e.g., if ghost data gets large, trim ghosts)
      try {
        this.data.ghosts = {};
        localStorage.setItem(CONFIG.saveKey, JSON.stringify(this.data));
      } catch {
        // Storage unavailable
      }
    }
  }

  addCoins(amount) {
    const add = Math.max(0, Math.round(amount));
    this.data.coins += add;
    this.save();
    return this.data.coins;
  }

  buyCar(carId, price) {
    if (this.data.ownedCars.includes(carId)) return { ok: true, reason: 'already_owned' };
    if (this.data.coins < price) return { ok: false, reason: 'insufficient_coins' };
    this.data.coins -= price;
    this.data.ownedCars.push(carId);
    this.data.selectedCar = carId;
    this.save();
    return { ok: true };
  }

  selectCar(carId) {
    if (!this.data.ownedCars.includes(carId)) return false;
    this.data.selectedCar = carId;
    this.save();
    return true;
  }

  unlockTrack(trackId) {
    if (!this.data.unlockedTracks.includes(trackId)) {
      this.data.unlockedTracks.push(trackId);
      this.save();
      return true;
    }
    return false;
  }

  recordLevelResult(levelNum, stars) {
    const prev = this.data.levelStars[levelNum] || 0;
    if (stars > prev) {
      this.data.levelStars[levelNum] = stars;
    }
    if (levelNum >= this.data.highestLevel && levelNum < 1000) {
      this.data.highestLevel = levelNum + 1;
    }
    this.save();
  }

  recordRaceTimes(trackId, totalMs, bestLapMs, ghostSamples = null) {
    const prev = this.data.bestTimes[trackId] || {};
    let isNewBestTotal = false;
    let isNewBestLap = false;

    if (totalMs > 0 && (!prev.totalMs || totalMs < prev.totalMs)) {
      prev.totalMs = totalMs;
      isNewBestTotal = true;
    }
    if (bestLapMs > 0 && (!prev.bestLapMs || bestLapMs < prev.bestLapMs)) {
      prev.bestLapMs = bestLapMs;
      isNewBestLap = true;
      if (Array.isArray(ghostSamples) && ghostSamples.length > 5) {
        // Quantize ghost samples to save storage space
        this.data.ghosts[trackId] = ghostSamples.map((s) => [
          Math.round(s.t),
          Math.round(s.x * 10) / 10,
          Math.round(s.y * 10) / 10,
          Math.round(s.z * 10) / 10,
          Math.round(s.ry * 100) / 100,
        ]);
      }
    }

    this.data.bestTimes[trackId] = prev;
    this.save();
    return { isNewBestTotal, isNewBestLap };
  }

  getGhost(trackId) {
    const raw = this.data.ghosts[trackId];
    if (!Array.isArray(raw)) return null;
    return raw.map((arr) => ({ t: arr[0], x: arr[1], y: arr[2], z: arr[3], ry: arr[4] }));
  }

  exportCode() {
    const payload = JSON.stringify({ ...this.data, ghosts: {} });
    return btoa(unescape(encodeURIComponent(payload)));
  }

  importCode(code) {
    try {
      const json = decodeURIComponent(escape(atob(code.trim())));
      const parsed = JSON.parse(json);
      this.data = sanitizeSave(parsed);
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  reset() {
    this.data = createDefaultSave();
    this.save();
  }
}

export const saveSystem = new SaveSystem();
