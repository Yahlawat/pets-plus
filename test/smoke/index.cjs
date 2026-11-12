'use strict';

const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('yashahlawat.pets-plus');
  assert.ok(extension, 'Pets+ is installed from the VSIX');
  const api = await extension.activate();
  assert.deepEqual(api.state().pets, []);
  assert.ok((await vscode.commands.getCommands()).includes('petsPlus.spawn'));
  await vscode.commands.executeCommand('petsPlus.view.focus');
  const deadline = Date.now() + 10_000;
  while (!api.panelReady() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(api.panelReady(), 'the installed webview loaded');
};
