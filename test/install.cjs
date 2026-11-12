'use strict';

const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} = require('@vscode/test-electron');
const { name, version } = require('../package.json');

async function main() {
  const root = dirname(__dirname);
  const profile = mkdtempSync(join(tmpdir(), name + '-smoke-'));
  try {
    const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode('stable');
    const windows = process.platform === 'win32';
    const [macCli] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, { reuseMachineInstall: true });
    const cli = windows ? vscodeExecutablePath : macCli;
    const cliArgs = windows ? [join(dirname(cli), 'resources', 'app', 'out', 'cli.js')] : [];
    const profileArgs = ['--user-data-dir', join(profile, 'user'), '--extensions-dir', join(profile, 'extensions')];
    const vsix = join(root, 'dist', `${name}-${version}.vsix`);
    const result = spawnSync(cli, [...cliArgs, ...profileArgs, '--install-extension', vsix], {
      env: windows ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      windowsHide: true,
      stdio: 'inherit',
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`VSIX install exited with code ${result.status}`);
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: join(__dirname, 'smoke'),
      extensionTestsPath: join(__dirname, 'smoke', 'index.cjs'),
      launchArgs: [...profileArgs, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
    });
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
