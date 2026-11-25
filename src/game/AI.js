import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * AI Opponent Controller for Cannon-es RaycastVehicle cars.
 * Steers along spline look-ahead points with lane offsets, corner braking,
 * car avoidance, light rubber-banding, and automatic pileup recovery.
 */
export class AIController {
  constructor(car, laneOffset, difficultyKey, skillJitter = 0, customSpeedMult = null) {
    this.car = car;
    this.laneOffset = laneOffset;
    const baseDiff = CONFIG.ai.difficulties[difficultyKey] || CONFIG.ai.difficulties.medium;
    this.difficulty = customSpeedMult
      ? { ...baseDiff, speedMult: customSpeedMult }
      : baseDiff;
    this.skillJitter = skillJitter;
    this.targetUpdateTimer = 0;
    this.dynamicLane = laneOffset;
    this.stuckTimer = 0;
  }

  computeControls(dt, track, allCars, playerProgress) {
    const car = this.car;
    if (car.finished) {
      return { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false, holdBrake: true };
    }

    // Automatic AI recovery if wedged in a pileup or barrier
    if (car.getSpeed() < 1.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3.2) {
        this.stuckTimer = 0;
        car.resetToCheckpoint(track);
      }
    } else {
      this.stuckTimer = 0;
    }

    // Periodically shift lane slightly so AI packs look organic
    this.targetUpdateTimer -= dt;
    if (this.targetUpdateTimer <= 0) {
      this.targetUpdateTimer = 1.6 + Math.random() * 1.8;
      this.dynamicLane = this.laneOffset + (Math.random() - 0.5) * 3.2;
      this.dynamicLane = THREE.MathUtils.clamp(
        this.dynamicLane,
        -(track.halfWidth - 3.2),
        track.halfWidth - 3.2
      );
    }

    // Look ahead along track spline
    const lookSteps = Math.round((CONFIG.ai.lookAheadDist / track.totalLength) * track.sampleCount);
    const targetIdx = (car.sampleHint + lookSteps) % track.sampleCount;
    const targetSample = track.samples[targetIdx];

    // Car avoidance lateral nudge
    let avoidOffset = 0;
    for (const other of allCars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < CONFIG.ai.avoidanceRadius * 2.2 && dist > 0.1) {
        const fwd = car.getForwardVector();
        const ahead = (dx * fwd.x + dz * fwd.z) / dist;
        if (ahead > 0.3) {
          const right = car.getRightVector();
          const side = dx * right.x + dz * right.z;
          avoidOffset -= Math.sign(side || 1) * 3.5;
        }
      }
    }

    const desiredPos = targetSample.pos
      .clone()
      .addScaledVector(
        targetSample.right,
        THREE.MathUtils.clamp(this.dynamicLane + avoidOffset, -track.halfWidth + 2.5, track.halfWidth - 2.5)
      );

    const toTarget = desiredPos.sub(car.pos);
    toTarget.y = 0;
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
    let yawDiff = desiredYaw - car.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

    const steer = THREE.MathUtils.clamp(yawDiff * 1.8, -1, 1);

    // Light rubber-banding based on gap to player
    const gap = playerProgress - car.totalProgress;
    const rubberAdj = THREE.MathUtils.clamp(gap * 0.45, -this.difficulty.rubberBand, this.difficulty.rubberBand);
    car.aiSkill = THREE.MathUtils.clamp(
      this.difficulty.speedMult + this.skillJitter + rubberAdj,
      0.65,
      1.08
    );

    // Corner braking based on upcoming curvature
    const aheadSample = track.samples[(car.sampleHint + lookSteps + 4) % track.sampleCount];
    const sharpTurn = aheadSample.curvature > 0.28 || Math.abs(yawDiff) > 0.55;
    const speedRatio = car.getSpeed() / car.stats.maxSpeed;

    let throttle = 1;
    let brake = 0;
    if (sharpTurn && speedRatio > this.difficulty.cornerSkill * 0.85) {
      throttle = 0.2;
      brake = 0.45;
    }

    const useNitro =
      !sharpTurn &&
      Math.abs(yawDiff) < 0.15 &&
      car.nitro > 25 &&
      (gap > 0.03 || Math.random() < 0.02);

    return {
      throttle,
      brake,
      steer,
      drift: Math.abs(yawDiff) > 0.72 && speedRatio > 0.6,
      nitro: useNitro,
      noReverse: true,
    };
  }
}
