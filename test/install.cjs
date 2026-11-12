'use strict';

const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join } = require('node:path');
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
    const cursor = /^cursor(?:\.exe)?$/i.test(basename(vscodeExecutablePath));
    const workspace = join(profile, 'workspace');
    mkdirSync(workspace);
    const [defaultCli] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, { reuseMachineInstall: true });
    const cli = cursor && process.platform === 'win32' ? join(dirname(vscodeExecutablePath), 'bin', 'cursor.cmd') : defaultCli;
    const userDataDir = join(profile, 'user');
    const extensionsDir = join(profile, 'extensions');
    const profileArgs = ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir];
    const vsix = join(root, 'dist', `${name}-${version}.vsix`);
    const options = { stdio: 'inherit', timeout: 60_000, windowsHide: true };
    // The Windows batch wrapper handles versioned VS Code resource directories.
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', [
        '/d', '/s', '/v:off', '/c',
        '""%SMOKE_CLI%" --user-data-dir "%SMOKE_USER%" --extensions-dir "%SMOKE_EXTENSIONS%" --install-extension "%SMOKE_VSIX%""',
      ], {
        ...options,
        windowsVerbatimArguments: true,
        env: { ...process.env, SMOKE_CLI: cli, SMOKE_USER: userDataDir, SMOKE_EXTENSIONS: extensionsDir, SMOKE_VSIX: vsix },
      })
      : spawnSync(cli, [...profileArgs, '--install-extension', vsix], options);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`VSIX install exited with code ${result.status}`);
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: join(__dirname, 'smoke'),
      extensionTestsPath: join(__dirname, 'smoke', 'index.cjs'),
      launchArgs: [
        ...profileArgs, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        ...(cursor ? ['--classic'] : []),
        workspace,
      ],
    });
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
