import { TRACKS } from './tracks/index.js';

/**
 * Deterministic 1,000-Level Campaign Generator for Raftaar Nitro.
 * Combines all 5 circuits, scaling lap counts (1-5 laps), AI speed/skill progression,
 * milestone Boss races every 10 levels, and escalating Nitro Coin prizes.
 */
export const TOTAL_LEVELS = 1000;

const CHAPTERS = [
  'Rookie Horizon Cup',
  'Desert & Neon Circuit',
  'Coastal Sprint Series',
  'Alpine Drift Masters',
  'Emerald Jump Challenge',
  'Grand Tourer Pro',
  'Midnight Apex Tour',
  'Supercar Showdown',
  'Hypercar Elite',
  'Badshah Championship',
];

export function getChapterName(levelNum) {
  const idx = Math.min(CHAPTERS.length - 1, Math.floor((levelNum - 1) / 100));
  return CHAPTERS[idx];
}

export function getLevelConfig(levelNum) {
  const lv = Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(Number(levelNum) || 1)));
  const isBoss = lv % 10 === 0;
  const isMegaBoss = lv % 50 === 0 || lv === TOTAL_LEVELS;

  // Cycle cleanly across all 5 tracks, shifting offset per chapter so consecutive chapters feel fresh
  const chapterIdx = Math.floor((lv - 1) / 100);
  const track = TRACKS[(lv - 1 + chapterIdx) % TRACKS.length];

  // Lap-based progression inside each level:
  // Early/sprint levels = 1-2 laps, standard = 2-3 laps, Boss = 3-5 laps
  let laps = 2;
  if (lv <= 5) laps = 1;
  else if (isMegaBoss) laps = lv >= 500 ? 5 : 4;
  else if (isBoss) laps = 3;
  else if (lv % 3 === 0 && lv > 20) laps = 3;
  else if (lv % 4 === 1 && lv < 150) laps = 1;

  // Smooth AI skill curve from 0.72 (Level 1) to 1.14 (Level 1000)
  const progress = (lv - 1) / (TOTAL_LEVELS - 1);
  const aiSkillBase = 0.72 + progress * 0.42 + (isBoss ? 0.03 : 0);
  const difficulty = lv < 150 ? 'easy' : lv < 550 ? 'medium' : 'hard';

  // Target rank required to clear the level & unlock next level
  const targetRank = isBoss ? 1 : lv <= 10 ? 4 : 3;

  // Nitro Coin rewards scale steadily so players earn supercars & hypercars across the campaign
  const clearBonus = 50 + Math.round(lv * 1.8) + (isBoss ? 120 : 0) + (isMegaBoss ? 250 : 0);

  return {
    level: lv,
    title: isMegaBoss
      ? `Mega Boss #${lv}`
      : isBoss
        ? `Boss Stage #${lv}`
        : `Level ${lv}`,
    chapter: getChapterName(lv),
    track,
    laps,
    difficulty,
    aiSkillBase,
    targetRank,
    isBoss,
    isMegaBoss,
    clearBonus,
  };
}
