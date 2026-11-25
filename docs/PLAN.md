# Raftaar Nitro — Architecture & Game Design Plan

## Concept
**Raftaar Nitro** is an original browser-based 3D arcade racing game built with **Vite + Vanilla ES Modules + Three.js**.
- **Core Hook (Nitro-as-Currency):** Collecting nitro pickups, drifting, and overtaking fills your in-race **Boost Tank** *and* adds **Nitro Coins** to your persistent wallet to unlock faster original cars in the Garage.
- **Modes:** Quick Race (against 5 AI rivals on Easy/Medium/Hard) & Time Trial (chase your own saved Best Lap Ghost). Also includes an optional **2D Mini Rush** top-down view mode in Settings.
- **5 Original Tracks:**
  1. **Dhool Valley** (Desert Canyon Sunset — Easy, 3 laps, unlocked)
  2. **Sheher Raat** (Neon City Night — Medium, 3 laps, unlock: Top 3 in Dhool Valley)
  3. **Sahil Highway** (Coastal Sunset — Medium, 3 laps, unlock: Top 3 in Sheher Raat)
  4. **Barfani Dara** (Snowy Mountain Pass — Hard, 3 laps, unlock: Top 3 in Sahil Highway)
  5. **Jungle Mod** (Jungle Hills & Mud — Hard, 3 laps, unlock: Top 3 in Barfani Dara)
- **6 Original Cars (Invented Brands):**
  1. **Jugnu** (*Sitara Motors*) — Hatchback — Free (0 Nitro)
  2. **Dhool Runner** (*Khyber Offroad*) — Off-road Buggy — 400 Nitro
  3. **Sheher Cruiser** (*Nawaab Auto*) — Sport Sedan — 900 Nitro
  4. **Barq GT** (*Zafar Dynamics*) — Sports Coupe — 1800 Nitro
  5. **Shaheen** (*Loha Works*) — Muscle Car — 3000 Nitro
  6. **Toofan X** (*Parwaaz Aero*) — Hypercar — 5000 Nitro

## Folder Structure
```text
raftaar-nitro/
├── index.html
├── package.json
├── vite.config.js
├── docs/
│   ├── PLAN.md
│   ├── PROMPTS.md
│   └── CREDITS.md
└── src/
    ├── main.js
    ├── config.js
    ├── style.css
    ├── data/
    │   ├── cars.js
    │   └── tracks/
    │       ├── index.js
    │       ├── track01.js (Dhool Valley)
    │       ├── track02.js (Sheher Raat)
    │       ├── track03.js (Sahil Highway)
    │       ├── track04.js (Barfani Dara)
    │       └── track05.js (Jungle Mod)
    ├── game/
    │   ├── Game.js
    │   ├── Car.js
    │   ├── CarModels.js
    │   ├── Track.js
    │   ├── Nitro.js
    │   ├── AI.js
    │   ├── Camera.js
    │   └── Particles.js
    ├── systems/
    │   ├── input.js
    │   ├── save.js
    │   └── audio.js
    └── ui/
        ├── menu.js
        ├── hud.js
        └── garage.js
```
