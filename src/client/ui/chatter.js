// Radio chatter: the bots are a recurring cast with personalities. Lines
// are short, skippable, and fire only on moments the game already has.

export const TEAMS = {
  red:  { village: 'Oostwijk',    club: 'Polder Aces', short: 'OOSTWIJK' },
  blue: { village: 'Westerhaven', club: 'Delft Kites', short: 'WESTERHAVEN' },
};

export const CAST = {
  Femke: { role: 'the ace', lines: {
    hello: ['Femke here. Try to keep up.'],
    killedYou: ['Nice try, farm boy.', 'That one\'s going in my scrapbook.', 'Femke one. You: still learning.'],
    youKilledThem: ['Lucky. Won\'t happen twice.', 'Fine. FINE. Enjoy it.'],
    capture: ['Mill\'s ours. Put the kettle on.'],
    lost: ['Who let them near my mill?'],
    streak: ['Getting warmed up.'],
    win: ['Told you. The flour is ours.'],
    lose: ['Rematch. Now.'],
    storm: ['Rain. Good. I fly better angry.'],
    night: ['Lights on, everyone. I\'m still hunting.'],
  } },
  Daan: { role: 'the rookie', lines: {
    hello: ['Daan here! First Cup. Please don\'t shoot me.'],
    killedYou: ['Sorry! Sorry, was that you?', 'I did not mean to hit that. Sorry!'],
    youKilledThem: ['Ow. Okay. Okay, I\'m learning.', 'My mum is watching this, you know.'],
    capture: ['I captured one! Is that a mill? That\'s a mill!'],
    lost: ['Oh no, oh no, oh no.'],
    streak: ['Three?! Someone write this down!'],
    win: ['We won? WE WON!'],
    lose: ['Next year. Definitely next year.'],
    storm: ['Is it supposed to rain THIS much?'],
    night: ['It\'s getting dark. Is that allowed?'],
  } },
  Bram: { role: 'the veteran', lines: {
    hello: ['Bram. Forty Cups. Don\'t waste my time.'],
    killedYou: ['That\'s how we did it in \'86.', 'Sit down, kid.'],
    youKilledThem: ['Hm. Not bad. Once.', 'My plane was older than your parents.'],
    capture: ['Mill secured. Like clockwork.'],
    lost: ['In my day we HELD the mills.'],
    streak: ['Still got it.'],
    win: ['As expected. Someone fetch my coffee.'],
    lose: ['Robbed. The wind was wrong.'],
    storm: ['Sea storm. Told the committee. Nobody listens.'],
    night: ['Too dark for this nonsense.'],
  } },
  Lotte: { role: 'the optimist', lines: {
    hello: ['Lotte! Gorgeous day for a Cup, isn\'t it?'],
    killedYou: ['Sorry, love! Beautiful crash though.'],
    youKilledThem: ['Ooh, well flown! Do it again, I wasn\'t looking.'],
    capture: ['Look at those tulips from up here!'],
    lost: ['Ah well. There are four more.'],
    streak: ['This is going rather well!'],
    win: ['Cake for everyone!'],
    lose: ['Lovely match. Pity about the losing.'],
    storm: ['Rain on the tulips. They\'ll love it.'],
    night: ['Oh, the lights on the canal. Look!'],
  } },
  Jesse: { role: 'the show-off', lines: {
    hello: ['Jesse. You\'ve heard of me.'],
    killedYou: ['Did everyone see that? Everyone saw that.', 'Textbook. I wrote the textbook.'],
    youKilledThem: ['Sun was in my eyes.', 'Lag. Definitely lag.'],
    capture: ['Barrel roll over the mill. Nobody asked. Did it anyway.'],
    lost: ['I was doing a thing. Give me a second.'],
    streak: ['Highlight reel, coming up.'],
    win: ['Carried. You\'re welcome.'],
    lose: ['I had, like, six kills. Not my fault.'],
    storm: ['Storm run. Watch this.'],
    night: ['Night flying. My best angle.'],
  } },
  Sanne: { role: 'the strategist', lines: {
    hello: ['Sanne on comms. Stay on the mills, not the kills.'],
    killedYou: ['You flew straight. Don\'t fly straight.'],
    youKilledThem: ['Noted. Adjusting.'],
    capture: ['That\'s two. Hold them, don\'t chase.'],
    lost: ['We overextended. Fall back to Hill.'],
    streak: ['Efficient.'],
    win: ['Good discipline, everyone.'],
    lose: ['We lost the canal early. That was the match.'],
    storm: ['Radar\'s short in this. Stay close.'],
    night: ['Lights make you a target. Fly low.'],
  } },
  Ruben: { role: 'the nervous one', lines: {
    hello: ['Ruben here. Everything\'s fine. Probably.'],
    killedYou: ['Was that a hit? That was a hit. Oh.'],
    youKilledThem: ['Bailing! Bailing! ...I\'m okay.'],
    capture: ['Got the mill! Can I go home now?'],
    lost: ['They took it. They just took it.'],
    streak: ['Three? I\'d like to stop now.'],
    win: ['We won and nobody yelled at me!'],
    lose: ['I knew it. I knew it.'],
    storm: ['Lightning. Near planes. Great.'],
    night: ['I can\'t see. Can anyone see?'],
  } },
  Anouk: { role: 'the competitor', lines: {
    hello: ['Anouk. Let\'s make this quick.'],
    killedYou: ['Down. Next.'],
    youKilledThem: ['Good. I needed a reason.'],
    capture: ['Mill. Moving on.'],
    lost: ['Unacceptable. Retaking.'],
    streak: ['Keep them coming.'],
    win: ['Expected.'],
    lose: ['Again. Tomorrow. Earlier.'],
    storm: ['Weather\'s an excuse. Fly.'],
    night: ['Dark suits me.'],
  } },
  Thijs: { role: 'the joker', lines: {
    hello: ['Thijs here. I brought snacks. Not sharing.'],
    killedYou: ['Boop.', 'And that\'s why we can\'t have nice planes.'],
    youKilledThem: ['I meant to do that. Part of a bit.'],
    capture: ['Mill\'s ours. I\'m naming it Gerald.'],
    lost: ['They took Gerald!'],
    streak: ['Is this what winning feels like? Weird.'],
    win: ['Snacks for the winners! Still not sharing.'],
    lose: ['We\'ll get them next Cup. Or the one after.'],
    storm: ['Free plane wash!'],
    night: ['Who turned the lights off?'],
  } },
  Maud: { role: 'the precise one', lines: {
    hello: ['Maud. Checklist complete.'],
    killedYou: ['Four hits. As calculated.'],
    youKilledThem: ['Error in my approach. Correcting.'],
    capture: ['Capture at 100 percent. Proceeding.'],
    lost: ['Loss logged.'],
    streak: ['Three consecutive. Within parameters.'],
    win: ['Result as forecast.'],
    lose: ['Result outside forecast. Reviewing.'],
    storm: ['Visibility reduced 45 percent. Adjusting.'],
    night: ['Switching to lights. Expected.'],
  } },
  Koen: { role: 'the slow talker', lines: {
    hello: ['Koen. ...Hello.'],
    killedYou: ['...Got one.'],
    youKilledThem: ['...Right then.'],
    capture: ['...Mill.'],
    lost: ['...Hm.'],
    streak: ['...Three, they say.'],
    win: ['...Nice.'],
    lose: ['...Next time.'],
    storm: ['...Wet.'],
    night: ['...Dark.'],
  } },
  Fleur: { role: 'the poet', lines: {
    hello: ['Fleur. The sky is a page. Let\'s write on it.'],
    killedYou: ['You fell like a petal. Gently, then all at once.'],
    youKilledThem: ['Every ending is a runway.'],
    capture: ['The sails turn for us now.'],
    lost: ['Sails turn for anyone. That\'s their nature.'],
    streak: ['The wind remembers my name today.'],
    win: ['The bells will ring for us.'],
    lose: ['The bells ring for them. They sound the same.'],
    storm: ['The sea has come to watch.'],
    night: ['Stars above the polder. Worth a Cup on its own.'],
  } },
};

export class Chatter {
  constructor(playSound) {
    this.playSound = playSound || (() => {});
    this.el = document.getElementById('radio');
    this.lastAt = -1e9;
    this.minGap = 7000;
    this.timer = null;
  }

  /** Bots only; drops the line if the radio is busy */
  say(name, team, event, force = false) {
    const cast = CAST[name];
    if (!cast || !this.el) return false;
    const pool = cast.lines[event];
    if (!pool || !pool.length) return false;
    const now = performance.now();
    if (!force && now - this.lastAt < this.minGap) return false;
    this.lastAt = now;
    const line = pool[Math.floor(Math.random() * pool.length)];
    const club = TEAMS[team] ? TEAMS[team].club : '';
    this.el.querySelector('.radio-who').textContent = `${name.toUpperCase()} · ${club}`;
    this.el.querySelector('.radio-line').textContent = `“${line}”`;
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('show'), 5200);
    this.playSound('radio');
    return true;
  }
}
