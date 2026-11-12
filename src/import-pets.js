'use strict';

const { execFile } = require('node:child_process');
const { access } = require('node:fs/promises');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);

function databasePath() {
  const home = homedir();
  switch (process.platform) {
    case 'darwin': return join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'state.vscdb');
    case 'win32': return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'state.vscdb');
    default: return join(home, '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
  }
}

function decodePets(raw) {
  const saved = JSON.parse(raw.trim() || '{}') || {};
  const types = saved['vscode-pets.extra-pets.types'];
  const colors = saved['vscode-pets.extra-pets.colors'];
  const names = saved['vscode-pets.extra-pets.names'];
  if (!Array.isArray(types)) return [];
  return types.map((type, i) => ({
    type,
    color: String(Array.isArray(colors) ? colors[i] ?? '' : '').replace(/ /g, '_'),
    name: Array.isArray(names) && typeof names[i] === 'string' ? names[i] : '',
  }));
}

async function readOldPets() {
  const db = databasePath();
  try {
    await access(db);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const query = "select value from ItemTable where key = 'tonybaloney.vscode-pets'";
  const { stdout } = await run('sqlite3', ['-readonly', db, query], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  return decodePets(stdout);
}

module.exports = { decodePets, readOldPets };
