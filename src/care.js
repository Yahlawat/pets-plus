// Care and progression rules. Pure functions on plain objects, no vscode,
// so test/care.test.js can run them outside the editor.

const HOUR = 3600 * 1000;

// Gentle: things drift down slowly and never hit rock bottom.
const FOOD_PER_HOUR = 4;        // full to empty in about a day
const MOOD_PER_HOUR = 2;
const HUNGRY_MOOD_PER_HOUR = 2; // extra mood loss while hungry
const HUNGRY_BELOW = 30;
const MOOD_FLOOR = 10;
const MAX_OFFLINE_HOURS = 12;   // a weekend away counts as half a day

const XP = { codingMinute: 1, save: 2, commit: 15, testsPass: 10, focusBlock: 25 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function newPet({ type, color, name, now = Date.now() }) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type, color, name,
    born: now,
    xp: 0,
    mood: 80,
    food: 80,
    petted: 0,
    fed: 0,
    unlocked: [color],
  };
}

// XP needed to go from level n to n+1 is 60n, so level 2 is an hour of typing.
function levelFor(xp) {
  let level = 1, need = 60;
  while (xp >= need) { xp -= need; level++; need = 60 * level; }
  return { level, into: xp, need };
}

// Applies decay for the time since the last tick. Offline gaps are capped.
function decay(pet, hours) {
  hours = clamp(hours, 0, MAX_OFFLINE_HOURS);
  pet.food = clamp(pet.food - FOOD_PER_HOUR * hours, 0, 100);
  let moodLoss = MOOD_PER_HOUR * hours;
  if (pet.food < HUNGRY_BELOW) moodLoss += HUNGRY_MOOD_PER_HOUR * hours;
  pet.mood = clamp(pet.mood - moodLoss, Math.min(pet.mood, MOOD_FLOOR), 100);
  return pet;
}

// Returns false when the pet is already full, so the panel can say so.
function feed(pet) {
  if (pet.food >= 90) return false;
  pet.food = clamp(pet.food + 35, 0, 100);
  pet.mood = clamp(pet.mood + 5, 0, 100);
  pet.fed++;
  return true;
}

function petIt(pet) {
  pet.mood = clamp(pet.mood + 3, 0, 100);
  pet.petted++;
  return pet;
}

function cheer(pet, amount) {
  pet.mood = clamp(pet.mood + amount, 0, 100);
  return pet;
}

// Adds XP. Returns the new level if it went up, else 0.
function addXp(pet, amount, colours) {
  const before = levelFor(pet.xp).level;
  pet.xp += amount;
  const after = levelFor(pet.xp).level;
  if (after > before) {
    unlockColours(pet, after, colours);
    return after;
  }
  return 0;
}

// One extra colour of the same pet every 3 levels.
function unlockColours(pet, level, colours) {
  if (!colours) return;
  const want = 1 + Math.floor(level / 3);
  for (const c of colours) {
    if (pet.unlocked.length >= want) break;
    if (!pet.unlocked.includes(c)) pet.unlocked.push(c);
  }
}

function moodFace(mood) {
  if (mood >= 75) return '😊';
  if (mood >= 50) return '🙂';
  if (mood >= 25) return '😐';
  return '😢';
}

const isHungry = pet => pet.food < HUNGRY_BELOW;

// Local calendar day, YYYY-MM-DD.
function dayKey(now = Date.now()) {
  const d = new Date(now);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A day counts toward the streak once it has 15 coding minutes.
const STREAK_MINUTES = 15;

function addCodingMinute(stats, now = Date.now()) {
  const today = dayKey(now);
  if (stats.today !== today) { stats.today = today; stats.minutesToday = 0; }
  stats.minutesToday++;
  if (stats.minutesToday === STREAK_MINUTES && stats.lastStreakDay !== today) {
    const yesterday = dayKey(new Date(now).setDate(new Date(now).getDate() - 1));
    stats.streak = stats.lastStreakDay === yesterday ? (stats.streak || 0) + 1 : 1;
    stats.lastStreakDay = today;
  }
  return stats;
}

// Streak shown to you: zero once a whole day has gone by without one.
function currentStreak(stats, now = Date.now()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now).setDate(new Date(now).getDate() - 1));
  return stats.lastStreakDay === today || stats.lastStreakDay === yesterday ? stats.streak || 0 : 0;
}

module.exports = {
  HOUR, XP, newPet, levelFor, decay, feed, petIt, cheer, addXp,
  moodFace, isHungry, dayKey, addCodingMinute, currentStreak, STREAK_MINUTES,
};
