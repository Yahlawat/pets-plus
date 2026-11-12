// Pets+ species: how each kind of pet moves, what it does when left alone, and how
// it reacts. Plain data; the moves themselves live in panel.js.
//
// speed    multiplier on walking speed
// energy   0 to 1: how much it runs and plays rather than sits and lies
// gait     walk | hop | leap | waddle | sideways | scuttle | slither | float | trail
// climbs   has wall sprites (wallclimb, wallgrab, fall_from_grab, land)
// chaser   chases climbers up the walls
// thief    steals treats and the ball
// fetch    brings the ball back
// nocturnal  stays up after 8 pm local time while the others nap
// swipes   bats at pets walking past
// flips    lands on its back when dropped, and needs help to get up
// quirks   { move, w (weight), lines, anim, ms }. Moves: climb, wallnap, walldig, pose,
//          zoomies, pounce, rummage, binky, sniff, roll, stash, flip, catchFly, alert,
//          peck, rattle, wag
// react    per-event: errorsUp (climb | hide | stay | bark | flee), commit (party |
//          yawn | zoomies | binky), petted (aloof | wag), with optional lines
(function () {
  const q = (move, w, lines = [], extra = {}) => ({ move, w, lines, ...extra });

  const SPECIES = {
    cat: {
      speed: 1, energy: 0.45, gait: 'walk', climbs: true, swipes: true,
      quirks: [
        q('climb', 4, ['😼']),
        q('pose', 3, ['*licks paw*', '*grooms*', '*washes face*'], { anim: 'idle', ms: 4000 }),
        q('pose', 2, ['👀 ...?', '*stares at nothing*'], { anim: 'idle', ms: 3500 }),
        q('pose', 2, ['*loafs*', '*kneads*'], { anim: 'lie', ms: 9000 }),
        q('zoomies', 1.5, ['!!!', '*3am energy*']),
      ],
      react: { errorsUp: 'climb', commit: 'yawn', petted: 'aloof', lines: { errorsUp: ['😾', 'nope'] } },
      lines: ['meow', 'purr', '*stretches*', 'feed me at 3am?', 'that keyboard looks warm', 'mrrp'],
    },
    dog: {
      speed: 1.15, energy: 0.8, gait: 'walk', chaser: true, fetch: true,
      quirks: [
        q('sniff', 3, ['*sniff sniff*', 'smells like code']),
        q('zoomies', 2, ['zoom!', 'ZOOMIES']),
        q('roll', 2, ['*rolls over*', 'belly rub?']),
        q('wag', 1, ['*wags*', '❤']),
      ],
      react: { errorsUp: 'bark', commit: 'zoomies', petted: 'wag', lines: { errorsUp: ['woof?!', 'bark!'] } },
      lines: ['woof!', 'ball? ball?', 'good human', 'walk?'],
    },
    fox: {
      speed: 1.1, energy: 0.6, gait: 'walk', chaser: true, nocturnal: true,
      quirks: [
        q('pounce', 4, ['🐭?', '*pounce*', 'missed', 'got... nothing']),
        q('sniff', 2, ['*sniff*', '*ears twitch*']),
        q('pose', 1, ['*ears up*', '👂'], { anim: 'idle', ms: 2500 }),
        q('zoomies', 0.7, ['yip yip!']),
      ],
      react: { errorsUp: 'flee', lines: { errorsUp: ['yip!'] } },
      lines: ['yip!', '*sniff sniff*', 'what does the fox say', '🦊'],
    },
    turtle: {
      speed: 0.45, energy: 0.15, gait: 'walk', flips: true,
      quirks: [
        q('pose', 3, ['🐢 ...', '*hides in shell*'], { anim: 'lie', ms: 10000 }),
        q('pose', 2, ['☀️ *sunbathes*', 'warm'], { anim: 'lie', ms: 9000 }),
        q('flip', 0.4),
      ],
      react: { errorsUp: 'hide', lines: { errorsUp: ['*hides in shell*', '🐢'] } },
      lines: ['slow and steady', '🐢', 'no rush', 'one step at a time'],
    },
    raccoon: {
      speed: 0.9, energy: 0.5, gait: 'walk', thief: true, nocturnal: true,
      quirks: [
        q('rummage', 4, ['found: 🥫', 'found: 🔩', 'found: 🧦', 'found: 🍕', 'found: a semicolon', 'found: an old TODO']),
        q('pose', 2, ['*washes paws*', '*rubs hands*'], { anim: 'swipe', ms: 3500 }),
        q('sniff', 1, ['*sniff*']),
      ],
      react: { errorsUp: 'stay', lines: { errorsUp: ['ooh, bugs', "I'll check the trash for it"] } },
      lines: ['trash? 👀', '*rummages*', 'any snacks in node_modules?', 'mine'],
    },
    squirrel: {
      speed: 1.3, energy: 0.85, gait: 'walk', climbs: true,
      quirks: [
        q('climb', 3, ['!']),
        q('wallnap', 1.5, ['*naps on the wall*']),
        q('walldig', 1.5, ['*digs*']),
        q('stash', 2, ['🌰 stashed', 'for winter', 'nobody saw that']),
        q('zoomies', 1, ['*chitter*']),
      ],
      react: { errorsUp: 'climb', lines: { errorsUp: ['!!'] } },
      lines: ['acorn?!', '*chitter*', 'nuts.'],
    },
    totoro: {
      speed: 0.8, energy: 0.4, gait: 'walk', climbs: true,
      quirks: [q('climb', 2), q('binky', 2, ['*big hop*']), q('pose', 2, ['*yawns*'], { anim: 'lie', ms: 8000 })],
      react: { errorsUp: 'climb' },
      lines: ['🌳', '*rumble*'],
    },
    bunny: {
      speed: 1, energy: 0.6, gait: 'hop',
      quirks: [
        q('binky', 3, ['binky!', '✨']),
        q('alert', 2, ['!', '*ears up*']),
        q('pose', 1, ['*nose wiggle*'], { anim: 'idle', ms: 3000 }),
      ],
      react: { errorsUp: 'flee', commit: 'binky' },
      lines: ['*nose wiggle*', '*thump*', '🥕?'],
    },
    frog: {
      speed: 1, energy: 0.5, gait: 'leap',
      quirks: [q('catchFly', 3, ['👅 *gulp*', 'tasty bug']), q('pose', 1, ['ribbit'], { anim: 'idle', ms: 2500 })],
      react: { commit: 'binky', lines: { errorsUp: ['ribbit?'] } },
      lines: ['ribbit', 'croak', 'bugs? where?'],
    },
    chicken: {
      speed: 0.9, energy: 0.5, gait: 'waddle',
      quirks: [q('peck', 4, ['*peck peck*']), q('pose', 1, ['bawk!'], { anim: 'idle', ms: 2000 })],
      lines: ['bawk', 'cluck', '*pecks*'],
    },
    cockatiel: {
      speed: 0.9, energy: 0.55, gait: 'waddle',
      quirks: [q('pose', 2, ['♪♫', '*whistles*'], { anim: 'idle', ms: 3000 }), q('peck', 2, ['*preens*']), q('binky', 1, ['*flutters*'])],
      lines: ['♪', '*whistle*', 'pretty bird'],
    },
    'rubber-duck': {
      speed: 0.7, energy: 0.3, gait: 'waddle',
      quirks: [q('pose', 3, ['quack', 'explain it to me', 'what does line 12 do?'], { anim: 'idle', ms: 3000 })],
      react: { errorsUp: 'stay', lines: { errorsUp: ['tell me about the bug', 'explain it line by line', 'quack?'] } },
      lines: ['quack', 'tell me about your bug', 'explain it line by line'],
    },
    snake: {
      speed: 0.8, energy: 0.35, gait: 'slither',
      quirks: [q('pose', 2, ['ssss', '*coils*'], { anim: 'lie', ms: 7000 }), q('sniff', 1, ['*tastes the air*'])],
      react: { errorsUp: 'stay', lines: { errorsUp: ['hiss!'] } },
      lines: ['ssss', 'import this'],
    },
    crab: {
      speed: 0.8, energy: 0.5, gait: 'sideways',
      quirks: [q('pose', 2, ['snip snip', '🦀'], { anim: 'swipe', ms: 2000 })],
      lines: ['🦀', 'rewrite it in rust?', 'snip'],
    },
    rat: {
      speed: 1.2, energy: 0.7, gait: 'scuttle',
      quirks: [q('sniff', 3, ['*sniff*', '*whiskers twitch*']), q('rummage', 1, ['found: 🧀', 'found: a crumb'])],
      lines: ['squeak', '🧀?'],
    },
    snail: {
      speed: 0.25, energy: 0.05, gait: 'trail',
      quirks: [q('pose', 2, ['...', '*retracts*'], { anim: 'lie', ms: 9000 })],
      lines: ['...', 'almost there', 'eventually'],
    },
    horse: {
      speed: 1.4, energy: 0.7, gait: 'walk',
      quirks: [q('alert', 2, ['neigh!', '*rears up*']), q('zoomies', 2, ['*gallops*'])],
      lines: ['neigh', '*snort*'],
    },
    skeleton: {
      speed: 0.9, energy: 0.5, gait: 'walk',
      quirks: [q('rattle', 3, ['*rattle*', 'spooky']), q('alert', 1, ['boo'])],
      lines: ['*rattle*', 'bare bones'],
    },
    panda: {
      speed: 0.7, energy: 0.3, gait: 'walk',
      quirks: [
        q('roll', 3, ['*rolls*']),
        q('pose', 2, ['🎋 *munch*'], { anim: 'idle', ms: 5000 }),
        q('pose', 1, ['*flops*'], { anim: 'lie', ms: 9000 }),
      ],
      lines: ['bamboo?', '*rolls*'],
    },
    monkey: {
      speed: 1.1, energy: 0.8, gait: 'walk',
      quirks: [q('binky', 3, ['ooh ooh!', 'eee!']), q('zoomies', 1), q('pose', 1, ['🍌?'], { anim: 'idle', ms: 2500 })],
      lines: ['ooh ooh', '🍌'],
    },
    clippy: {
      speed: 0.8, energy: 0.4, gait: 'float',
      quirks: [q('pose', 3, ["It looks like you're writing code.", 'Need help with that?', 'Would you like to save?'], { anim: 'idle', ms: 3500 })],
      react: { errorsUp: 'stay', lines: { errorsUp: ['It looks like you have an error!'] } },
      lines: ["looks like you're writing code", 'need help?'],
    },
    deno: {
      speed: 0.9, energy: 0.5, gait: 'walk',
      quirks: [q('pose', 2, ['rawr', 'deno run?'], { anim: 'idle', ms: 2500 }), q('zoomies', 1)],
      lines: ['rawr', '🦕'],
    },
    mod: {
      speed: 1, energy: 0.5, gait: 'float',
      quirks: [q('pose', 2, ['dotnet run?', 'beep boop'], { anim: 'idle', ms: 2500 })],
      lines: ['beep', 'compiling...'],
    },
    morph: {
      speed: 0.8, energy: 0.5, gait: 'float',
      quirks: [q('rattle', 2, ['*wobble*']), q('binky', 1, ['*boing*'])],
      lines: ['*blob*', '*wobble*'],
    },
    rocky: {
      speed: 0.6, energy: 0.2, gait: 'walk',
      quirks: [q('pose', 2, ['...', '*rock noises*'], { anim: 'idle', ms: 6000 })],
      lines: ['...', 'rock solid'],
    },
    zappy: {
      speed: 1.3, energy: 0.9, gait: 'float',
      quirks: [q('zoomies', 2, ['⚡', 'bzzt!']), q('pose', 1, ['bzzt'], { anim: 'idle', ms: 2000 })],
      lines: ['bzzt', '⚡'],
    },
  };

  const DEFAULT = { speed: 1, energy: 0.5, gait: 'walk', quirks: [], react: {}, lines: [] };

  window.PetsSpecies = {
    get: type => ({ ...DEFAULT, ...(SPECIES[type] || {}), react: { ...((SPECIES[type] || {}).react || {}) } }),
    types: Object.keys(SPECIES),
  };
})();
