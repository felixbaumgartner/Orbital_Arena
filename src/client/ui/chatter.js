// The two sides as the player sees them, the three raids of a match, and
// the one voice that tells the story: the miller on the village radio.
// Whichever team the server puts you on, on your screen you are the village
// and the other team are the raiders.

export const SIDES = {
  us:   { name: 'the village', short: 'VILLAGE', css: '#6bb6ff', hex: 0x3ea0ff },
  them: { name: 'the raiders', short: 'RAIDERS', css: '#ff6257', hex: 0xff3b30 },
};

/** A match is three raids (rounds); named on the card between rounds */
export const ACTS = ['First raid', 'Second raid', 'Final raid'];

export class Chatter {
  /** notify: Instruments.notify, playSound: Game.playSound */
  constructor(playSound, notify) {
    this.playSound = playSound || (() => {});
    this.notify = notify || (() => {});
  }

  /** The miller speaks. Top priority: it interrupts whatever else is on the line */
  guide(line) {
    this.notify({ key: 'story', pri: 5, who: 'The Miller', title: `“${line}”`, ttl: 5600, story: true });
    this.playSound('radio');
  }
}
