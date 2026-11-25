import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CARS, getCarById } from '../data/cars.js';
import { createCarMesh, preloadCarModels } from '../game/CarModels.js';

/**
 * 3D Garage & Shop screen.
 * Displays an interactive rotating 3D showroom preview alongside car stats and purchase/select actions.
 */
export class GarageUI {
  constructor({ save, audio, onBack }) {
    this.save = save;
    this.audio = audio;
    this.onBack = onBack;
    this.activeCarId = save.data.selectedCar;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.previewMesh = null;
    this.rafId = null;
  }

  render(container) {
    this.destroy();
    this.activeCarId = this.save.data.selectedCar;
    const car = getCarById(this.activeCarId);

    container.innerHTML = `
      <div class="panel garage-panel">
        <div class="panel-header">
          <div>
            <div class="eyebrow">CUSTOMS & SHOWROOM</div>
            <h2>GARAGE SHOP</h2>
          </div>
          <div class="header-actions">
            <div class="coin-badge">◆ <span id="garage-coins">${this.save.data.coins}</span> NITRO</div>
            <button class="btn btn-ghost" id="garage-back">← Back</button>
          </div>
        </div>

        <div class="garage-layout">
          <div class="garage-stage-wrap">
            <div id="garage-canvas-host" class="garage-canvas-host"></div>
            <div class="garage-stage-meta" id="garage-meta"></div>
          </div>

          <div class="garage-sidebar">
            <div class="car-list" id="garage-car-list"></div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('garage-back').addEventListener('click', () => {
      this.audio.playClick();
      this.destroy();
      this.onBack();
    });

    this._init3DPreview(document.getElementById('garage-canvas-host'));
    this._renderCarList();
    this._selectPreview(car.id);
    preloadCarModels(CARS).then(() => {
      if (this.scene && this.renderer) {
        this._selectPreview(this.activeCarId);
      }
    });
  }

  _init3DPreview(host) {
    const w = Math.max(320, host.clientWidth || 520);
    const h = Math.max(240, host.clientHeight || 320);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this._envRT.texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(4.5, 2.5, 5.2);
    this.camera.lookAt(0, 0.65, 0);

    const amb = new THREE.HemisphereLight('#ffe5d9', '#1e1b2e', 1.1);
    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    key.position.set(5, 8, 6);
    const rim = new THREE.DirectionalLight('#00f5d4', 0.9);
    rim.position.set(-6, 3, -5);
    this.scene.add(amb, key, rim);

    // Showroom turntable platform
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.4, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: '#1b162a', roughness: 0.35, metalness: 0.6 })
    );
    disc.position.y = -0.11;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.15, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: '#ff6b35' })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(disc, ring);

    this._resizeHandler = () => {
      if (!this.renderer || !host.isConnected) return;
      const nw = host.clientWidth || 400;
      const nh = host.clientHeight || 300;
      this.renderer.setSize(nw, nh);
      this.camera.aspect = nw / nh;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._resizeHandler);

    const animate = () => {
      this.rafId = requestAnimationFrame(animate);
      if (this.previewMesh) {
        this.previewMesh.rotation.y += 0.01;
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  _renderCarList() {
    const listEl = document.getElementById('garage-car-list');
    listEl.innerHTML = CARS.map((car) => {
      const owned = this.save.data.ownedCars.includes(car.id);
      const selected = this.save.data.selectedCar === car.id;
      const active = this.activeCarId === car.id;
      return `
        <button class="car-card ${active ? 'active' : ''} ${!owned ? 'locked' : ''}" data-car-id="${car.id}">
          <div class="car-card-top">
            <span class="car-swatch" style="background:${car.colors.primary}"></span>
            <div>
              <div class="car-name">${car.name}</div>
              <div class="car-brand">${car.brand} · ${car.category}</div>
            </div>
          </div>
          <div class="car-card-status">
            ${selected ? '<span class="pill pill-cyan">EQUIPPED</span>' : owned ? '<span class="pill pill-muted">OWNED</span>' : `<span class="pill pill-gold">🔒 ◆ ${car.price}</span>`}
          </div>
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('.car-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.playClick();
        this._selectPreview(btn.dataset.carId);
      });
    });
  }

  _selectPreview(carId) {
    this.activeCarId = carId;
    const car = getCarById(carId);
    const owned = this.save.data.ownedCars.includes(car.id);
    const equipped = this.save.data.selectedCar === car.id;
    const canAfford = this.save.data.coins >= car.price;

    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }
    const built = createCarMesh(car, { castShadow: false });
    this.previewMesh = built.root;
    this.scene.add(this.previewMesh);

    const metaEl = document.getElementById('garage-meta');
    metaEl.innerHTML = `
      <div class="car-detail-head">
        <div>
          <span class="brand-chip">${car.brand}</span>
          <h3>${car.name}</h3>
          <p class="muted">${car.tagline}</p>
        </div>
        <div class="flame-tag">
          Flame: <span class="flame-dot" style="background:${car.colors.nitroFlame}"></span>
        </div>
      </div>

      <div class="stat-bars">
        ${this._statRow('Top Speed', car.stats.speed)}
        ${this._statRow('Handling', car.stats.handling)}
        ${this._statRow('Nitro Tank', car.stats.nitro)}
      </div>

      <div class="garage-actions">
        ${
          equipped
            ? '<button class="btn btn-primary" disabled>✓ EQUIPPED FOR RACE</button>'
            : owned
              ? '<button class="btn btn-primary" id="btn-equip-car">SELECT THIS CAR</button>'
              : `<button class="btn ${canAfford ? 'btn-gold' : 'btn-disabled'}" id="btn-buy-car" ${canAfford ? '' : 'disabled'}>
                  ${canAfford ? `UNLOCK FOR ◆ ${car.price}` : `NEED ◆ ${car.price} NITRO`}
                </button>`
        }
      </div>
    `;

    this._renderCarList();

    document.getElementById('btn-equip-car')?.addEventListener('click', () => {
      this.audio.playClick();
      this.save.selectCar(car.id);
      this._selectPreview(car.id);
    });

    document.getElementById('btn-buy-car')?.addEventListener('click', () => {
      const res = this.save.buyCar(car.id, car.price);
      if (res.ok) {
        this.audio.playWinFanfare();
        document.getElementById('garage-coins').textContent = String(this.save.data.coins);
        this._selectPreview(car.id);
      }
    });
  }

  _statRow(label, val) {
    return `
      <div class="stat-row">
        <span>${label}</span>
        <div class="stat-track"><div class="stat-fill" style="width:${val * 10}%"></div></div>
        <b>${val}/10</b>
      </div>
    `;
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._envRT) {
      this._envRT.dispose();
      this._envRT = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
