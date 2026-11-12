'use strict';

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const manifest = require('../media/pets/manifest.json');

test('every pet color has its idle, walk, and listed animations', () => {
  assert.ok(manifest.cat.brown, 'starter cat sprite exists');
  for (const [type, colors] of Object.entries(manifest)) {
    assert.ok(Object.keys(colors).length, type);
    for (const [color, animations] of Object.entries(colors)) {
      assert.ok(animations.includes('idle') && animations.includes('walk'), `${type}/${color}`);
      for (const animation of animations) {
        const file = join(__dirname, '../media/pets', type, `${color}_${animation}_8fps.gif`);
        assert.ok(existsSync(file), file);
      }
    }
  }
});
