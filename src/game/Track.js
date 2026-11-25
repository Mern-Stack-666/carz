import * as THREE from 'three';
import {
  getAsphaltTextures,
  getBiomeGroundTextures,
  getCityBuildingTextures,
  getFoliageTexture,
} from './Textures.js';

/**
 * Data-driven 3D spline track builder.
 * Generates road mesh, alternating curbs, center markings, start gantry,
 * gradient sky dome, theme-specific instanced decorations, and fast spline lookup samples.
 */
export class Track {
  constructor(trackData, qualityPreset) {
    this.data = trackData;
    this.quality = qualityPreset;
    this.group = new THREE.Group();
    this.samples = [];
    this.sampleCount = 420;
    this.halfWidth = trackData.roadWidth * 0.5;
    this.checkpointsCount = 12;

    const pts = trackData.controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.45);
    this.totalLength = this.curve.getLength();

    this._buildSamples();
    this._buildSkyAndGround();
    this._buildRoadAndCurbs();
    this._buildStartGantry();
    this._buildDecorations();
  }

  _buildSamples() {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.sampleCount; i++) {
      const t = i / this.sampleCount;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      // Horizontal right vector for flat banking
      const horizTan = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
      const right = new THREE.Vector3().crossVectors(horizTan, up).normalize();
      this.samples.push({ idx: i, t, pos, tangent, horizTan, right, curvature: 0 });
    }

    // Precompute horizontal curvature for AI corner braking
    for (let i = 0; i < this.sampleCount; i++) {
      const prev = this.samples[(i - 3 + this.sampleCount) % this.sampleCount];
      const next = this.samples[(i + 3) % this.sampleCount];
      const dot = THREE.MathUtils.clamp(prev.horizTan.dot(next.horizTan), -1, 1);
      this.samples[i].curvature = Math.acos(dot);
    }
  }

  _buildSkyAndGround() {
    const th = this.data.theme;
    const sunDir = new THREE.Vector3(...th.sunPosition).normalize();

    // Atmospheric gradient sky dome with glowing sun/moon disc & horizon scatter
    const skyGeo = new THREE.SphereGeometry(900, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(th.skyTop) },
        bottomColor: { value: new THREE.Color(th.skyBottom) },
        sunDir: { value: sunDir },
        sunColor: { value: new THREE.Color(th.isNight ? '#bfefff' : '#fff3c4') },
        isNight: { value: th.isNight ? 1.0 : 0.0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform float isNight;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 1.65 + 0.12, 0.0, 1.0);
          vec3 sky = mix(bottomColor, topColor, pow(h, 0.78));

          // Sun / Moon disc + atmospheric halo
          float sunDot = max(dot(dir, normalize(sunDir)), 0.0);
          float halo = pow(sunDot, isNight > 0.5 ? 24.0 : 10.0) * (isNight > 0.5 ? 0.35 : 0.65);
          float disc = smoothstep(0.9965, 0.9992, sunDot) * 1.4;
          sky += sunColor * (halo + disc);

          // Subtle stars at night
          if (isNight > 0.5 && dir.y > 0.08) {
            float starVal = fract(sin(dot(floor(dir * 340.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            if (starVal > 0.9965) sky += vec3(0.85, 0.92, 1.0) * (dir.y * 1.2);
          }
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    this.group.add(new THREE.Mesh(skyGeo, skyMat));

    // Sculpted 3D biome terrain outside track corridor
    const segs = 72;
    const groundGeo = new THREE.PlaneGeometry(1600, 1600, segs, segs);
    groundGeo.rotateX(-Math.PI / 2);

    let useVertexColors = false;
    if (th.type !== 'coast' && th.type !== 'city') {
      const posAttr = groundGeo.attributes.position;
      const amp = th.type === 'snow' ? 28 : th.type === 'jungle' ? 19 : 15;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        let minDistSq = Infinity;
        for (let sIdx = 0; sIdx < this.sampleCount; sIdx += 6) {
          const sp = this.samples[sIdx].pos;
          const dx = vx - sp.x;
          const dz = vz - sp.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) minDistSq = dSq;
        }
        const dist = Math.sqrt(minDistSq);
        const clearMargin = this.halfWidth + 28;
        if (dist > clearMargin) {
          const blend = Math.min(1, (dist - clearMargin) / 48);
          const ridge =
            Math.sin(vx * 0.022) * Math.cos(vz * 0.021) * 0.6 +
            Math.sin((vx + vz) * 0.045) * 0.4;
          const h = Math.max(0, ridge + 0.55) * amp * blend * blend;
          posAttr.setY(i, -0.85 + h);
        } else {
          posAttr.setY(i, -0.85);
        }
      }
      groundGeo.computeVertexNormals();

      // Slope-based vertex color blending (snow/sand/moss on flats, craggy rock on steep slopes)
      const normAttr = groundGeo.attributes.normal;
      const colors = new Float32Array(posAttr.count * 3);
      const flatCol = new THREE.Color(th.type === 'snow' ? '#eef7ff' : th.type === 'jungle' ? '#356b43' : '#e4a76e');
      const cliffCol = new THREE.Color(th.type === 'snow' ? '#4f5d75' : th.type === 'jungle' ? '#4a3f35' : '#9e4731');
      const tmpCol = new THREE.Color();
      for (let i = 0; i < posAttr.count; i++) {
        const ny = normAttr.getY(i); // 1.0 = flat, < 0.85 = steep cliff
        const cliffFactor = THREE.MathUtils.clamp((0.95 - ny) * 4.5, 0, 1);
        tmpCol.copy(flatCol).lerp(cliffCol, cliffFactor);
        colors[i * 3] = tmpCol.r;
        colors[i * 3 + 1] = tmpCol.g;
        colors[i * 3 + 2] = tmpCol.b;
      }
      groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      useVertexColors = true;
    }

    const gTex = getBiomeGroundTextures(th.type, th.groundColor);
    const groundMat = new THREE.MeshStandardMaterial({
      color: useVertexColors ? '#ffffff' : gTex.map ? '#ffffff' : th.groundColor,
      vertexColors: useVertexColors,
      map: gTex.map,
      bumpMap: gTex.bumpMap,
      bumpScale: th.type === 'coast' ? 0.25 : 0.65,
      roughness: th.type === 'coast' ? 0.16 : th.type === 'city' ? 0.32 : 0.92,
      metalness: th.type === 'coast' ? 0.68 : th.type === 'city' ? 0.28 : 0.02,
      envMapIntensity: th.type === 'coast' ? 1.55 : 0.65,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = th.type === 'coast' || th.type === 'city' ? -0.45 : 0;
    ground.receiveShadow = this.quality.shadows;
    this.group.add(ground);
  }

  _buildRoadAndCurbs() {
    const th = this.data.theme;
    const N = this.sampleCount;
    const hw = this.halfWidth;
    const curbW = 1.35;

    const roadPositions = [];
    const roadNormals = [];
    const roadUvs = [];
    const roadIndices = [];

    const curbPositionsA = [];
    const curbIndicesA = [];
    const curbPositionsB = [];
    const curbIndicesB = [];

    let cumDist = 0;
    // Road & curb strips
    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      if (i > 0) {
        cumDist += s.pos.distanceTo(this.samples[(i - 1) % N].pos);
      }
      const vCoord = cumDist / 14;
      const pL = s.pos.clone().addScaledVector(s.right, -hw);
      const pR = s.pos.clone().addScaledVector(s.right, hw);
      roadPositions.push(pL.x, pL.y + 0.02, pL.z, pR.x, pR.y + 0.02, pR.z);
      roadNormals.push(0, 1, 0, 0, 1, 0);
      roadUvs.push(0, vCoord, 1, vCoord);

      // Curbs on both edges
      const cLOut = s.pos.clone().addScaledVector(s.right, -(hw + curbW));
      const cROut = s.pos.clone().addScaledVector(s.right, hw + curbW);
      const targetPos = i % 2 === 0 ? curbPositionsA : curbPositionsB;
      // Add segment quad between i and i+1
      if (i < N) {
        const sn = this.samples[(i + 1) % N];
        const nL = sn.pos.clone().addScaledVector(sn.right, -hw);
        const nLOut = sn.pos.clone().addScaledVector(sn.right, -(hw + curbW));
        const nR = sn.pos.clone().addScaledVector(sn.right, hw);
        const nROut = sn.pos.clone().addScaledVector(sn.right, hw + curbW);

        const idxArr = i % 2 === 0 ? curbIndicesA : curbIndicesB;
        // Left curb quad
        let base = targetPos.length / 3;
        targetPos.push(
          cLOut.x, cLOut.y + 0.06, cLOut.z,
          pL.x, pL.y + 0.06, pL.z,
          nLOut.x, nLOut.y + 0.06, nLOut.z,
          nL.x, nL.y + 0.06, nL.z
        );
        idxArr.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);

        // Right curb quad
        base = targetPos.length / 3;
        targetPos.push(
          pR.x, pR.y + 0.06, pR.z,
          cROut.x, cROut.y + 0.06, cROut.z,
          nR.x, nR.y + 0.06, nR.z,
          nROut.x, nROut.y + 0.06, nROut.z
        );
        idxArr.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }

      if (i < N) {
        const b = i * 2;
        roadIndices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const aTex = getAsphaltTextures(th.roadColor, th.centerLineColor, th.isNight);
    const roadMat = new THREE.MeshStandardMaterial({
      color: aTex.map ? '#ffffff' : th.roadColor,
      map: aTex.map,
      bumpMap: aTex.bumpMap,
      bumpScale: 0.08,
      roughnessMap: aTex.roughnessMap,
      roughness: th.isNight ? 0.55 : 0.86,
      metalness: th.isNight ? 0.22 : 0.08,
      envMapIntensity: th.isNight ? 1.2 : 0.85,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = this.quality.shadows;
    this.group.add(roadMesh);

    const buildCurbMesh = (posArr, idxArr, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      g.setIndex(idxArr);
      g.computeVertexNormals();
      const m = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          emissive: th.isNight ? color : '#000000',
          emissiveIntensity: th.isNight ? 0.35 : 0,
        })
      );
      m.receiveShadow = this.quality.shadows;
      this.group.add(m);
    };

    buildCurbMesh(curbPositionsA, curbIndicesA, th.curbColorA);
    buildCurbMesh(curbPositionsB, curbIndicesB, th.curbColorB);

    // Instanced center line dashes
    const dashGeo = new THREE.BoxGeometry(0.32, 0.05, 3.2);
    const dashMat = new THREE.MeshBasicMaterial({ color: th.centerLineColor });
    const dashCount = Math.floor(N / 3);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < dashCount; i++) {
      const s = this.samples[(i * 3) % N];
      dummy.position.set(s.pos.x, s.pos.y + 0.05, s.pos.z);
      dummy.lookAt(s.pos.clone().add(s.tangent));
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    this.group.add(dashes);

    // Subtle earthen road skirt for elevated tracks (snow/jungle)
    if (this.data.controlPoints.some((p) => p[1] > 0.5)) {
      const skirtPos = [];
      const skirtIdx = [];
      for (let i = 0; i <= N; i++) {
        const s = this.samples[i % N];
        const pL = s.pos.clone().addScaledVector(s.right, -(hw + curbW));
        const pR = s.pos.clone().addScaledVector(s.right, hw + curbW);
        skirtPos.push(pL.x, pL.y, pL.z, pL.x, -1.0, pL.z, pR.x, pR.y, pR.z, pR.x, -1.0, pR.z);
        if (i < N) {
          const b = i * 4;
          skirtIdx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
          skirtIdx.push(b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
      sg.setIndex(skirtIdx);
      sg.computeVertexNormals();
      this.group.add(
        new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: th.groundColor, roughness: 0.95 }))
      );
    }

    // Instanced low-poly barrier posts along outer curbs matching physical guardrails
    const postGeo = new THREE.BoxGeometry(0.42, 1.05, 0.95);
    const postMat = new THREE.MeshStandardMaterial({
      color: th.isNight ? '#00f5d4' : '#e5e5e5',
      roughness: 0.5,
      emissive: th.isNight ? '#00f5d4' : '#000000',
      emissiveIntensity: th.isNight ? 0.3 : 0,
    });
    const postStep = 4;
    const postPairs = Math.floor(N / postStep);
    const posts = new THREE.InstancedMesh(postGeo, postMat, postPairs * 2);
    let pIdx = 0;
    for (let i = 0; i < postPairs; i++) {
      const s = this.samples[(i * postStep) % N];
      [-1, 1].forEach((side) => {
        const p = s.pos.clone().addScaledVector(s.right, side * (hw + curbW + 0.25));
        dummy.position.set(p.x, p.y + 0.55, p.z);
        dummy.lookAt(p.clone().add(s.tangent));
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        posts.setMatrixAt(pIdx++, dummy.matrix);
      });
    }
    posts.instanceMatrix.needsUpdate = true;
    this.group.add(posts);

    // Continuous metallic guardrail beams connecting outer barrier posts
    const railMat = new THREE.MeshStandardMaterial({
      color: th.isNight ? '#00f5d4' : '#cbd5e1',
      metalness: 0.82,
      roughness: 0.28,
      emissive: th.isNight ? '#00f5d4' : '#000000',
      emissiveIntensity: th.isNight ? 0.45 : 0,
      side: THREE.DoubleSide,
    });
    [-1, 1].forEach((side) => {
      const rPos = [];
      const rIdx = [];
      const offset = hw + curbW + 0.22;
      for (let i = 0; i <= N; i++) {
        const s = this.samples[i % N];
        const p = s.pos.clone().addScaledVector(s.right, side * offset);
        rPos.push(p.x, p.y + 0.45, p.z, p.x, p.y + 0.92, p.z);
        if (i < N) {
          const b = i * 2;
          rIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
      rg.setIndex(rIdx);
      rg.computeVertexNormals();
      const railSide = new THREE.Mesh(rg, railMat);
      this.group.add(railSide);
    });

    // Visual 3D Jump Ramps
    if (Array.isArray(this.data.ramps)) {
      const rampMat = new THREE.MeshStandardMaterial({
        color: '#2b2d42',
        roughness: 0.45,
        metalness: 0.35,
      });
      const chevronMat = new THREE.MeshBasicMaterial({ color: '#ffbe0b' });
      this.data.ramps.forEach((r) => {
        const s = this.getSampleAtT(r.t);
        const pitch = Math.atan2(r.height, r.length);
        const slopeLen = Math.hypot(r.length, r.height);
        const rampGroup = new THREE.Group();
        rampGroup.position
          .copy(s.pos)
          .addScaledVector(s.right, r.lateral * hw)
          .add(new THREE.Vector3(0, r.height * 0.5 - 0.12, 0));
        const yaw = Math.atan2(s.horizTan.x, s.horizTan.z);
        rampGroup.rotation.set(-pitch, yaw, 0, 'YXZ');

        const deck = new THREE.Mesh(new THREE.BoxGeometry(r.width, 0.28, slopeLen), rampMat);
        const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, slopeLen * 0.85), chevronMat);
        stripeL.position.x = -r.width * 0.38;
        const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, slopeLen * 0.85), chevronMat);
        stripeR.position.x = r.width * 0.38;
        const lip = new THREE.Mesh(new THREE.BoxGeometry(r.width, 0.34, 0.7), chevronMat);
        lip.position.z = slopeLen * 0.46;

        rampGroup.add(deck, stripeL, stripeR, lip);
        this.group.add(rampGroup);
      });
    }
  }

  _buildStartGantry() {
    const s = this.samples[0];
    const gantry = new THREE.Group();
    gantry.position.copy(s.pos);
    gantry.lookAt(s.pos.clone().add(s.horizTan));

    const span = this.data.roadWidth + 3;
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#1b1726', roughness: 0.4, metalness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd166' });

    const pGeo = new THREE.BoxGeometry(0.9, 8.5, 0.9);
    const leftP = new THREE.Mesh(pGeo, pillarMat);
    leftP.position.set(-span * 0.5, 4.25, 0);
    const rightP = new THREE.Mesh(pGeo, pillarMat);
    rightP.position.set(span * 0.5, 4.25, 0);

    const banner = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 1.8, 1.1), pillarMat);
    banner.position.set(0, 8.2, 0);

    const neonStrip = new THREE.Mesh(new THREE.BoxGeometry(span * 0.85, 0.35, 1.2), glowMat);
    neonStrip.position.set(0, 8.2, 0);

    // Checkered road strip
    const checkCount = 12;
    const cellW = this.data.roadWidth / checkCount;
    for (let i = 0; i < checkCount; i++) {
      for (let r = 0; r < 2; r++) {
        const isWhite = (i + r) % 2 === 0;
        const cell = new THREE.Mesh(
          new THREE.BoxGeometry(cellW, 0.06, 1.1),
          new THREE.MeshBasicMaterial({ color: isWhite ? '#ffffff' : '#111118' })
        );
        cell.position.set(-this.halfWidth + cellW * (i + 0.5), 0.05, (r - 0.5) * 1.1);
        gantry.add(cell);
      }
    }

    gantry.add(leftP, rightP, banner, neonStrip);
    this.group.add(gantry);
  }

  _buildDecorations() {
    const type = this.data.theme.type;
    const N = this.sampleCount;
    const dummy = new THREE.Object3D();

    // Helper to place instanced objects well outside the road & barrier walls so hills never clip onto the track
    const scatterOffsets = [];
    for (let i = 0; i < N; i += 3) {
      const s = this.samples[i];
      [-1, 1].forEach((side) => {
        const dist = this.halfWidth + 15.0 + ((i * 17 + (side > 0 ? 7 : 3)) % 26);
        const pos = s.pos.clone().addScaledVector(s.right, side * dist);
        // Keep away from road everywhere (accounts for wide mesa bases)
        const check = this.getClosestSample(pos.x, pos.z);
        if (check.dist > this.halfWidth + 13.5) {
          scatterOffsets.push({ pos, sample: s, side, seed: i * 13 + side });
        }
      });
    }

    if (type === 'desert') {
      // Tiered sandstone mesas + angular canyon boulders + desert scrub
      const mesaGeo = new THREE.CylinderGeometry(3.2, 5.5, 12, 7);
      const mesaMat = new THREE.MeshStandardMaterial({ color: '#b55239', roughness: 0.92 });
      const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, scatterOffsets.length);

      const rockGeo = new THREE.DodecahedronGeometry(1.7, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: '#8f4431', roughness: 0.95 });
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, scatterOffsets.length);

      scatterOffsets.forEach((o, idx) => {
        const scale = 0.6 + ((Math.abs(o.seed) % 10) / 10) * 1.6;
        dummy.position.set(o.pos.x, Math.max(-0.5, o.pos.y - 1) + 4.5 * scale, o.pos.z);
        dummy.rotation.set(0, o.seed * 0.7, 0);
        dummy.scale.set(scale, scale * (0.7 + (idx % 3) * 0.4), scale);
        dummy.updateMatrix();
        mesas.setMatrixAt(idx, dummy.matrix);

        // Foreground boulder tucked closer to guardrail
        const nearP = o.sample.pos.clone().addScaledVector(o.sample.right, o.side * (this.halfWidth + 4.5 + (idx % 5)));
        const rs = 0.55 + (idx % 4) * 0.25;
        dummy.position.set(nearP.x, nearP.y + rs * 0.55, nearP.z);
        dummy.rotation.set(idx, idx * 0.6, 0);
        dummy.scale.set(rs * 1.2, rs * 0.8, rs);
        dummy.updateMatrix();
        rocks.setMatrixAt(idx, dummy.matrix);
      });
      mesas.instanceMatrix.needsUpdate = true;
      rocks.instanceMatrix.needsUpdate = true;
      this.group.add(mesas, rocks);
    } else if (type === 'city') {
      // Lit window-grid skyscrapers + rooftop neon crowns + streetlamps + cones
      const bTex = getCityBuildingTextures();
      const bldgGeo = new THREE.BoxGeometry(7.5, 1, 7.5);
      const bldgMat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: bTex.map,
        emissive: '#ffffff',
        emissiveMap: bTex.emissiveMap,
        emissiveIntensity: 1.15,
        roughness: 0.25,
        metalness: 0.55,
      });
      const bldgs = new THREE.InstancedMesh(bldgGeo, bldgMat, scatterOffsets.length);
      const neonGeo = new THREE.BoxGeometry(7.7, 0.45, 7.7);
      const neonMat = new THREE.MeshBasicMaterial({ color: '#00f5d4' });
      const neons = new THREE.InstancedMesh(neonGeo, neonMat, scatterOffsets.length);

      scatterOffsets.forEach((o, idx) => {
        const h = 16 + (Math.abs(o.seed * 7) % 34);
        const sx = 1 + (idx % 2) * 0.45;
        const sz = 1 + (idx % 3) * 0.35;
        dummy.position.set(o.pos.x, h * 0.5 - 0.6, o.pos.z);
        dummy.rotation.set(0, Math.atan2(o.sample.horizTan.x, o.sample.horizTan.z), 0);
        dummy.scale.set(sx, h, sz);
        dummy.updateMatrix();
        bldgs.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(o.pos.x, h - 1.2, o.pos.z);
        dummy.scale.set(sx, 1, sz);
        dummy.updateMatrix();
        neons.setMatrixAt(idx, dummy.matrix);
      });
      bldgs.instanceMatrix.needsUpdate = true;
      neons.instanceMatrix.needsUpdate = true;
      this.group.add(bldgs, neons);

      // Curved highway streetlamps along curbs
      const lampCount = 36;
      const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2d42', metalness: 0.8, roughness: 0.3 });
      const bulbGeo = new THREE.BoxGeometry(1.6, 0.18, 0.45);
      const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe8b3' });
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);
      const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);
      for (let i = 0; i < lampCount; i++) {
        const s = this.samples[Math.floor((i / lampCount) * N)];
        const side = i % 2 === 0 ? 1 : -1;
        const p = s.pos.clone().addScaledVector(s.right, side * (this.halfWidth + 2.1));
        const yaw = Math.atan2(s.right.x * -side, s.right.z * -side);
        dummy.position.set(p.x, p.y + 3.7, p.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);

        const bp = p.clone().addScaledVector(s.right, -side * 0.9);
        dummy.position.set(bp.x, p.y + 7.45, bp.z);
        dummy.updateMatrix();
        bulbs.setMatrixAt(i, dummy.matrix);
      }
      poles.instanceMatrix.needsUpdate = true;
      bulbs.instanceMatrix.needsUpdate = true;
      this.group.add(poles, bulbs);

      // Traffic cones along edge markers
      const coneGeo = new THREE.ConeGeometry(0.38, 0.95, 8);
      const coneMat = new THREE.MeshStandardMaterial({ color: '#ff5400', emissive: '#ff5400', emissiveIntensity: 0.25 });
      const coneCount = 48;
      const cones = new THREE.InstancedMesh(coneGeo, coneMat, coneCount);
      for (let i = 0; i < coneCount; i++) {
        const s = this.samples[Math.floor((i / coneCount) * N)];
        const side = i % 2 === 0 ? 1 : -1;
        const p = s.pos.clone().addScaledVector(s.right, side * (this.halfWidth + 0.6));
        dummy.position.set(p.x, p.y + 0.48, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cones.setMatrixAt(i, dummy.matrix);
      }
      cones.instanceMatrix.needsUpdate = true;
      this.group.add(cones);
    } else if (type === 'coast') {
      // Sunset palm trees with alpha-cutout palm frond cards + coastal boulders
      const trunkGeo = new THREE.CylinderGeometry(0.24, 0.44, 8.2, 7);
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
      const frondTex = getFoliageTexture('palm');
      const crownGeo = new THREE.PlaneGeometry(7.2, 7.2);
      crownGeo.rotateX(-Math.PI / 2);
      const crownMat = new THREE.MeshStandardMaterial({
        map: frondTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.65,
      });

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, scatterOffsets.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, scatterOffsets.length * 2);
      scatterOffsets.forEach((o, idx) => {
        const scale = 0.8 + (idx % 4) * 0.18;
        const leanX = ((idx % 3) - 1) * 0.11;
        const leanZ = (idx % 2 === 0 ? 1 : -1) * 0.1;
        dummy.position.set(o.pos.x, o.pos.y + 3.9 * scale, o.pos.z);
        dummy.rotation.set(leanX, idx, leanZ);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);

        // Two angled frond layers per palm crown
        for (let l = 0; l < 2; l++) {
          dummy.position.set(o.pos.x, o.pos.y + (7.8 + l * 0.45) * scale, o.pos.z);
          dummy.rotation.set(leanX * 1.4, idx * 0.7 + l * 0.55, leanZ * 1.4);
          dummy.scale.setScalar(scale * (1 - l * 0.18));
          dummy.updateMatrix();
          crowns.setMatrixAt(idx * 2 + l, dummy.matrix);
        }
      });
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      this.group.add(trunks, crowns);
    } else if (type === 'snow') {
      // Multi-tiered snow-dusted alpine pines + angular granite mountain boulders
      const trunkGeo = new THREE.CylinderGeometry(0.32, 0.48, 4.2, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#422c1d', roughness: 0.95 });
      const boughGeo = new THREE.ConeGeometry(2.8, 5.0, 7);
      const boughMat = new THREE.MeshStandardMaterial({ color: '#1f4e3d', roughness: 0.85 });
      const snowCapGeo = new THREE.ConeGeometry(2.2, 3.6, 7);
      const snowCapMat = new THREE.MeshStandardMaterial({ color: '#eef7ff', roughness: 0.75 });
      const boulderGeo = new THREE.DodecahedronGeometry(1.9, 0);
      const boulderMat = new THREE.MeshStandardMaterial({ color: '#5c6b7e', roughness: 0.92 });

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, scatterOffsets.length);
      const boughs = new THREE.InstancedMesh(boughGeo, boughMat, scatterOffsets.length);
      const caps = new THREE.InstancedMesh(snowCapGeo, snowCapMat, scatterOffsets.length);
      const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, scatterOffsets.length);

      scatterOffsets.forEach((o, idx) => {
        const scale = 0.85 + (idx % 4) * 0.25;
        const baseY = Math.max(-0.5, o.pos.y - 0.8);
        dummy.position.set(o.pos.x, baseY + 2.1 * scale, o.pos.z);
        dummy.rotation.set(0, idx, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(o.pos.x, baseY + 5.2 * scale, o.pos.z);
        dummy.updateMatrix();
        boughs.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(o.pos.x, baseY + 7.6 * scale, o.pos.z);
        dummy.updateMatrix();
        caps.setMatrixAt(idx, dummy.matrix);

        const np = o.sample.pos.clone().addScaledVector(o.sample.right, o.side * (this.halfWidth + 5.0 + (idx % 6)));
        const bs = 0.6 + (idx % 3) * 0.3;
        dummy.position.set(np.x, np.y + bs * 0.5, np.z);
        dummy.rotation.set(idx, idx * 0.5, 0);
        dummy.scale.set(bs * 1.2, bs * 0.75, bs);
        dummy.updateMatrix();
        boulders.setMatrixAt(idx, dummy.matrix);
      });
      trunks.instanceMatrix.needsUpdate = true;
      boughs.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      boulders.instanceMatrix.needsUpdate = true;
      this.group.add(trunks, boughs, caps, boulders);
    } else {
      // Jungle Mod: Multi-layer rainforest canopy trees (crossed alpha-cutout leaf cards) + mossy boulders
      const trunkGeo = new THREE.CylinderGeometry(0.38, 0.62, 7.5, 7);
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#47301e', roughness: 0.95 });
      const leafTex = getFoliageTexture('jungle');
      const canopyGeo = new THREE.PlaneGeometry(8.5, 7.2);
      const canopyMat = new THREE.MeshStandardMaterial({
        map: leafTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.82,
      });
      const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: '#3b5249', roughness: 0.92 });

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, scatterOffsets.length);
      const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, scatterOffsets.length * 3);
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, scatterOffsets.length);

      scatterOffsets.forEach((o, idx) => {
        const scale = 0.9 + (idx % 4) * 0.25;
        const baseY = Math.max(-0.5, o.pos.y - 0.8);
        dummy.position.set(o.pos.x, baseY + 3.6 * scale, o.pos.z);
        dummy.rotation.set((idx % 3 - 1) * 0.06, idx, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);

        // 3 crossed leaf-card planes per tree crown (volume from every camera angle!)
        for (let k = 0; k < 3; k++) {
          dummy.position.set(o.pos.x, baseY + 7.6 * scale, o.pos.z);
          dummy.rotation.set(k === 2 ? Math.PI / 2.2 : 0.12, idx * 0.5 + (k * Math.PI) / 3, 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          canopies.setMatrixAt(idx * 3 + k, dummy.matrix);
        }

        const np = o.sample.pos.clone().addScaledVector(o.sample.right, o.side * (this.halfWidth + 4.5 + (idx % 6)));
        const bs = 0.55 + (idx % 3) * 0.28;
        dummy.position.set(np.x, np.y + bs * 0.45, np.z);
        dummy.rotation.set(idx, idx * 0.7, 0);
        dummy.scale.set(bs * 1.2, bs * 0.75, bs);
        dummy.updateMatrix();
        rocks.setMatrixAt(idx, dummy.matrix);
      });
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      rocks.instanceMatrix.needsUpdate = true;
      this.group.add(trunks, canopies, rocks);
    }
  }

  getSampleAtT(t) {
    const norm = ((t % 1) + 1) % 1;
    const idx = Math.floor(norm * this.sampleCount) % this.sampleCount;
    return this.samples[idx];
  }

  /**
   * Fast nearest-sample lookup using optional hint index for O(1) tracking during driving.
   */
  getClosestSample(x, z, hintIdx = -1) {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIdx >= 0 && hintIdx < this.sampleCount) {
      const window = 24;
      for (let offset = -window; offset <= window; offset++) {
        const i = (hintIdx + offset + this.sampleCount) % this.sampleCount;
        const p = this.samples[i].pos;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
      if (bestDistSq < (this.halfWidth + 24) ** 2) {
        return this._buildProjection(bestIdx, x, z, Math.sqrt(bestDistSq));
      }
    }

    for (let i = 0; i < this.sampleCount; i++) {
      const p = this.samples[i].pos;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return this._buildProjection(bestIdx, x, z, Math.sqrt(bestDistSq));
  }

  _buildProjection(idx, x, z, dist) {
    const s = this.samples[idx];
    const dx = x - s.pos.x;
    const dz = z - s.pos.z;
    const lateral = dx * s.right.x + dz * s.right.z;
    return {
      idx,
      sample: s,
      t: s.t,
      dist,
      lateral,
      roadY: s.pos.y,
    };
  }
}
