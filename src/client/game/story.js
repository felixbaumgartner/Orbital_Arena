// The story, told by one voice. Two villages fly for the Windmill Cup and
// the lighthouse keeper who judges it speaks three times in a match: when
// it opens, when it turns, and at last light. Also the dip to black that
// covers every jump across the map.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import { TEAMS } from '../ui/chatter.js';

export class StoryMethods {
  // =========================================================================
  // THE KEEPER
  // =========================================================================

  /** Says a beat's line, at most once per match */
  storyBeat(beat) {
    if (!this.localPlayer || this.matchOver || this.storyDone.has(beat)) return;
    const line = this.storyLine(beat);
    if (!line || !this.chatter) return;
    this.storyDone.add(beat);
    this.chatter.guide(line);
  }

  storyLine(beat) {
    const my = this.localPlayer.team, foe = my === 'red' ? 'blue' : 'red';
    const tdm = this.mode === 'tdm';
    const wins = this.roundWins || { red: 0, blue: 0 };
    if (beat === 'opening') {
      return tdm
        ? `No mills today. First village to ${this.rules.tdmTarget || 30} shoot-downs takes the Cup.`
        : 'Ninety-one years, one Cup. Hold the mills till my bell rings.';
    }
    if (beat === 'turning') {
      if (wins[my] > wins[foe]) return `First round to ${TEAMS[my].village}. One more and the Cup is yours.`;
      if (wins[my] < wins[foe]) return `${TEAMS[foe].village} lead. Take this round or lose the Cup.`;
      return 'All square. Everything still to fly for.';
    }
    if (beat === 'last') {
      return tdm ? 'Last light. This round decides the Cup.' : 'Last light. Mills count double. The whole village is watching.';
    }
    return null;
  }

  /** Which beat belongs to the round being played */
  beatForRound() {
    if (this.round <= 1) return 'opening';
    return this.round >= (this.rules.maxRounds || 3) || this.suddenDeath ? 'last' : 'turning';
  }

  /** Queues the round's line for just after the countdown clears */
  scheduleStory(extraMs = 1500) {
    clearTimeout(this.storyTimer);
    const wait = Math.max(0, (this.countdownEndsAt || 0) - performance.now()) + extraMs;
    this.storyTimer = setTimeout(() => {
      // Flight school has the floor on a first flight; the line follows it
      if (!this.onboarding) this.storyBeat(this.beatForRound());
    }, wait);
  }

  /** The Keeper's verdict for the end screen */
  storyCloser(winner) {
    if (!winner) return 'A draw. Both villages bake.';
    const mine = winner === this.localPlayer?.team;
    return mine ? `The Cup goes to ${TEAMS[winner].village}.` : `The Cup goes to ${TEAMS[winner].village}. Next year.`;
  }

  // =========================================================================
  // FLAVOUR: landmark and windmill lore
  // =========================================================================

  /** Lore waits for a quiet moment: not early, not mid-fight, once a round */
  loreOk() {
    const now = this.animationTime;
    return this.controlsEnabled && !this.onboarding && !this.dead
      && now - (this.airborneAt ?? now) > 40
      && now - (this.lastCombatAt ?? -99) > 8
      && this.loreRound !== this.round
      && !this.instruments.busy();
  }

  lore(icon, title, sub) {
    this.loreRound = this.round;
    this.instruments.notify({ key: 'lore', pri: 0, icon, title, sub, ttl: 5200 });
  }

  // =========================================================================
  // CURTAIN
  // =========================================================================

  /**
   * Dips to black, runs `mid` while nothing can be seen, and comes back.
   * With hold, the screen stays dark until curtainRelease().
   */
  curtain(mid, hold = false) {
    const el = document.getElementById('curtain');
    if (!el) { if (mid) mid(); return; }
    if (mid) this.curtainJobs.push(mid);
    if (hold) this.curtainHeld = true;
    el.classList.add('on');
    if (this.curtainTimer) return;
    this.curtainTimer = setTimeout(() => {
      this.curtainTimer = null;
      const jobs = this.curtainJobs.splice(0);
      for (const job of jobs) { try { job(); } catch (e) { console.error('curtain job failed', e); } }
      if (this.curtainHeld) {
        // Never leave the player in the dark if the release is missed
        clearTimeout(this.curtainFailsafe);
        this.curtainFailsafe = setTimeout(() => this.curtainRelease(), 6000);
      } else {
        el.classList.remove('on');
      }
    }, 190);
  }

  curtainRelease() {
    this.curtainHeld = false;
    clearTimeout(this.curtainFailsafe);
    if (this.curtainTimer) return; // still closing: it opens by itself when the jobs have run
    const el = document.getElementById('curtain');
    if (el) el.classList.remove('on');
  }
}
