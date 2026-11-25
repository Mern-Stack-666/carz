import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * High-speed 3D Cannon-es Physics World for Raftaar Nitro.
 * Uses a single fast ground collider on flat circuits (or coarse sloped slabs on hilly circuits)
 * plus 3D jump ramps, keeping RaycastVehicle ray tests ultra-lightweight (~0.2ms/frame).
 * Track guardrails are enforced seamlessly along the continuous spline in Car.postStep().
 */
export class PhysicsWorld {
  constructor() {
    const p = CONFIG.physics;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, p.gravity, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.2;
    this.world.defaultContactMaterial.restitution = 0.25;

    this.roadMaterial = new CANNON.Material('road');
    this.chassisMaterial = new CANNON.Material('chassis');

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.chassisMaterial, this.roadMaterial, {
        friction: 0.12,
        restitution: 0.04,
      })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.chassisMaterial, this.chassisMaterial, {
        friction: 0.18,
        restitution: p.carRestitution,
      })
    );
  }

  buildTrackColliders(track) {
    const isHilly = track.data.controlPoints.some((pt) => Math.abs(pt[1]) > 0.2);

    if (!isHilly) {
      // Single broad solid ground box for flat tracks -> 10x faster RaycastVehicle raycasts!
      const flatRoad = new CANNON.Body({
        mass: 0,
        material: this.roadMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(1200, 1.5, 1200)),
        position: new CANNON.Vec3(0, -1.5, 0),
      });
      flatRoad.userData = { kind: 'road' };
      this.world.addBody(flatRoad);
    } else {
      // Safety floor far below hills
      const safetyFloor = new CANNON.Body({
        mass: 0,
        material: this.roadMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(1500, 1, 1500)),
        position: new CANNON.Vec3(0, -18, 0),
      });
      this.world.addBody(safetyFloor);

      // Sloped overlapping road slabs for elevated mountain/jungle circuits
      const N = track.sampleCount;
      const step = 6;
      const roadThickness = 2.6;
      const roadFullWidth = track.data.roadWidth + 8.0;
      const up = new THREE.Vector3(0, 1, 0);
      const mat4 = new THREE.Matrix4();
      const quat = new THREE.Quaternion();

      for (let i = 0; i < N; i += step) {
        const sA = track.samples[i];
        const sB = track.samples[(i + step) % N];
        const mid = new THREE.Vector3().addVectors(sA.pos, sB.pos).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(sB.pos, sA.pos);
        const segLen = dir.length();
        if (segLen < 0.01) continue;
        const fwd = dir.clone().normalize();
        const left = new THREE.Vector3().crossVectors(up, fwd).normalize();
        const normal = new THREE.Vector3().crossVectors(fwd, left).normalize();

        mat4.makeBasis(left, normal, fwd);
        quat.setFromRotationMatrix(mat4);

        const roadPos = mid.clone().addScaledVector(normal, -roadThickness * 0.5);
        const roadBody = new CANNON.Body({
          mass: 0,
          material: this.roadMaterial,
          shape: new CANNON.Box(
            new CANNON.Vec3(roadFullWidth * 0.5, roadThickness * 0.5, segLen * 0.72 + 1.8)
          ),
          position: new CANNON.Vec3(roadPos.x, roadPos.y, roadPos.z),
          quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
        });
        roadBody.userData = { kind: 'road' };
        this.world.addBody(roadBody);
      }
    }

    // Physical 3D Jump Ramps
    if (Array.isArray(track.data.ramps)) {
      track.data.ramps.forEach((r) => {
        const s = track.getSampleAtT(r.t);
        const pitch = Math.atan2(r.height, r.length);
        const slopeLen = Math.hypot(r.length, r.height);
        const rampThickness = 0.8;

        const center = s.pos
          .clone()
          .addScaledVector(s.right, r.lateral * track.halfWidth)
          .add(new THREE.Vector3(0, r.height * 0.5 - rampThickness * 0.35, 0));

        const yaw = Math.atan2(s.horizTan.x, s.horizTan.z);
        const rampQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));

        const rampBody = new CANNON.Body({
          mass: 0,
          material: this.roadMaterial,
          shape: new CANNON.Box(new CANNON.Vec3(r.width * 0.5, rampThickness * 0.5, slopeLen * 0.5)),
          position: new CANNON.Vec3(center.x, center.y, center.z),
          quaternion: new CANNON.Quaternion(rampQuat.x, rampQuat.y, rampQuat.z, rampQuat.w),
        });
        rampBody.userData = { kind: 'ramp' };
        this.world.addBody(rampBody);
      });
    }
  }

  step(dt) {
    const p = CONFIG.physics;
    this.world.step(p.fixedTimeStep, dt, p.maxSubSteps);
  }
}
