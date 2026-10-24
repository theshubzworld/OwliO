const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeShortcut, formatShortcut } = require('../dist/shared/shortcuts');

test('custom shortcuts normalize modifiers, preserve legacy keys and accept modifier-only combinations', () => {
  for (const [input, expected] of [
    ['win + control', 'Ctrl+Win'], ['alt+win+m', 'Alt+Win+M'],
    ['shift+ctrl+space', 'Ctrl+Shift+Space'], ['F24', 'F24'], ['space', 'SPACE'],
    ['RightAlt', 'RALT'], ['Ctrl+Alt+K', 'Ctrl+Alt+K'], ['ctrl+1', 'Ctrl+1'],
  ]) assert.equal(normalizeShortcut(input), expected);
  assert.equal(formatShortcut('Ctrl+Win'), 'Ctrl + Win');
});

test('invalid shortcuts are rejected before they can break normal typing', () => {
  for (const input of ['', 'Ctrl', 'Win', 'Q', 'Ctrl+Ctrl+K', 'Ctrl+Control+K', 'Ctrl+K+J', 'F25', 'Win+L', 'Ctrl+Alt+Delete', 'Ctrl++']) {
    assert.throws(() => normalizeShortcut(input), undefined, input);
  }
});
