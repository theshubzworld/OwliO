const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Python server uses bounded uploads and local-only CORS defaults', () => {
  const source = fs.readFileSync(path.join(root, 'server.py'), 'utf8');
  assert.match(source, /MAX_AUDIO_BYTES/);
  assert.match(source, /allow_credentials=False/);
  assert.match(source, /asyncio\.to_thread/);
});

test('build performs type checking and Python dependencies are declared', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /typecheck/);
  assert.ok(fs.existsSync(path.join(root, 'requirements.txt')));
  assert.ok(fs.existsSync(path.join(root, 'src', 'renderer', 'env.d.ts')));
});
