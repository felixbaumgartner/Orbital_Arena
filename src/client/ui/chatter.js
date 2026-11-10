// The two villages, the three acts of a match, and the one voice that
// tells the story: the lighthouse keeper who judges the Cup.

export const TEAMS = {
  red:  { village: 'Oostwijk',    club: 'Polder Aces', short: 'OOSTWIJK' },
  blue: { village: 'Westerhaven', club: 'Delft Kites', short: 'WESTERHAVEN' },
};

/** A match is three acts (rounds); named on the card between rounds */
export const ACTS = ['Act I · The opening ceremony', 'Act II · The long afternoon', 'Act III · The last light'];

export class Chatter {
  /** notify: Instruments.notify, playSound: Game.playSound */
  constructor(playSound, notify) {
    this.playSound = playSound || (() => {});
    this.notify = notify || (() => {});
  }

  /** The Keeper speaks. Top priority: it interrupts whatever else is on the line */
  guide(line) {
    this.notify({ key: 'story', pri: 5, who: 'The Keeper', title: `“${line}”`, ttl: 5600, story: true });
    this.playSound('radio');
  }
}
