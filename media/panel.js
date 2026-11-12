// Pets+ panel: draws the pets, runs their behaviour and handles clicks and drags.
// The extension owns the stats (mood, food, XP). This file only animates them and
// reports what you did back with postMessage.
(function () {
  const vscode = acquireVsCodeApi();

  const SIZES = { nano: 30, small: 40, medium: 55, large: 110 };
  const GAIT = { walk: 30, walk_fast: 60, run: 95 }; // px per second
  const FALLBACK = {
    walk_fast: ['walk'],
    run: ['walk_fast', 'walk'],
    lie: ['idle'],
    with_ball: ['run', 'walk_fast', 'walk'],
    swipe: ['idle'],
    stand: ['idle'],
    jump: ['run', 'walk_fast', 'walk'],
    wallclimb: ['idle'],
    wallgrab: ['idle'],
    wallnap: ['wallgrab', 'idle'],
    walldig: ['wallgrab', 'idle'],
    fall_from_grab: ['idle'],
    land: ['idle'],
  };
  const GRAVITY = 900;

  // States that own the pet until they finish; reactions and the ball leave them alone.
  const BUSY = new Set(['drag', 'fall', 'climb', 'hang', 'drop', 'land', 'flipped', 'jump', 'crouch']);
  // States that end by themselves (landing, being helped up), not by a timer.
  const HELD = new Set(['drag', 'fall', 'drop', 'jump', 'flipped']);
  const MOVING = new Set(['walk', 'walk_fast', 'run', 'goto', 'chase', 'flee', 'party', 'hold', 'roll', 'fetch', 'steal', 'sniff']);

  const ANY_LINES = ['hi', '♪', '🤔', 'what are we building?', 'commit soon?', '*yawn*', 'nice code', '👀'];
  const HUNGRY_LINES = ['🍖?', 'hungry...', 'snack?'];
  const SAD_LINES = ['😢', 'pet me?', '...'];
  const OWL_LINES = ['🌙', '*night shift*', 'shh, they are asleep'];

  // After 8 pm and before 6 am local time. The harness can force it.
  const isNight = () => {
    if (window.__PETS_NIGHT__ != null) return window.__PETS_NIGHT__;
    const h = new Date().getHours();
    return h >= 20 || h < 6;
  };

  let cfg = { size: 'nano', theme: 'forest', media: '', manifest: {}, effects: true };
  let global = { streak: 0, minutesToday: 0 };
  const pets = new Map();
  const mode = { sleeping: false, focus: false, hypeUntil: 0, napX: 0 };
  let ball = null;
  let treats = [];
  let cardId = null;
  let renaming = false;

  const saved = vscode.getState() || { x: {} };

  // ---------- DOM ----------
  const mk = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };
  const sceneBack = mk('canvas', 'scene back', document.body);
  const fxBack = mk('canvas', 'scene back', document.body);
  const world = mk('div', '', document.body); world.id = 'world';
  const fxFront = mk('canvas', 'scene front', document.body);
  let sceneFx = null;
  const fx = mk('div', '', document.body); fx.id = 'fx';
  const empty = mk('div', '', document.body); empty.id = 'empty';
  empty.textContent = 'No pets yet. Use + above to spawn one.';
  empty.hidden = true;
  const card = mk('div', '', document.body); card.id = 'card'; card.hidden = true;

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  const size = () => SIZES[cfg.size] || 30;
  const floor = () => cfg.theme === 'none' ? 0 : window.PetsScenes.floor(cfg.size);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  // Simulation time in ms. It only advances while frames run, so a hidden
  // panel pauses the pets instead of skipping their states.
  let clock = 0;
  const now = () => clock;

  function themeKind() {
    const c = document.body.classList;
    return c.contains('vscode-light') || c.contains('vscode-high-contrast-light') ? 'light' : 'dark';
  }

  function applyTheme() {
    const kind = themeKind();
    sceneFx = window.PetsScenes.build(cfg.theme,
      { width: W(), height: H(), size: cfg.size, kind, effects: cfg.effects },
      [sceneBack, fxBack, fxFront]);
  }
  new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---------- Effects ----------
  function burst(x, y, chars, n, cls = 'heart') {
    for (let i = 0; i < n; i++) {
      const h = mk('div', cls, fx);
      h.textContent = pick(chars);
      h.style.left = `${x + rand(-8, 8)}px`;
      h.style.bottom = `${y + rand(0, 6)}px`;
      h.style.setProperty('--dx', `${rand(-14, 14)}px`);
      h.style.animationDelay = `${i * 90}ms`;
      setTimeout(() => h.remove(), 1100 + i * 90);
    }
  }

  function confetti() {
    const colours = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e67e22'];
    for (let i = 0; i < 40; i++) {
      const c = mk('div', 'confetti', fx);
      c.style.left = `${rand(0, W())}px`;
      c.style.background = pick(colours);
      c.style.setProperty('--dx', `${rand(-40, 40)}px`);
      c.style.setProperty('--t', `${rand(1.2, 2.2)}s`);
      c.style.animationDelay = `${rand(0, 300)}ms`;
      setTimeout(() => c.remove(), 2600);
    }
  }

  // ---------- Pets ----------
  const clampX = x => Math.max(0, Math.min(W() - size(), x));
  const onGround = p => p.y <= floor() + 1;

  class Pet {
    constructor(data) {
      this.root = mk('div', 'pet', world);
      this.body = mk('div', 'body', this.root); // flips, tilts and bobs the sprite
      this.img = mk('img', 'sprite', this.body);
      this.bubble = mk('div', 'bubble', this.root);
      this.tag = mk('div', 'tag', this.root);
      this.update(data);
      const sx = saved.x[data.id];
      this.x = sx != null ? Math.min(sx, W() - size()) : rand(0, Math.max(0, W() - size()));
      this.y = floor();
      this.vy = 0;
      this.dir = Math.random() < 0.5 ? 1 : -1;
      this.jitter = rand(0.8, 1.2);
      this.anim = null;
      this.bubbleTimer = null;
      this.offY = 0;      // visual bob, px up
      this.angle = 0;     // visual tilt, degrees
      this.phase = rand(0, 6);
      this.wall = null;   // 'left' or 'right' while on a wall
      this.flipped = false;
      this.escaping = false;
      this.leap = null;
      this.leapWait = 0;
      this.trail = 0;
      this.swipeReady = now() + 10000;
      this.nextChat = now() + rand(20000, 70000);
      this.nextQuirk = now() + rand(20000, 60000);
      this.set('idle', rand(500, 2500));
      this.bindPointer();
      this.render();
    }

    update(data) {
      const colourChanged = this.data && this.data.color !== data.color;
      this.data = data;
      this.id = data.id;
      this.sp = window.PetsSpecies.get(data.type);
      this.tag.textContent = `${data.name} · Lv ${data.level}`;
      this.root.classList.toggle('sad', data.mood < 25);
      this.root.style.width = `${size()}px`;
      if (colourChanged) { const a = this.anim; this.anim = null; this.setAnim(a); }
    }

    has(anim) {
      const colours = cfg.manifest[this.data.type] || {};
      return (colours[this.data.color] || []).includes(anim);
    }

    setAnim(anim) {
      let a = anim;
      if (!this.has(a)) a = (FALLBACK[anim] || []).find(f => this.has(f)) || 'idle';
      if (a === this.anim) return;
      this.anim = a;
      this.img.src = `${cfg.media}/pets/${this.data.type}/${this.data.color}_${a}_8fps.gif`;
    }

    // state: what the pet is doing. ms: how long. opts: target, gait, then, after...
    set(state, ms = 3000, opts = {}) {
      this.state = state;
      this.until = now() + ms;
      this.opts = opts;
      this.leap = null;
      const anims = {
        idle: 'idle', walk: 'walk', walk_fast: 'walk_fast', run: 'run', lie: 'lie',
        sleep: 'lie', swipe: 'swipe', hold: 'with_ball', fetch: 'with_ball', drag: 'idle',
        fall: this.sp.climbs ? 'fall_from_grab' : 'idle',
        goto: opts.gait || 'walk', chase: 'run', flee: 'run', party: 'run', steal: 'run',
        climb: 'wallclimb', hang: opts.anim || 'wallgrab', drop: 'fall_from_grab', land: 'land',
        flipped: 'idle', jump: 'jump', crouch: 'idle', pose: opts.anim || 'idle',
        rummage: 'swipe', sniff: 'walk', roll: 'idle', bark: 'idle', peck: 'idle',
      };
      this.setAnim(anims[state] || 'idle');
      this.img.classList.toggle('shake', !!opts.shake);
      if (state === 'sleep') this.say('z z z', 0, 'zzz');
      else if (this.bubble.classList.contains('zzz')) this.hush();
    }

    say(text, ms = 2600, cls = '') {
      if (!text) return;
      clearTimeout(this.bubbleTimer);
      this.bubble.textContent = text;
      this.bubble.className = `bubble show ${cls}`;
      if (ms) this.bubbleTimer = setTimeout(() => this.hush(), ms);
    }

    hush() {
      clearTimeout(this.bubbleTimer);
      this.bubble.className = 'bubble';
    }

    hop(delay = 0) {
      setTimeout(() => {
        this.root.classList.remove('hop');
        void this.root.offsetWidth; // restart the animation
        this.root.classList.add('hop');
      }, delay);
    }

    owl() { return !!this.sp.nocturnal && isNight(); }
    get free() { return !BUSY.has(this.state) && !this.wall && !this.flipped; }

    get speedFactor() {
      const sad = this.data.mood < 25 ? 0.6 : 1;
      return this.jitter * sad * Math.max(0.75, size() / 40) * this.sp.speed * (this.owl() ? 1.15 : 1);
    }

    gaitSpeed(gait) {
      if (now() < mode.hypeUntil && gait === 'walk') gait = 'walk_fast';
      return GAIT[gait] * this.speedFactor;
    }

    move(dx) {
      this.x += dx;
      const max = Math.max(0, W() - size());
      if (this.x <= 0) { this.x = 0; this.dir = 1; }
      if (this.x >= max) { this.x = max; this.dir = -1; }
    }

    // One step of travel in this species' style. Returns the distance covered.
    stride(gait, dt, maxDist = Infinity) {
      const style = this.sp.gait;
      if (style === 'leap') {
        // Frogs travel in leaps with pauses between.
        if (!this.leap) {
          this.leapWait -= dt;
          if (this.leapWait > 0) { this.setAnim('idle'); return 0; }
          this.leap = { vx: this.gaitSpeed(gait) * 2.4, vy: gait === 'walk' ? 150 : 210, y: 0 };
        }
        const L = this.leap;
        L.vy -= GRAVITY * dt;
        L.y += L.vy * dt;
        this.setAnim(gait === 'walk' ? 'walk' : 'run');
        const d = Math.min(L.vx * dt, maxDist);
        this.move(this.dir * d);
        if (L.y <= 0) { this.leap = null; this.leapWait = rand(0.25, 0.7); } else this.offY = L.y;
        return d;
      }
      let v = this.gaitSpeed(gait);
      if (style === 'scuttle') { this.phase += dt * 7; v *= Math.sin(this.phase) > -0.3 ? 1.5 : 0.1; }
      if (style === 'slither') { this.phase += dt * 3; v *= 0.8 + 0.3 * Math.sin(this.phase); }
      const d = Math.min(v * dt, maxDist);
      this.move(this.dir * d);
      if (style === 'hop') { this.phase += d * 0.12; this.offY = Math.abs(Math.sin(this.phase)) * size() * 0.25; }
      if (style === 'waddle') { this.phase += dt * 11; this.angle = Math.sin(this.phase) * 7; }
      if (style === 'trail') this.slime(d);
      return d;
    }

    // Moves toward x. Returns true on arrival.
    approach(x, gait, dt) {
      const d = x - this.x;
      if (Math.abs(d) < 3) return true;
      this.dir = Math.sign(d);
      this.stride(gait, dt, Math.abs(d));
      return false;
    }

    slime(d) {
      this.trail += d;
      if (this.trail < 5) return;
      this.trail = 0;
      const s = mk('div', 'slime', world);
      s.style.left = `${this.x + (this.dir > 0 ? size() * 0.15 : size() * 0.85) - 2}px`;
      s.style.bottom = `${floor()}px`;
      setTimeout(() => s.remove(), 8000);
    }

    tick(dt) {
      const t = now();
      this.offY = 0;
      this.angle = 0;
      const o = this.opts;
      switch (this.state) {
        case 'walk': case 'walk_fast': case 'run': case 'hold':
          this.stride(this.state === 'hold' ? 'walk_fast' : this.state, dt);
          if (now() < mode.hypeUntil && this.state === 'walk' && this.sp.gait !== 'leap') this.setAnim('walk_fast');
          break;
        case 'party':
          this.stride('run', dt);
          if (Math.random() < dt * 1.2) this.dir *= -1;
          break;
        case 'roll':
          this.stride('walk', dt);
          this.angle = 360 * (1 - (this.until - t) / o.ms);
          break;
        case 'goto': case 'fetch':
          if (this.approach(o.target, o.gait || 'walk', dt)) {
            const then = o.then;
            this.set('idle', 800);
            if (then) then();
            return this.render();
          }
          break;
        case 'chase': {
          const other = pets.get(o.friend);
          if (!other) break;
          if (this.approach(other.x, 'run', dt)) {
            if (other.wall || other.escaping) {
              // It got away up the wall. Wait at the bottom, then lose interest.
              this.dir = other.wall === 'left' ? -1 : 1;
              this.set('bark', 3500);
              this.say(pick(this.data.type === 'dog' ? ['woof!', 'come down!', 'WOOF'] : ['yip!', '*stares up*']), 1800);
            } else {
              this.set('swipe', 700);
              other.say(pick(['😆', 'hey!', 'tag!']), 1500);
              if (other.free) other.set('idle', 1500);
            }
            return this.render();
          }
          break;
        }
        case 'steal': {
          const victim = pets.get(o.victim);
          if (!victim || !['hold', 'fetch'].includes(victim.state)) { this.set('idle', 1000); this.say('aw', 1200); break; }
          if (this.approach(victim.x, 'run', dt)) {
            victim.set('idle', 1500);
            victim.say(pick(['hey!', 'thief!', '😠']), 1800);
            this.dir = this.x < victim.x ? -1 : 1;
            this.set('hold', 4500);
            this.say('🦝 mine now', 1800);
            return this.render();
          }
          break;
        }
        case 'flee':
          if (this.approach(o.target, 'run', dt)) {
            if (this.sp.flips && Math.random() < 0.15) this.flipOver();
            else this.set('idle', 4000);
            return this.render();
          }
          break;
        case 'sniff':
          if (t >= (o.phaseEnd || 0)) {
            o.walking = !o.walking;
            o.phaseEnd = t + (o.walking ? rand(700, 1300) : rand(600, 1100));
            this.setAnim(o.walking ? 'walk' : 'idle');
            if (!o.walking && Math.random() < 0.3) this.dir *= -1;
          }
          if (o.walking) this.stride('walk', dt);
          break;
        case 'peck':
          this.phase += dt * 9;
          this.offY = -Math.max(0, Math.sin(this.phase)) * 2;
          break;
        case 'bark':
          if (t >= (o.nextHop || 0)) { this.hop(); o.nextHop = t + 800; }
          break;
        case 'climb': {
          const speed = 55 * Math.max(0.75, size() / 40) * this.sp.speed;
          this.y += speed * dt;
          if (this.y >= o.top) {
            this.y = o.top;
            this.set('hang', o.hangMs, { anim: o.hangAnim, waitFor: o.waitFor });
          }
          break;
        }
        case 'hang':
          if (o.waitFor && o.waitFor()) this.until = Math.max(this.until, t + 1500);
          break;
        case 'drop':
        case 'fall':
          this.vy -= GRAVITY * dt;
          this.y += this.vy * dt;
          if (o.vx) this.move(o.vx * dt);
          if (this.y <= floor()) this.landed();
          break;
        case 'jump':
          this.vy -= GRAVITY * dt;
          this.y += this.vy * dt;
          this.move(o.vx * dt);
          if (o.spin) this.angle = Math.min(1, (t - o.t0) / o.air) * o.spin;
          if (this.y <= floor() && this.vy < 0) {
            this.y = floor();
            this.vy = 0;
            const then = o.then;
            this.set('idle', 600);
            if (then) then();
            return this.render();
          }
          break;
        case 'flipped':
          this.angle = 180;
          if (t >= this.nextHelpLine) {
            this.say(pick(['help!', '🙃', 'a little help?', '*wiggles*']), 2200);
            this.nextHelpLine = t + rand(15000, 20000);
          }
          if (t >= this.helpAt) this.callHelp();
          break;
      }

      if (this.sp.gait === 'float' && !this.wall && !this.flipped && this.state !== 'jump') this.offY += 3 + Math.sin(t / 450) * 3;

      // A thrown ball beats whatever the pet was doing, unless it's busy.
      if (ball && !ball.resting && this.free && !['hold', 'fetch', 'steal'].includes(this.state)) this.chaseBall();

      if (this.sp.swipes) this.swipeAtPassers(t);

      if (t >= this.until && !HELD.has(this.state)) {
        const after = this.opts.after;
        if (after) { this.opts.after = null; after(); } else this.next();
      }

      if (t >= this.nextChat) this.chat();
      this.render();
    }

    // Landing after a drop off the wall or out of your hand.
    landed() {
      this.y = floor();
      this.vy = 0;
      const wasDragged = this.state === 'fall';
      this.wall = null;
      this.escaping = false;
      if (wasDragged && this.sp.flips) return this.flipOver();
      if (this.sp.climbs) {
        this.set('land', 450, { after: () => this.set('idle', 1200) });
        if (wasDragged) this.say(pick(['😼', 'landed it', 'feet first']), 1200);
      } else {
        this.set('idle', 1200);
        if (wasDragged) this.say(pick(['!', 'oof', '😵']), 1200);
      }
    }

    chaseBall() {
      if (this.state !== 'goto' || !this.opts.ball) {
        this.set('goto', 15000, { target: ball.x, gait: 'run', ball: true });
      }
      this.opts.target = clampX(ball.x - size() / 2);
      const near = Math.abs(this.x + size() / 2 - ball.x) < size() * 0.5 && ball.y < floor() + size();
      if (!near || now() < (ball.catchAfter || 0)) return;
      ball.el.remove();
      ball = null;
      for (const p of pets.values()) if (p !== this && p.opts.ball) p.set('idle', 1500);
      this.say(pick(['got it!', '⚽', 'mine!']), 1500);
      if (this.sp.fetch) {
        // Bring it back to the middle and drop it for you.
        this.set('fetch', 20000, {
          target: clampX(W() / 2 - size() / 2), gait: 'walk_fast',
          then: () => {
            placeBall(this.x + (this.dir > 0 ? size() * 1.6 : -size()));
            this.say('again? 🎾', 3500);
            this.set('idle', 4000);
          },
        });
      } else this.set('hold', 4500);
      const thief = [...pets.values()].find(p => p !== this && p.sp.thief && p.free);
      if (thief && Math.random() < 0.35) thief.set('steal', 10000, { victim: this.id });
    }

    swipeAtPassers(t) {
      if (t < this.swipeReady || !['idle', 'lie', 'pose'].includes(this.state) || !onGround(this)) return;
      for (const other of pets.values()) {
        if (other === this || !MOVING.has(other.state) || !onGround(other)) continue;
        if (Math.abs(other.x - this.x) > size() * 0.6) continue;
        this.dir = other.x >= this.x ? 1 : -1;
        this.set('swipe', 700);
        other.hop();
        other.say(pick(['ow!', 'hey!', '😾?']), 1200);
        this.swipeReady = t + 25000;
        return;
      }
    }

    // Picks the next thing to do when the current one runs out.
    next() {
      if (this.wall) return this.dropFromWall();
      this.escaping = false;
      const mine = treats.find(tr => tr.owner === this.id && !tr.taken && tr.landed);
      if (mine) return this.set('goto', 20000, { target: mine.x, gait: 'walk_fast', then: () => eat(this, mine) });
      if (mode.sleeping && !this.owl()) {
        // Cats sleep wherever they are. Everyone else piles up together.
        if (this.data.type === 'cat') { this.set('sleep', 60000); return; }
        const spot = clampX(mode.napX + (this.napOffset || 0));
        if (this.state === 'sleep') { this.until = now() + 60000; return; }
        if (Math.abs(this.x - spot) > 4) {
          this.set('goto', 30000, { target: spot, gait: 'walk', then: () => this.set('sleep', 60000) });
        } else this.set('sleep', 60000);
        return;
      }
      if (mode.focus) {
        if (Math.random() < 0.85) this.set('lie', rand(15000, 40000));
        else this.set('walk', rand(2000, 4000));
        return;
      }
      if (now() >= this.nextQuirk && this.sp.quirks.length) {
        this.nextQuirk = now() + rand(60000, 120000) * (this.owl() ? 0.7 : 1);
        if (this.doQuirk()) return;
      }
      const m = this.data.mood / 100;
      const e = this.sp.energy;
      const friends = [...pets.values()].filter(p => p !== this && p.free);
      const options = [
        ['idle', 3, () => this.set('idle', rand(2000, 5000))],
        ['walk', 3 + 2 * m, () => { this.dir = Math.random() < 0.5 ? 1 : -1; this.set('walk', rand(3000, 7000)); }],
        ['walk_fast', m * (0.5 + e), () => this.set('walk_fast', rand(2000, 4000))],
        ['run', (0.3 + 1.2 * m) * (0.2 + 1.6 * e), () => this.set('run', rand(1500, 3000))],
        ['lie', (0.5 + 2 * (1 - m)) * (1.6 - e), () => this.set('lie', rand(5000, 12000))],
        ['swipe', 0.3, () => this.set('swipe', 800)],
      ];
      if (friends.length) {
        options.push(['chase', 0.7 * m * (0.5 + e), () => {
          const climbers = friends.filter(f => f.sp.climbs);
          if (this.sp.chaser && climbers.length && Math.random() < 0.6) return this.chaseUpWall(pick(climbers));
          const f = pick(friends);
          this.set('chase', rand(3000, 5000), { friend: f.id });
          f.dir = f.x >= this.x ? 1 : -1;
          f.set('run', rand(2000, 4000));
        }]);
      }
      let r = Math.random() * options.reduce((s, o) => s + o[1], 0);
      for (const [, w, go] of options) {
        if ((r -= w) <= 0) { go(); return; }
      }
      options[0][2]();
    }

    // ---------- Species moves ----------

    // Runs a quirk: a named one (for tests), or a weighted pick from the species list.
    doQuirk(name) {
      const list = this.sp.quirks;
      let q = name ? list.find(x => x.move === name) || { move: name, lines: [] } : null;
      if (!q) {
        let r = Math.random() * list.reduce((s, x) => s + x.w, 0);
        q = list.find(x => (r -= x.w) <= 0) || list[0];
      }
      const line = () => (q.lines && q.lines.length ? pick(q.lines) : null);
      switch (q.move) {
        case 'climb':
        case 'wallnap':
        case 'walldig':
          return this.climbWall({
            hangAnim: q.move === 'climb' ? 'wallgrab' : q.move,
            hangMs: q.move === 'wallnap' ? rand(10000, 18000) : rand(3000, 7000),
            line: line(),
          });
        case 'pose':
          this.set('pose', q.ms || 3000, { anim: q.anim });
          this.say(line(), Math.min(3000, q.ms || 3000));
          return true;
        case 'rattle':
          this.set('pose', 2000, { anim: 'idle', shake: true });
          this.say(line(), 2000);
          return true;
        case 'alert':
          this.set('pose', 2500, { anim: 'stand' });
          this.say(line(), 2000);
          return true;
        case 'zoomies':
          this.set('party', rand(2500, 4000));
          this.say(line(), 1800);
          return true;
        case 'sniff':
          this.set('sniff', rand(4000, 7000), { walking: false });
          this.say(line(), 2000);
          return true;
        case 'peck':
          this.set('peck', rand(2500, 4000));
          this.say(line(), 1800);
          return true;
        case 'roll':
          this.set('roll', 1300, { ms: 1300 });
          this.say(line(), 1800);
          return true;
        case 'wag':
          this.hop(); this.hop(450);
          this.set('idle', 1500);
          this.say(line(), 1500);
          return true;
        case 'rummage':
        case 'stash':
          this.set('rummage', rand(3000, 5000), { after: () => { this.say(line(), 2500); this.set('idle', 2000); } });
          return true;
        case 'binky':
          this.jump(this.dir * 20, 270, { spin: 360 * this.dir }, () => this.say(line(), 1500));
          return true;
        case 'pounce':
          this.pounce(line());
          return true;
        case 'catchFly':
          this.say('🪰?', 1000);
          this.set('crouch', 900, { after: () => this.jump(0, 170, {}, () => this.say(line(), 2000)) });
          return true;
        case 'flip':
          if (!onGround(this)) return false;
          this.flipOver();
          return true;
      }
      return false;
    }

    jump(vx, vy, o, then) {
      this.vy = vy;
      this.set('jump', 1e9, { vx, spin: o.spin, t0: now(), air: (2 * vy / GRAVITY) * 1000, then });
    }

    // Crouch, leap, land with a swipe. Sometimes aims at another pet.
    pounce(line) {
      const others = [...pets.values()].filter(p => p !== this && onGround(p));
      const target = others.length && Math.random() < 0.4 ? pick(others) : null;
      let dist = rand(40, 90);
      if (target) {
        this.dir = target.x >= this.x ? 1 : -1;
        dist = Math.max(10, Math.min(130, Math.abs(target.x - this.x) - size() * 0.5));
      }
      const vy = 240, air = (2 * vy) / GRAVITY;
      this.set('crouch', 700, {
        after: () => this.jump(this.dir * (dist / air), vy, {}, () => {
          this.set('swipe', 600);
          this.say(line, 1600);
          if (target && Math.abs(target.x - this.x) < size()) { target.hop(); target.say('!', 1000); }
        }),
      });
    }

    // Walk to the nearest wall, climb it, hang, then drop. False if there's no room.
    climbWall(o = {}) {
      if (!this.sp.climbs) return false;
      const room = H() - size() - floor();
      if (room < size() * 1.5) return false;
      const side = this.x + size() / 2 < W() / 2 ? 'left' : 'right';
      // Partway up, but never a long haul in a tall panel.
      const top = floor() + Math.min(rand(0.35, 0.8) * room, size() * rand(2.5, 4.5));
      this.set('goto', 20000, {
        target: side === 'left' ? 0 : W() - size(), gait: o.gait || 'walk_fast',
        then: () => this.startClimb(side, top, o),
      });
      return true;
    }

    startClimb(side, top, o) {
      this.wall = side;
      this.x = side === 'left' ? 0 : W() - size();
      this.dir = side === 'left' ? -1 : 1; // the climbing art faces the wall
      this.set('climb', 30000, { top, hangAnim: o.hangAnim || 'wallgrab', hangMs: o.hangMs || rand(3000, 7000), waitFor: o.waitFor });
      this.say(o.line, 1800);
    }

    dropFromWall() {
      const away = this.wall === 'left' ? 1 : -1;
      this.dir = away;
      this.vy = 0;
      this.set('drop', 1e9, { vx: away * 35 });
    }

    // A dog or fox chases a cat or squirrel, which escapes up the wall.
    chaseUpWall(target) {
      this.set('chase', 9000, { friend: target.id });
      target.escaping = true;
      const ok = target.climbWall({
        gait: 'run', hangMs: rand(3000, 5000), line: pick(['😾', '!!', 'eek']),
        waitFor: () => this.state === 'chase' || this.state === 'bark',
      });
      if (!ok) {
        target.escaping = false;
        target.dir = target.x >= this.x ? 1 : -1;
        target.set('run', rand(2000, 4000));
      }
    }

    // Turtles: on their back, legs going, until someone helps.
    flipOver() {
      this.flipped = true;
      this.wall = null;
      this.y = floor();
      this.set('flipped', 1e9);
      this.img.classList.add('wiggle');
      this.say('help! 🙃', 3000);
      this.nextHelpLine = now() + rand(15000, 20000);
      this.helpAt = now() + rand(45000, 75000);
      this.helper = null;
    }

    flipBack(line) {
      this.flipped = false;
      this.helper = null;
      this.img.classList.remove('wiggle');
      this.hop();
      this.set('idle', 1500);
      this.say(line, 2000);
    }

    // If you don't help, a friend walks over and nudges it upright.
    callHelp() {
      const t = now();
      if (this.helper) {
        if (t > this.helpAt + 30000) { this.helper = null; this.helpAt = t; } // helper got distracted
        return;
      }
      const friends = [...pets.values()].filter(p => p !== this && p.free);
      if (!friends.length) {
        if (t > this.helpAt + 60000) this.flipBack('...finally');
        return;
      }
      const f = friends.reduce((a, b) => (Math.abs(a.x - this.x) < Math.abs(b.x - this.x) ? a : b));
      this.helper = f.id;
      const side = f.x < this.x ? -1 : 1;
      f.set('goto', 20000, {
        target: clampX(this.x + side * size() * 0.8), gait: 'walk_fast',
        then: () => {
          if (!this.flipped) return;
          f.dir = this.x >= f.x ? 1 : -1;
          f.set('swipe', 700);
          f.say(pick(['here you go', '*nudge*', 'up you get']), 1500);
          this.flipBack('thanks! 🐢');
        },
      });
    }

    chat() {
      this.nextChat = now() + rand(45000, 150000);
      if (mode.focus || this.flipped || this.bubble.classList.contains('show')) return;
      let lines;
      if (mode.sleeping) {
        if (!this.owl()) return;
        lines = OWL_LINES;
      } else if (this.data.hungry) lines = HUNGRY_LINES;
      else if (this.data.mood < 25) lines = SAD_LINES;
      else lines = ANY_LINES.concat(this.sp.lines, this.sp.lines);
      this.say(pick(lines));
    }

    render() {
      this.root.style.left = `${this.x}px`;
      this.root.style.bottom = `${this.y}px`;
      // Crabs walk sideways, so they never turn around.
      const flip = this.sp.gait === 'sideways' && !this.wall ? 1 : this.dir;
      this.body.style.transform = `translateY(${-this.offY}px) scaleX(${flip < 0 ? -1 : 1}) rotate(${this.angle}deg)`;
    }

    bindPointer() {
      let start = null;
      this.root.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        start = { x: e.clientX, y: e.clientY, dragging: false };
        this.root.setPointerCapture(e.pointerId);
      });
      this.root.addEventListener('pointermove', e => {
        if (!start) return;
        if (!start.dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
          start.dragging = true;
          this.root.classList.add('dragging');
          this.wall = null;
          this.escaping = false;
          if (this.flipped) { this.flipped = false; this.img.classList.remove('wiggle'); }
          this.set('drag', 1e9);
          this.say(pick(['wheee', '!!', 'put me down']), 1500);
        }
        if (start.dragging) {
          this.x = clampX(e.clientX - size() / 2);
          this.y = Math.max(floor(), Math.min(H() - size(), H() - e.clientY - size() / 2));
          this.render();
        }
      });
      this.root.addEventListener('pointerup', () => {
        if (!start) return;
        const dragged = start.dragging;
        start = null;
        this.root.classList.remove('dragging');
        if (dragged) {
          this.vy = 0;
          this.set('fall', 1e9);
        } else {
          this.petMe();
        }
      });
      this.root.addEventListener('dblclick', () => openCard(this.id));
    }

    petMe() {
      vscode.postMessage({ type: 'petted', id: this.id });
      const heart = () => burst(this.x + size() / 2 - 6, this.y + size(), ['❤', '💕', '❤'], 3);
      if (this.flipped) { this.flipBack('thanks! 💚'); heart(); return; }
      if (this.state === 'sleep') { this.set('idle', 1500); this.say('!', 1000); }
      const style = this.sp.react.petted;
      if (style === 'aloof' && this.free && Math.random() < 0.25) {
        this.set('swipe', 700);
        this.say(pick(['😾 enough.', 'hmph', '*tail flick*']), 1500);
        return;
      }
      heart();
      this.hop();
      if (style === 'wag') { this.hop(400); this.say(pick(['❤', '*wags*', 'best human']), 1200); }
    }
  }

  // ---------- Ball and treats ----------
  function makeBall() {
    if (ball) ball.el.remove();
    const d = Math.max(8, size() / 3);
    const el = mk('div', 'ball', world);
    el.style.width = el.style.height = `${d}px`;
    ball = { el, d, x: 0, y: 0, vx: 0, vy: 0, resting: false };
    el.addEventListener('click', kickBall);
    return ball;
  }

  function throwBall(fromX) {
    const left = fromX == null ? Math.random() < 0.5 : fromX < W() / 2;
    const b = makeBall();
    b.x = left ? 10 : W() - 10;
    b.y = H() * 0.6;
    b.vx = (left ? 1 : -1) * rand(140, 240);
    b.vy = rand(120, 260);
    for (const p of pets.values()) if (p.state === 'sleep') p.set('idle', 300);
  }

  // The dog drops the ball; it sits there until you click it.
  function placeBall(x) {
    const b = makeBall();
    b.x = Math.max(0, Math.min(W() - b.d, x));
    b.y = floor();
    b.resting = true;
    b.el.classList.add('resting');
    b.el.title = 'Throw again';
    tickBall(0);
  }

  function kickBall() {
    if (!ball || !ball.resting) return;
    ball.resting = false;
    ball.el.classList.remove('resting');
    ball.vx = (Math.random() < 0.5 ? -1 : 1) * rand(150, 250);
    ball.vy = rand(220, 320);
    ball.catchAfter = now() + 700; // let it fly before anyone grabs it
  }

  function tickBall(dt) {
    if (!ball) return;
    if (!ball.resting) {
      ball.vy -= GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.y <= floor()) {
        ball.y = floor();
        ball.vy = Math.abs(ball.vy) > 60 ? -ball.vy * 0.55 : 0;
        ball.vx *= 0.9;
      }
      if (ball.x < 0 || ball.x > W() - ball.d) { ball.vx *= -0.8; ball.x = Math.max(0, Math.min(W() - ball.d, ball.x)); }
    }
    ball.el.style.left = `${ball.x}px`;
    ball.el.style.bottom = `${ball.y}px`;
  }

  function eat(p, t) {
    if (t.taken) { p.say(pick(['hey! 😠', 'where did it go?', '🦝!!']), 2000); return; }
    t.taken = true;
    t.el.remove();
    treats = treats.filter(o => o !== t);
    p.say('😋', 1800);
    burst(p.x + size() / 2 - 6, p.y + size(), ['❤', '✨'], 2);
  }

  // results: [{ id, ate }] from the extension, which has already applied the food.
  function dropTreats(results) {
    const mine = new Map();
    for (const { id, ate } of results) {
      const p = pets.get(id);
      if (!p) continue;
      if (!ate) { p.say(pick(['😌 full', "I'm good", 'no thanks']), 2000); continue; }
      const t = {
        el: mk('div', 'treat', world),
        x: rand(0, Math.max(0, W() - size())),
        y: H() - 20,
        vy: 0,
        landed: false,
        owner: id,
        taken: false,
      };
      t.el.textContent = pick(['🍖', '🐟', '🍪', '🥕', '🍓']);
      t.el.style.fontSize = `${Math.max(12, size() / 2.5)}px`;
      treats.push(t);
      mine.set(p, t);
      // Busy pets (on a wall, on their back) go for it once they're free.
      if (p.free) p.set('goto', 20000, { target: t.x, gait: 'walk_fast', then: () => eat(p, t) });
    }
    // Raccoons sometimes grab someone else's first.
    for (const [p, own] of mine) {
      if (!p.sp.thief || !p.free || Math.random() >= 0.4) continue;
      const others = [...mine.values()].filter(t => t !== own);
      if (!others.length) continue;
      const v = pick(others);
      p.set('goto', 20000, {
        target: v.x, gait: 'run',
        then: () => {
          if (!v.taken) {
            v.taken = true;
            v.el.remove();
            treats = treats.filter(o => o !== v);
            p.say('😋 yoink', 1800);
          }
          p.set('goto', 20000, { target: own.x, gait: 'walk_fast', then: () => eat(p, own) });
        },
      });
    }
  }

  function tickTreats(dt) {
    for (const t of treats) {
      if (t.landed) continue;
      t.vy -= GRAVITY * dt;
      t.y += t.vy * dt;
      if (t.y <= floor()) { t.y = floor(); t.landed = true; }
      t.el.style.left = `${t.x}px`;
      t.el.style.bottom = `${t.y}px`;
    }
  }

  // ---------- Reactions to what you're doing ----------
  const someone = () => pick([...pets.values()]);
  const all = () => [...pets.values()];
  const free = () => all().filter(p => p.free);

  function wake() {
    if (!mode.sleeping) return;
    mode.sleeping = false;
    for (const p of all()) {
      if (p.state === 'sleep' || (p.state === 'goto' && !p.opts.ball)) { p.set('idle', rand(800, 2000)); p.say('!', 1000); }
    }
  }

  function flee(p) {
    p.set('flee', 6000, { target: p.x < W() / 2 ? 0 : W() - size() });
  }

  // One or two pets with something to say about it, else a generic line from anyone.
  function speak(kind, fallback, ms = 2500) {
    // Different species, in random order, so it isn't always the same two cats.
    const seen = new Set();
    const talkers = all().filter(p => p.sp.react.lines && p.sp.react.lines[kind])
      .sort(() => Math.random() - 0.5)
      .filter(p => !seen.has(p.data.type) && seen.add(p.data.type));
    if (talkers.length) talkers.slice(0, 2).forEach((p, i) => setTimeout(() => p.say(pick(p.sp.react.lines[kind]), ms), i * 400));
    else { const p = someone(); if (p) p.say(pick(fallback), ms); }
  }

  const REACTIONS = {
    typing: () => wake(),
    typingFast: () => { wake(); mode.hypeUntil = now() + 6000; },
    save: () => all().forEach((p, i) => p.hop(i * 80)),
    commit: () => {
      confetti();
      for (const p of free()) {
        const style = p.sp.react.commit;
        if (style === 'yawn' && Math.random() < 0.5) { p.set('lie', 4000); p.say('*yawn*', 2000); }
        else if (style === 'zoomies') p.set('party', 5000);
        else if (style === 'binky') p.jump(p.dir * 20, 280, { spin: 360 * p.dir });
        else p.set('party', 3000);
      }
      const p = someone(); if (p && !p.bubble.classList.contains('show')) p.say(pick(['🎉 shipped!', 'committed!', '🚀']), 2500);
    },
    testsPass: () => {
      all().forEach((p, i) => { p.hop(i * 80); p.hop(500 + i * 80); });
      const p = someone(); if (p) p.say('✅ green!', 2200);
    },
    testsFail: () => {
      free().forEach(p => p.set('lie', 3500));
      const p = someone(); if (p) p.say(pick(['😞', 'red again', 'oh no']), 2500);
    },
    errorsUp: () => {
      if (mode.focus) { const p = someone(); if (p) p.say('😬', 1500); return; }
      for (const p of free()) {
        switch (p.sp.react.errorsUp) {
          case 'climb': if (!p.climbWall({ gait: 'run', hangMs: rand(5000, 8000) })) flee(p); break;
          case 'hide': p.set('pose', 6000, { anim: 'lie' }); break;
          case 'stay': p.set('idle', 3000); break;
          case 'bark': p.set('bark', 3000); break;
          default: flee(p);
        }
      }
      speak('errorsUp', ['😰', 'uh oh', 'red squiggles!']);
    },
    errorsCleared: () => {
      all().forEach((p, i) => p.hop(i * 80));
      const p = someone(); if (p) p.say(pick(['😌 phew', 'all clean', '✨']), 2200);
    },
    sleep: () => {
      if (mode.sleeping) return;
      mode.sleeping = true;
      mode.napX = rand(size(), Math.max(size(), W() - 2 * size()));
      const sleepers = all().filter(p => !p.owl());
      sleepers.forEach((p, i) => { p.napOffset = (i - (sleepers.length - 1) / 2) * size() * 0.7; if (p.free) p.until = 0; });
    },
    wake: () => wake(),
    focusStart: () => {
      mode.focus = true;
      free().forEach(p => p.set('lie', rand(15000, 40000)));
      const p = someone(); if (p) p.say('🤫 focus', 2000);
    },
    focusStop: () => { mode.focus = false; },
    breakStart: () => {
      mode.focus = false;
      wake();
      free().forEach(p => p.set('party', 2500));
      all().forEach((p, i) => setTimeout(() => p.say(pick(['☕ break!', 'stretch!', 'water?', 'walk?']), 4000), i * 300));
    },
    breakEnd: () => { const p = someone(); if (p) p.say('💪 back to it?', 3000); },
    levelUp: ({ id, level }) => {
      const p = pets.get(id);
      if (!p) return;
      p.hop(); p.hop(500);
      p.say(`⭐ Lv ${level}!`, 3000);
      burst(p.x + size() / 2 - 6, p.y + size(), ['✨', '⭐'], 5, 'sparkle');
    },
    ball: () => throwBall(),
    feed: ({ results }) => dropTreats(results),
  };

  // ---------- Stats card ----------
  function openCard(id) {
    cardId = id;
    renaming = false;
    drawCard();
  }

  function closeCard() {
    cardId = null;
    card.hidden = true;
  }

  function bar(cls, label, right, pct) {
    return `<div class="bar ${cls}"><div class="label"><span>${label}</span><span>${right}</span></div>` +
      `<div class="track"><div class="fill" style="width:${Math.round(pct)}%"></div></div></div>`;
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function drawCard() {
    const p = cardId && pets.get(cardId);
    if (!p) { closeCard(); return; }
    if (renaming) return; // don't redraw under the cursor
    const d = p.data;
    const allColours = Object.keys(cfg.manifest[d.type] || {});
    const locked = allColours.length - d.unlocked.length;
    const nextAt = 3 * Math.floor(d.level / 3) + 3;
    card.innerHTML =
      `<div class="head"><span class="name">${esc(d.name)}</span><span class="lv">Lv ${d.level}</span>` +
      `<button class="close" data-act="close" title="Close">✕</button></div>` +
      `<div class="sub">${esc(d.color.replace(/_/g, ' '))} ${esc(d.type)} · ${d.ageDays} day${d.ageDays === 1 ? '' : 's'} old</div>` +
      bar('xp', 'XP', `${d.into}/${d.need}`, (100 * d.into) / d.need) +
      bar('mood', 'Mood', d.face, d.mood) +
      bar('food', 'Food', d.hungry ? 'hungry' : `${Math.round(d.food)}%`, d.food) +
      `<div class="sub">Petted ${d.petted} · Fed ${d.fed} · Streak ${global.streak} 🔥 · Today ${global.minutesToday}m</div>` +
      (allColours.length > 1
        ? `<div class="colours">${d.unlocked.map(c =>
          `<button data-act="colour" data-c="${esc(c)}" class="${c === d.color ? 'on' : ''}">${esc(c.replace(/_/g, ' '))}</button>`).join('')}</div>` +
          (locked > 0 ? `<div class="sub">${locked} more colour${locked === 1 ? '' : 's'}. Next at Lv ${nextAt}.</div>` : '')
        : '') +
      `<div class="actions"><button class="primary" data-act="feed">Feed</button>` +
      `<button data-act="rename">Rename</button><button data-act="ball">Ball</button></div>`;
    card.hidden = false;
  }

  card.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !cardId) return;
    const act = b.dataset.act;
    if (act === 'close') closeCard();
    else if (act === 'feed') vscode.postMessage({ type: 'feed', id: cardId });
    else if (act === 'ball') throwBall();
    else if (act === 'colour') vscode.postMessage({ type: 'colour', id: cardId, color: b.dataset.c });
    else if (act === 'rename') startRename();
  });

  function startRename() {
    const p = pets.get(cardId);
    const nameEl = card.querySelector('.name');
    if (!p || !nameEl) return;
    renaming = true;
    nameEl.innerHTML = '';
    const input = mk('input', '', nameEl);
    input.value = p.data.name;
    input.maxLength = 24;
    input.focus();
    input.select();
    const done = save => {
      if (!renaming) return;
      renaming = false;
      const name = input.value.trim();
      if (save && name && name !== p.data.name) vscode.postMessage({ type: 'rename', id: p.id, name });
      drawCard();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !renaming) closeCard(); });

  // ---------- Sync with the extension ----------
  function syncPets(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      if (pets.has(d.id)) pets.get(d.id).update(d);
      else pets.set(d.id, new Pet(d));
    }
    for (const [id, p] of pets) {
      if (!seen.has(id)) { p.root.remove(); pets.delete(id); }
    }
    empty.hidden = pets.size > 0;
    if (cardId) drawCard();
  }

  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'init') {
      const resized = cfg.size !== msg.size || cfg.theme !== msg.theme;
      cfg = { ...cfg, ...msg };
      applyTheme();
      if (resized) for (const p of pets.values()) { p.y = floor(); p.update(p.data); }
      if (msg.focus) REACTIONS.focusStart();
    }
    if (msg.pets) syncPets(msg.pets);
    if (msg.global) global = msg.global;
    if (msg.type === 'event' && REACTIONS[msg.kind]) REACTIONS[msg.kind](msg);
    if (msg.type === 'openCard') openCard(msg.id);
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    for (const p of pets.values()) { p.x = Math.min(p.x, Math.max(0, W() - size())); p.render(); }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyTheme, 150);
  });

  // ---------- Main loop ----------
  function step(dt) {
    clock += dt * 1000;
    tickBall(dt);
    tickTreats(dt);
    for (const p of pets.values()) p.tick(dt);
    if (sceneFx) { sceneFx.step(dt); sceneFx.draw(); }
  }

  let last = performance.now();
  function frame() {
    const t = performance.now();
    step(Math.min(0.1, (t - last) / 1000)); // a long gap shouldn't teleport pets
    last = t;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test/harness.html sets this to drive the clock by hand.
  if (window.__PETS_TEST__) {
    window.__petsPlus = { step, pets, mode, throwBall, kickBall, get ball() { return ball; }, get treats() { return treats; } };
  }

  // Remember where everyone was, so a reload doesn't scatter them.
  setInterval(() => {
    const x = {};
    for (const p of pets.values()) x[p.id] = Math.round(p.x);
    vscode.setState({ x });
  }, 5000);

  vscode.postMessage({ type: 'ready' });
})();
