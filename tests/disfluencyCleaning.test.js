const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');

function loadService() {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/main/aiService.js'), 'utf8'), {
    require: name => {
      if (name === './store') return { store: { getSettings: () => ({ writingStyle: 'auto' }) } };
      if (name.startsWith('.')) return require(path.join(root, 'dist/main', name));
      return require(name);
    },
    exports,
    __dirname: path.join(root, 'dist/main'),
    process,
    console,
    Buffer,
  });
  return exports;
}

test('cleanSpeechDisfluencies strips filler sounds and collapses stutters', () => {
  const { cleanSpeechDisfluencies } = loadService();
  assert.equal(cleanSpeechDisfluencies('like uh data data is full'), 'like data is full');
  assert.equal(cleanSpeechDisfluencies('um hello uh there'), 'hello there');
  assert.equal(cleanSpeechDisfluencies('hello to to to to to to to'), 'hello to');
  assert.equal(cleanSpeechDisfluencies('kabhi kabhi aisa hota hai'), 'kabhi kabhi aisa hota hai');
  assert.equal(cleanSpeechDisfluencies('no no that is fine'), 'no no that is fine');
  assert.equal(cleanSpeechDisfluencies('तो तो तो तो'), 'तो');
  assert.equal(cleanSpeechDisfluencies('डेटा डेटा'), 'डेटा');
  assert.equal(cleanSpeechDisfluencies('kal अं meeting'), 'kal meeting');
});

test('localFormat cleans disfluencies and applies capitalization and punctuation', () => {
  const { localFormat } = loadService();
  const context = { processName: 'notepad', windowTitle: 'Notes', browserUrl: '', surroundingText: '' };
  assert.equal(localFormat('like uh data data is full', context), 'Like data is full.');
  assert.equal(localFormat('why are you late', context), 'Why are you late.');
});
