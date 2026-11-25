import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Car model loader & sculpted fallback builder.
 * Preloads Catmull-Clark subdivided .glb models via GLTFLoader with 5-node RaycastVehicle
 * hierarchy (Chassis, Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR) and clearcoat PBR upgrades.
 */
const glbCache = new Map();
let preloadPromise = null;

export function preloadCarModels(cars) {
  if (preloadPromise) return preloadPromise;
  if (typeof fetch === 'undefined') return Promise.resolve();

  const loader = new GLTFLoader();
  preloadPromise = Promise.all(
    cars.map(
      (car) =>
        new Promise((resolve) => {
          if (!car.modelUrl || glbCache.has(car.id)) {
            resolve();
            return;
          }
          loader.load(
            car.modelUrl,
            (gltf) => {
              glbCache.set(car.id, gltf.scene);
              resolve();
            },
            undefined,
            () => resolve() // Keep procedural fallback if file missing
          );
        })
    )
  );
  return preloadPromise;
}
const wheelTireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 20);
wheelTireGeo.rotateZ(Math.PI / 2);
const rimDishGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.35, 16);
rimDishGeo.rotateZ(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(0.37, 0.055, 0.48);
const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.38, 10);
hubGeo.rotateZ(Math.PI / 2);
const flameGeo = new THREE.ConeGeometry(0.20, 1.45, 12);
flameGeo.rotateX(-Math.PI / 2);

const tireMat = new THREE.MeshStandardMaterial({ color: '#14141b', roughness: 0.88, metalness: 0.05 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: '#0c1624',
  roughness: 0.06,
  metalness: 0.85,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.75,
});
const headlightMat = new THREE.MeshBasicMaterial({ color: '#fff8db' });

function makeExtrudedHull(points, width, bevel = 0.09) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const innerW = Math.max(0.2, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerW,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.75,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geo.translate(0, 0, -innerW * 0.5);
  geo.rotateY(-Math.PI / 2); // +X profile -> +Z forward
  geo.computeVertexNormals();
  return geo;
}

const PROFILES = {
  hatchback: {
    body: [[-1.78, 0.30], [1.75, 0.30], [1.82, 0.62], [1.45, 0.78], [0.85, 0.84], [-1.75, 0.84]],
    cabin: [[-1.38, 0.82], [0.88, 0.82], [0.35, 1.32], [-1.08, 1.32]],
    width: 1.88,
    cabinWidth: 1.46,
    zFront: 1.86,
    zRear: -1.82,
  },
  buggy: {
    body: [[-1.88, 0.42], [1.86, 0.38], [1.94, 0.66], [1.18, 0.84], [-0.45, 0.88], [-1.88, 0.82]],
    cabin: [[-1.12, 0.84], [0.72, 0.84], [0.22, 1.42], [-0.88, 1.42]],
    width: 1.76,
    cabinWidth: 1.24,
    zFront: 1.94,
    zRear: -1.90,
  },
  sedan: {
    body: [[-2.14, 0.28], [2.14, 0.26], [2.22, 0.56], [1.92, 0.74], [1.05, 0.80], [-2.12, 0.82]],
    cabin: [[-1.42, 0.78], [1.08, 0.78], [0.46, 1.24], [-0.95, 1.24]],
    width: 1.98,
    cabinWidth: 1.52,
    zFront: 2.22,
    zRear: -2.14,
  },
  coupe: {
    body: [[-2.18, 0.26], [2.22, 0.22], [2.28, 0.48], [1.82, 0.68], [0.95, 0.76], [-2.15, 0.78]],
    cabin: [[-1.48, 0.74], [0.96, 0.74], [0.25, 1.15], [-0.82, 1.15]],
    width: 2.06,
    cabinWidth: 1.48,
    zFront: 2.28,
    zRear: -2.18,
  },
  muscle: {
    body: [[-2.24, 0.28], [2.24, 0.25], [2.30, 0.64], [1.88, 0.82], [0.95, 0.86], [-2.22, 0.86]],
    cabin: [[-1.56, 0.84], [0.68, 0.84], [0.12, 1.26], [-1.08, 1.26]],
    width: 2.16,
    cabinWidth: 1.58,
    zFront: 2.30,
    zRear: -2.24,
  },
  hypercar: {
    body: [[-2.34, 0.22], [2.38, 0.18], [2.44, 0.40], [1.85, 0.62], [0.95, 0.68], [-2.32, 0.72]],
    cabin: [[-1.32, 0.66], [1.12, 0.66], [0.35, 1.02], [-0.72, 1.02]],
    width: 2.20,
    cabinWidth: 1.34,
    zFront: 2.44,
    zRear: -2.34,
  },
  m_coupe: {
    body: [[-2.14, 0.25], [2.16, 0.23], [2.22, 0.54], [1.85, 0.72], [0.95, 0.79], [-2.14, 0.80]],
    cabin: [[-1.40, 0.78], [1.02, 0.78], [0.42, 1.22], [-0.96, 1.22]],
    width: 2.00,
    cabinWidth: 1.52,
    zFront: 2.22,
    zRear: -2.14,
  },
  stuttgart_gt: {
    body: [[-2.12, 0.24], [2.10, 0.22], [2.16, 0.50], [1.75, 0.68], [0.88, 0.75], [-2.12, 0.77]],
    cabin: [[-1.52, 0.74], [0.88, 0.74], [0.22, 1.18], [-0.95, 1.18]],
    width: 2.04,
    cabinWidth: 1.44,
    zFront: 2.16,
    zRear: -2.12,
  },
  berlinetta: {
    body: [[-2.22, 0.22], [2.24, 0.19], [2.28, 0.44], [1.80, 0.64], [0.90, 0.72], [-2.22, 0.74]],
    cabin: [[-1.36, 0.70], [1.04, 0.70], [0.32, 1.08], [-0.82, 1.08]],
    width: 2.12,
    cabinWidth: 1.40,
    zFront: 2.28,
    zRear: -2.22,
  },
  wedge_v12: {
    body: [[-2.28, 0.20], [2.34, 0.16], [2.38, 0.38], [1.82, 0.58], [0.90, 0.68], [-2.28, 0.70]],
    cabin: [[-1.34, 0.66], [1.10, 0.66], [0.34, 1.02], [-0.74, 1.02]],
    width: 2.20,
    cabinWidth: 1.40,
    zFront: 2.38,
    zRear: -2.28,
  },
  cline_hyper: {
    body: [[-2.30, 0.21], [2.32, 0.19], [2.36, 0.44], [1.82, 0.65], [0.92, 0.74], [-2.30, 0.76]],
    cabin: [[-1.38, 0.72], [1.04, 0.72], [0.30, 1.06], [-0.78, 1.06]],
    width: 2.24,
    cabinWidth: 1.44,
    zFront: 2.36,
    zRear: -2.30,
  },
};

export function createCarMesh(carData, options = {}) {
  const { isGhost = false, castShadow = true, physicsMode = false, useClearcoat = true } = options;

  const cachedScene = glbCache.get(carData.id);
  if (cachedScene) {
    return buildFromGLB(cachedScene, carData, { isGhost, castShadow, physicsMode, useClearcoat });
  }

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  if (physicsMode) {
    bodyGroup.position.y = -0.83;
  }
  root.add(bodyGroup);

  const primaryMat = isGhost
    ? new THREE.MeshBasicMaterial({ color: '#00f5d4', transparent: true, opacity: 0.30 })
    : useClearcoat
      ? new THREE.MeshPhysicalMaterial({
          color: carData.colors.primary,
          roughness: 0.24,
          metalness: 0.52,
          clearcoat: 1.0,
          clearcoatRoughness: 0.07,
          envMapIntensity: 1.4,
        })
      : new THREE.MeshStandardMaterial({
          color: carData.colors.primary,
          roughness: 0.22,
          metalness: 0.6,
          envMapIntensity: 1.3,
        });

  const secondaryMat = isGhost
    ? primaryMat
    : new THREE.MeshStandardMaterial({
        color: carData.colors.secondary,
        roughness: 0.45,
        metalness: 0.55,
        envMapIntensity: 1.1,
      });

  const accentMat = isGhost
    ? primaryMat
    : new THREE.MeshStandardMaterial({
        color: carData.colors.accent,
        roughness: 0.25,
        metalness: 0.65,
        emissive: carData.colors.accent,
        emissiveIntensity: 0.25,
      });

  const rimMat = isGhost
    ? primaryMat
    : new THREE.MeshStandardMaterial({
        color: '#e5e7eb',
        roughness: 0.18,
        metalness: 0.92,
        envMapIntensity: 1.5,
      });

  const taillightMat = isGhost
    ? primaryMat
    : new THREE.MeshStandardMaterial({
        color: '#ff1e4d',
        emissive: '#ff1e4d',
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });

  const shape = carData.shape || 'sedan';
  const prof = PROFILES[shape] || PROFILES.sedan;

  // Main sculpted fuselage
  const hullMesh = new THREE.Mesh(makeExtrudedHull(prof.body, prof.width, 0.09), primaryMat);
  if (castShadow && !isGhost) {
    hullMesh.castShadow = true;
    hullMesh.receiveShadow = true;
  }
  bodyGroup.add(hullMesh);

  // Sculpted tinted cockpit canopy
  const cabinMesh = new THREE.Mesh(makeExtrudedHull(prof.cabin, prof.cabinWidth, 0.06), isGhost ? primaryMat : glassMat);
  bodyGroup.add(cabinMesh);

  // Lower aerodynamic splitter & side skirts
  const addDetail = (w, h, d, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    bodyGroup.add(m);
    return m;
  };

  addDetail(prof.width + 0.08, 0.11, prof.zFront - prof.zRear + 0.08, secondaryMat, 0, 0.24, (prof.zFront + prof.zRear) * 0.5);

  // Racing livery accent stripe & rear diffuser / spoiler per car class
  if (shape === 'hatchback') {
    addDetail(0.32, 0.03, 1.5, accentMat, 0, 0.87, 1.0);
    addDetail(1.56, 0.09, 0.34, accentMat, 0, 1.36, -1.26, -0.18);
  } else if (shape === 'buggy') {
    addDetail(0.09, 0.62, 0.09, accentMat, -0.62, 1.15, -1.0);
    addDetail(0.09, 0.62, 0.09, accentMat, 0.62, 1.15, -1.0);
    addDetail(1.66, 0.09, 0.42, primaryMat, 0, 1.35, -1.72, -0.22);
  } else if (shape === 'sedan') {
    addDetail(0.28, 0.03, 3.8, accentMat, 0, 0.84, 0.0);
    addDetail(1.84, 0.09, 0.26, accentMat, 0, 0.87, -2.02);
  } else if (shape === 'coupe') {
    addDetail(0.07, 0.20, 1.45, accentMat, -1.04, 0.52, -0.1);
    addDetail(0.07, 0.20, 1.45, accentMat, 1.04, 0.52, -0.1);
    addDetail(2.02, 0.08, 0.42, accentMat, 0, 1.02, -2.02, -0.14);
  } else if (shape === 'muscle') {
    // Supercharger twin hood intake
    addDetail(0.68, 0.18, 1.05, secondaryMat, 0, 0.90, 1.05);
    addDetail(0.54, 0.08, 0.14, accentMat, 0, 0.93, 1.60);
    addDetail(2.12, 0.20, 0.24, accentMat, 0, 0.94, -2.14, 0.28);
  } else {
    // Hypercar dorsal fin + carbon GT wing
    addDetail(0.07, 0.36, 1.45, accentMat, 0, 0.82, -1.22);
    addDetail(0.08, 0.40, 0.18, secondaryMat, -0.78, 0.84, -2.18);
    addDetail(0.08, 0.40, 0.18, secondaryMat, 0.78, 0.84, -2.18);
    addDetail(2.24, 0.07, 0.50, accentMat, 0, 1.05, -2.20, -0.14);
  }

  // Headlights & glowing taillight bar
  if (!isGhost) {
    addDetail(0.42, 0.12, 0.08, headlightMat, -prof.width * 0.33, 0.49, prof.zFront - 0.01);
    addDetail(0.42, 0.12, 0.08, headlightMat, prof.width * 0.33, 0.49, prof.zFront - 0.01);
    addDetail(0.52, 0.12, 0.08, taillightMat, -prof.width * 0.33, 0.56, prof.zRear + 0.01);
    addDetail(0.52, 0.12, 0.08, taillightMat, prof.width * 0.33, 0.56, prof.zRear + 0.01);
  }

  // Wheels with multi-spoke alloy rims & brake calipers
  const wheelZFront = shape === 'hatchback' ? 1.15 : 1.42;
  const wheelZRear = shape === 'hatchback' ? -1.15 : -1.42;
  const wheelX = shape === 'muscle' || shape === 'hypercar' ? 1.08 : 0.98;
  const wheelScale = shape === 'buggy' ? 1.15 : 1.0;

  const wheels = [];
  const steerPivots = [];
  const frontSteerPivots = [];

  [
    { x: wheelX, z: wheelZFront, front: true },
    { x: -wheelX, z: wheelZFront, front: true },
    { x: wheelX, z: wheelZRear, front: false },
    { x: -wheelX, z: wheelZRear, front: false },
  ].forEach((pos) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(pos.x, 0.42 * wheelScale, pos.z);

    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(wheelTireGeo, isGhost ? primaryMat : tireMat);
    const dish = new THREE.Mesh(rimDishGeo, isGhost ? primaryMat : secondaryMat);
    const hub = new THREE.Mesh(hubGeo, rimMat);

    const spokeA = new THREE.Mesh(spokeGeo, rimMat);
    const spokeB = new THREE.Mesh(spokeGeo, rimMat);
    spokeB.rotation.x = Math.PI / 3;
    const spokeC = new THREE.Mesh(spokeGeo, rimMat);
    spokeC.rotation.x = (2 * Math.PI) / 3;

    [tire, dish, hub, spokeA, spokeB, spokeC].forEach((m) => m.scale.setScalar(wheelScale));
    if (castShadow && !isGhost) tire.castShadow = true;

    spinGroup.add(tire, dish, hub, spokeA, spokeB, spokeC);
    steerPivot.add(spinGroup);
    root.add(steerPivot);

    wheels.push(spinGroup);
    steerPivots.push(steerPivot);
    if (pos.front) frontSteerPivots.push(steerPivot);
  });

  // Dual Nitro exhaust flame cones
  const flames = [];
  if (!isGhost) {
    const flameMat = new THREE.MeshBasicMaterial({
      color: carData.colors.nitroFlame || '#00f5d4',
      transparent: true,
      opacity: 0.92,
    });
    const zFlame = prof.zRear - 0.55;
    [-0.45, 0.45].forEach((fx) => {
      const cone = new THREE.Mesh(flameGeo, flameMat);
      cone.position.set(fx, 0.36, zFlame);
      cone.visible = false;
      bodyGroup.add(cone);
      flames.push(cone);
    });
  }

  return {
    root,
    wheels,
    steerPivots,
    frontSteerPivots,
    flames,
    taillightMat: isGhost ? null : taillightMat,
    wheelLayout: { wheelX, wheelZFront, wheelZRear },
  };
}

function buildFromGLB(sourceScene, carData, { isGhost, castShadow, physicsMode, useClearcoat }) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  if (physicsMode) {
    bodyGroup.position.y = -0.83;
  }
  root.add(bodyGroup);

  const cloned = sourceScene.clone(true);
  const ghostMat = isGhost
    ? new THREE.MeshBasicMaterial({ color: '#00f5d4', transparent: true, opacity: 0.30 })
    : null;

  let taillightMat = null;
  const wheelNames = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
  const wheelNodes = {};

  cloned.traverse((obj) => {
    if (wheelNames.includes(obj.name)) {
      wheelNodes[obj.name] = obj;
    }
    if (!obj.isMesh) return;
    if (isGhost) {
      obj.material = ghostMat;
      return;
    }

    if (castShadow && obj.name.includes('Chassis')) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const nextMats = mats.map((m) => {
      if (!m) return m;
      if (m.name === 'BodyPaint') {
        return useClearcoat
          ? new THREE.MeshPhysicalMaterial({
              color: m.color,
              roughness: 0.20,
              metalness: 0.55,
              clearcoat: 1.0,
              clearcoatRoughness: 0.06,
              envMapIntensity: 1.45,
            })
          : new THREE.MeshStandardMaterial({
              color: m.color,
              roughness: 0.22,
              metalness: 0.60,
              envMapIntensity: 1.30,
            });
      }
      if (m.name === 'TintedGlass') {
        return glassMat;
      }
      if (m.name === 'Taillight') {
        taillightMat = m.clone();
        taillightMat.emissiveIntensity = 0.9;
        return taillightMat;
      }
      if (m.name === 'AlloyRim') {
        m.envMapIntensity = 1.5;
      }
      return m;
    });
    obj.material = Array.isArray(obj.material) ? nextMats : nextMats[0];
  });

  // Extract chassis into bodyGroup and wrap each Wheel_XX in a suspension steerPivot
  const chassisNode = cloned.getObjectByName('Chassis');
  if (chassisNode) {
    bodyGroup.add(chassisNode);
  } else {
    bodyGroup.add(cloned);
  }

  const shape = carData.shape || 'sedan';
  const wheelZFront = shape === 'hatchback' ? 1.15 : 1.42;
  const wheelZRear = shape === 'hatchback' ? -1.15 : -1.42;
  const wheelXMap = {
    hatchback: 0.98,
    buggy: 1.04,
    sedan: 0.98,
    m_coupe: 1.00,
    stuttgart_gt: 1.02,
    coupe: 1.02,
    berlinetta: 1.04,
    muscle: 1.08,
    wedge_v12: 1.08,
    hypercar: 1.08,
    cline_hyper: 1.08,
  };
  const wheelX = wheelXMap[shape] || 1.00;

  const wheels = [];
  const steerPivots = [];
  const frontSteerPivots = [];

  wheelNames.forEach((wName, idx) => {
    const wObj = wheelNodes[wName];
    const steerPivot = new THREE.Group();
    if (wObj) {
      steerPivot.position.copy(wObj.position);
      wObj.position.set(0, 0, 0);
      steerPivot.add(wObj);
      wheels.push(wObj);
    } else {
      wheels.push(new THREE.Group());
    }
    root.add(steerPivot);
    steerPivots.push(steerPivot);
    if (idx < 2) frontSteerPivots.push(steerPivot);
  });

  // Dual Nitro exhaust flame cones
  const flames = [];
  if (!isGhost) {
    const flameMat = new THREE.MeshBasicMaterial({
      color: carData.colors.nitroFlame || '#00f5d4',
      transparent: true,
      opacity: 0.92,
    });
    const prof = PROFILES[shape] || PROFILES.sedan;
    const zFlame = prof.zRear - 0.55;
    [-0.46, 0.46].forEach((fx) => {
      const cone = new THREE.Mesh(flameGeo, flameMat);
      cone.position.set(fx, 0.36, zFlame);
      cone.visible = false;
      bodyGroup.add(cone);
      flames.push(cone);
    });
  }

  return {
    root,
    wheels,
    steerPivots,
    frontSteerPivots,
    flames,
    taillightMat: isGhost ? null : taillightMat,
    wheelLayout: { wheelX, wheelZFront, wheelZRear },
  };
}
