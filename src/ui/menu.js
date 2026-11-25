import { CONFIG } from '../config.js';
import { CARS, getCarById } from '../data/cars.js';
import { TRACKS } from '../data/tracks/index.js';
import { TOTAL_LEVELS, getChapterName, getLevelConfig } from '../data/levels.js';
import { formatTime } from './hud.js';

/**
 * Menu, 1000-Level Career Browser, Track & Lap Select, Settings, Pause, and Post-Race Results.
 */
export class MenuUI {
  constructor({ root, save, audio, garage, onStartRace, onResume, onQuitRace, onSettingsChange }) {
    this.root = root;
    this.save = save;
    this.audio = audio;
    this.garage = garage;
    this.onStartRace = onStartRace;
    this.onResume = onResume;
    this.onQuitRace = onQuitRace;
    this.onSettingsChange = onSettingsChange;

    this.selectedTrackId = 'dhool_valley';
    this.selectedMode = 'race'; // 'race' | 'timetrial' | 'level'
    this.selectedLaps = 3;
    this.lastRaceOpts = { trackId: 'dhool_valley', mode: 'race', laps: 3 };
    this.levelPage = Math.floor((save.data.highestLevel - 1) / 20);
  }

  hide() {
    this.garage.destroy();
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }

  showMainMenu() {
    this.garage.destroy();
    this.root.classList.remove('hidden');
    const car = getCarById(this.save.data.selectedCar);
    const highestLv = this.save.data.highestLevel || 1;
    const ownedCount = this.save.data.ownedCars.length;

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="menu-hero">
          <div class="brand-lockup">
            <span class="brand-bolt">⚡</span>
            <span class="brand-text">RAFTAAR <em>NITRO</em></span>
          </div>
          <p class="hero-tagline">1,000-Level Career · Lap Racing · Supercar &amp; Hypercar Garage</p>

          <div class="hero-status-bar">
            <div class="status-chip">🚗 Ride: <b>${car.name}</b> <small>(${ownedCount}/${CARS.length})</small></div>
            <div class="status-chip">🏆 Level: <b>${highestLv} / ${TOTAL_LEVELS}</b></div>
            <div class="status-chip gold">◆ Wallet: <b>${this.save.data.coins} NITRO</b></div>
          </div>

          <div class="menu-buttons">
            <button class="btn btn-primary btn-lg" id="menu-levels">🏆 LEVEL MODE (LV ${highestLv} / 1000)</button>
            <button class="btn btn-secondary btn-lg" id="menu-play">🏁 QUICK RACE / LAPS</button>
            <button class="btn btn-secondary btn-lg" id="menu-garage">🛠 GARAGE SHOP (${CARS.length} CARS)</button>
            <button class="btn btn-ghost btn-lg" id="menu-settings">⚙ SETTINGS &amp; SAVE</button>
          </div>

          <div class="menu-footer-note">
            Controls: <b>WASD / Arrows</b> Drive · <b>Space</b> Drift · <b>Shift</b> Nitro Boost · <b>C</b> Camera · <b>R</b> Reset
          </div>
        </div>
      </div>
    `;

    document.getElementById('menu-levels').addEventListener('click', () => {
      this.audio.playClick();
      this.audio.startMusic('menu');
      this.levelPage = Math.floor((this.save.data.highestLevel - 1) / 20);
      this.showLevelSelect();
    });
    document.getElementById('menu-play').addEventListener('click', () => {
      this.audio.playClick();
      this.audio.startMusic('menu');
      this.showTrackSelect();
    });
    document.getElementById('menu-garage').addEventListener('click', () => {
      this.audio.playClick();
      this.audio.startMusic('menu');
      this.showGarage();
    });
    document.getElementById('menu-settings').addEventListener('click', () => {
      this.audio.playClick();
      this.showSettings();
    });
  }

  showGarage() {
    this.root.classList.remove('hidden');
    this.garage.render(this.root);
  }

  showLevelSelect() {
    this.root.classList.remove('hidden');
    const highest = this.save.data.highestLevel || 1;
    const totalPages = Math.ceil(TOTAL_LEVELS / 20); // 50 pages of 20 levels
    this.levelPage = Math.max(0, Math.min(totalPages - 1, this.levelPage));

    const startLv = this.levelPage * 20 + 1;
    const endLv = Math.min(TOTAL_LEVELS, startLv + 19);
    const chapterIdx = Math.floor((startLv - 1) / 100);
    const chapterName = getChapterName(startLv);
    const nextCfg = getLevelConfig(highest);

    const cardsHtml = [];
    for (let lv = startLv; lv <= endLv; lv++) {
      const cfg = getLevelConfig(lv);
      const unlocked = lv <= highest;
      const stars = this.save.data.levelStars[lv] || 0;
      const isCurrent = lv === highest;
      const starStr = unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '🔒';

      cardsHtml.push(`
        <button class="level-card ${isCurrent ? 'current' : ''} ${cfg.isBoss ? 'boss' : ''} ${!unlocked ? 'locked' : ''}"
          data-lv="${lv}" ${unlocked ? '' : 'disabled'}>
          <div class="lv-top">
            <span class="lv-num">${cfg.isMegaBoss ? '👑 ' : cfg.isBoss ? '⚔ ' : ''}LV ${lv}</span>
            <span class="lv-laps">${cfg.laps}L</span>
          </div>
          <div class="lv-track">${cfg.track.name}</div>
          <div class="lv-bottom">
            <span class="lv-stars">${starStr}</span>
            <span class="lv-goal">Top ${cfg.targetRank}</span>
          </div>
        </button>
      `);
    }

    const chapterButtons = Array.from({ length: 10 }, (_, ch) => {
      const chStart = ch * 100 + 1;
      const active = chapterIdx === ch;
      return `<button class="seg-btn ${active ? 'active' : ''}" data-ch="${ch}">${chStart}–${chStart + 99}</button>`;
    }).join('');

    const pageStartInChapter = chapterIdx * 5;
    const pageButtons = Array.from({ length: 5 }, (_, p) => {
      const pageIdx = pageStartInChapter + p;
      const pLv = pageIdx * 20 + 1;
      return `<button class="seg-btn ${this.levelPage === pageIdx ? 'active' : ''}" data-pg="${pageIdx}">${pLv}–${pLv + 19}</button>`;
    }).join('');

    this.root.innerHTML = `
      <div class="panel level-panel">
        <div class="panel-header">
          <div>
            <div class="eyebrow">CAREER CAMPAIGN · 1,000 LEVELS</div>
            <h2>CH ${chapterIdx + 1}: ${chapterName.toUpperCase()}</h2>
          </div>
          <div class="header-actions">
            <div class="coin-badge">◆ ${this.save.data.coins} NITRO</div>
            <button class="btn btn-primary" id="btn-play-next-lv">▶ Play LV ${highest} (${nextCfg.track.name})</button>
            <button class="btn btn-ghost" id="levels-back">← Back</button>
          </div>
        </div>

        <div class="level-nav-bar">
          <div class="segmented wrap-seg">${chapterButtons}</div>
          <div class="level-jump">
            <div class="segmented">${pageButtons}</div>
            <div class="jump-box">
              <span>Jump to LV</span>
              <input type="number" id="jump-lv-input" min="1" max="${TOTAL_LEVELS}" value="${highest}" />
              <button class="btn btn-secondary" id="btn-jump-lv">Go</button>
            </div>
          </div>
        </div>

        <div class="level-grid">${cardsHtml.join('')}</div>
      </div>
    `;

    document.getElementById('levels-back').addEventListener('click', () => {
      this.audio.playClick();
      this.showMainMenu();
    });

    document.getElementById('btn-play-next-lv').addEventListener('click', () => {
      this.audio.playClick();
      this._launchLevel(highest);
    });

    this.root.querySelectorAll('[data-ch]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.playClick();
        this.levelPage = Number(b.dataset.ch) * 5;
        this.showLevelSelect();
      });
    });

    this.root.querySelectorAll('[data-pg]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.playClick();
        this.levelPage = Number(b.dataset.pg);
        this.showLevelSelect();
      });
    });

    document.getElementById('btn-jump-lv').addEventListener('click', () => {
      const val = Math.max(1, Math.min(TOTAL_LEVELS, parseInt(document.getElementById('jump-lv-input').value, 10) || 1));
      this.audio.playClick();
      this.levelPage = Math.floor((val - 1) / 20);
      this.showLevelSelect();
    });

    this.root.querySelectorAll('.level-card:not(.locked)').forEach((card) => {
      card.addEventListener('click', () => {
        this.audio.playClick();
        this._launchLevel(Number(card.dataset.lv));
      });
    });
  }

  _launchLevel(levelNum) {
    const cfg = getLevelConfig(levelNum);
    const opts = {
      trackId: cfg.track.id,
      mode: 'level',
      laps: cfg.laps,
      levelConfig: cfg,
    };
    this.lastRaceOpts = opts;
    this.onStartRace(opts);
  }

  showTrackSelect() {
    this.root.classList.remove('hidden');
    const unlocked = this.save.data.unlockedTracks;
    if (!unlocked.includes(this.selectedTrackId)) {
      this.selectedTrackId = unlocked[0] || 'dhool_valley';
    }
    if (this.selectedMode === 'level') this.selectedMode = 'race';

    const diff = this.save.data.settings.difficulty;

    this.root.innerHTML = `
      <div class="panel track-panel">
        <div class="panel-header">
          <div>
            <div class="eyebrow">SELECT CIRCUIT, LAPS &amp; MODE</div>
            <h2>QUICK RACE &amp; LAPS</h2>
          </div>
          <div class="header-actions">
            <div class="coin-badge">◆ ${this.save.data.coins} NITRO</div>
            <button class="btn btn-ghost" id="tracks-back">← Back</button>
          </div>
        </div>

        <div class="mode-bar">
          <div class="segmented">
            <button class="seg-btn ${this.selectedMode === 'race' ? 'active' : ''}" data-mode="race">🏁 Quick Race (6 Cars)</button>
            <button class="seg-btn ${this.selectedMode === 'timetrial' ? 'active' : ''}" data-mode="timetrial">⏱ Time Trial + Ghost</button>
          </div>
          <div class="segmented" id="lap-count-bar">
            ${[1, 2, 3, 5]
              .map((l) => `<button class="seg-btn ${this.selectedLaps === l ? 'active' : ''}" data-laps="${l}">${l} ${l === 1 ? 'Lap' : 'Laps'}</button>`)
              .join('')}
          </div>
          <div class="segmented" id="ai-diff-bar">
            ${['easy', 'medium', 'hard']
              .map(
                (d) =>
                  `<button class="seg-btn ${diff === d ? 'active' : ''}" data-diff="${d}">${CONFIG.ai.difficulties[d].label} AI</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="track-grid">
          ${TRACKS.map((tr) => {
            const isUnlocked = unlocked.includes(tr.id);
            const isSelected = this.selectedTrackId === tr.id;
            const best = this.save.data.bestTimes[tr.id];
            return `
              <button class="track-card ${isSelected ? 'active' : ''} ${!isUnlocked ? 'locked' : ''}" data-track-id="${tr.id}" ${isUnlocked ? '' : 'disabled'}>
                <div class="track-swatch" style="background:linear-gradient(135deg, ${tr.theme.skyTop}, ${tr.theme.skyBottom})">
                  <span class="diff-badge">${tr.difficulty}</span>
                  ${!isUnlocked ? '<span class="lock-badge">🔒 LOCKED</span>' : ''}
                </div>
                <div class="track-info">
                  <h3>${tr.name}</h3>
                  <div class="track-sub">${tr.subtitle} · ${this.selectedLaps} ${this.selectedLaps === 1 ? 'Lap' : 'Laps'}</div>
                  <p class="muted">${isUnlocked ? tr.description : tr.unlockHint}</p>
                  <div class="track-records">
                    <span>Best Race: <b>${formatTime(best?.totalMs)}</b></span>
                    <span>Best Lap: <b>${formatTime(best?.bestLapMs)}</b></span>
                  </div>
                </div>
              </button>
            `;
          }).join('')}
        </div>

        <div class="panel-footer">
          <button class="btn btn-primary btn-lg" id="btn-start-race">START ${this.selectedLaps}-LAP RACE →</button>
        </div>
      </div>
    `;

    document.getElementById('tracks-back').addEventListener('click', () => {
      this.audio.playClick();
      this.showMainMenu();
    });

    this.root.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.playClick();
        this.selectedMode = b.dataset.mode;
        this.showTrackSelect();
      });
    });

    this.root.querySelectorAll('[data-laps]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.playClick();
        this.selectedLaps = Number(b.dataset.laps);
        this.showTrackSelect();
      });
    });

    this.root.querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.playClick();
        this.save.data.settings.difficulty = b.dataset.diff;
        this.save.save();
        this.showTrackSelect();
      });
    });

    this.root.querySelectorAll('.track-card:not(.locked)').forEach((card) => {
      card.addEventListener('click', () => {
        this.audio.playClick();
        this.selectedTrackId = card.dataset.trackId;
        this.showTrackSelect();
      });
    });

    document.getElementById('btn-start-race').addEventListener('click', () => {
      this.audio.playClick();
      const opts = {
        trackId: this.selectedTrackId,
        mode: this.selectedMode,
        laps: this.selectedLaps,
      };
      this.lastRaceOpts = opts;
      this.onStartRace(opts);
    });
  }

  showSettings() {
    this.root.classList.remove('hidden');
    const s = this.save.data.settings;

    this.root.innerHTML = `
      <div class="panel settings-panel">
        <div class="panel-header">
          <div>
            <div class="eyebrow">AUDIO, GRAPHICS &amp; DATA</div>
            <h2>SETTINGS</h2>
          </div>
          <button class="btn btn-ghost" id="settings-back">← Back</button>
        </div>

        <div class="settings-grid">
          <div class="settings-box">
            <h3>Audio Mixer</h3>
            <label class="range-row">
              <span>Master Volume</span>
              <input type="range" id="set-master" min="0" max="1" step="0.05" value="${s.masterVolume}">
            </label>
            <label class="range-row">
              <span>Music Volume</span>
              <input type="range" id="set-music" min="0" max="1" step="0.05" value="${s.musicVolume}">
            </label>
            <label class="range-row">
              <span>SFX &amp; Engine</span>
              <input type="range" id="set-sfx" min="0" max="1" step="0.05" value="${s.sfxVolume}">
            </label>

            <h3>Graphics &amp; View</h3>
            <label class="select-row">
              <span>Quality Preset</span>
              <select id="set-graphics">
                <option value="low" ${s.graphics === 'low' ? 'selected' : ''}>Low (30+ FPS Mobile)</option>
                <option value="medium" ${s.graphics === 'medium' ? 'selected' : ''}>Medium (60 FPS Smooth)</option>
                <option value="high" ${s.graphics === 'high' ? 'selected' : ''}>High (Shadows + Bloom)</option>
              </select>
            </label>
            <label class="toggle-row">
              <span>2D Mini Rush Mode (Top-Down View)</span>
              <input type="checkbox" id="set-mode2d" ${s.mode2D ? 'checked' : ''}>
            </label>
            <label class="toggle-row">
              <span>Force On-Screen Touch Controls</span>
              <input type="checkbox" id="set-touch" ${s.showTouchControls ? 'checked' : ''}>
            </label>
          </div>

          <div class="settings-box">
            <h3>Controls Guide</h3>
            <ul class="controls-list">
              <li><b>W / ↑</b> Accelerate · <b>S / ↓</b> Brake / Reverse</li>
              <li><b>A / D or ← / →</b> Steer</li>
              <li><b>Space</b> Handbrake Drift (sustained drifts earn Nitro!)</li>
              <li><b>Shift</b> Activate Nitro Boost + Raftaar Pulse</li>
              <li><b>C</b> Cycle Camera (Chase / Far Chase / Hood)</li>
              <li><b>R</b> Reset to Last Checkpoint · <b>Esc</b> Pause</li>
            </ul>

            <h3>Save Backup &amp; Track Access</h3>
            <div class="save-actions">
              <button class="btn btn-primary" id="btn-unlock-tracks">🔓 Unlock All 5 Tracks</button>
              <button class="btn btn-secondary" id="btn-export-save">Export Save Code</button>
              <button class="btn btn-secondary" id="btn-import-save">Import Save Code</button>
              <button class="btn btn-danger" id="btn-reset-save">Reset All Progress</button>
            </div>
            <textarea id="save-code-box" class="save-code-box" placeholder="Save code appears here for backup/transfer..."></textarea>
            <div id="save-msg" class="muted"></div>
          </div>
        </div>
      </div>
    `;

    const syncAudio = () => {
      s.masterVolume = parseFloat(document.getElementById('set-master').value);
      s.musicVolume = parseFloat(document.getElementById('set-music').value);
      s.sfxVolume = parseFloat(document.getElementById('set-sfx').value);
      s.graphics = document.getElementById('set-graphics').value;
      s.mode2D = document.getElementById('set-mode2d').checked;
      s.showTouchControls = document.getElementById('set-touch').checked;
      this.save.save();
      this.audio.applySettings(s);
      this.onSettingsChange?.();
    };

    ['set-master', 'set-music', 'set-sfx', 'set-graphics', 'set-mode2d', 'set-touch'].forEach((id) => {
      document.getElementById(id).addEventListener('change', syncAudio);
      document.getElementById(id).addEventListener('input', syncAudio);
    });

    document.getElementById('settings-back').addEventListener('click', () => {
      this.audio.playClick();
      this.showMainMenu();
    });

    const msgEl = document.getElementById('save-msg');
    const codeBox = document.getElementById('save-code-box');

    document.getElementById('btn-unlock-tracks').addEventListener('click', () => {
      this.audio.playClick();
      TRACKS.forEach((tr) => this.save.unlockTrack(tr.id));
      msgEl.textContent = 'All 5 tracks unlocked! Pick City, Coast, Snow, or Jungle in Quick Race.';
    });

    document.getElementById('btn-export-save').addEventListener('click', () => {
      codeBox.value = this.save.exportCode();
      codeBox.select();
      msgEl.textContent = 'Save code exported! Copy it somewhere safe.';
    });

    document.getElementById('btn-import-save').addEventListener('click', () => {
      if (this.save.importCode(codeBox.value)) {
        msgEl.textContent = 'Save restored successfully!';
        this.showSettings();
      } else {
        msgEl.textContent = 'Invalid save code.';
      }
    });

    document.getElementById('btn-reset-save').addEventListener('click', () => {
      if (confirm('Reset all Nitro Coins, unlocked cars, levels, tracks, and best times?')) {
        this.save.reset();
        this.showSettings();
      }
    });
  }

  showPauseModal() {
    this.root.classList.remove('hidden');
    this.root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h2>RACE PAUSED</h2>
          <div class="modal-buttons">
            <button class="btn btn-primary" id="pause-resume">▶ Resume</button>
            <button class="btn btn-secondary" id="pause-restart">↻ Restart Race</button>
            <button class="btn btn-ghost" id="pause-quit">Exit to Menu</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('pause-resume').addEventListener('click', () => {
      this.audio.playClick();
      this.onResume();
    });
    document.getElementById('pause-restart').addEventListener('click', () => {
      this.audio.playClick();
      this.onStartRace(this.lastRaceOpts);
    });
    document.getElementById('pause-quit').addEventListener('click', () => {
      this.audio.playClick();
      this.onQuitRace();
    });
  }

  showResults(res) {
    this.root.classList.remove('hidden');
    const isLevel = res.mode === 'level' && res.levelConfig;
    const lv = res.levelConfig;
    const hasNextLevel = isLevel && res.levelPassed && lv.level < TOTAL_LEVELS;

    const posLabel =
      res.mode === 'timetrial'
        ? 'TIME TRIAL COMPLETE'
        : `${res.position}${res.position === 1 ? 'ST' : res.position === 2 ? 'ND' : res.position === 3 ? 'RD' : 'TH'} PLACE`;

    const levelBanner = isLevel
      ? res.levelPassed
        ? `<div class="unlock-banner">🏆 LEVEL ${lv.level} CLEARED! ${'★'.repeat(res.levelStars)}${'☆'.repeat(3 - res.levelStars)}</div>`
        : `<div class="fail-banner">Finish Top ${lv.targetRank} to clear Level ${lv.level}!</div>`
      : '';

    this.root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card results-card">
          <div class="eyebrow">${isLevel ? `LEVEL ${lv.level} · ${lv.chapter.toUpperCase()}` : `${res.track.name.toUpperCase()} · ${res.laps || res.track.laps} LAPS`}</div>
          <h2>${posLabel}</h2>
          ${levelBanner}
          ${res.unlockedTrack ? `<div class="unlock-banner">🔓 NEW TRACK UNLOCKED: <b>${res.unlockedTrack.name}</b>!</div>` : ''}

          <div class="results-grid">
            <div class="res-stat"><span>Total Time</span><b>${formatTime(res.totalTimeMs)} ${res.isNewBestTotal ? '★' : ''}</b></div>
            <div class="res-stat"><span>Best Lap</span><b>${formatTime(res.bestLapMs)} ${res.isNewBestLap ? '★' : ''}</b></div>
            <div class="res-stat"><span>Pickups Collected</span><b>${res.nitroPicked}</b></div>
            <div class="res-stat"><span>Overtakes</span><b>${res.overtakes}</b></div>
            <div class="res-stat"><span>Race + Clear Prize</span><b>+◆ ${res.podiumReward}</b></div>
            <div class="res-stat highlight"><span>Total Nitro Earned</span><b>+◆ ${res.coinsEarned}</b></div>
          </div>

          <div class="results-wallet">Current Wallet: <b>◆ ${this.save.data.coins} NITRO</b></div>

          <div class="modal-buttons row">
            ${hasNextLevel ? `<button class="btn btn-gold" id="res-next-lv">▶ Next: Level ${lv.level + 1}</button>` : ''}
            <button class="btn btn-primary" id="res-restart">↻ Race Again</button>
            <button class="btn btn-secondary" id="res-garage">🛠 Garage</button>
            <button class="btn btn-ghost" id="res-menu">Menu</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('res-next-lv')?.addEventListener('click', () => {
      this.audio.playClick();
      this._launchLevel(lv.level + 1);
    });
    document.getElementById('res-restart').addEventListener('click', () => {
      this.audio.playClick();
      const opts = isLevel
        ? { trackId: lv.track.id, mode: 'level', laps: lv.laps, levelConfig: lv }
        : { trackId: res.track.id, mode: res.mode, laps: res.laps };
      this.lastRaceOpts = opts;
      this.onStartRace(opts);
    });
    document.getElementById('res-garage').addEventListener('click', () => {
      this.audio.playClick();
      this.onQuitRace('garage');
    });
    document.getElementById('res-menu').addEventListener('click', () => {
      this.audio.playClick();
      this.onQuitRace('menu');
    });
  }
}
