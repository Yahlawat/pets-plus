'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { decodePets } = require('../src/import-pets');

test('decodes the legacy pet arrays and preserves names', () => {
  assert.deepEqual(decodePets(JSON.stringify({
    'vscode-pets.extra-pets.types': ['cat', 'dog'],
    'vscode-pets.extra-pets.colors': ['light brown'],
    'vscode-pets.extra-pets.names': ['O’Malley'],
  })), [
    { type: 'cat', color: 'light_brown', name: 'O’Malley' },
    { type: 'dog', color: '', name: '' },
  ]);
});

test('handles a missing pet list', () => {
  assert.deepEqual(decodePets(''), []);
  assert.deepEqual(decodePets('null'), []);
  assert.deepEqual(decodePets('{"vscode-pets.extra-pets.types": "cat"}'), []);
});
