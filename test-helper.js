const { spawn } = require('child_process');
const path = require('path');

const helperPath = path.resolve(__dirname, 'windows-helper/bin/Release/net8.0-windows/publish/windows-helper.exe');
console.log('Testing helper binary:', helperPath);

const proc = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

proc.stdout.on('data', (d) => {
  console.log('STDOUT from helper:', d.toString('utf-8').trim());
});

proc.stderr.on('data', (d) => {
  console.error('STDERR from helper:', d.toString('utf-8').trim());
});

setTimeout(() => {
  console.log('Sending ping...');
  proc.stdin.write(JSON.stringify({ type: 'ping' }) + '\n');
}, 500);

setTimeout(() => {
  console.log('Sending get_context...');
  proc.stdin.write(JSON.stringify({ type: 'get_context' }) + '\n');
}, 1000);

setTimeout(() => {
  console.log('Exiting helper...');
  proc.stdin.write(JSON.stringify({ type: 'quit' }) + '\n');
  setTimeout(() => process.exit(0), 500);
}, 2000);
