import { useEffect } from 'react';
import { create } from 'zustand';
import type { WorldState } from '../protocol';
import { networkUpkeep } from './worldQueries';

export type Lighthouse = WorldState['lighthouses'][number];
export type Mood = 'Sick' | 'Worried' | 'Lonely' | 'Cheerful';
export const remarks: Record<Mood, readonly string[]> = {
  Sick: [
    'The fever makes the lantern stairs feel endless. Please send a doctor.',
    'I cannot tend the flame properly today. Is help on its way?',
    'A little medicine and rest would bring this light back to strength.',
    'My light is weaker tonight. I am doing what I can.',
    'I had to sit down halfway up the stairs again.',
    'The kettle is warm, but I cannot seem to shake this chill.',
    'Even polishing the lantern glass has worn me out today.',
    'I have left my coat by the door for the doctor to find me.',
    'A bowl of broth is waiting downstairs. So am I, between rounds.',
    'My hands are unsteady. Trimming the wick takes longer than usual.',
    'I miss being able to take those stairs two at a time.',
    'The logbook will have to wait. I need to rest my eyes.',
  ],
  Worried: [
    'I keep a spare wick ready. Let us hope we have fuel for it.',
    'The dark feels closer tonight. Will you tend to our light?',
    'Every drop of fuel is another moment of safe passage.',
    'I will stay by the lantern until the light returns.',
    'I have checked the oil gauge three times this watch.',
    'There are reefs out there that no sailor should meet in darkness.',
    'The spare lantern is beside the door. Old habits help me think.',
    'I keep listening for a hull scraping the rocks.',
    'I know every step to the lantern room, even with my eyes shut.',
    'The logbook is open. I hope the next entry brings better news.',
    'I have put away the kettle. There is too much on my mind for tea.',
    'A keeper learns patience. Nights like this put it to the test.',
  ],
  Lonely: [
    'My light is burning. I wish another would answer.',
    'The gulls are fine company, but they never stay for tea.',
    'I watch the horizon for a friendly light.',
    'Send my regards to Haven when the passage opens again.',
    'I laid two places at supper out of habit. It has been a while.',
    'The clock is very loud when there is nobody here to talk to.',
    'I have a letter ready for the next boat that calls.',
    'I named the gull on the railing. He still ignores me.',
    'Some evenings I read the logbook aloud for company.',
    'There is a spare chair by the stove, should anyone visit.',
    'I wonder what they are serving at the Haven inn tonight.',
    'I save the good biscuits for visitors. They are lasting far too long.',
  ],
  Cheerful: [
    'A bright lantern and friendly lights nearby. What more could I ask?',
    'Another safe passage! I shall put the kettle on.',
    'Look at those lights across the water. We are finding our way.',
    'The glass is polished and the flame is steady. A fine watch ahead!',
    'A passing crew waved this morning. That will keep me smiling all day.',
    'Fresh bread, hot tea, and a well-kept lantern. A good day at the tower.',
    'I can pick out our neighboring lights without opening the chart now.',
    'The brass is shining enough to see my grin in it.',
    'I have finally fixed that squeaky stair. Quiet rounds from now on!',
    'There is time for a second cup before the next inspection.',
    'I am teaching myself a tune on the concertina. The gulls seem doubtful.',
    'I wrote home today. It was a pleasure to have good news to share.',
  ],
};

export function keeperIdentity(light: Lighthouse) {
  return JSON.stringify([light.id, light.name, light.position.x, light.position.y]);
}

export function keeperName(light: Lighthouse) {
  let hash = 2166136261;
  for (const char of keeperIdentity(light)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const first = ['Mara', 'Elias', 'Nora', 'Jonas', 'Ada', 'Silas', 'Iris', 'Finn', 'Clara', 'Theo', 'Ruth', 'Owen'];
  const last = ['Reed', 'Hale', 'Marsh', 'Bell', 'Shaw', 'Ward', 'Pike', 'Gray', 'Vale', 'Brooks', 'Hart', 'Wells'];
  return `${first[hash % first.length]} ${last[Math.floor(hash / first.length) % last.length]}`;
}

export function keeperMood(world: WorldState, light: Lighthouse): Mood {
  if (light.sick) return 'Sick';
  if (!light.active || world.economy.blackout || world.economy.fuel < networkUpkeep(world) * 10) return 'Worried';
  return light.connected ? 'Cheerful' : 'Lonely';
}

export function pickRemark(mood: Mood, previous?: string, random = Math.random) {
  const choices = remarks[mood].filter(line => line !== previous);
  return choices[Math.floor(random() * choices.length)];
}

type Entry = { mood: Mood; remark: string; viewers: number };
const useKeepers = create<{ entries: Record<string, Entry> }>(() => ({ entries: {} }));

// Active presentations share a sentence; a fresh inspection gets another one.
function inspectKeeper(key: string, mood: Mood) {
  useKeepers.setState(({ entries }) => {
    const old = entries[key];
    return { entries: { ...entries, [key]: {
      mood, viewers: (old?.viewers ?? 0) + 1,
      remark: old?.viewers && old.mood === mood ? old.remark : pickRemark(mood, old?.remark),
    } } };
  });
  return () => useKeepers.setState(({ entries }) => ({
    entries: { ...entries, [key]: { ...entries[key], viewers: entries[key].viewers - 1 } },
  }));
}

export function useKeeperRemark(light: Lighthouse, mood: Mood) {
  const key = keeperIdentity(light);
  const entry = useKeepers(state => state.entries[key]);
  useEffect(() => inspectKeeper(key, mood), [key, mood]);
  return entry?.mood === mood ? entry.remark : null;
}
