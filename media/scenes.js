// Pets+ scenes: backgrounds drawn in code as pixel art, plus the small animated
// effects that go with them. Everything is
// drawn on low-res canvases that CSS scales up with crisp pixels, so a scene fits
// any panel size. Day version for light editor themes, night for dark ones.
(function () {
  const SCENES = ['forest', 'castle', 'beach', 'winter', 'autumn', 'lakefront', 'city', 'space', 'dojo', 'mountains', 'room', 'blossom'];
  // Ground height in CSS px. Divisible by the pixel size so pets line up exactly.
  const FLOOR = { nano: 18, small: 22, medium: 30, large: 45 };
  const PIXEL = { nano: 2, small: 2, medium: 2, large: 3 };
  // Scenery is drawn in at most this many scene pixels above the bottom. A taller
  // panel just gets more sky (or wall), so hills don't balloon next to small trees.
  const MAX_SCENE = 110;

  // ---------- Helpers ----------

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Smooth 1D value noise in [0, 1].
  function noise(seed, scale) {
    const r = rng(seed);
    const pts = Array.from({ length: 512 }, r);
    return x => {
      const xs = x / scale, i = Math.floor(xs), f = xs - i;
      const t = (1 - Math.cos(f * Math.PI)) / 2;
      return pts[i & 511] * (1 - t) + pts[(i + 1) & 511] * t;
    };
  }

  // A painter bound to one low-res canvas.
  // top is the panel's real top edge: 0, or negative when the panel is taller than MAX_SCENE.
  function painter(ctx, w, h, gy, night, seed, top) {
    const g = {
      ctx, w, h, gy, night, top, r: rng(seed),
      rect(x, y, rw, rh, c) {
        if (rw <= 0 || rh <= 0) return;
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(rw), Math.round(rh));
      },
      px(x, y, c) { g.rect(x, y, 1, 1, c); },
      // Banded vertical gradient, like old pixel-art skies.
      sky(top, bottom, y0 = 0, y1 = gy) {
        if (y0 === 0 && g.top < 0) g.rect(0, g.top, w, -g.top, top);
        const bands = 8;
        for (let y = y0; y < y1; y++) {
          const t = Math.round(((y - y0) / Math.max(1, y1 - y0)) * bands) / bands;
          g.rect(0, y, w, 1, mix(top, bottom, t));
        }
      },
      ellipse(cx, cy, rx, ry, c) {
        for (let dy = -ry; dy <= ry; dy++) {
          const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.01))));
          g.rect(cx - half, cy + dy, half * 2 + 1, 1, c);
        }
      },
      circle(cx, cy, rad, c) { g.ellipse(cx, cy, rad, rad, c); },
      // Dithered blob: every other pixel, fading toward the edge.
      dither(cx, cy, rad, c, density = 0.6) {
        for (let y = -rad; y <= rad; y++) {
          for (let x = -rad; x <= rad; x++) {
            const d = Math.hypot(x, y) / rad;
            if (d <= 1 && (x + y) % 2 === 0 && g.r() < density * (1 - d * 0.7)) g.px(cx + x, cy + y, c);
          }
        }
      },
      // Soft round light, for lamps.
      glow(cx, cy, rad, colour) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, `rgba(${colour},0.35)`);
        grad.addColorStop(1, `rgba(${colour},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      },
      // Fills from a noisy ridge line down to the ground. Returns the line.
      ridge(top, bottom, c, seed, scale) {
        const n1 = noise(seed, scale), n2 = noise(seed + 7, scale / 3);
        const line = [];
        for (let x = 0; x < w; x++) {
          const v = 0.75 * n1(x) + 0.25 * n2(x);
          const y = Math.round(top + (bottom - top) * (1 - v));
          line.push(y);
          g.rect(x, y, 1, gy - y + 1, c);
        }
        return line;
      },
      speckle(y0, y1, n, colours) {
        for (let i = 0; i < n; i++) g.px(g.r() * w, y0 + g.r() * (y1 - y0), colours[Math.floor(g.r() * colours.length)]);
      },
    };
    return g;
  }

  // ---------- Effects ----------

  // Each effect has step(dt) and draw(ctx); dt in seconds, units are scene pixels.
  function twinkle(r, n, x0, y0, x1, y1, colour = '255,255,240') {
    const stars = Array.from({ length: n }, () => ({
      x: Math.floor(x0 + r() * (x1 - x0)), y: Math.floor(y0 + r() * (y1 - y0)),
      p: r() * 6.3, s: 0.6 + r() * 2, big: r() < 0.12,
    }));
    return {
      step(dt) { for (const s of stars) s.p += s.s * dt; },
      draw(ctx) {
        for (const s of stars) {
          const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(s.p));
          ctx.fillStyle = `rgba(${colour},${a.toFixed(2)})`;
          ctx.fillRect(s.x, s.y, 1, 1);
          if (s.big && a > 0.8) {
            ctx.fillStyle = `rgba(${colour},${(a - 0.6).toFixed(2)})`;
            ctx.fillRect(s.x - 1, s.y, 3, 1);
            ctx.fillRect(s.x, s.y - 1, 1, 3);
          }
        }
      },
    };
  }

  function shootingStars(r, w, ymax) {
    let wait = 3 + r() * 6, star = null;
    return {
      step(dt) {
        if (star) {
          star.x += star.vx * dt; star.y += star.vy * dt; star.life -= dt;
          if (star.life <= 0) star = null;
        } else if ((wait -= dt) <= 0) {
          wait = 5 + r() * 9;
          star = { x: r() * w * 0.7 + w * 0.2, y: r() * ymax * 0.4, vx: -(60 + r() * 40), vy: 25 + r() * 15, life: 0.7 };
        }
      },
      draw(ctx) {
        if (!star) return;
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = `rgba(255,255,255,${(0.9 - i * 0.12) * Math.min(1, star.life * 3)})`;
          ctx.fillRect(Math.round(star.x - (star.vx / 60) * i), Math.round(star.y - (star.vy / 60) * i), 1, 1);
        }
      },
    };
  }

  function clouds(r, w, ymax, colour = 'rgba(255,255,255,0.85)', n = 3) {
    const list = Array.from({ length: n }, () => {
      const cw = 10 + Math.floor(r() * 14);
      return {
        x: r() * w, y: 2 + Math.floor(r() * Math.max(2, ymax)), cw, v: 1.2 + r() * 2.5,
        puffs: Array.from({ length: 3 }, (_, i) => ({ dx: Math.floor((i / 2) * cw * 0.6), rad: 2 + Math.floor(r() * 3) })),
      };
    });
    return {
      step(dt) { for (const c of list) { c.x += c.v * dt; if (c.x > w + 4) c.x = -c.cw - 4; } },
      draw(ctx) {
        ctx.fillStyle = colour;
        for (const c of list) {
          const x = Math.round(c.x);
          ctx.fillRect(x, c.y, c.cw, 3);
          for (const p of c.puffs) ctx.fillRect(x + p.dx, c.y - p.rad + 1, p.rad * 2 + 2, p.rad);
        }
      },
    };
  }

  // Falling things: snow, petals, leaves. Drawn in front of the pets.
  function falling(r, w, h, { n, colours, speed = [6, 14], sway = 6, size = 1 }) {
    const make = top => ({
      x: r() * w, y: top ? -r() * h : r() * h, v: speed[0] + r() * (speed[1] - speed[0]),
      p: r() * 6.3, c: colours[Math.floor(r() * colours.length)], s: size + (r() < 0.3 ? 1 : 0),
    });
    const list = Array.from({ length: n }, () => make(false));
    return {
      step(dt) {
        for (const f of list) {
          f.y += f.v * dt; f.p += dt * 1.6;
          if (f.y > h) Object.assign(f, make(true), { y: -2 });
        }
      },
      draw(ctx) {
        for (const f of list) {
          ctx.fillStyle = f.c;
          ctx.fillRect(Math.round(f.x + Math.sin(f.p) * sway), Math.round(f.y), f.s, f.s);
        }
      },
    };
  }

  function gulls(r, w, ymax) {
    const list = Array.from({ length: 3 }, () => ({ x: r() * w, y: 3 + r() * ymax, v: 5 + r() * 5, p: r() * 6 }));
    const up = [[-2, -1], [-1, 0], [0, 0], [1, 0], [2, -1]];
    const down = [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1]];
    return {
      step(dt) { for (const b of list) { b.x += b.v * dt; b.p += dt * 5; if (b.x > w + 4) { b.x = -4; b.y = 3 + r() * ymax; } } },
      draw(ctx) {
        ctx.fillStyle = 'rgba(60,64,72,0.9)';
        for (const b of list) for (const [dx, dy] of (Math.sin(b.p) > 0 ? up : down)) ctx.fillRect(Math.round(b.x) + dx, Math.round(b.y) + dy, 1, 1);
      },
    };
  }

  function sparkles(r, x0, y0, x1, y1, n = 6, colour = '255,255,255') {
    const list = Array.from({ length: n }, () => ({ x: 0, y: 0, life: r() }));
    return {
      step(dt) {
        for (const s of list) {
          s.life -= dt * 0.8;
          if (s.life <= 0) Object.assign(s, { x: Math.floor(x0 + r() * (x1 - x0)), y: Math.floor(y0 + r() * (y1 - y0)), life: 1 });
        }
      },
      draw(ctx) {
        for (const s of list) {
          ctx.fillStyle = `rgba(${colour},${(Math.sin(s.life * Math.PI) * 0.9).toFixed(2)})`;
          ctx.fillRect(s.x, s.y, 2, 1);
        }
      },
    };
  }

  function beam(x, y, w) {
    let a = 0;
    return {
      step(dt) { a += dt * 0.9; },
      draw(ctx) {
        const c = Math.cos(a);
        for (const [dir, k] of [[-1, Math.max(0, c)], [1, Math.max(0, -c)]]) {
          if (k < 0.05) continue;
          const grad = ctx.createLinearGradient(x, y, x + dir * w, y);
          grad.addColorStop(0, `rgba(255,236,150,${(0.45 * k).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(255,236,150,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(x, y - 1);
          ctx.lineTo(x + dir * w, y - 4 - 12 * k);
          ctx.lineTo(x + dir * w, y + 4 + 12 * k);
          ctx.lineTo(x, y + 1);
          ctx.closePath();
          ctx.fill();
        }
      },
    };
  }

  function aurora(w, y) {
    let t = 0;
    const bands = [['80,255,170', 0], ['120,170,255', 9]];
    return {
      step(dt) { t += dt; },
      draw(ctx) {
        for (const [colour, off] of bands) {
          for (let x = 0; x < w; x++) {
            const top = Math.round(y + off + Math.sin(x * 0.07 + t * 0.5 + off) * 4 + Math.sin(x * 0.023 - t * 0.25) * 4);
            const glow = 0.5 + 0.5 * Math.sin(x * 0.05 + t * 0.8 + off);
            for (let i = 0; i < 10; i++) {
              ctx.fillStyle = `rgba(${colour},${((0.28 - i * 0.026) * glow).toFixed(3)})`;
              ctx.fillRect(x, top + i, 1, 1);
            }
          }
        }
      },
    };
  }

  function rain(r, rect) {
    const list = Array.from({ length: Math.ceil((rect.w * rect.h) / 25) }, () => ({ x: r() * rect.w, y: r() * rect.h, v: 40 + r() * 30 }));
    return {
      step(dt) { for (const d of list) { d.y += d.v * dt; if (d.y > rect.h) { d.y = -2; d.x = r() * rect.w; } } },
      draw(ctx) {
        ctx.save();
        ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
        ctx.fillStyle = 'rgba(225,235,248,0.75)';
        for (const d of list) ctx.fillRect(Math.round(rect.x + d.x), Math.round(rect.y + d.y), 1, 2);
        ctx.restore();
      },
    };
  }

  // Lit windows that switch on and off now and then.
  function flicker(r, windows, on, off) {
    const state = windows.map(() => true);
    let wait = 0.5;
    return {
      step(dt) {
        if ((wait -= dt) > 0 || !windows.length) return;
        wait = 0.4 + r() * 1.5;
        const i = Math.floor(r() * windows.length);
        state[i] = !state[i];
      },
      draw(ctx) {
        windows.forEach(([x, y], i) => { if (!state[i]) { ctx.fillStyle = off; ctx.fillRect(x, y, 1, 1); } });
      },
    };
  }

  // ---------- Scenes ----------

  const draw = {};

  function ground(g, surface, soil, accents) {
    g.rect(0, g.gy, g.w, g.h - g.gy, soil);
    g.rect(0, g.gy, g.w, 2, surface);
    g.speckle(g.gy + 2, g.h, Math.ceil(g.w * 0.65), accents);
  }

  function grove(g, season) {
    const { w, gy, night } = g;
    const palette = {
      forest: ['#568b69', '#2d604d', '#154b3d', '#88af74', '#586347'],
      autumn: ['#daac72', '#b86c52', '#884c43', '#e1a451', '#775048'],
      winter: ['#b8d4de', '#7c9fac', '#466b82', '#e0eaf0', '#819eb3'],
    }[season];
    const [sky, distant, trees, grass, soil] = palette;
    g.sky(night ? '#131d32' : sky, night ? '#364f63' : '#eef1d0');
    g.ridge(Math.max(1, gy * 0.45), gy, night ? '#25384a' : distant, 8, 40);
    for (let x = 6; x < w + 9; x += 13 + Math.floor(g.r() * 12)) {
      const height = 11 + Math.floor(g.r() * 21);
      const bark = night ? '#303345' : soil;
      g.rect(x - 1, gy - height + 8, 3, height - 8, bark);
      const crown = night ? '#31475a' : trees;
      if (season === 'autumn') {
        g.ellipse(x, gy - height + 7, 7, 7, crown);
        g.ellipse(x - 2, gy - height + 5, 5, 4, night ? '#68546a' : grass);
      } else {
        for (let y = 0; y < height - 5; y++) {
          const width = 1 + Math.floor(y / 3);
          g.rect(x - width, gy - height + y, width * 2 + 1, 1, crown);
          if (season === 'winter' && y % 4 === 2) g.rect(x - width, gy - height + y, width, 1, grass);
        }
      }
    }
    ground(g, night ? '#66788a' : grass, night ? '#3c4356' : soil, [distant, trees]);
  }

  draw.forest = g => grove(g, 'forest');
  draw.autumn = g => grove(g, 'autumn');
  draw.winter = g => grove(g, 'winter');

  draw.beach = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#101d3c' : '#86cde6', night ? '#68577c' : '#ffd9a6');
    g.circle(Math.round(w * 0.7), Math.round(gy * 0.27), 6, night ? '#e1e1e9' : '#ffde88');
    const horizon = Math.floor(gy * 0.62);
    g.rect(0, horizon, w, gy - horizon, night ? '#386280' : '#57a6b9');
    g.rect(0, horizon, w, 1, night ? '#7594ac' : '#c4ebde');
    g.speckle(horizon + 2, gy - 2, Math.ceil(w * 0.6), night ? ['#658ca1', '#46788b'] : ['#83c5c7', '#a0d7d2']);
    ground(g, night ? '#c5b6ad' : '#fff0c5', night ? '#83798a' : '#dcb583', ['#aa8e80', '#ebc79e']);
  };

  draw.castle = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#16192e' : '#9796c1', night ? '#433a5b' : '#f1c5ae');
    g.ridge(gy * 0.37, gy, night ? '#33324d' : '#a78caa', 16, 26);
    const stone = night ? '#5c5c78' : '#9a8897';
    const trim = night ? '#757593' : '#c3a9a7';
    const window = night ? '#e7b56b' : '#5c4964';
    for (let x = Math.floor(w / 2) - 32; x < w; x += 26) {
      const tower = Math.max(12, Math.min(32, gy - 7)) - (Math.abs(x) % 3) * 3;
      const y = gy - tower;
      g.rect(x, y, 13, tower, stone);
      g.rect(x + 13, y + 10, 13, tower - 10, stone);
      for (let i = 0; i < 13; i += 5) g.rect(x + i, y - 3, 3, 4, trim);
      g.rect(x + 3, y + 6, 3, 5, window);
      g.rect(x, y + 3, 13, 1, trim);
    }
    ground(g, trim, stone, [window, '#7c7185']);
  };

  draw.lakefront = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#0b1630' : '#6fb7e6', night ? '#23406f' : '#d9f1fb');
    const cx = Math.round(w * 0.22), cy = Math.round(gy * 0.28);
    if (night) {
      g.circle(cx, cy, 4, '#f3efd2');
      g.px(cx - 1, cy - 1, '#d8d3b0'); g.px(cx + 2, cy + 1, '#d8d3b0');
    } else {
      g.circle(cx, cy, 6, '#fff7d1');
      g.circle(cx, cy, 4, '#ffe98a');
    }
    const wh = clamp(Math.round(gy * 0.24), 6, 30), wy = gy - wh;
    g.rect(0, wy, w, wh, night ? '#17305e' : '#3b8ccf');
    g.rect(0, wy, w, 1, night ? '#2b4b82' : '#86c6ee');
    g.speckle(wy + 1, gy - 1, Math.ceil((w * wh) / 10), night ? ['#24467a', '#1d3a6b'] : ['#68b0e4', '#4e9ad8']);
    // Sun or moon on the water: short dashes, wider near the shore.
    for (let y = wy + 2, i = 0; y < gy - 1; y += 2, i++) {
      const dw = 2 + Math.min(4, i) + (i % 2);
      g.rect(cx - Math.floor(dw / 2) + (g.r() < 0.5 ? 0 : 1), y, dw, 1, night ? '#c9c6a8' : '#fff3c0');
    }
    // Grosse Point lighthouse on its rocks.
    const T = clamp(Math.round(gy * 0.55), 14, 46);
    const bw = Math.max(5, Math.round(T * 0.26));
    const lx = w - Math.max(16, Math.round(w * 0.2));
    g.ellipse(lx + bw / 2, gy, bw + 4, 3, night ? '#3d404b' : '#7a7d86');
    const base = gy - 2;
    // Conical tower, shaded on the right, with a few small windows.
    for (let i = 0; i < T; i++) {
      const tw = Math.max(3, Math.round(bw - (i / T) * bw * 0.4));
      const x = Math.round(lx + (bw - tw) / 2);
      g.rect(x, base - i, tw, 1, night ? '#bdb59c' : '#efe6cc');
      g.rect(x + tw - Math.max(1, Math.round(tw / 4)), base - i, Math.max(1, Math.round(tw / 4)), 1, night ? '#968f78' : '#cdbf9e');
    }
    for (let i = 5; i < T - 4; i += 6) g.rect(Math.round(lx + bw / 2) - 1, base - i, 1, 2, night ? '#ffd86b' : '#3a3a3a');
    // Keeper's house.
    const kw = Math.max(6, Math.round(bw * 1.4)), kh = Math.max(4, Math.round(T * 0.18));
    g.rect(lx - kw, base - kh + 1, kw, kh, night ? '#9e917a' : '#e2d6b8');
    g.rect(lx - kw - 1, base - kh, kw + 2, 1, night ? '#5b2a22' : '#9c3b2e');
    g.px(lx - kw + 2, base - kh + 2, night ? '#ffd86b' : '#5b6b80');
    const top = base - T;
    g.rect(lx - 1, top, bw + 2, 1, '#1e1e1e');
    g.rect(lx + 1, top - 3, bw - 2, 3, night ? '#ffd86b' : '#fdf3c4');
    g.rect(lx + 1, top - 4, bw - 2, 1, '#1e1e1e');
    g.rect(lx + 2, top - 5, bw - 4, 1, '#1e1e1e');
    g.lantern = [lx + bw / 2, top - 2];
    // Sand.
    g.rect(0, gy, w, g.h - gy, night ? '#8b7c58' : '#ead9a5');
    g.rect(0, gy, w, 1, night ? '#6f6346' : '#cdb985');
    g.speckle(gy + 1, g.h, Math.ceil(w / 2), night ? ['#7a6d4d', '#9c8c66'] : ['#d9c58e', '#f4e6bb']);
    for (let i = 0; i < w / 18; i++) {
      const x = g.r() * w;
      for (let k = 0; k < 3; k++) g.rect(x + k, gy - 1 - Math.floor(g.r() * 3), 1, 3, night ? '#4f6b3a' : '#7fa35a');
    }
  };

  draw.city = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#0c0a24' : '#8ccbf3', night ? '#2d2254' : '#e4f3ff');
    if (night) g.circle(Math.round(w * 0.15), Math.round(gy * 0.18), 3, '#f2f0de');
    let x = 0;
    while (x < w) {
      const bw = 4 + Math.floor(g.r() * 6), bh = Math.round(gy * (0.25 + g.r() * 0.3));
      g.rect(x, gy - bh, bw, bh, night ? '#1f2347' : '#a9bdd3');
      x += bw;
    }
    g.windows = [];
    const lit = '#ffd36b';
    x = -Math.floor(g.r() * 5);
    while (x < w) {
      const bw = 6 + Math.floor(g.r() * 8);
      let bh = Math.max(8, Math.round(gy * (0.3 + g.r() * 0.42)));
      const kind = g.r();
      const c = night ? ['#14162e', '#191b38', '#101229'][Math.floor(g.r() * 3)] : ['#5d6f86', '#4e5d72', '#6b7b90'][Math.floor(g.r() * 3)];
      if (kind < 0.12) {
        // Stepped tower with two antennas.
        bh = Math.round(gy * 0.82);
        g.rect(x, gy - bh, bw, bh, c);
        g.rect(x + 1, gy - bh - 3, bw - 2, 3, c);
        g.rect(x + 2, gy - bh - 9, 1, 6, c);
        g.rect(x + bw - 3, gy - bh - 9, 1, 6, c);
        if (night) { g.px(x + 2, gy - bh - 10, '#ff4d4d'); g.px(x + bw - 3, gy - bh - 10, '#ff4d4d'); }
      } else if (kind < 0.2) {
        // Tapered tower.
        bh = Math.round(gy * 0.7);
        for (let i = 0; i < bh; i++) {
          const inset = Math.floor((i / bh) * 2);
          g.rect(x + inset, gy - i - 1, bw - inset * 2, 1, c);
        }
        g.rect(x + 2, gy - bh - 6, 1, 6, c);
        g.rect(x + bw - 3, gy - bh - 6, 1, 6, c);
      } else {
        g.rect(x, gy - bh, bw, bh, c);
      }
      for (let y = gy - bh + 2; y < gy - 2; y += 2) {
        for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
          if (night) {
            if (g.r() < 0.35) { g.px(wx, y, lit); g.windows.push([wx, y]); } else g.px(wx, y, '#262a52');
          } else if (g.r() < 0.7) g.px(wx, y, '#a8cbe6');
        }
      }
      x += bw + (g.r() < 0.3 ? 1 : 0);
    }
    g.windowOff = '#262a52';
    // Street.
    const fl = g.h - gy;
    g.rect(0, gy, w, Math.ceil(fl * 0.35), night ? '#4b4a55' : '#bdb8ad');
    g.rect(0, gy, w, 1, night ? '#5c5b66' : '#d4cfc4');
    g.rect(0, gy + Math.ceil(fl * 0.35), w, g.h, night ? '#24242c' : '#5b5b62');
    const lane = gy + Math.ceil(fl * 0.35) + Math.floor((fl * 0.65) / 2);
    for (let lx = 2; lx < w; lx += 9) g.rect(lx, lane, 4, 1, night ? '#8a7d45' : '#e8d27a');
    for (let lx = 10; lx < w; lx += 46) {
      g.rect(lx, gy - 9, 1, 9, night ? '#0c0c14' : '#3d3f46');
      g.rect(lx - 1, gy - 10, 3, 1, night ? '#0c0c14' : '#3d3f46');
      g.px(lx, gy - 9, night ? '#ffe9a3' : '#d8d2b8');
      if (night) g.glow(lx + 0.5, gy - 8.5, 7, '255,225,150');
    }
  };

  draw.space = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#05030f' : '#221d58', night ? '#170f36' : '#4a3d8e');
    for (let i = 0; i < 3; i++) {
      g.dither(g.r() * w, g.r() * gy * 0.8, 10 + Math.floor(g.r() * 14), ['rgba(170,90,220,0.5)', 'rgba(60,190,200,0.4)', 'rgba(230,110,160,0.4)'][i]);
    }
    g.speckle(0, gy, Math.ceil((w * gy) / 40), ['rgba(255,255,255,0.45)', 'rgba(200,210,255,0.35)']);
    // Ringed planet.
    const R = clamp(Math.round(Math.min(w, gy) * 0.13), 5, 16);
    const cx = Math.round(w * 0.76), cy = Math.round(gy * 0.32);
    const ring = night ? '#c9b88f' : '#e6d6ac';
    for (let x = -Math.round(R * 1.9); x <= Math.round(R * 1.9); x++) {
      const y = Math.round(Math.sqrt(Math.max(0, 1 - (x / (R * 1.9)) ** 2)) * R * 0.45);
      g.px(cx + x, cy - y, ring);
    }
    const bands = ['#e3ab6c', '#c98a4d', '#ecc48e', '#d39a5c'];
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        if (x * x + y * y > R * R) continue;
        const shade = Math.hypot(x + R * 0.45, y + R * 0.45) > R * 1.15;
        g.px(cx + x, cy + y, shade ? '#8f5d33' : bands[Math.floor((y + R) / Math.max(2, R / 3)) % 4]);
      }
    }
    for (let x = -Math.round(R * 1.9); x <= Math.round(R * 1.9); x++) {
      const y = Math.round(Math.sqrt(Math.max(0, 1 - (x / (R * 1.9)) ** 2)) * R * 0.45);
      g.px(cx + x, cy + y, ring); // front half of the ring, over the planet
    }
    g.circle(Math.round(w * 0.18), Math.round(gy * 0.2), 2, '#b8bccb');
    // Moon surface.
    g.rect(0, gy, w, g.h - gy, night ? '#6e6d7c' : '#9c9baa');
    g.rect(0, gy, w, 1, night ? '#8a8999' : '#b9b8c6');
    for (let i = 0; i < w / 14; i++) {
      const x = g.r() * w, y = gy + 2 + g.r() * Math.max(1, g.h - gy - 4), rx = 2 + Math.floor(g.r() * 5);
      g.ellipse(x, y, rx, 1, night ? '#56556a' : '#7d7c8c');
      g.rect(x - rx + 1, y + 1, rx * 2 - 1, 1, night ? '#82819a' : '#b3b2c2');
    }
    const fx = Math.round(w * 0.1);
    g.rect(fx, gy - 9, 1, 9, '#d9d9e3');
    g.rect(fx + 1, gy - 9, 5, 3, '#e04848');
    g.rect(fx + 1, gy - 9, 2, 1, '#3d5bd9');
  };

  draw.dojo = g => {
    const { w, gy, night } = g;
    const plaster = night ? '#5b5547' : '#eee6d6';
    const beamC = night ? '#2e1f13' : '#5b3a22';
    g.rect(0, g.top, w, gy - g.top, plaster);
    const wain = gy - Math.round(gy * 0.32);
    g.rect(0, wain, w, gy - wain, night ? '#5c3f27' : '#b07a48');
    for (let x = 0; x < w; x += 4) g.rect(x, wain, 1, gy - wain, night ? '#4c3420' : '#9a683b');
    g.rect(0, wain - 1, w, 2, beamC);
    const beamY = Math.round(gy * 0.16);
    g.rect(0, beamY, w, 2, beamC);
    for (let x = 6; x < w; x += 44) g.rect(x, g.top, 2, wain - g.top, beamC);
    // Belt rack: white, blue, purple, brown, black.
    const rackY = Math.round(gy * 0.3), rackX = 12, L = clamp(Math.round(gy * 0.3), 6, 16);
    const belts = [['#f4f4f4', '#1b1b1b'], ['#2f62c9', '#1b1b1b'], ['#7b3fb5', '#1b1b1b'], ['#7a4a24', '#1b1b1b'], ['#1b1b1b', '#c62828']];
    g.rect(rackX - 2, rackY, belts.length * 4 + 3, 1, beamC);
    belts.forEach(([c, bar], i) => {
      const bx = rackX + i * 4;
      g.rect(bx, rackY + 1, 2, L, night ? mix(c, '#000000', 0.35) : c);
      g.rect(bx, rackY + L - 3, 2, 2, bar);
    });
    // Clock.
    const ccx = Math.round(w * 0.5), ccy = Math.round(gy * 0.32);
    g.circle(ccx, ccy, 4, beamC);
    g.circle(ccx, ccy, 3, night ? '#cfc9b6' : '#ffffff');
    g.rect(ccx, ccy - 2, 1, 3, '#222'); g.rect(ccx, ccy, 2, 1, '#222');
    // Shoji window.
    const ww = clamp(Math.round(w * 0.2), 12, 30), wh = clamp(Math.round(gy * 0.3), 8, 20);
    const sx = w - ww - 10, sy = beamY + 4;
    g.rect(sx - 1, sy - 1, ww + 2, wh + 2, beamC);
    g.rect(sx, sy, ww, wh, night ? '#39425f' : '#fbf6e6');
    for (let x = sx + 3; x < sx + ww; x += 4) g.rect(x, sy, 1, wh, beamC);
    for (let y = sy + 3; y < sy + wh; y += 4) g.rect(sx, y, ww, 1, beamC);
    g.light = { x: sx, y: sy, w: ww, h: wh };
    // Mats.
    const mat = night ? '#1c3868' : '#2d5aa8';
    g.rect(0, gy, w, g.h - gy, mat);
    g.rect(0, gy, w, 1, night ? '#2a4a82' : '#4a78c8');
    for (let x = 0; x < w; x += 16) {
      if (x === 0 || x + 16 >= w) g.rect(x, gy + 1, 16, g.h - gy, night ? '#6e2626' : '#b33a3a');
      g.rect(x, gy + 1, 1, g.h - gy, night ? '#132a52' : '#21478a');
    }
  };

  draw.mountains = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#040a1c' : '#78b0e6', night ? '#16294d' : '#ffd3a3');
    if (night) g.circle(Math.round(w * 0.2), Math.round(gy * 0.2), 3, '#f1eedb');
    else g.circle(Math.round(w * 0.68), Math.round(gy * 0.52), 6, '#fff1b8');
    const far = g.ridge(gy * 0.22, gy * 0.6, night ? '#2a3a63' : '#a9badd', 11, 26);
    const snow = night ? '#a7b6d8' : '#f6f8ff';
    const peak = Math.min(...far);
    far.forEach((y, x) => { if (y < peak + gy * 0.1) g.rect(x, y, 1, 2 + (y < peak + 3 ? 1 : 0), snow); });
    g.ridge(gy * 0.45, gy * 0.75, night ? '#1f2d50' : '#7f97c6', 23, 18);
    const near = g.ridge(gy * 0.68, gy * 0.92, night ? '#14203a' : '#536f93', 37, 12);
    for (let i = 0; i < w / 7; i++) {
      const x = Math.floor(g.r() * w), th = 5 + Math.floor(g.r() * 7);
      const base = Math.max(near[x] || gy, gy - 2) + 1;
      for (let k = 0; k < th; k++) {
        const half = Math.floor((k / th) * 3);
        g.rect(x - half, base - th + k, half * 2 + 1, 1, night ? '#11241a' : '#2f5634');
      }
    }
    g.rect(0, gy, w, g.h - gy, night ? '#283f22' : '#689a43');
    g.rect(0, gy, w, 1, night ? '#35522c' : '#82b558');
    if (!night) g.speckle(gy + 1, g.h, Math.ceil(w / 6), ['#f7e36b', '#f08aa8', '#ffffff']);
  };

  draw.room = g => {
    const { w, gy, night } = g;
    g.rect(0, g.top, w, gy - g.top, night ? '#3a3350' : '#efe1c6');
    for (let x = 3; x < w; x += 6) g.rect(x, g.top, 1, gy - g.top, night ? '#342e49' : '#e6d5b6');
    g.rect(0, gy - 2, w, 2, night ? '#2b2540' : '#c8b38c');
    // Window.
    const ww = clamp(Math.round(w * 0.28), 16, 40), wh = clamp(Math.round(gy * 0.45), 12, 36);
    const wx = Math.round(w * 0.1), wy = Math.round(gy * 0.14);
    g.rect(wx - 2, wy - 2, ww + 4, wh + 4, '#7d5232');
    for (let y = 0; y < wh; y++) g.rect(wx, wy + y, ww, 1, night ? mix('#0e1430', '#22305e', y / wh) : mix('#8e9fb2', '#c7d2dd', y / wh));
    if (night) g.circle(wx + ww - 5, wy + 4, 2, '#f1eedb');
    g.rect(wx + Math.floor(ww / 2), wy, 1, wh, '#7d5232');
    g.rect(wx, wy + Math.floor(wh / 2), ww, 1, '#7d5232');
    g.rect(wx - 3, wy + wh + 2, ww + 6, 2, '#8f6040');
    g.rect(wx - 5, wy - 3, 3, wh + 4, night ? '#7a3434' : '#c0504d');
    g.rect(wx + ww + 2, wy - 3, 3, wh + 4, night ? '#7a3434' : '#c0504d');
    g.rect(wx - 6, wy - 4, ww + 12, 1, '#5a3a22');
    g.window = { x: wx, y: wy, w: ww, h: wh };
    // Picture.
    const px = Math.round(w * 0.5) - 4, py = Math.round(gy * 0.2);
    g.rect(px - 1, py - 1, 10, 8, '#6b4426');
    g.rect(px, py, 8, 3, night ? '#3a4f7a' : '#8ec5ea');
    g.rect(px, py + 3, 8, 3, night ? '#355236' : '#77b05a');
    // Bookshelf.
    const bw = clamp(Math.round(w * 0.16), 12, 28), sh = clamp(Math.round(gy * 0.6), 14, 44);
    const bx = w - bw - 6, by = gy - sh;
    g.rect(bx - 1, by - 1, bw + 2, sh + 1, '#5e3b20');
    g.rect(bx, by, bw, sh, night ? '#2a1c12' : '#3f2817');
    const spines = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#4bacc6', '#e07b39'];
    for (let y = by + 7; y <= gy; y += 7) {
      g.rect(bx, y, bw, 1, '#5e3b20');
      let x = bx;
      while (x < bx + bw - 1) {
        const bkw = 1 + Math.floor(g.r() * 2), bkh = 4 + Math.floor(g.r() * 3);
        if (g.r() > 0.12) g.rect(x, y - bkh, bkw, bkh, night ? mix(spines[Math.floor(g.r() * 7)], '#000000', 0.4) : spines[Math.floor(g.r() * 7)]);
        x += bkw;
      }
    }
    // Plant.
    const plx = bx - 10;
    g.rect(plx, gy - 5, 6, 5, '#c46a3c');
    g.rect(plx - 1, gy - 6, 8, 1, '#a85a32');
    const leaf = night ? '#2f5a35' : '#4c9a52';
    for (let i = 0; i < 6; i++) {
      const lh = 4 + Math.floor(g.r() * 6), lx = plx + 1 + Math.floor(g.r() * 4);
      g.rect(lx, gy - 6 - lh, 1, lh, leaf);
      g.rect(lx - 1 + Math.floor(g.r() * 3), gy - 6 - lh, 2, 1, leaf);
    }
    // Floor lamp.
    const lx = wx + ww + 10;
    g.rect(lx, gy - 20, 1, 20, '#3a3a3a');
    g.rect(lx - 3, gy - 24, 7, 1, night ? '#ffd98a' : '#d9c08a');
    g.rect(lx - 2, gy - 25, 5, 1, night ? '#ffd98a' : '#d9c08a');
    g.rect(lx - 4, gy - 23, 9, 2, night ? '#f6c768' : '#cbb07a');
    if (night) g.glow(lx + 0.5, gy - 21, 16, '255,214,140');
    // Floor and rug.
    g.rect(0, gy, w, g.h - gy, night ? '#4a3221' : '#a56d3d');
    for (let y = gy + 2; y < g.h; y += 3) {
      g.rect(0, y, w, 1, night ? '#3d2a1b' : '#8e5d33');
      for (let x = (y * 7) % 13; x < w; x += 13) g.px(x, y - 1, night ? '#3d2a1b' : '#8e5d33');
    }
    const rw = Math.round(w * 0.5), rx = Math.round((w - rw) / 2);
    g.rect(rx, gy + 1, rw, g.h - gy - 2, night ? '#6e2a25' : '#b5483c');
    g.rect(rx + 1, gy + 2, rw - 2, 1, night ? '#8f6a3a' : '#e0a458');
    g.rect(rx + 1, g.h - 3, rw - 2, 1, night ? '#8f6a3a' : '#e0a458');
    for (let x = rx + 3; x < rx + rw - 3; x += 4) g.px(x, gy + 4, night ? '#8f6a3a' : '#e0a458');
  };

  draw.blossom = g => {
    const { w, gy, night } = g;
    g.sky(night ? '#191636' : '#a6daff', night ? '#3f3266' : '#fff0f5');
    if (night) g.circle(Math.round(w * 0.78), Math.round(gy * 0.22), 6, '#fff6e2');
    g.ridge(gy * 0.55, gy * 0.8, night ? '#2a3150' : '#bcd8c0', 5, 30);
    // Torii.
    const tx = Math.round(w * 0.68), th = clamp(Math.round(gy * 0.42), 12, 30), tw = clamp(Math.round(th * 0.9), 10, 26);
    const red = night ? '#7a2620' : '#d43d2f';
    g.rect(tx, gy - th, 2, th, red);
    g.rect(tx + tw, gy - th, 2, th, red);
    g.rect(tx - 2, gy - th + 3, tw + 6, 1, red);
    g.rect(tx - 3, gy - th - 1, tw + 8, 2, '#2b2b2b');
    g.rect(tx + Math.floor(tw / 2), gy - th + 1, 2, 2, red);
    // Cherry trees.
    const pinks = night ? ['#b9728f', '#a35f7c', '#d39ab3'] : ['#f8b7cd', '#f49ac1', '#fcd5e3'];
    const trees = [Math.round(w * 0.14), Math.round(w * 0.42), Math.round(w * 0.92)];
    for (const x of trees) {
      const h = clamp(Math.round(gy * 0.38), 10, 30);
      g.rect(x, gy - h, 2, h, night ? '#3e2a22' : '#5a3a2e');
      g.rect(x - 3, gy - h + 2, 3, 1, night ? '#3e2a22' : '#5a3a2e');
      g.rect(x + 2, gy - h + 4, 4, 1, night ? '#3e2a22' : '#5a3a2e');
      const cr = clamp(Math.round(h * 0.45), 5, 14);
      for (let k = 0; k < 5; k++) {
        g.circle(x + Math.round((g.r() - 0.5) * cr * 1.6), gy - h - Math.round(g.r() * cr * 0.6), Math.round(cr * (0.5 + g.r() * 0.35)), pinks[k % 3]);
      }
      g.dither(x, gy - h - 2, cr, pinks[2], 0.5);
    }
    g.rect(0, gy, w, g.h - gy, night ? '#33522f' : '#8cc47a');
    g.rect(0, gy, w, 1, night ? '#41663b' : '#a5d692');
    g.speckle(gy + 1, g.h, Math.ceil(w / 3), pinks);
  };

  // ---------- Effects per theme ----------

  function effectsFor(theme, g, w, h, night) {
    const r = rng(99);
    const sky = g ? g.gy : Math.round(h * 0.45);
    const back = [], front = [];
    // Stars for the extra sky above a capped outdoor scene.
    if (g && g.top < 0 && night && !['room', 'dojo'].includes(theme)) {
      back.push(twinkle(r, Math.ceil((w * -g.top) / 110), 0, g.top, w, 0));
    }
    switch (theme) {
      case 'forest':
      case 'beach':
        if (night) back.push(twinkle(r, Math.ceil(w / 8), 0, 0, w, sky * 0.4));
        break;
      case 'winter':
        front.push(falling(r, w, h, { n: Math.ceil(w / 4), colours: ['rgba(255,255,255,0.9)', 'rgba(230,240,255,0.8)'], speed: [5, 12] }));
        break;
      case 'autumn':
        front.push(falling(r, w, h, { n: Math.ceil(w / 10), colours: ['#d9622b', '#e8a33d', '#b8432c', '#f0c75e'], speed: [6, 12], sway: 8 }));
        break;
      case 'lakefront': {
        const wy = g.gy - clamp(Math.round(g.gy * 0.24), 6, 30);
        if (night) {
          back.push(twinkle(r, Math.ceil(w / 6), 0, 0, w, wy - 2));
          back.push(beam(g.lantern[0], g.lantern[1], w));
        } else {
          back.push(gulls(r, w, wy * 0.5));
          back.push(sparkles(r, 0, wy + 1, w, g.gy - 1, Math.ceil(w / 20)));
        }
        break;
      }
      case 'city':
        if (night) {
          back.push(twinkle(r, Math.ceil(w / 12), 0, 0, w, sky * 0.18));
          back.push(flicker(r, g.windows, '#ffd36b', g.windowOff));
        } else back.push(clouds(r, w, sky * 0.3));
        break;
      case 'space':
        back.push(twinkle(r, Math.ceil(w / 4), 0, 0, w, sky - 1, '235,240,255'));
        back.push(shootingStars(r, w, sky));
        break;
      case 'dojo':
        if (!night) back.push(sparkles(r, g.light.x - 10, g.light.y, g.light.x + g.light.w, sky, 5, '255,250,230'));
        break;
      case 'mountains':
        if (night) {
          back.push(aurora(w, Math.round(sky * 0.08)));
          back.push(twinkle(r, Math.ceil(w / 6), 0, 0, w, sky * 0.45));
        } else back.push(clouds(r, w, sky * 0.25));
        break;
      case 'room':
        if (night) back.push(twinkle(r, Math.ceil(g.window.w / 3), g.window.x, g.window.y, g.window.x + g.window.w, g.window.y + g.window.h));
        else back.push(rain(r, g.window));
        break;
      case 'blossom':
        front.push(falling(r, w, h, { n: Math.ceil(w / 8), colours: night ? ['#d39ab3', '#b9728f'] : ['#f8b7cd', '#f49ac1', '#ffffff'], speed: [5, 11], sway: 7 }));
        break;
    }
    return { back, front };
  }

  // ---------- Public API ----------

  // Draws theme into the canvases (each sized to cover the panel) and returns
  // its effects as { step(dt), draw() }, or null when there's nothing to animate.
  function build(theme, { width, height, size, kind, effects }, canvases) {
    const P = SCENES.includes(theme) ? PIXEL[size] || 2 : 2;
    const w = Math.ceil(width / P), h = Math.ceil(height / P);
    for (const c of canvases) {
      c.width = w; c.height = h;
      c.style.width = `${w * P}px`; c.style.height = `${h * P}px`;
      c.getContext('2d').clearRect(0, 0, w, h);
    }
    const [back, fxBack, fxFront] = canvases.map(c => c.getContext('2d'));
    const night = kind !== 'light';
    let g = null, off = 0;
    if (SCENES.includes(theme)) {
      off = Math.max(0, h - MAX_SCENE);
      back.setTransform(1, 0, 0, 1, 0, off);
      g = painter(back, w, h - off, h - off - FLOOR[size] / P, night, theme.length * 7919, -off);
      draw[theme](g);
      back.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (!effects) return null;
    const fx = effectsFor(theme, g, w, h, night);
    if (!fx.back.length && !fx.front.length) return null;
    return {
      step(dt) { for (const e of fx.back.concat(fx.front)) e.step(dt); },
      draw() {
        fxBack.setTransform(1, 0, 0, 1, 0, 0);
        fxBack.clearRect(0, 0, w, h);
        fxFront.clearRect(0, 0, w, h);
        fxBack.setTransform(1, 0, 0, 1, 0, off); // back effects use the scene's coordinates
        for (const e of fx.back) e.draw(fxBack);
        for (const e of fx.front) e.draw(fxFront);
      },
    };
  }

  window.PetsScenes = {
    names: SCENES,
    has: theme => SCENES.includes(theme),
    floor: size => FLOOR[size] || FLOOR.nano,
    build,
  };
})();
