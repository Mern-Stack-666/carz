import './style.css';
import { saveSystem } from './systems/save.js';
import { InputSystem } from './systems/input.js';
import { AudioSystem } from './systems/audio.js';
import { Game } from './game/Game.js';
import { HUD } from './ui/hud.js';
import { GarageUI } from './ui/garage.js';
import { MenuUI } from './ui/menu.js';
import { getTrackById } from './data/tracks/index.js';
import { CARS } from './data/cars.js';
import { preloadCarModels } from './game/CarModels.js';

/**
 * Raftaar Nitro entry point.
 * Bootstraps systems, binds touch & keyboard controls, and routes between Menu, Garage, and Race.
 */
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-progress-bar');
const loadingTrackName = document.getElementById('loading-track-name');

const input = new InputSystem();
input.bindTouchControls();

const audio = new AudioSystem(saveSystem.data.settings);
const hud = new HUD();

const game = new Game({
  container: document.getElementById('game-container'),
  input,
  audio,
  save: saveSystem,
  hud,
});

const garage = new GarageUI({
  save: saveSystem,
  audio,
  onBack: () => menu.showMainMenu(),
});

const menu = new MenuUI({
  root: document.getElementById('ui-root'),
  save: saveSystem,
  audio,
  garage,
  onStartRace: (raceOpts) => launchRace(raceOpts),
  onResume: () => {
    menu.hide();
    game.togglePause();
  },
  onQuitRace: (target = 'menu') => {
    game.stop();
    audio.startMusic('menu');
    if (target === 'garage') menu.showGarage();
    else menu.showMainMenu();
  },
  onSettingsChange: () => {
    game.applyQuality();
  },
});

hud.onPauseClick(() => {
  if (game.state === 'racing' || game.state === 'paused') {
    game.togglePause();
  }
});

// Unlock Web Audio on first user interaction anywhere
const firstUnlock = () => {
  audio.unlock();
  window.removeEventListener('pointerdown', firstUnlock);
  window.removeEventListener('keydown', firstUnlock);
};
window.addEventListener('pointerdown', firstUnlock);
window.addEventListener('keydown', firstUnlock);

const modelsReady = preloadCarModels(CARS);

function launchRace({ trackId, mode = 'race', laps = null, levelConfig = null }) {
  const track = getTrackById(trackId);
  menu.hide();
  loadingTrackName.textContent = levelConfig
    ? `Level ${levelConfig.level} — ${track.name} (${levelConfig.laps} Laps)`
    : `Loading ${track.name}...`;
  loadingBar.style.width = '20%';
  loadingScreen.classList.remove('hidden');

  requestAnimationFrame(async () => {
    loadingBar.style.width = '55%';
    await modelsReady;
    loadingBar.style.width = '80%';
    setTimeout(() => {
      game.startRace(
        { trackId, mode, laps, levelConfig },
        (results) => menu.showResults(results),
        (isPaused) => {
          if (isPaused) menu.showPauseModal();
          else menu.hide();
        }
      );
      loadingBar.style.width = '100%';
      setTimeout(() => loadingScreen.classList.add('hidden'), 180);
    }, 60);
  });
}

menu.showMainMenu();

// Register offline PWA service worker on web (skipped inside native Capacitor shell)
if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
