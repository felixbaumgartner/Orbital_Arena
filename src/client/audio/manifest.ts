// Recorded sounds shipped in static/assets/audio. Each key lists its
// variants; one is picked at random per play so repeats never sound canned.
// Sources and licences: see CREDITS.md.

export const SFX_BASE = 'assets/audio/sfx/';
export const VOICE_BASE = 'assets/audio/voice/';
export const MUSIC_BASE = 'assets/audio/music/';

/** Sound effects: key -> file stems (mp3) */
export const SFX: Record<string, string[]> = {
  gun: ['gun_0', 'gun_1', 'gun_2', 'gun_3'],
  'gun-far': ['gun_far_0', 'gun_far_1', 'gun_far_2'],
  explosion: ['explosion_0', 'explosion_1', 'explosion_2', 'explosion_3', 'explosion_4'],
  boom: ['boom_0', 'boom_1'],
  'bullet-hit': ['hit_metal_0', 'hit_metal_1', 'hit_metal_2', 'hit_metal_3', 'hit_metal_4'],
  'hit-taken': ['hit_heavy_0', 'hit_heavy_1', 'hit_heavy_2', 'hit_heavy_3'],
  impact: ['impact_0', 'impact_1', 'impact_2'],
  rocket: ['rocket_0', 'rocket_1'],
};

/** Announcer and radio lines: key -> file stem */
export const VOICE: Record<string, string> = {
  one: 'one', two: 'two', three: 'three', fight: 'fight',
  round1: 'round_1', round2: 'round_2', round3: 'round_3',
  finalRound: 'final_round', suddenDeath: 'sudden_death',
  hurryUp: 'hurry_up', youWin: 'you_win', youLose: 'you_lose', tie: 'its_a_tie',
  flawless: 'flawless_victory', multiKill: 'multi_kill', objective: 'objective_achieved',
  levelUp: 'level_up',
  // radio calls (played through the radio filter)
  targetDestroyed: 'radio_target_destroyed', lookOut: 'radio_look_out',
  watchMyBack: 'radio_watch_my_back', fireInTheHole: 'radio_fire_in_the_hole',
  targetEngaged: 'radio_target_engaged', coverMe: 'radio_cover_me',
};

/** Short musical stingers */
export const STINGERS: Record<string, string> = {
  roundWin: 'sting_round_win', roundLose: 'sting_round_lose',
  victory: 'sting_victory', defeat: 'sting_defeat', levelUp: 'sting_level_up',
};

/** Looping music beds for the adaptive score */
export const MUSIC = {
  calm: 'carefree',
  combat: 'clash_defiant',
};
