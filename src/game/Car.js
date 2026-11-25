import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { CONFIG, computeCarPhysics } from '../config.js';
import { createCarMesh } from './CarModels.js';

/**
 * Full 3D Rigid-Body + 4-Wheel RaycastVehicle Car Controller.
 * Driven by Cannon-es suspension, tire friction slip, gravity, jumps, and 3D collisions.
 */
export class Car {
  constructor(carData, options = {}) {
    this.data = carData;
    this.stats = computeCarPhysics(carData);
    this.isPlayer = Boolean(options.isPlayer);
    this.name = options.name || carData.name;
    this.aiSkill = options.aiSkill || 1.0;
    this.physicsWorld = options.physicsWorld || null;

    const built = createCarMesh(carData, {
      castShadow: options.castShadow !== false,
      physicsMode: Boolean(this.physicsWorld),
      useClearcoat: this.isPlayer,
    });
    this.mesh = built.root;
    this.wheels = built.wheels;
    this.steerPivots = built.steerPivots;
    this.flames = built.flames;
    this.taillightMat = built.taillightMat;
    this._isBraking = false;

    // 3D Physics Chassis & RaycastVehicle
    const p = CONFIG.physics;
    const [hx, hy, hz] = p.chassisHalfExtents;
    this.chassisBody = new CANNON.Body({
      mass: p.chassisMass,
      material: this.physicsWorld ? this.physicsWorld.chassisMaterial : undefined,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      linearDamping: 0.04,
      angularDamping: 0.28,
    });
    this.chassisBody.allowSleep = false;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelOpts = {
      radius: p.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: p.suspensionStiffness,
      suspensionRestLength: p.suspensionRestLength,
      frictionSlip: p.normalFrictionSlip,
      dampingRelaxation: p.dampingRelaxation,
      dampingCompression: p.dampingCompression,
      maxSuspensionForce: 100000,
      rollInfluence: p.rollInfluence,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      maxSuspensionTravel: p.maxSuspensionTravel,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const { wheelX, wheelZFront, wheelZRear } = built.wheelLayout;
    [
      [wheelX, 0, wheelZFront],
      [-wheelX, 0, wheelZFront],
      [wheelX, 0, wheelZRear],
      [-wheelX, 0, wheelZRear],
    ].forEach(([wx, wy, wz]) => {
      this.vehicle.addWheel({
        ...wheelOpts,
        chassisConnectionPointLocal: new CANNON.Vec3(wx, wy, wz),
      });
    });

    if (this.physicsWorld) {
      this.vehicle.addToWorld(this.physicsWorld.world);
    }

    // Collision event hook for audio & camera shake
    this._pendingCollision = 0;
    this.collisionCooldown = 0;
    this.chassisBody.addEventListener('collide', (e) => {
      if (this.collisionCooldown > 0) return;
      const kind = e.body?.userData?.kind;
      if (kind === 'wall' || e.body?.mass > 0) {
        const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (impact > 4.5) {
          this._pendingCollision = Math.max(this._pendingCollision, Math.min(1, impact / 26));
          this.collisionCooldown = 0.25;
        }
      }
    });

    // Public read-friendly state synced from Cannon chassisBody
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.yaw = 0;
    this.steerAngle = 0;
    this.isDrifting = false;
    this.driftDuration = 0;
    this.isBoosting = false;
    this.isAirborne = false;
    this.wasAirborne = false;
    this.flippedTimer = 0;
    this.nitro = this.stats.nitroCapacity * 0.45;
    this.stuckTimer = 0;

    // Race state
    this.sampleHint = 0;
    this.trackT = 0;
    this.lap = 1;
    this.nextCheckpoint = 1;
    this.finished = false;
    this.finishTimeMs = 0;
    this.lapStartMs = 0;
    this.bestLapMs = 0;
    this.totalProgress = 0;
    this.lastSafeSampleIdx = 0;
    this.wrongWay = false;
  }

  placeOnTrack(track, t, lateralOffset = 0) {
    const s = track.getSampleAtT(t);
    const spawnPos = s.pos.clone().addScaledVector(s.right, lateralOffset);
    this.yaw = Math.atan2(s.horizTan.x, s.horizTan.z);

    this.chassisBody.position.set(spawnPos.x, spawnPos.y + 1.05, spawnPos.z);
    this.chassisBody.quaternion.setFromEuler(0, this.yaw, 0);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);

    this.sampleHint = s.idx;
    this.lastSafeSampleIdx = s.idx;
    this.trackT = s.t;
    this.flippedTimer = 0;
    this.stuckTimer = 0;
    this.syncVisuals();
  }

  resetToCheckpoint(track) {
    const s = track.samples[this.lastSafeSampleIdx] || track.samples[0];
    this.yaw = Math.atan2(s.horizTan.x, s.horizTan.z);
    this.chassisBody.position.set(s.pos.x, s.pos.y + 1.25, s.pos.z);
    this.chassisBody.quaternion.setFromEuler(0, this.yaw, 0);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.sampleHint = s.idx;
    this.flippedTimer = 0;
    this.stuckTimer = 0;
    this.syncVisuals();
  }

  getForwardVector() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat).setY(0).normalize();
  }

  getRightVector() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat).setY(0).normalize();
  }

  getSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  getKmh() {
    return Math.round(this.getSpeed() * CONFIG.physics.kmhScale);
  }

  /**
   * Apply throttle, steering, braking, drift tire slip, boost forces, and air stabilization
   * BEFORE PhysicsWorld.step(dt).
   */
  applyControls(dt, controls, track) {
    const p = CONFIG.physics;
    const nCfg = CONFIG.nitro;

    if (this.collisionCooldown > 0) this.collisionCooldown -= dt;

    // Sync current orientation & velocity from Cannon
    this.quat.set(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );
    this.vel.set(this.chassisBody.velocity.x, this.chassisBody.velocity.y, this.chassisBody.velocity.z);
    const euler = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    this.yaw = euler.y;

    const fwd3D = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    const right3D = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const up3D = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);

    const forwardSpeed = this.vel.dot(fwd3D);
    const lateralSpeed = this.vel.dot(right3D);

    // Nitro boost state
    const wantsBoost = controls.nitro && this.nitro > (this.isBoosting ? 0.5 : nCfg.minToActivate);
    this.isBoosting = wantsBoost && controls.throttle >= 0 && !this.finished;
    if (this.isBoosting) {
      this.nitro = Math.max(0, this.nitro - nCfg.drainPerSec * dt);
    }

    const maxSpd =
      this.stats.maxSpeed *
      (this.isPlayer ? 1.0 : this.aiSkill) *
      (this.isBoosting ? nCfg.boostSpeedMult : 1.0);
    const speedNorm = Math.min(1.2, Math.abs(forwardSpeed) / this.stats.maxSpeed);

    // Speed-sensitive steering (tapers smoothly at high velocity)
    const steerFade = 1 - Math.min(1, speedNorm) * p.highSpeedSteerFade;
    const targetSteer = controls.steer * p.maxSteerAngle * this.stats.steerRate * steerFade;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetSteer, Math.min(1, dt * 11));
    this.vehicle.setSteeringValue(this.steerAngle, 0);
    this.vehicle.setSteeringValue(this.steerAngle, 1);

    // Engine & Brake Forces (negative engineForce pushes forward along +Z)
    const forceBase =
      this.stats.engineForce *
      (this.isPlayer ? 1.0 : 0.92 + this.aiSkill * 0.12) *
      (this.isBoosting ? nCfg.boostForceMult : 1.0);

    let engineForce = 0;
    let brake = 0;

    if (controls.holdBrake) {
      // Locked on starting grid / post-finish without triggering reverse
      engineForce = 0;
      brake = p.brakeForce;
    } else if (controls.throttle > 0) {
      if (forwardSpeed < maxSpd) {
        // Taper drive force near top speed for crisp ceiling
        const headroom = THREE.MathUtils.clamp((maxSpd - forwardSpeed) / 10, 0.15, 1.0);
        engineForce = -forceBase * controls.throttle * headroom;
      }
    } else if (controls.brake > 0) {
      if (forwardSpeed > 2.2) {
        brake = p.brakeForce * controls.brake;
      } else if (!controls.noReverse && forwardSpeed > -p.reverseMaxSpeed) {
        engineForce = forceBase * 0.62 * controls.brake;
      } else {
        brake = p.brakeForce * controls.brake;
      }
    } else {
      // Gentle engine coasting drag
      brake = 4.5;
    }

    // AWD force split (40% front, 60% rear) gives snappy arcade launches & slope climbing
    this.vehicle.applyEngineForce(engineForce * 0.4, 0);
    this.vehicle.applyEngineForce(engineForce * 0.4, 1);
    this.vehicle.applyEngineForce(engineForce * 0.6, 2);
    this.vehicle.applyEngineForce(engineForce * 0.6, 3);

    for (let i = 0; i < 4; i++) {
      this.vehicle.setBrake(i >= 2 && controls.drift ? p.brakeForce * 0.25 : brake, i);
    }

    // Extra nitro rocket thrust through center of mass (local zero lever arm -> zero spin torque!)
    if (this.isBoosting && forwardSpeed < maxSpd) {
      const thrust = this.chassisBody.mass * 14;
      this.chassisBody.applyLocalForce(
        new CANNON.Vec3(0, 0, thrust),
        new CANNON.Vec3(0, 0, 0)
      );
    }

    // Dynamic tire frictionSlip for real physics drifting & icy surfaces
    const surfaceGrip = track.data.surfaceGrip * this.stats.gripFactor;
    const hardTurnDrift =
      Math.abs(controls.steer) > 0.7 && speedNorm > 0.65 && track.data.surfaceGrip < 0.95;
    this.isDrifting = (controls.drift || hardTurnDrift) && Math.abs(forwardSpeed) > 10 && !this.isAirborne;

    const frontSlip = p.normalFrictionSlip * surfaceGrip;
    const rearSlip = (this.isDrifting ? p.driftFrictionSlip : p.normalFrictionSlip) * surfaceGrip;
    this.vehicle.wheelInfos[0].frictionSlip = frontSlip;
    this.vehicle.wheelInfos[1].frictionSlip = frontSlip;
    this.vehicle.wheelInfos[2].frictionSlip = rearSlip;
    this.vehicle.wheelInfos[3].frictionSlip = rearSlip;

    // Subtle arcade yaw assist during handbrake drift so tail slides controllably
    if (this.isDrifting && Math.abs(controls.steer) > 0.15) {
      this.chassisBody.angularVelocity.y += controls.steer * 2.2 * dt;
    }

    // Airborne detection & mid-air / anti-flip stabilization
    const contacts = this.vehicle.wheelInfos.filter((w) => w.isInContact).length;
    this.wasAirborne = this.isAirborne;
    this.isAirborne = contacts === 0;

    if (this.isAirborne) {
      // Gentle air attitude damping so jumps look awesome and land flat
      this.chassisBody.angularVelocity.x *= Math.exp(-3.2 * dt);
      this.chassisBody.angularVelocity.z *= Math.exp(-3.2 * dt);
    }

    // Anti-roll & flip recovery if overturned
    if (up3D.y < 0.35) {
      this.flippedTimer += dt;
      if (this.flippedTimer > 1.1) {
        this.resetToCheckpoint(track);
      }
    } else {
      this.flippedTimer = 0;
    }

    // Aerodynamic top-speed clamp + lateral speed store for visual/drift checks
    this._lastForwardSpeed = forwardSpeed;
    this._lastLateralSpeed = lateralSpeed;
    this._isBraking = brake > 10 || controls.holdBrake;
  }

  /**
   * Read updated physics state AFTER PhysicsWorld.step(dt), update race progress,
   * fire callbacks, and sync 3D chassis + suspension wheel transforms.
   */
  postStep(dt, controls, track, callbacks = {}) {
    const p = CONFIG.physics;
    const nCfg = CONFIG.nitro;

    this.syncVisuals();

    // Emit collision feedback detected during PhysicsWorld step
    if (this._pendingCollision > 0) {
      callbacks.onWallHit?.(this._pendingCollision);
      this._pendingCollision = 0;
    }

    // Landing shock when returning from jump
    if (this.wasAirborne && !this.isAirborne && Math.abs(this.vel.y) > 4) {
      callbacks.onLanding?.(this.pos, Math.min(1, Math.abs(this.vel.y) / 14));
    }

    // Drift nitro bonus
    if (this.isDrifting && Math.abs(controls.steer) > 0.25 && !this.finished) {
      this.driftDuration += dt;
      if (this.driftDuration > p.driftBoostThreshold && this.isPlayer) {
        this.nitro = Math.min(this.stats.nitroCapacity, this.nitro + nCfg.driftTankRate * dt);
        callbacks.onDriftBonus?.(nCfg.driftCoinRate * dt);
      }
    } else {
      this.driftDuration = 0;
    }

    // Spline projection for progress, checkpoints, and wrong-way alert
    const proj = track.getClosestSample(this.pos.x, this.pos.z, this.sampleHint);
    this.sampleHint = proj.idx;
    this.trackT = proj.t;

    const fwd = this.getForwardVector();
    this.wrongWay = fwd.dot(proj.sample.horizTan) < -0.35 && (this._lastForwardSpeed || 0) > 6;

    // Stuck detection
    if (this.isPlayer && !this.finished && controls.throttle > 0 && this.getSpeed() < p.stuckSpeedThreshold) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }

    // Continuous spline-aligned 3D guardrail bounce (gap-free on every curve & zero extra Physics bodies)
    const maxTrackLat = track.halfWidth - 0.55;
    if (Math.abs(proj.lateral) > maxTrackLat) {
      const sign = Math.sign(proj.lateral);
      const excess = Math.abs(proj.lateral) - maxTrackLat;
      this.chassisBody.position.x -= proj.sample.right.x * sign * excess;
      this.chassisBody.position.z -= proj.sample.right.z * sign * excess;

      const outVel =
        this.chassisBody.velocity.x * proj.sample.right.x * sign +
        this.chassisBody.velocity.z * proj.sample.right.z * sign;
      if (outVel > 0) {
        const bounce = 1 + p.wallRestitution;
        this.chassisBody.velocity.x -= proj.sample.right.x * sign * outVel * bounce;
        this.chassisBody.velocity.z -= proj.sample.right.z * sign * outVel * bounce;
        // Gentle scrape slowdown + realistic nudge back along road
        this.chassisBody.velocity.x *= 0.94;
        this.chassisBody.velocity.z *= 0.94;
        if (outVel > 4.5 && this.collisionCooldown <= 0) {
          this.collisionCooldown = 0.25;
          callbacks.onWallHit?.(Math.min(1, outVel / 22));
        }
      }
      this.syncVisuals();
    }

    // Safety recovery if car ever drops far off track
    if (proj.dist > track.halfWidth + 18 || this.pos.y < proj.roadY - 12) {
      this.resetToCheckpoint(track);
      if (this.isPlayer) callbacks.onOutOfBounds?.();
    }

    this._updateCheckpoints(track, proj.t, callbacks);
  }

  syncVisuals() {
    // Use Cannon's interpolatedPosition/Quaternion when available to eliminate frame micro-stutter
    const pSrc = this.chassisBody.interpolatedPosition || this.chassisBody.position;
    const qSrc = this.chassisBody.interpolatedQuaternion || this.chassisBody.quaternion;
    this.pos.set(pSrc.x, pSrc.y, pSrc.z);
    this.quat.set(qSrc.x, qSrc.y, qSrc.z, qSrc.w);
    this.vel.set(this.chassisBody.velocity.x, this.chassisBody.velocity.y, this.chassisBody.velocity.z);

    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);

    // Sync each wheel's suspension travel, steer angle, and spin directly from RaycastVehicle
    for (let i = 0; i < 4; i++) {
      const wInfo = this.vehicle.wheelInfos[i];
      const pivot = this.steerPivots[i];
      const spin = this.wheels[i];
      if (wInfo && pivot && spin) {
        pivot.position.y = wInfo.chassisConnectionPointLocal.y - wInfo.suspensionLength;
        pivot.rotation.y = wInfo.steering;
        spin.rotation.x = wInfo.rotation;
      }
    }

    // Reactive glowing taillights when braking
    if (this.taillightMat) {
      this.taillightMat.emissiveIntensity = this._isBraking ? 2.8 : 0.85;
    }

    // Nitro exhaust flames
    this.flames.forEach((f, idx) => {
      f.visible = this.isBoosting;
      if (this.isBoosting) {
        const flicker = 0.85 + Math.sin(performance.now() * 0.045 + idx) * 0.25;
        f.scale.set(1, 1, flicker);
      }
    });
  }

  _updateCheckpoints(track, t, callbacks) {
    if (this.finished) return;
    const totalCP = track.checkpointsCount;
    const cpIdx = Math.floor(t * totalCP);

    if (cpIdx === this.nextCheckpoint || cpIdx === (this.nextCheckpoint + 1) % totalCP) {
      if (cpIdx !== 0) {
        this.lastSafeSampleIdx = this.sampleHint;
        this.nextCheckpoint = (cpIdx + 1) % totalCP;
      } else if (this.nextCheckpoint === totalCP - 1) {
        this.nextCheckpoint = 0;
      }
    }

    if (this.nextCheckpoint === 0 && cpIdx === 0 && t < 0.18) {
      this.nextCheckpoint = 1;
      this.lastSafeSampleIdx = 0;
      callbacks.onLapComplete?.(this);
    }

    const cpProgress = this.nextCheckpoint === 0 ? 0.99 : Math.max(0, (this.nextCheckpoint - 1) / totalCP);
    const smoothT = this.nextCheckpoint === 1 && t > 0.8 ? t - 1 : t;
    this.totalProgress = (this.lap - 1) + Math.max(cpProgress * 0.85, smoothT);
  }
}
