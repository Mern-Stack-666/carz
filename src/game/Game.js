import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';
import { CARS, getCarById } from '../data/cars.js';
import { getTrackById } from '../data/tracks/index.js';
import { Track } from './Track.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Car } from './Car.js';
import { createCarMesh } from './CarModels.js';
import { NitroManager } from './Nitro.js';
import { ParticleSystem } from './Particles.js';
import { SkidMarkSystem } from './SkidMarks.js';
import { RaceCamera } from './Camera.js';
import { AIController } from './AI.js';

const AI_NAMES = ['Zayn', 'Hira', 'Bilal', 'Sana', 'Tariq'];

/**
 * Main race orchestrator: drives Three.js renderer, Cannon-es PhysicsWorld,
 * countdown, player + AI RaycastVehicles, Time Trial Ghost, overtakes, and results.
 */
export class Game {
  constructor({ container, input, audio, save, hud }) {
    this.container = container;
    this.input = input;
    this.audio = audio;
    this.save = save;
    this.hud = hud;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Pre-generate crisp studio/sky IBL reflection environment for clearcoat car paint
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();

    this.scene = null;
    this.composer = null;
    this.physicsWorld = null;
    this.track = null;
    this.nitroMgr = null;
    this.particles = null;
    this.skidMarks = null;
    this.raceCamera = new RaceCamera(window.innerWidth / window.innerHeight);

    this.cars = [];
    this.playerCar = null;
    this.aiControllers = [];

    this.mode = 'race';
    this.ghostMesh = null;
    this.ghostData = null;
    this.currentLapGhost = [];
    this.ghostSampleTimer = 0;

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.state = 'idle';
    this.countdownTimer = 0;
    this.lastCountdownStep = 4;
    this.raceTimeMs = 0;
    this.coinsEarnedThisRace = 0;
    this.nitroPickedCount = 0;
    this.overtakesCount = 0;
    this.driftCoinBuffer = 0;
    this.prevPlayerRank = 1;

    this.lastFrameTime = performance.now();
    this.fpsFrames = 0;
    this.fpsClock = 0;
    this.currentFps = 60;
    this.rafId = null;

    this.onRaceFinish = null;
    this.onPauseToggle = null;

    this._onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.composer?.setSize(w, h);
      this.raceCamera.camera.aspect = w / h;
      this.raceCamera.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);

    this.input.on('camera', () => {
      if (this.state === 'racing' || this.state === 'countdown') {
        const name = this.raceCamera.cycleMode();
        this.audio.playClick();
        this.hud.showPopup(`CAM: ${name.toUpperCase()}`, '#9bf6ff');
      }
    });

    this.input.on('reset', () => {
      if (this.state === 'racing' && this.playerCar && this.track) {
        this.playerCar.resetToCheckpoint(this.track);
        this.hud.showPopup('RESET TO TRACK', '#ffd166');
      }
    });

    this.input.on('pause', () => {
      if (this.state === 'racing' || this.state === 'paused') {
        this.togglePause();
      }
    });

    this.applyQuality();
  }

  applyQuality() {
    const qKey = this.save.data.settings.graphics || 'medium';
    const q = CONFIG.graphics[qKey] || CONFIG.graphics.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.raceCamera.set2DMode(this.save.data.settings.mode2D);
    return q;
  }

  startRace({ trackId, mode = 'race', laps = null, levelConfig = null }, onFinish, onPauseToggle) {
    this.stop();
    this.mode = mode;
    this.activeLevel = levelConfig || null;
    this.onRaceFinish = onFinish;
    this.onPauseToggle = onPauseToggle;

    const quality = this.applyQuality();
    const trackData = getTrackById(trackId);
    this.activeLaps = Math.max(1, Number(laps || levelConfig?.laps || trackData.laps));
    const playerCarData = getCarById(this.save.data.selectedCar);

    this.scene = new THREE.Scene();
    this.scene.environment = this.envRT.texture;
    this.scene.fog = new THREE.FogExp2(trackData.theme.fogColor, trackData.theme.fogDensity);

    const amb = new THREE.HemisphereLight(
      trackData.theme.ambientColor,
      trackData.theme.groundColor,
      trackData.theme.ambientIntensity
    );
    this.scene.add(amb);

    const sun = new THREE.DirectionalLight(trackData.theme.sunColor, trackData.theme.sunIntensity);
    sun.position.set(...trackData.theme.sunPosition);
    if (quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      const d = 180;
      sun.shadow.camera.left = -d;
      sun.shadow.camera.right = d;
      sun.shadow.camera.top = d;
      sun.shadow.camera.bottom = -d;
      sun.shadow.camera.far = 500;
    }
    this.scene.add(sun);

    this.track = new Track(trackData, quality);
    this.scene.add(this.track.group);

    // Initialize full 3D Cannon-es PhysicsWorld & track colliders
    this.physicsWorld = new PhysicsWorld();
    this.physicsWorld.buildTrackColliders(this.track);

    this.nitroMgr = new NitroManager(this.scene, this.track);
    this.particles = new ParticleSystem(this.scene, quality);
    this.skidMarks = new SkidMarkSystem(this.scene, quality.bloom ? 320 : 180);

    // Optional post-processing UnrealBloomPass for glowing nitro flames, neon towers, & lights
    if (quality.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.raceCamera.camera));
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.34, // subtle cinematic glow without washing out daytime tracks
        0.45,
        0.86
      );
      this.composer.addPass(bloomPass);
      this.composer.addPass(new OutputPass());
    } else {
      this.composer = null;
    }

    this.cars = [];
    this.aiControllers = [];
    this.playerCar = new Car(playerCarData, {
      isPlayer: true,
      name: 'You',
      castShadow: quality.shadows,
      physicsWorld: this.physicsWorld,
    });
    // Add dynamic headlight beam on night tracks (Sheher Raat)
    if (trackData.theme.isNight) {
      const spot = new THREE.SpotLight('#fff6d6', 28, 85, Math.PI / 5.5, 0.45, 1.2);
      spot.position.set(0, 0.2, 2.0);
      const target = new THREE.Object3D();
      target.position.set(0, -1.2, 28);
      this.playerCar.mesh.add(spot, target);
      spot.target = target;
    }
    this.scene.add(this.playerCar.mesh);
    this.cars.push(this.playerCar);

    if (mode === 'race' || mode === 'level') {
      const diff = this.activeLevel ? this.activeLevel.difficulty : (this.save.data.settings.difficulty || 'medium');
      // Scale AI vehicle tier in higher career levels so rivals drive supercars & hypercars too
      let aiPool = CARS.filter((c) => c.id !== playerCarData.id);
      if (this.activeLevel) {
        const minIdx = Math.min(CARS.length - 5, Math.floor((this.activeLevel.level - 1) / 140));
        const tiered = CARS.slice(minIdx).filter((c) => c.id !== playerCarData.id);
        if (tiered.length >= 3) aiPool = tiered;
      }

      for (let i = 0; i < CONFIG.ai.count; i++) {
        const cData = aiPool[i % aiPool.length];
        const aiCar = new Car(cData, {
          isPlayer: false,
          name: AI_NAMES[i],
          castShadow: quality.shadows,
          physicsWorld: this.physicsWorld,
        });
        const row = Math.floor(i / 2);
        const side = (i % 2 === 0 ? -1 : 1) * 3.8;
        aiCar.placeOnTrack(this.track, 1 - (6 + row * 12) / this.track.totalLength, side);
        this.scene.add(aiCar.mesh);
        this.cars.push(aiCar);

        const lane = (i % 2 === 0 ? -1 : 1) * (1.8 + (i % 3) * 1.4);
        const jitter = (i - 2) * 0.02;
        const customSkill = this.activeLevel ? this.activeLevel.aiSkillBase : null;
        this.aiControllers.push(new AIController(aiCar, lane, diff, jitter, customSkill));
      }
      this.playerCar.placeOnTrack(this.track, 1 - (6 + 2 * 12) / this.track.totalLength, 3.8);
    } else {
      this.playerCar.placeOnTrack(this.track, 1 - 12 / this.track.totalLength, 0);
      this.ghostData = this.save.getGhost(trackId);
      if (this.ghostData && this.ghostData.length > 5) {
        this.ghostMesh = createCarMesh(playerCarData, { isGhost: true, castShadow: false }).root;
        this.scene.add(this.ghostMesh);
      } else {
        this.ghostMesh = null;
      }
    }

    // Settle all cars onto suspension springs cleanly before first frame
    for (let i = 0; i < 15; i++) {
      this.physicsWorld.step(1 / 60);
    }
    this.cars.forEach((c) => c.syncVisuals());

    this.currentLapGhost = [];
    this.ghostSampleTimer = 0;

    this.raceCamera.snapToCar(this.playerCar);
    this.raceCamera.setBoostEffect(0);

    this.state = 'countdown';
    this.countdownTimer = 3.2;
    this.lastCountdownStep = 4;
    this.raceTimeMs = 0;
    this.coinsEarnedThisRace = 0;
    this.nitroPickedCount = 0;
    this.overtakesCount = 0;
    this.driftCoinBuffer = 0;
    this.prevPlayerRank = mode === 'race' || mode === 'level' ? this.cars.length : 1;

    this.hud.show(
      trackData,
      this.save.data.coins,
      this.cars.length,
      this.save.data.settings.showTouchControls || this.input.isTouchDevice,
      this.activeLaps,
      this.activeLevel?.level || null
    );
    this.hud.drawMinimapTrack(this.track);
    this.audio.startEngine(playerCarData.audio);
    this.audio.startMusic('race');

    this.lastFrameTime = performance.now();
    this._loop();
  }

  togglePause() {
    if (this.state === 'racing') {
      this.state = 'paused';
      this.audio.updateEngine(0, false, false);
      this.onPauseToggle?.(true);
    } else if (this.state === 'paused') {
      this.state = 'racing';
      this.lastFrameTime = performance.now();
      this.onPauseToggle?.(false);
    }
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.state = 'idle';
    this.audio.stopEngine();
    this.hud.hide();
    this.hud.setPulse(0);
  }

  _loop = () => {
    this.rafId = requestAnimationFrame(this._loop);
    const now = performance.now();
    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    this.fpsFrames++;
    this.fpsClock += rawDt;
    if (this.fpsClock >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsClock);
      this.fpsFrames = 0;
      this.fpsClock = 0;
    }

    if (this.state !== 'paused') {
      this._step(dt, now / 1000);
    }

    if (this.scene) {
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.raceCamera.camera);
      }
    }
  };

  _step(dt, timeSec) {
    if (this.state === 'countdown') {
      this.countdownTimer -= dt;
      const step = Math.ceil(this.countdownTimer);
      if (step !== this.lastCountdownStep && step >= 1 && step <= 3) {
        this.lastCountdownStep = step;
        this.hud.showCountdown(String(step));
        this.audio.playCountdown(false);
      }
      if (this.countdownTimer <= 0) {
        this.state = 'racing';
        this.hud.showCountdown('GO!');
        this.audio.playCountdown(true);
        setTimeout(() => this.hud.showCountdown(null), 700);
      }

      // Lock brakes on starting grid during countdown (no reverse!)
      const idleCtrl = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false, holdBrake: true };
      this.cars.forEach((c) => c.applyControls(dt, idleCtrl, this.track));
      this.physicsWorld.step(dt);
      this.cars.forEach((c) => c.syncVisuals());

      this.raceCamera.update(dt, this.playerCar);
      this.nitroMgr.update(dt, timeSec, [], null);
      this.audio.updateEngine(0.05, false, false);
      this.hud.update({
        car: this.playerCar,
        position: this.prevPlayerRank,
        totalCars: this.cars.length,
        totalLaps: this.activeLaps,
        raceTimeMs: 0,
        coins: this.save.data.coins,
        fps: this.currentFps,
      });
      return;
    }

    if (this.state !== 'racing' && this.state !== 'finished') return;

    if (this.state === 'racing') {
      this.raceTimeMs += dt * 1000;
    }

    // 1. Apply player & AI controls to RaycastVehicle
    const playerControls =
      this.state === 'racing'
        ? this.input.getDriveState()
        : { throttle: 0.25, brake: 0, steer: 0, drift: false, nitro: false };

    this.playerCar.applyControls(dt, playerControls, this.track);

    const aiControlsList = this.aiControllers.map((ai) => {
      const ctrl = ai.computeControls(dt, this.track, this.cars, this.playerCar.totalProgress);
      ai.car.applyControls(dt, ctrl, this.track);
      return ctrl;
    });

    // 2. Step full 3D rigid-body & suspension physics world
    this.physicsWorld.step(dt);

    // 3. Post-step sync, collision callbacks, checkpoints, and visual transforms
    this.playerCar.postStep(dt, playerControls, this.track, {
      onWallHit: (intensity) => {
        this.audio.playCollision(intensity);
        this.raceCamera.triggerShake(intensity);
      },
      onLanding: (pos, intensity) => {
        this.audio.playCollision(intensity * 0.55);
        this.raceCamera.triggerShake(intensity * 0.4);
        this.particles.emitBurst(pos.clone().setY(pos.y - 0.5), '#d4a373', 10);
      },
      onOutOfBounds: () => {
        this.hud.showPopup('TRACK RESET', '#ffd166');
      },
      onDriftBonus: (coinFloat) => {
        this.driftCoinBuffer += coinFloat;
        if (this.driftCoinBuffer >= 5) {
          const award = Math.floor(this.driftCoinBuffer);
          this.driftCoinBuffer -= award;
          this.coinsEarnedThisRace += award;
          this.save.addCoins(award);
          this.hud.showPopup(`+${award} DRIFT NITRO`, '#ffd166');
        }
      },
      onLapComplete: (car) => this._handleLapComplete(car),
    });

    if (this.playerCar.stuckTimer >= CONFIG.physics.stuckResetTime) {
      this.playerCar.resetToCheckpoint(this.track);
      this.hud.showPopup('AUTO-RESET TO TRACK', '#ffd166');
    }

    this.aiControllers.forEach((ai, idx) => {
      ai.car.postStep(dt, aiControlsList[idx], this.track, {
        onLapComplete: (car) => this._handleLapComplete(car),
      });
    });

    // Nitro pickups
    this.nitroMgr.update(dt, timeSec, this.cars, (info) => {
      this.nitroPickedCount++;
      this.coinsEarnedThisRace += info.coins;
      this.save.addCoins(info.coins);
      this.audio.playPickup(info.risky);
      this.particles.emitBurst(info.position, info.risky ? '#ffbe0b' : '#00f5d4', 14);
      this.hud.showPopup(
        info.risky ? `+${info.coins} RISKY NITRO!` : `+${info.coins} NITRO`,
        info.risky ? '#ffbe0b' : '#00f5d4'
      );
    });

    this._emitCarParticles();
    this.particles.update(dt);

    if (this.mode === 'timetrial' && this.state === 'racing') {
      this._updateGhost(dt);
    }

    // Standings & Overtake bonus
    const sorted = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    const playerRank = sorted.indexOf(this.playerCar) + 1;
    if (this.state === 'racing' && (this.mode === 'race' || this.mode === 'level') && playerRank < this.prevPlayerRank && this.raceTimeMs > 2500) {
      const gained = this.prevPlayerRank - playerRank;
      const bonus = gained * CONFIG.nitro.overtakeCoins;
      this.overtakesCount += gained;
      this.coinsEarnedThisRace += bonus;
      this.save.addCoins(bonus);
      this.playerCar.nitro = Math.min(
        this.playerCar.stats.nitroCapacity,
        this.playerCar.nitro + gained * CONFIG.nitro.overtakeTankFill
      );
      this.hud.showPopup(`OVERTAKE! +${bonus} NITRO`, '#00f5d4');
    }
    this.prevPlayerRank = playerRank;

    this.raceCamera.setBoostEffect(this.playerCar.isBoosting ? 1 : 0);
    this.raceCamera.update(dt, this.playerCar);
    this.hud.setPulse(this.playerCar.isBoosting ? 1 : 0);

    const speedRatio = this.playerCar.getSpeed() / this.playerCar.stats.maxSpeed;
    this.audio.updateEngine(speedRatio, this.playerCar.isBoosting, this.playerCar.isDrifting);

    this.hud.update({
      car: this.playerCar,
      position: playerRank,
      totalCars: this.cars.length,
      totalLaps: this.activeLaps,
      raceTimeMs: this.raceTimeMs,
      coins: this.save.data.coins,
      fps: this.currentFps,
    });
    this.hud.updateMinimapCars(this.track, this.cars);
  }

  _emitCarParticles() {
    for (const car of this.cars) {
      if (car.isBoosting && Math.random() < 0.7) {
        const back = car.getForwardVector().multiplyScalar(-2.2);
        const pos = car.pos.clone().add(back);
        pos.y -= 0.35;
        this.particles.emit(
          pos,
          new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2),
          car.data.colors.nitroFlame,
          0.75,
          0.32
        );
      }
      if (car.isDrifting && Math.random() < 0.55) {
        const back = car.getForwardVector().multiplyScalar(-1.5);
        const pos = car.pos.clone().add(back);
        pos.y -= 0.55;
        this.particles.emit(
          pos,
          new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.2, (Math.random() - 0.5) * 1.5),
          '#dcdcdc',
          0.95,
          0.42
        );
        if (this.skidMarks) {
          const sample = this.track.samples[car.sampleHint];
          this.skidMarks.addPair(car, sample ? sample.pos.y : car.pos.y - 0.8);
        }
      }
    }
  }

  _updateGhost(dt) {
    const lapElapsed = this.raceTimeMs - this.playerCar.lapStartMs;
    this.ghostSampleTimer += dt;
    if (this.ghostSampleTimer >= 0.08) {
      this.ghostSampleTimer = 0;
      this.currentLapGhost.push({
        t: lapElapsed,
        x: this.playerCar.pos.x,
        y: this.playerCar.pos.y - 0.83,
        z: this.playerCar.pos.z,
        ry: this.playerCar.yaw,
      });
    }

    if (this.ghostMesh && this.ghostData && this.ghostData.length > 1) {
      const totalGhostMs = this.ghostData[this.ghostData.length - 1].t || 1;
      const gTime = lapElapsed % totalGhostMs;
      let idx = 0;
      while (idx < this.ghostData.length - 2 && this.ghostData[idx + 1].t < gTime) idx++;
      const a = this.ghostData[idx];
      const b = this.ghostData[idx + 1];
      const span = Math.max(1, b.t - a.t);
      const frac = THREE.MathUtils.clamp((gTime - a.t) / span, 0, 1);

      this.ghostMesh.position.set(
        THREE.MathUtils.lerp(a.x, b.x, frac),
        THREE.MathUtils.lerp(a.y, b.y, frac),
        THREE.MathUtils.lerp(a.z, b.z, frac)
      );
      this.ghostMesh.rotation.set(0, THREE.MathUtils.lerp(a.ry, b.ry, frac), 0);
    }
  }

  _handleLapComplete(car) {
    const lapDuration = this.raceTimeMs - car.lapStartMs;
    car.lapStartMs = this.raceTimeMs;
    if (lapDuration > 2000 && (car.bestLapMs === 0 || lapDuration < car.bestLapMs)) {
      car.bestLapMs = lapDuration;
      if (car.isPlayer && this.mode === 'timetrial') {
        this.save.recordRaceTimes(this.track.data.id, 0, lapDuration, this.currentLapGhost);
        this.ghostData = this.save.getGhost(this.track.data.id);
      }
    }
    if (car.isPlayer) {
      this.currentLapGhost = [];
    }

    if (car.lap >= this.activeLaps) {
      car.finished = true;
      car.finishTimeMs = this.raceTimeMs;
      if (car.isPlayer && this.state === 'racing') {
        this._finishPlayerRace();
      }
    } else {
      car.lap++;
      if (car.isPlayer) {
        const msg =
          car.lap === this.activeLaps
            ? `FINAL LAP! (${car.lap}/${this.activeLaps})`
            : `LAP ${car.lap} / ${this.activeLaps}`;
        this.hud.showPopup(msg, car.lap === this.activeLaps ? '#ffbe0b' : '#ffffff');
      }
    }
  }

  _finishPlayerRace() {
    this.state = 'finished';
    const sorted = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    const position = sorted.indexOf(this.playerCar) + 1;
    const podiumReward =
      this.mode === 'race' || this.mode === 'level'
        ? CONFIG.nitro.podiumRewards[Math.min(position - 1, CONFIG.nitro.podiumRewards.length - 1)]
        : 60;

    let levelPassed = false;
    let levelStars = 0;
    let levelBonus = 0;

    if (this.mode === 'level' && this.activeLevel) {
      levelPassed = position <= this.activeLevel.targetRank;
      if (levelPassed) {
        levelStars = position === 1 ? 3 : position === 2 ? 2 : 1;
        levelBonus = this.activeLevel.clearBonus;
        this.save.recordLevelResult(this.activeLevel.level, levelStars);
      }
    }

    const totalPrize = podiumReward + levelBonus;
    this.coinsEarnedThisRace += totalPrize;
    this.save.addCoins(totalPrize);

    const recordInfo = this.save.recordRaceTimes(
      this.track.data.id,
      this.raceTimeMs,
      this.playerCar.bestLapMs,
      this.mode === 'timetrial' ? this.currentLapGhost : null
    );

    let unlockedTrack = null;
    if ((this.mode === 'race' || levelPassed) && position <= 3 && this.track.data.unlocksNext) {
      const didUnlock = this.save.unlockTrack(this.track.data.unlocksNext);
      if (didUnlock) unlockedTrack = getTrackById(this.track.data.unlocksNext);
    }

    this.audio.playWinFanfare();
    this.hud.setPulse(0);

    setTimeout(() => {
      this.onRaceFinish?.({
        track: this.track.data,
        mode: this.mode,
        laps: this.activeLaps,
        levelConfig: this.activeLevel,
        levelPassed,
        levelStars,
        levelBonus,
        position,
        totalCars: this.cars.length,
        totalTimeMs: this.raceTimeMs,
        bestLapMs: this.playerCar.bestLapMs,
        nitroPicked: this.nitroPickedCount,
        overtakes: this.overtakesCount,
        podiumReward: totalPrize,
        coinsEarned: this.coinsEarnedThisRace,
        isNewBestTotal: recordInfo.isNewBestTotal,
        isNewBestLap: recordInfo.isNewBestLap,
        unlockedTrack,
      });
    }, 900);
  }
}
