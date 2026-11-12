// Unit checks for src/care.js. Run with test/unit.sh (uses VS Code's bundled Node).
const assert = require('assert');
const care = require('../src/care');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`PASS  ${name}`); } catch (e) { results.push(`FAIL  ${name}: ${e.message}`); }
};

check('levels: 60 XP is level 2, 180 is level 3', () => {
  assert.strictEqual(care.levelFor(0).level, 1);
  assert.strictEqual(care.levelFor(59).level, 1);
  assert.strictEqual(care.levelFor(60).level, 2);
  assert.deepStrictEqual(care.levelFor(200), { level: 3, into: 20, need: 180 });
});

check('decay is gentle and capped offline', () => {
  const p = care.newPet({ type: 'cat', color: 'brown', name: 'x' });
  care.decay(p, 1);
  assert.strictEqual(p.food, 76);
  assert.strictEqual(p.mood, 78);
  const q = care.newPet({ type: 'cat', color: 'brown', name: 'y' });
  care.decay(q, 1000); // a month away counts as 12 hours
  assert.strictEqual(q.food, 32);
  assert.ok(q.mood >= 10);
});

check('mood never drops below the floor', () => {
  const p = care.newPet({ type: 'cat', color: 'brown', name: 'x' });
  for (let i = 0; i < 20; i++) care.decay(p, 12);
  assert.strictEqual(p.mood, 10);
  assert.strictEqual(p.food, 0);
});

check('feeding: full pets refuse', () => {
  const p = care.newPet({ type: 'cat', color: 'brown', name: 'x' });
  p.food = 50;
  assert.strictEqual(care.feed(p), true);
  assert.strictEqual(p.food, 85);
  p.food = 95;
  assert.strictEqual(care.feed(p), false);
  assert.strictEqual(p.fed, 1);
});

check('level-up unlocks a colour every 3 levels', () => {
  const p = care.newPet({ type: 'cat', color: 'brown', name: 'x' });
  const colours = ['black', 'brown', 'gray', 'orange'];
  assert.strictEqual(care.addXp(p, 60, colours), 2);
  assert.deepStrictEqual(p.unlocked, ['brown']);
  assert.strictEqual(care.addXp(p, 120, colours), 3); // 180 total
  assert.deepStrictEqual(p.unlocked, ['brown', 'black']);
  assert.strictEqual(care.addXp(p, 1, colours), 0);
});

check('streak: 15 minutes a day, consecutive days', () => {
  const s = { streak: 0 };
  const day1 = new Date(2026, 9, 25, 10).getTime();
  const day2 = new Date(2026, 9, 26, 10).getTime();
  const day4 = new Date(2026, 9, 28, 10).getTime();
  for (let i = 0; i < 15; i++) care.addCodingMinute(s, day1);
  assert.strictEqual(s.streak, 1);
  for (let i = 0; i < 20; i++) care.addCodingMinute(s, day2);
  assert.strictEqual(s.streak, 2);
  assert.strictEqual(care.currentStreak(s, day2), 2);
  assert.strictEqual(care.currentStreak(s, day4), 0); // missed a day
  for (let i = 0; i < 15; i++) care.addCodingMinute(s, day4);
  assert.strictEqual(s.streak, 1);
});

check('test command detection', () => {
  const { TEST_RE } = require('../src/detect');
  for (const ok of ['pytest -q', 'python -m pytest tests/', 'npm test', 'npm run test', 'go test ./...', 'cargo test', 'python -m unittest', 'make test'])
    assert.ok(TEST_RE.test(ok), ok);
  for (const no of ['ls', 'git commit -m "test"', 'npm install', 'cat test.py'])
    assert.ok(!TEST_RE.test(no), no);
});

console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
