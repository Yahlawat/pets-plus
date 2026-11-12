// End-to-end check, run inside a real VS Code by test/run.sh.
const vscode = require('vscode');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const care = require('../src/care');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(200); }
  return false;
}

exports.run = async () => {
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const lines = [];
  let ok = true;
  const check = (name, pass, detail = '') => {
    lines.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
    if (!pass) ok = false;
  };
  try {
    const api = await vscode.extensions.getExtension('yashahlawat.pets-plus').activate();
    const st = api.state;

    check('starts with no pets', st().pets.length === 0);
    st().pets.push(care.newPet({ type: 'bunny', color: 'purple', name: 'Demo Bunny' }));
    api.tick();

    await vscode.commands.executeCommand('petsPlus.view.focus');
    check('panel loads and says ready', await until(api.panelReady), '');

    check('status bar shows a pet', /Lv\d/.test(api.statusText()), api.statusText());

    st().pets.forEach(p => { p.food = 40; });
    await vscode.commands.executeCommand('petsPlus.feed');
    check('feeding raises food', st().pets.every(p => p.food === 75), st().pets.map(p => p.food).join(','));

    const file = path.join(ws, 'code.py');
    const doc = await vscode.workspace.openTextDocument(file);
    const ed = await vscode.window.showTextDocument(doc);
    const xpBefore = st().pets[0].xp;
    for (let i = 0; i < 5; i++) await ed.edit(e => e.insert(new vscode.Position(0, 0), 'x'));
    api.tick();
    check('a minute of typing earns XP', st().pets[0].xp === xpBefore + 1, `${xpBefore} -> ${st().pets[0].xp}`);
    check('coding minutes are counted', st().stats.minutesToday >= 1, String(st().stats.minutesToday));

    const saves = st().stats.saves || 0;
    await doc.save();
    await sleep(300);
    check('saves are counted', st().stats.saves === saves + 1, `${saves} -> ${st().stats.saves}`);

    await vscode.commands.executeCommand('petsPlus.focus');
    check('focus timer starts', st().focus && st().focus.mode === 'focus', JSON.stringify(st().focus));
    // Pretend the block is nearly over to check the switch to a break.
    st().focus.endsAt = Date.now() + 500;
    const blocks = st().stats.focusBlocks || 0;
    await until(() => st().focus && st().focus.mode === 'break', 3000);
    check('focus block ends in a break and counts', st().focus && st().focus.mode === 'break' && st().stats.focusBlocks === blocks + 1,
      JSON.stringify(st().focus));

    // A commit from the terminal, the way you'd make one.
    const commits = st().stats.commits || 0;
    const git = cmd => execSync(cmd, { cwd: ws, stdio: 'pipe' });
    const gitApi = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
    // Wait until the git extension has loaded the repo, then a beat for Pets+ to see it.
    await until(() => gitApi.repositories.some(r => r.state.HEAD && r.state.HEAD.commit), 20000);
    await sleep(1000);
    fs.writeFileSync(path.join(ws, 'a.txt'), 'one\n');
    git('git add a.txt && git -c user.name=t -c user.email=t@t commit -qm second');
    // The git extension normally refreshes on file events or window focus; in a
    // throwaway profile those can lag, so ask it directly.
    await gitApi.repositories[0].status();
    const seen = await until(() => (st().stats.commits || 0) === commits + 1, 15000);
    check('git commits are noticed', seen, `${commits} -> ${st().stats.commits}`);
    if (!seen) lines.push(`info  git ext HEAD ${gitApi.repositories.map(r => r.state.HEAD && r.state.HEAD.commit).join(',')} real ${git('git rev-parse HEAD').toString().trim()} repos ${gitApi.repositories.length}`);

    // Checking out an old commit is not a new commit.
    git('git checkout -q HEAD~1');
    await gitApi.repositories[0].status();
    await sleep(4000);
    check('checkout does not count as a commit', st().stats.commits === commits + 1, String(st().stats.commits));
  } catch (e) {
    lines.push('ERROR  ' + e.stack);
    ok = false;
  }
  fs.writeFileSync(path.join(ws, 'results.txt'), lines.join('\n') + '\n');
  if (!ok) throw new Error('pets-plus e2e failed');
};
