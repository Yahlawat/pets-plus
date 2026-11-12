// Pets+: pets in the Explorer that react to your coding, get hungry, level up,
// and sit with you through focus blocks. Plain JS with no dependencies, so
// there's no build step. The panel (media/panel.js) only animates; the stats
// live here, in globalState.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const care = require('./care');
const { TEST_RE } = require('./detect');
const { readOldPets } = require('./import-pets');

const STATE_KEY = 'petsPlus.state';
const MINUTE = 60 * 1000;
const RECENT_EDIT_MS = 15000;
const CTRL_C_EXIT = 130;

const EMOJI = {
  bunny: '🐇', cat: '🐈', chicken: '🐔', clippy: '📎', cockatiel: '🦜', crab: '🦀', deno: '🦕',
  dog: '🐕', fox: '🦊', frog: '🐸', horse: '🐎', mod: '🤖', monkey: '🐒', morph: '🟣', panda: '🐼',
  raccoon: '🦝', rat: '🐀', rocky: '🪨', 'rubber-duck': '🦆', skeleton: '💀', snail: '🐌',
  snake: '🐍', squirrel: '🐿️', totoro: '🌳', turtle: '🐢', zappy: '⚡',
};
const NAMES = ['Biscuit', 'Pixel', 'Mochi', 'Byte', 'Pepper', 'Noodle', 'Ziggy', 'Waffles', 'Echo', 'Juniper', 'Tofu', 'Comet'];
const THEMES = ['none', 'forest', 'castle', 'beach', 'winter', 'autumn',
  'lakefront', 'city', 'space', 'dojo', 'mountains', 'room', 'blossom'];

let ctx, manifest, state, provider;
let petItem, timerItem;
let lastActivity = Date.now();
let lastTyped = 0;
let asleep = false;
let keystrokes = [];
let lastTypingPost = 0;
let lastFastPost = 0;
let lastSaveXp = 0;
let lastSavePost = 0;
let diagSettled = new Map(); // uri -> error count at the last check
let diagTimers = new Map();
let lastEdit = new Map();
let saveTimer = null;
let panelReady = false;

const config = () => vscode.workspace.getConfiguration('petsPlus');

// ---------- State ----------

function load() {
  state = ctx.globalState.get(STATE_KEY) || {};
  state.pets = state.pets || [];
  state.removed = state.removed || [];
  state.stats = state.stats || { saves: 0, commits: 0, focusBlocks: 0, streak: 0 };
  state.lastTick = state.lastTick || Date.now();
  state.focus = state.focus || null;
}

// Writes are batched: petting a pet ten times shouldn't mean ten writes.
function save(now = false) {
  clearTimeout(saveTimer);
  if (now) return ctx.globalState.update(STATE_KEY, state);
  saveTimer = setTimeout(() => ctx.globalState.update(STATE_KEY, state), 2000);
}

const coloursOf = type => Object.hasOwn(manifest, type) ? Object.keys(manifest[type]) : [];
const findPet = id => state.pets.find(p => p.id === id);

function buddy() {
  return findPet(state.buddy) || state.pets[0];
}

function view(pet) {
  const lv = care.levelFor(pet.xp);
  return {
    ...pet,
    level: lv.level,
    into: lv.into,
    need: lv.need,
    ageDays: Math.floor((Date.now() - pet.born) / (24 * care.HOUR)),
    face: care.moodFace(pet.mood),
    hungry: care.isHungry(pet),
  };
}

function globals() {
  const today = care.dayKey();
  return {
    streak: care.currentStreak(state.stats),
    minutesToday: state.stats.today === today ? state.stats.minutesToday : 0,
  };
}

// ---------- Panel ----------

function post(msg) {
  if (provider && provider.view) provider.view.webview.postMessage(msg);
}

function sendPets() {
  post({ type: 'pets', pets: state.pets.map(view), global: globals() });
  updateStatusBar();
}

function react(kind, extra = {}) {
  if (!config().get('reactions')) return;
  post({ type: 'event', kind, ...extra });
}

function initMessage() {
  const v = provider.view;
  return {
    type: 'init',
    size: config().get('size'),
    theme: config().get('theme'),
    effects: config().get('effects'),
    media: v.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media')).toString(),
    manifest,
    focus: state.focus && state.focus.mode === 'focus',
    pets: state.pets.map(view),
    global: globals(),
  };
}

class Provider {
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const src = webviewView.webview.cspSource;
    const uri = f => webviewView.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${src}; style-src ${src} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('panel.css')}">
<title>Pets+</title>
</head>
<body>
<script nonce="${nonce}" src="${uri('scenes.js')}"></script>
<script nonce="${nonce}" src="${uri('species.js')}"></script>
<script nonce="${nonce}" src="${uri('panel.js')}"></script>
</body>
</html>`;
    webviewView.webview.onDidReceiveMessage(onPanelMessage);
    webviewView.onDidDispose(() => { this.view = null; });
  }
}

function onPanelMessage(msg) {
  const pet = msg.id && findPet(msg.id);
  switch (msg.type) {
    case 'ready':
      panelReady = true;
      post(initMessage());
      break;
    case 'petted':
      if (!pet) return;
      care.petIt(pet);
      state.buddy = pet.id;
      save();
      sendPets();
      break;
    case 'feed':
      if (pet) feedPets([pet]);
      break;
    case 'colour':
      if (pet && pet.unlocked.includes(msg.color)) {
        pet.color = msg.color;
        save();
        sendPets();
      }
      break;
    case 'rename': {
      const name = String(msg.name || '').trim().slice(0, 24);
      if (pet && name) {
        pet.name = name;
        state.buddy = pet.id;
        save();
        sendPets();
      }
      break;
    }
  }
}

// ---------- Care ----------

function grantXp(amount) {
  for (const pet of state.pets) {
    const level = care.addXp(pet, amount, coloursOf(pet.type));
    if (level) react('levelUp', { id: pet.id, level });
  }
}

function feedPets(list) {
  const results = list.map(pet => ({ id: pet.id, ate: care.feed(pet) }));
  if (list.length === 1) state.buddy = list[0].id;
  save();
  post({ type: 'event', kind: 'feed', results });
  sendPets();
  return results;
}

// Runs every minute: drift, coding time, streak.
function tick() {
  const now = Date.now();
  const hours = (now - state.lastTick) / care.HOUR;
  state.lastTick = now;
  for (const pet of state.pets) care.decay(pet, hours);

  if (now - lastTyped < MINUTE) {
    care.addCodingMinute(state.stats, now);
    grantXp(care.XP.codingMinute);
    if (state.stats.minutesToday % 10 === 0) for (const pet of state.pets) care.cheer(pet, 1);
  }
  save();
  sendPets();
}

// ---------- Activity, idle and typing ----------

function active() {
  lastActivity = Date.now();
  if (asleep) {
    asleep = false;
    react('wake');
  }
}

function checkIdle() {
  const limit = config().get('idleMinutes') * MINUTE;
  if (!asleep && limit > 0 && Date.now() - lastActivity > limit) {
    asleep = true;
    react('sleep');
  }
}

function onTextChange(e) {
  const ed = vscode.window.activeTextEditor;
  if (!ed || e.document !== ed.document || !e.contentChanges.length) return;
  const now = Date.now();
  lastEdit.set(e.document.uri.toString(), now);
  lastTyped = now;
  active();

  keystrokes.push(now);
  keystrokes = keystrokes.filter(t => now - t < 5000);
  // About 5 edits a second (60 wpm or so) counts as fast.
  if (keystrokes.length >= 25 && now - lastFastPost > 4000) {
    lastFastPost = now;
    react('typingFast');
  } else if (now - lastTypingPost > 3000) {
    lastTypingPost = now;
    react('typing');
  }
}

function onSave() {
  const now = Date.now();
  state.stats.saves = (state.stats.saves || 0) + 1;
  if (now - lastSaveXp > 10000) {
    lastSaveXp = now;
    grantXp(care.XP.save);
    save();
  }
  if (now - lastSavePost > 3000) {
    lastSavePost = now;
    react('save');
  }
}

// ---------- Errors in the active file ----------

function errorCount(uri) {
  return vscode.languages.getDiagnostics(uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
}

function onDiagnostics(e) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const uri = ed.document.uri;
  const key = uri.toString();
  if (!e.uris.some(u => u.toString() === key)) return;
  clearTimeout(diagTimers.get(key));
  // Wait for diagnostics to settle so half-typed words don't count.
  diagTimers.set(key, setTimeout(() => {
    const before = diagSettled.has(key) ? diagSettled.get(key) : errorCount(uri);
    const after = errorCount(uri);
    diagSettled.set(key, after);
    const edited = Date.now() - (lastEdit.get(key) || 0) < RECENT_EDIT_MS;
    if (!edited) return;
    if (after > before) react('errorsUp', { count: after });
    else if (before > 0 && after === 0) react('errorsCleared');
  }, 1000));
}

function onActiveEditor(ed) {
  active();
  if (ed) diagSettled.set(ed.document.uri.toString(), errorCount(ed.document.uri));
}

// ---------- Git commits ----------

// Watches HEAD in each repo. A new commit on the same branch whose parent is
// the old HEAD, made in the last two minutes, counts. Covers commits from the
// Source Control view and from the terminal; pulls and checkouts don't count.
async function watchGit() {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) return;
  let api;
  try {
    api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
  } catch {
    return;
  }
  const watch = repo => {
    let head = repo.state.HEAD && repo.state.HEAD.commit;
    let branch = repo.state.HEAD && repo.state.HEAD.name;
    ctx.subscriptions.push(repo.state.onDidChange(async () => {
      const h = repo.state.HEAD;
      if (!h || !h.commit || h.commit === head) return;
      const oldHead = head, oldBranch = branch;
      head = h.commit;
      branch = h.name;
      if (!oldHead || h.name !== oldBranch) return;
      try {
        const c = await repo.getCommit(h.commit);
        const when = (c.commitDate || c.authorDate || new Date(0)).getTime();
        if (c.parents.includes(oldHead) && Date.now() - when < 2 * MINUTE) onCommit();
      } catch { /* commit not readable, skip */ }
    }));
  };
  api.repositories.forEach(watch);
  ctx.subscriptions.push(api.onDidOpenRepository(watch));
}

function onCommit() {
  state.stats.commits = (state.stats.commits || 0) + 1;
  grantXp(care.XP.commit);
  for (const pet of state.pets) care.cheer(pet, 3);
  save();
  react('commit');
  sendPets();
}

// ---------- Tests ----------

function onTestsDone(exitCode) {
  if (exitCode === undefined || exitCode === CTRL_C_EXIT) return;
  if (exitCode === 0) {
    grantXp(care.XP.testsPass);
    save();
    react('testsPass');
    sendPets();
  } else {
    react('testsFail');
  }
}

// ---------- Focus timer ----------

let timerInterval = null;

function startFocus() {
  state.focus = { mode: 'focus', endsAt: Date.now() + config().get('focusMinutes') * MINUTE };
  save(true);
  react('focusStart');
  runTimer();
}

function stopFocus() {
  state.focus = null;
  save(true);
  react('focusStop');
  runTimer();
}

function runTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (state.focus) timerInterval = setInterval(timerTick, 1000);
  timerTick();
}

function timerTick() {
  const f = state.focus;
  if (!f) {
    if (timerItem.text !== '$(check) Break over') timerItem.hide();
    return;
  }
  const left = f.endsAt - Date.now();
  if (left <= 0) {
    if (f.mode === 'focus') {
      state.stats.focusBlocks = (state.stats.focusBlocks || 0) + 1;
      grantXp(care.XP.focusBlock);
      for (const pet of state.pets) care.cheer(pet, 10);
      state.focus = { mode: 'break', endsAt: Date.now() + config().get('breakMinutes') * MINUTE };
      react('breakStart');
      sendPets();
    } else {
      state.focus = null;
      react('breakEnd');
      timerItem.text = '$(check) Break over';
      timerItem.tooltip = 'Click to start another focus block';
      timerItem.backgroundColor = undefined;
      timerItem.show();
      setTimeout(() => { if (!state.focus) timerItem.hide(); }, MINUTE);
      clearInterval(timerInterval);
      timerInterval = null;
    }
    save(true);
    return;
  }
  const s = Math.ceil(left / 1000);
  const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (f.mode === 'focus') {
    timerItem.text = `$(watch) ${mmss}`;
    timerItem.tooltip = 'Focus block. Click to stop.';
    timerItem.backgroundColor = undefined;
  } else {
    timerItem.text = `☕ Break ${mmss}`;
    timerItem.tooltip = 'Break. Click to skip.';
    timerItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  timerItem.show();
}

async function focusCommand() {
  if (!state.focus) return startFocus();
  const choice = await vscode.window.showQuickPick(
    state.focus.mode === 'focus' ? ['Stop focus block', 'Keep going'] : ['Skip break', 'Start another focus block now', 'Keep resting'],
    { placeHolder: 'Pets+ focus timer' });
  if (choice === 'Stop focus block' || choice === 'Skip break') stopFocus();
  if (choice === 'Start another focus block now') startFocus();
}

// ---------- Status bar ----------

function updateStatusBar() {
  const b = buddy();
  if (!config().get('statusBar') || !b) {
    petItem.hide();
    return;
  }
  const v = view(b);
  petItem.text = `${EMOJI[b.type] || '🐾'} ${b.name} ${v.face} Lv${v.level}${v.hungry ? ' 🍖' : ''}`;
  const g = globals();
  const md = new vscode.MarkdownString();
  for (const p of state.pets.map(view)) {
    md.appendMarkdown(`${EMOJI[p.type] || '🐾'} **${p.name}** Lv${p.level} · ${p.face} · food ${Math.round(p.food)}%${p.hungry ? ' 🍖' : ''}  \n`);
  }
  md.appendMarkdown(`\n🔥 ${g.streak}-day streak · ${g.minutesToday} min coded today`);
  petItem.tooltip = md;
  petItem.show();
}

// ---------- Importing from VS Code Pets ----------

const pickName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

async function importOld() {
  let found;
  try {
    found = await readOldPets();
  } catch (error) {
    const message = error.code === 'ENOENT'
      ? 'Install the sqlite3 command-line tool and make sure it is on PATH to import from VS Code Pets.'
      : 'Could not read VS Code Pets data. Check that the VS Code profile is readable and try again.';
    vscode.window.showWarningMessage(`Pets+: ${message}`);
    return;
  }

  const have = new Set(state.pets.map(p => JSON.stringify([p.type, p.name])));
  const fresh = [];
  for (const { type, color, name } of found) {
    const colors = coloursOf(type);
    if (!colors.length) continue;
    const petName = name || pickName();
    const key = JSON.stringify([type, petName]);
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(care.newPet({ type, color: colors.includes(color) ? color : colors[0], name: petName }));
  }

  if (!fresh.length) {
    vscode.window.showInformationMessage('Pets+: no new pets found in the default VS Code profile.');
    return;
  }
  state.pets.push(...fresh);
  await save(true);
  sendPets();
  const pick = await vscode.window.showInformationMessage(
    `Pets+ imported ${fresh.length} pet${fresh.length === 1 ? '' : 's'} from VS Code Pets.`,
    'Show VS Code Pets');
  if (pick) vscode.commands.executeCommand('extension.open', 'tonybaloney.vscode-pets');
}

// ---------- Commands ----------

async function choosePet(placeHolder, list = state.pets) {
  if (!list.length) {
    vscode.window.showInformationMessage('Pets+: no pets here.');
    return null;
  }
  if (list.length === 1 && list === state.pets) return list[0];
  const picked = await vscode.window.showQuickPick(
    list.map(p => ({ label: `${EMOJI[p.type] || '🐾'} ${p.name}`, description: `${p.color.replace(/_/g, ' ')} ${p.type} · Lv${care.levelFor(p.xp).level}`, pet: p })),
    { placeHolder });
  return picked && picked.pet;
}

async function spawn() {
  const type = await vscode.window.showQuickPick(
    Object.keys(manifest).map(t => ({ label: `${EMOJI[t] || '🐾'} ${t}`, type: t })),
    { placeHolder: 'Which pet?' });
  if (!type) return;
  const colours = coloursOf(type.type);
  const color = colours.length === 1 ? colours[0]
    : await vscode.window.showQuickPick(colours.map(c => ({ label: c.replace(/_/g, ' '), c })), { placeHolder: 'Colour' }).then(c => c && c.c);
  if (!color) return;
  const name = await vscode.window.showInputBox({ prompt: 'Name', value: pickName(), validateInput: v => v.trim() ? null : 'Give it a name' });
  if (!name) return;
  const pet = care.newPet({ type: type.type, color, name: name.trim().slice(0, 24) });
  state.pets.push(pet);
  state.buddy = pet.id;
  save(true);
  sendPets();
}

async function remove() {
  const pet = await choosePet('Which pet should go? You can bring it back with "Pets+: Bring Back a Pet".');
  if (!pet) return;
  state.pets = state.pets.filter(p => p !== pet);
  state.removed.push(pet);
  save(true);
  sendPets();
}

async function restore() {
  const pet = await choosePet('Bring back which pet?', state.removed);
  if (!pet) return;
  state.removed = state.removed.filter(p => p !== pet);
  state.pets.push(pet);
  save(true);
  sendPets();
}

async function rename() {
  const pet = await choosePet('Rename which pet?');
  if (!pet) return;
  const name = await vscode.window.showInputBox({ prompt: `New name for ${pet.name}`, value: pet.name });
  if (!name || !name.trim()) return;
  pet.name = name.trim().slice(0, 24);
  save(true);
  sendPets();
}

async function showStats() {
  const pet = await choosePet('Whose stats?');
  if (!pet) return;
  await vscode.commands.executeCommand('petsPlus.view.focus');
  post({ type: 'openCard', id: pet.id });
}

async function reveal() {
  if (!provider.view || !provider.view.visible) await vscode.commands.executeCommand('petsPlus.view.focus');
}

async function chooseTheme() {
  const theme = await vscode.window.showQuickPick(THEMES, { placeHolder: `Theme (now ${config().get('theme')})` });
  if (theme) config().update('theme', theme, vscode.ConfigurationTarget.Global);
}

// ---------- Activate ----------

function activate(context) {
  ctx = context;
  manifest = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'media/pets/manifest.json'), 'utf8'));
  load();
  // Time away counts (capped in care.decay), so pets are a bit hungrier when you come back.
  for (const pet of state.pets) care.decay(pet, (Date.now() - state.lastTick) / care.HOUR);
  state.lastTick = Date.now();
  if (state.focus && state.focus.endsAt < Date.now()) state.focus = null;

  provider = new Provider();
  petItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  petItem.command = 'petsPlus.show';
  timerItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  timerItem.command = 'petsPlus.focus';

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(
    petItem, timerItem,
    vscode.window.registerWebviewViewProvider('petsPlus.view', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    cmd('petsPlus.show', () => vscode.commands.executeCommand('petsPlus.view.focus')),
    cmd('petsPlus.spawn', spawn),
    cmd('petsPlus.remove', remove),
    cmd('petsPlus.restore', restore),
    cmd('petsPlus.rename', rename),
    cmd('petsPlus.stats', showStats),
    cmd('petsPlus.feed', async () => { await reveal(); feedPets(state.pets); }),
    cmd('petsPlus.ball', async () => { await reveal(); post({ type: 'event', kind: 'ball' }); }),
    cmd('petsPlus.focus', focusCommand),
    cmd('petsPlus.theme', chooseTheme),
    cmd('petsPlus.importOld', importOld),
    cmd('petsPlus.toggleStatusBar', () => config().update('statusBar', !config().get('statusBar'), vscode.ConfigurationTarget.Global)),

    vscode.workspace.onDidChangeTextDocument(onTextChange),
    vscode.workspace.onDidSaveTextDocument(onSave),
    vscode.languages.onDidChangeDiagnostics(onDiagnostics),
    vscode.window.onDidChangeActiveTextEditor(onActiveEditor),
    vscode.window.onDidChangeTextEditorSelection(active),
    vscode.window.onDidChangeTextEditorVisibleRanges(active),
    vscode.window.onDidChangeWindowState(s => { if (s.focused) active(); }),
    vscode.tasks.onDidEndTaskProcess(e => {
      const t = e.execution.task;
      if (t.group === vscode.TaskGroup.Test || /test/i.test(t.name)) onTestsDone(e.exitCode);
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('petsPlus')) return;
      if (provider.view) post(initMessage());
      updateStatusBar();
    }),
    { dispose: () => { clearInterval(timerInterval); save(true); } },
  );
  // Terminal shell integration (VS Code 1.93+): test commands you run yourself.
  if (vscode.window.onDidEndTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution(active),
      vscode.window.onDidEndTerminalShellExecution(e => {
        const line = e.execution.commandLine && e.execution.commandLine.value;
        if (line && TEST_RE.test(line)) onTestsDone(e.exitCode);
      }),
    );
  }

  const tickTimer = setInterval(tick, MINUTE);
  const idleTimer = setInterval(checkIdle, 30 * 1000);
  context.subscriptions.push({ dispose: () => { clearInterval(tickTimer); clearInterval(idleTimer); } });

  if (vscode.window.activeTextEditor) onActiveEditor(vscode.window.activeTextEditor);
  watchGit();
  runTimer();
  updateStatusBar();
  save(true);

  // Used by test/e2e.js.
  return { state: () => state, tick, statusText: () => petItem.text, panelReady: () => panelReady };
}

function deactivate() {}

module.exports = { activate, deactivate };
