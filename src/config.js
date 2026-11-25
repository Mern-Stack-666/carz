/**
 * Central tunable configuration for Raftaar Nitro.
 * Adjust 3D rigid-body physics, suspension, nitro economy, camera feel, AI, and graphics presets here.
 */
export const CONFIG = {
  // Full 3D Rigid-Body & RaycastVehicle Physics (cannon-es)
  physics: {
    gravity: -24,             // Punchy arcade gravity (m/s^2)
    fixedTimeStep: 1 / 60,
    maxSubSteps: 2,
    chassisMass: 220,         // kg
    chassisHalfExtents: [0.95, 0.25, 2.05],
    wheelRadius: 0.42,
    suspensionStiffness: 65,
    suspensionRestLength: 0.50,
    maxSuspensionTravel: 0.36,
    dampingRelaxation: 4.5,
    dampingCompression: 5.5,
    rollInfluence: 0.05,      // Keeps cars planted on fast corners while leaning naturally
    normalFrictionSlip: 5.4,  // Tire grip when driving normally
    driftFrictionSlip: 1.75,  // Rear tire slip when drifting (Space)
    baseMaxSpeed: 46,         // world units/sec (~165 km/h for stat 4)
    speedPerStat: 4.5,        // extra units/sec per speed stat point (1..10)
    baseEngineForce: 1750,    // wheel force (N)
    forcePerSpeedStat: 145,
    brakeForce: 58,           // per-wheel brake force
    reverseMaxSpeed: 18,
    maxSteerAngle: 0.46,      // radians at low speed
    highSpeedSteerFade: 0.52, // steering tapers smoothly at top speed
    driftBoostThreshold: 0.65,// seconds of sustained drift to earn nitro bonus
    wallFriction: 0.06,       // low friction so cars scrape along guardrails smoothly
    wallRestitution: 0.32,
    carRestitution: 0.42,
    kmhScale: 3.6,            // conversion factor from m/s to displayed km/h
    stuckSpeedThreshold: 1.5,
    stuckResetTime: 3.0,      // seconds stuck before auto-reset to checkpoint
  },

  // Nitro Boost & Currency Economy
  nitro: {
    baseCapacity: 60,
    capacityPerStat: 12,
    drainPerSec: 26,
    minToActivate: 6,
    boostSpeedMult: 1.28,
    boostForceMult: 1.65,
    pickupTankFill: 32,
    pickupCoins: 15,
    riskyPickupCoins: 30,
    driftCoinRate: 12,
    driftTankRate: 14,
    overtakeCoins: 20,
    overtakeTankFill: 10,
    podiumRewards: [120, 80, 55, 35, 25, 15],
  },

  // Camera & Raftaar Pulse Effects
  camera: {
    modes: ['chase', 'far', 'hood'],
    chase: { distance: 8.4, height: 3.4, lookAhead: 5.5, lerp: 8.0 },
    far: { distance: 12.4, height: 5.0, lookAhead: 7.0, lerp: 6.8 },
    hood: { forwardOffset: 0.55, height: 1.15, lookAhead: 16.0, lerp: 24.0 },
    topDown: { height: 58, lookAhead: 4.0, lerp: 8.5 },
    baseFov: 64,
    maxSpeedFovAdd: 11,
    boostFovAdd: 9,
    boostShakeIntensity: 0.14,
    collisionShakeIntensity: 0.30,
  },

  // AI Opponents
  ai: {
    count: 5,
    difficulties: {
      easy: { speedMult: 0.78, cornerSkill: 0.75, rubberBand: 0.08, label: 'Easy' },
      medium: { speedMult: 0.90, cornerSkill: 0.88, rubberBand: 0.12, label: 'Medium' },
      hard: { speedMult: 1.01, cornerSkill: 0.96, rubberBand: 0.16, label: 'Hard' },
    },
    lookAheadDist: 17,
    avoidanceRadius: 3.8,
  },

  // Graphics Quality Presets
  graphics: {
    low: { label: 'Low (30+ FPS Mobile)', pixelRatio: 0.9, shadows: false, bloom: false, particles: 0.35, drawDist: 280 },
    medium: { label: 'Medium (60 FPS Smooth)', pixelRatio: 1.0, shadows: false, bloom: false, shadowSize: 1024, particles: 0.7, drawDist: 420 },
    high: { label: 'High (Shadows + Bloom)', pixelRatio: 1.5, shadows: true, bloom: true, shadowSize: 1024, particles: 1.0, drawDist: 620 },
  },

  saveKey: 'raftaar_nitro_save_v1',
  saveVersion: 1,
};

/**
 * Derive physical vehicle stats from a car's 1-10 ratings.
 */
export function computeCarPhysics(carData) {
  const p = CONFIG.physics;
  const n = CONFIG.nitro;
  return {
    maxSpeed: p.baseMaxSpeed + carData.stats.speed * p.speedPerStat,
    engineForce: p.baseEngineForce + carData.stats.speed * p.forcePerSpeedStat,
    steerRate: 0.82 + carData.stats.handling * 0.045,
    gripFactor: 0.84 + carData.stats.handling * 0.032,
    nitroCapacity: n.baseCapacity + carData.stats.nitro * n.capacityPerStat,
  };
}
