import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Dynamic chase camera with Chase, Far Chase, Hood, and 2D Mini Rush Top-Down modes.
 * Exposes setBoostEffect(amount) and triggerShake(amount) for nitro/collision feedback.
 */
export class RaceCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.baseFov, aspect, 0.3, 1400);
    this.modeIndex = 0;
    this.mode2D = false;
    this.boostAmount = 0;
    this.shakeAmount = 0;

    this.currentPos = new THREE.Vector3(0, 8, -14);
    this.currentLook = new THREE.Vector3(0, 1, 10);
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % CONFIG.camera.modes.length;
    return CONFIG.camera.modes[this.modeIndex];
  }

  getModeName() {
    if (this.mode2D) return '2D Mini Rush';
    const m = CONFIG.camera.modes[this.modeIndex];
    return m === 'chase' ? 'Chase' : m === 'far' ? 'Far Chase' : 'Hood';
  }

  set2DMode(enabled) {
    this.mode2D = Boolean(enabled);
  }

  setBoostEffect(amount) {
    this.boostAmount = THREE.MathUtils.clamp(amount, 0, 1);
  }

  triggerShake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, Math.min(1, amount));
  }

  snapToCar(car) {
    const fwd = car.getForwardVector();
    const cfg = CONFIG.camera.chase;
    this.currentPos.copy(car.pos).addScaledVector(fwd, -cfg.distance);
    this.currentPos.y += cfg.height;
    this.currentLook.copy(car.pos).addScaledVector(fwd, cfg.lookAhead);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }

  update(dt, car) {
    const cCfg = CONFIG.camera;
    const fwd = car.getForwardVector();
    const speedNorm = Math.min(1.2, car.getSpeed() / car.stats.maxSpeed);

    let desiredPos = new THREE.Vector3();
    let desiredLook = new THREE.Vector3();
    let lerpRate = 7.5;

    if (this.mode2D) {
      // Top-down orthographic-feel perspective view for 2D Mini Rush mode
      desiredPos.set(car.pos.x, car.pos.y + cCfg.topDown.height, car.pos.z + 0.01);
      desiredLook.set(car.pos.x, car.pos.y, car.pos.z);
      lerpRate = cCfg.topDown.lerp;
    } else {
      const mode = cCfg.modes[this.modeIndex];
      const preset = cCfg[mode];
      lerpRate = preset.lerp;

      if (mode === 'hood') {
        desiredPos.copy(car.pos).addScaledVector(fwd, preset.forwardOffset);
        desiredPos.y += preset.height;
        desiredLook.copy(car.pos).addScaledVector(fwd, preset.lookAhead);
        desiredLook.y += 0.9;
      } else {
        desiredPos.copy(car.pos).addScaledVector(fwd, -preset.distance);
        desiredPos.y += preset.height;
        desiredLook.copy(car.pos).addScaledVector(fwd, preset.lookAhead);
        desiredLook.y += 1.0;
      }
    }

    const alpha = 1 - Math.exp(-lerpRate * dt);
    this.currentPos.lerp(desiredPos, alpha);
    this.currentLook.lerp(desiredLook, alpha);

    // Decay collision shake & apply boost/collision camera shake
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.8);
    const totalShake =
      this.boostAmount * cCfg.boostShakeIntensity + this.shakeAmount * cCfg.collisionShakeIntensity;

    this.camera.position.copy(this.currentPos);
    if (totalShake > 0.002 && !this.mode2D) {
      this.camera.position.x += (Math.random() - 0.5) * totalShake;
      this.camera.position.y += (Math.random() - 0.5) * totalShake * 0.7;
    }
    this.camera.lookAt(this.currentLook);

    // Speed + Boost FOV kick
    const targetFov = this.mode2D
      ? 52
      : cCfg.baseFov + speedNorm * cCfg.maxSpeedFovAdd + this.boostAmount * cCfg.boostFovAdd;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 8));
      this.camera.updateProjectionMatrix();
    }
  }
}
