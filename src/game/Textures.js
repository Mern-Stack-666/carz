import * as THREE from 'three';

/**
 * Procedural PBR Texture Generator (zero external asset downloads).
 * Builds tileable CanvasTextures for asphalt, shoulder markings, biome ground, and carbon accents.
 * Safe in Node/SSR checks by returning null textures if document is unavailable.
 */
const cache = new Map();

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function getAsphaltTextures(roadHex, lineHex, isNight = false) {
  const key = `asphalt_${roadHex}_${lineHex}_${isNight}`;
  if (cache.has(key)) return cache.get(key);

  const size = 512;
  const colCanvas = makeCanvas(size, size);
  const bumpCanvas = makeCanvas(size, size);
  const roughCanvas = makeCanvas(size, size);

  if (!colCanvas) {
    return { map: null, bumpMap: null, roughnessMap: null };
  }

  const cCtx = colCanvas.getContext('2d');
  const bCtx = bumpCanvas.getContext('2d');
  const rCtx = roughCanvas.getContext('2d');

  // Base asphalt tone
  cCtx.fillStyle = roadHex;
  cCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = isNight ? '#7a7a7a' : '#c8c8c8';
  rCtx.fillRect(0, 0, size, size);

  // Subtle dark rubber racing-line wear tracks
  const laneCenters = [size * 0.32, size * 0.68];
  laneCenters.forEach((lx) => {
    const grad = cCtx.createLinearGradient(lx - 55, 0, lx + 55, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cCtx.fillStyle = grad;
    cCtx.fillRect(lx - 55, 0, 110, size);

    // Slightly glossier polished rubber track in roughness map
    const rGrad = rCtx.createLinearGradient(lx - 50, 0, lx + 50, 0);
    rGrad.addColorStop(0, 'rgba(120,120,120,0)');
    rGrad.addColorStop(0.5, isNight ? 'rgba(60,60,60,0.7)' : 'rgba(150,150,150,0.45)');
    rGrad.addColorStop(1, 'rgba(120,120,120,0)');
    rCtx.fillStyle = rGrad;
    rCtx.fillRect(lx - 50, 0, 100, size);
  });

  // Aggregate mineral speckle noise for micro-grain & speed sense
  const imgData = cCtx.getImageData(0, 0, size, size);
  const bumpData = bCtx.getImageData(0, 0, size, size);
  const d = imgData.data;
  const bd = bumpData.data;
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 32;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));

    const bv = Math.max(0, Math.min(255, 128 + n * 2.2));
    bd[i] = bv;
    bd[i + 1] = bv;
    bd[i + 2] = bv;
  }
  cCtx.putImageData(imgData, 0, 0);
  bCtx.putImageData(bumpData, 0, 0);

  // Crisp painted shoulder edge lines
  cCtx.fillStyle = 'rgba(255,255,255,0.72)';
  cCtx.fillRect(14, 0, 10, size);
  cCtx.fillRect(size - 24, 0, 10, size);

  // Faint asphalt tar seams
  cCtx.fillStyle = 'rgba(10,10,16,0.35)';
  cCtx.fillRect(0, 128, size, 3);
  cCtx.fillRect(0, 384, size, 3);

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const result = {
    map: setup(colCanvas, true),
    bumpMap: setup(bumpCanvas, false),
    roughnessMap: setup(roughCanvas, false),
  };
  cache.set(key, result);
  return result;
}

export function getBiomeGroundTextures(type, baseHex) {
  const key = `ground_${type}_${baseHex}`;
  if (cache.has(key)) return cache.get(key);

  const size = 256;
  const colCanvas = makeCanvas(size, size);
  const bumpCanvas = makeCanvas(size, size);
  if (!colCanvas) return { map: null, bumpMap: null };

  const cCtx = colCanvas.getContext('2d');
  const bCtx = bumpCanvas.getContext('2d');

  cCtx.fillStyle = baseHex;
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Directional ripples for desert sand & ocean waves, mottled noise for snow/jungle/city
  for (let y = 0; y < size; y += 2) {
    const wave = Math.sin((y / size) * Math.PI * 12);
    if (type === 'desert' || type === 'coast') {
      cCtx.fillStyle = wave > 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
      cCtx.fillRect(0, y, size, 2);
      const bVal = Math.round(128 + wave * 42);
      bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
      bCtx.fillRect(0, y, size, 2);
    }
  }

  // Organic surface patches
  let seed = 4242;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 650; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2 + rand() * 9;
    cCtx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.055)';
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    const bv = Math.round(100 + rand() * 56);
    bCtx.fillStyle = `rgba(${bv},${bv},${bv},0.35)`;
    bCtx.beginPath();
    bCtx.arc(x, y, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(36, 36);
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const result = {
    map: setup(colCanvas, true),
    bumpMap: setup(bumpCanvas, false),
  };
  cache.set(key, result);
  return result;
}

/**
 * Lit skyscraper window-grid facade + emissive map for Sheher Raat night city.
 */
export function getCityBuildingTextures() {
  const key = 'city_building_facade';
  if (cache.has(key)) return cache.get(key);

  const w = 256;
  const h = 512;
  const colCanvas = makeCanvas(w, h);
  const emCanvas = makeCanvas(w, h);
  if (!colCanvas) return { map: null, emissiveMap: null };

  const cCtx = colCanvas.getContext('2d');
  const eCtx = emCanvas.getContext('2d');

  cCtx.fillStyle = '#181828';
  cCtx.fillRect(0, 0, w, h);
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, w, h);

  let seed = 9001;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const cols = 8;
  const rows = 24;
  const cellW = w / cols;
  const cellH = h / rows;

  for (let r = 1; r < rows - 1; r++) {
    const floorLitBias = 0.25 + rand() * 0.55;
    for (let c = 0; c < cols; c++) {
      const lit = rand() < floorLitBias;
      const wx = c * cellW + 5;
      const wy = r * cellH + 4;
      const ww = cellW - 10;
      const wh = cellH - 8;

      if (lit) {
        const tone = rand();
        const col = tone < 0.55 ? '#ffd89b' : tone < 0.85 ? '#7ef9ff' : '#ff85c0';
        cCtx.fillStyle = col;
        eCtx.fillStyle = col;
      } else {
        cCtx.fillStyle = '#0d101c';
        eCtx.fillStyle = '#000000';
      }
      cCtx.fillRect(wx, wy, ww, wh);
      eCtx.fillRect(wx, wy, ww, wh);
    }
  }

  const setup = (canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const res = { map: setup(colCanvas), emissiveMap: setup(emCanvas) };
  cache.set(key, res);
  return res;
}

/**
 * Alpha-cutout foliage card texture for jungle canopies, palm fronds, and alpine pine boughs.
 */
export function getFoliageTexture(kind = 'jungle') {
  const key = `foliage_${kind}`;
  if (cache.has(key)) return cache.get(key);

  const size = 256;
  const canvas = makeCanvas(size, size);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  let seed = kind === 'palm' ? 77 : kind === 'pine' ? 313 : 505;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  if (kind === 'palm') {
    // Radiating palm fronds
    const cx = size * 0.5;
    const cy = size * 0.5;
    for (let f = 0; f < 9; f++) {
      const ang = (f / 9) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = f % 2 === 0 ? '#2b8a3e' : '#37b24d';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(58, -22, 118, 0);
      ctx.quadraticCurveTo(58, 22, 0, 6);
      ctx.fill();
      ctx.restore();
    }
  } else {
    // Organic leaf/needle cluster silhouette
    const count = kind === 'pine' ? 140 : 110;
    const baseColors =
      kind === 'pine'
        ? ['#1b4332', '#2d6a4f', '#d8f3dc']
        : ['#1b4332', '#2d6a4f', '#40916c', '#52b788'];
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * (size * 0.36);
      const x = size * 0.5 + Math.cos(a) * dist;
      const y = size * 0.5 + Math.sin(a) * dist;
      const rx = 12 + rand() * 18;
      const ry = 8 + rand() * 14;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand() * Math.PI);
      ctx.fillStyle = baseColors[Math.floor(rand() * baseColors.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
