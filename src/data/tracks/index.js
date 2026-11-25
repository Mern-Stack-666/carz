import track01 from './track01.js';
import track02 from './track02.js';
import track03 from './track03.js';
import track04 from './track04.js';
import track05 from './track05.js';

export const TRACKS = [track01, track02, track03, track04, track05];

export function getTrackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
