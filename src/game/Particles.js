import * as THREE from 'three';

/**
 * Lightweight pooled particle system for drift tire smoke, nitro sparks, and pickup bursts.
 */
export class ParticleSystem {
  constructor(scene, qualityPreset) {
    this.maxCount = Math.round(180 * qualityPreset.particles);
    this.particles = [];
    this.cursor = 0;

    const geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.78,
    });

    this.instanced = new THREE.InstancedMesh(geo, mat, Math.max(1, this.maxCount));
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.frustumCulled = false;

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxCount; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scale: 1,
        color: new THREE.Color('#ffffff'),
      });
      this.instanced.setMatrixAt(i, zero);
      this.instanced.setColorAt(i, new THREE.Color('#ffffff'));
    }

    if (this.maxCount > 0) scene.add(this.instanced);
    this._dummy = new THREE.Object3D();
  }

  emit(pos, vel, colorHex, scale = 1, maxLife = 0.55) {
    if (this.maxCount <= 0) return;
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.maxCount;

    p.active = true;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.scale = scale;
    p.color.set(colorHex);
  }

  emitBurst(pos, colorHex, count = 12) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const spd = 4 + Math.random() * 6;
      this.emit(
        pos,
        new THREE.Vector3(Math.cos(ang) * spd, 2 + Math.random() * 4, Math.sin(ang) * spd),
        colorHex,
        0.9,
        0.48
      );
    }
  }

  update(dt) {
    if (this.maxCount <= 0) return;
    let dirty = false;

    for (let i = 0; i < this.maxCount; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.instanced.setMatrixAt(i, this._dummy.matrix);
        continue;
      }

      p.pos.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      this._dummy.position.copy(p.pos);
      this._dummy.rotation.set(t * 3, t * 2, 0);
      this._dummy.scale.setScalar(p.scale * t);
      this._dummy.updateMatrix();
      this.instanced.setMatrixAt(i, this._dummy.matrix);
      this.instanced.setColorAt(i, p.color);
    }

    if (dirty) {
      this.instanced.instanceMatrix.needsUpdate = true;
      if (this.instanced.instanceColor) this.instanced.instanceColor.needsUpdate = true;
    }
  }
}
