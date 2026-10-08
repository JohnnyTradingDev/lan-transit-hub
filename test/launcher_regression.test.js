const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Windows bridge subprocesses never open console windows', () => {
  for (const relativePath of ['scrcpy_bridge.py', 'public/scrcpy_bridge.py']) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /"creationflags": subprocess\.CREATE_NO_WINDOW/);
    const runCalls = source.match(/subprocess\.run\(/g) || [];
    const hiddenUses = source.match(/\*\*WINDOWS_SUBPROCESS_FLAGS/g) || [];
    assert.equal(hiddenUses.length, runCalls.length + 1);
  }
});

test('phone launcher allows Android screen timeout without forcing screen off', () => {
  const source = fs.readFileSync(path.join(root, 'start-laptop.ps1'), 'utf8');
  assert.doesNotMatch(source, /--stay-awake/);
  assert.doesNotMatch(source, /--turn-screen-off/);
  assert.match(source, /settings put global stay_on_while_plugged_in 0/);
});
