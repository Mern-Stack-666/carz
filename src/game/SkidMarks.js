import * as THREE from 'three';

/**
 * Pooled instanced tire skid-mark decals laid onto the track surface during drifts.
 */
export class SkidMarkSystem {
  constructor(scene, maxMarks = 280) {
    this.maxMarks = maxMarks;
    this.cursor = 0;
    this.activeCount = 0;

    const geo = new THREE.PlaneGeometry(0.38, 1.35);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: '#0e0d12',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, maxMarks);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxMarks; i++) {
      this.mesh.setMatrixAt(i, zero);
    }
    scene.add(this.mesh);
    this._dummy = new THREE.Object3D();
  }

  addPair(car, roadY) {
    const fwd = car.getForwardVector();
    const right = car.getRightVector();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const y = roadY + 0.04;

    [-0.95, 0.95].forEach((lat) => {
      const p = car.pos
        .clone()
        .addScaledVector(fwd, -1.35)
        .addScaledVector(right, lat);

      this._dummy.position.set(p.x, y, p.z);
      this._dummy.rotation.set(0, yaw, 0);
      this._dummy.scale.set(1, 1, 1);
      this._dummy.updateMatrix();

      this.mesh.setMatrixAt(this.cursor, this._dummy.matrix);
      this.cursor = (this.cursor + 1) % this.maxMarks;
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
