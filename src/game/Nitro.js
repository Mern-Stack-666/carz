import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Collectible Nitro Canisters along the track.
 * Drives the dual Nitro-as-Currency mechanic: refills boost tank AND awards persistent Nitro Coins.
 */
export class NitroManager {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.pickups = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._buildPickups();
  }

  _buildPickups() {
    const coreGeo = new THREE.OctahedronGeometry(0.75, 0);
    const ringGeo = new THREE.TorusGeometry(1.08, 0.08, 8, 20);

    const stdCoreMat = new THREE.MeshStandardMaterial({
      color: '#00f5d4',
      emissive: '#00f5d4',
      emissiveIntensity: 0.65,
      roughness: 0.2,
    });
    const stdRingMat = new THREE.MeshBasicMaterial({ color: '#80ffea' });

    const riskyCoreMat = new THREE.MeshStandardMaterial({
      color: '#ffbe0b',
      emissive: '#ff5400',
      emissiveIntensity: 0.75,
      roughness: 0.15,
    });
    const riskyRingMat = new THREE.MeshBasicMaterial({ color: '#ff006e' });

    this.track.data.pickups.forEach((cfg) => {
      const s = this.track.getSampleAtT(cfg.t);
      const pos = s.pos.clone().addScaledVector(s.right, cfg.lateral * this.track.halfWidth);
      pos.y += 1.15;

      const node = new THREE.Group();
      node.position.copy(pos);

      const core = new THREE.Mesh(coreGeo, cfg.risky ? riskyCoreMat : stdCoreMat);
      const ring = new THREE.Mesh(ringGeo, cfg.risky ? riskyRingMat : stdRingMat);
      node.add(core, ring);
      this.group.add(node);

      this.pickups.push({
        node,
        core,
        ring,
        basePos: pos.clone(),
        risky: Boolean(cfg.risky),
        collected: false,
        respawnTimer: 0,
        popAnim: 0,
      });
    });
  }

  resetAll() {
    this.pickups.forEach((p) => {
      p.collected = false;
      p.respawnTimer = 0;
      p.popAnim = 0;
      p.node.visible = true;
      p.node.scale.setScalar(1);
    });
  }

  update(dt, timeSec, cars, onPlayerCollect) {
    const nCfg = CONFIG.nitro;

    for (const p of this.pickups) {
      if (p.collected) {
        if (p.popAnim > 0) {
          p.popAnim -= dt * 3.5;
          p.node.scale.setScalar(1 + (1 - Math.max(0, p.popAnim)) * 0.8);
          if (p.popAnim <= 0) p.node.visible = false;
        }
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.collected = false;
          p.node.visible = true;
          p.node.scale.setScalar(1);
        }
        continue;
      }

      // Floating & rotating animation
      p.node.position.y = p.basePos.y + Math.sin(timeSec * 3.2 + p.basePos.x) * 0.22;
      p.core.rotation.y += dt * 2.4;
      p.ring.rotation.x += dt * 1.8;
      p.ring.rotation.y -= dt * 1.4;

      // Check car collision (2.4 unit radius)
      for (const car of cars) {
        const dx = car.pos.x - p.basePos.x;
        const dz = car.pos.z - p.basePos.z;
        if (dx * dx + dz * dz < 6.2) {
          p.collected = true;
          p.popAnim = 1.0;
          p.respawnTimer = 9.0; // Respawns on next lap!

          const tankGain = nCfg.pickupTankFill * (p.risky ? 1.4 : 1.0);
          car.nitro = Math.min(car.stats.nitroCapacity, car.nitro + tankGain);

          if (car.isPlayer) {
            const coinGain = p.risky ? nCfg.riskyPickupCoins : nCfg.pickupCoins;
            onPlayerCollect?.({
              coins: coinGain,
              risky: p.risky,
              position: p.basePos,
            });
          }
          break;
        }
      }
    }
  }
}
