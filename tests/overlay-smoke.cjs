const { app, BrowserWindow, ipcMain, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const output = path.join(__dirname, '.runtime');
const recoveryOnly = process.argv.includes('--recovery-only');
const diagnostics = { points: [], layouts: [], initial: null, target: null };
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'overlay-profile'));
require('../dist/main/main.js');
const pointer = (...args) => new Promise((resolve, reject) => {
  execFile('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'overlay-pointer.ps1'), ...args.map(String)],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message)); else resolve(stdout.trim());
    });
});
const waitFor = async check => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    let timer;
    const ready = await Promise.race([Promise.resolve().then(check), new Promise(resolve => { timer = setTimeout(() => resolve(false), 750); })]);
    clearTimeout(timer);
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Overlay did not settle: ' + diagnostics.stage);
};
app.whenReady().then(async () => {
  const original = JSON.parse(await pointer('-Report'));
  let lastPoint;
  try {
    await waitFor(() => BrowserWindow.getAllWindows().some(window => window.getBounds().width === 64));
    let pill = BrowserWindow.getAllWindows().find(window => window.getBounds().width === 64);
    await waitFor(() => pill.webContents.executeJavaScript("!!document.querySelector('.pill-rest')"));
    const layouts = [];
    diagnostics.layouts = layouts;
    const readCursor = screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint = () => { const point = readCursor(); diagnostics.points.push(point); return point; };
    ipcMain.on('pill-layout', (_event, message) => { if (!pill.isDestroyed()) layouts.push({ ...message, bounds: pill.getBounds() }); });
    const idle = pill.getBounds();
    diagnostics.initial = idle;
    assert.ok(Math.abs(idle.width - 64) <= 1); assert.ok(Math.abs(idle.height - 40) <= 1, 'Allow one-pixel Windows DPI rounding');
    const visibleRect = () => pill.webContents.executeJavaScript(`(() => { const r = document.querySelector('.pill-rest, .pill-controls').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const idleRect = await visibleRect();
    const idleCenter = idle.x + idleRect.x + idleRect.width / 2;
    const idleBottom = idle.y + idleRect.y + idleRect.height;
    let expanded = idle;
    if (!recoveryOnly) {
    diagnostics.stage = 'native hover';
    lastPoint = screen.dipToScreenPoint({ x: idleCenter, y: idleBottom - idleRect.height / 2 });
    diagnostics.target = lastPoint;
    await pointer('-X', lastPoint.x, '-Y', lastPoint.y, '-DwellMs', 250);
    await waitFor(() => layouts.some(layout => layout.expanded && Math.abs(layout.bounds.width - 260) <= 1));
    expanded = layouts.find(layout => layout.expanded).bounds;
    await waitFor(() => pill.webContents.executeJavaScript("!!document.querySelector('.pill-controls.idle')"));
    const expandedRect = await visibleRect();
    const currentBounds = pill.getBounds();
    assert.ok(Math.abs(currentBounds.x + expandedRect.x + expandedRect.width / 2 - idleCenter) <= 2, 'Hover expansion must preserve the visible horizontal center');
    assert.ok(Math.abs(currentBounds.y + expandedRect.y + expandedRect.height - idleBottom) <= 2, 'Hover expansion must preserve the visible bottom edge');
    lastPoint = screen.dipToScreenPoint({ x: expanded.x + 4, y: expanded.y + 8 });
    await pointer('-X', lastPoint.x, '-Y', lastPoint.y);
    await waitFor(() => pill.getBounds().width === 64);
    }
    assert.equal(pill.isFocusable(), false);
    assert.equal(pill.webContents.getBackgroundThrottling(), false);
    diagnostics.stage = 'hidden recovery';
    pill.hide();
    await waitFor(() => pill.isVisible());
    const dashboard = BrowserWindow.getAllWindows().find(window => window !== pill);
    diagnostics.stage = 'manual bar repair';
    pill.setBounds({ x: -20000, y: -20000, width: 64, height: 40 });
    await dashboard.webContents.executeJavaScript('window.api.showFloatingBar()');
    pill = BrowserWindow.getAllWindows().find(window => window !== dashboard);
    await waitFor(() => pill.webContents.executeJavaScript("!!document.querySelector('.pill-rest')").catch(() => false));
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'Manual repair must leave exactly one floating bar');
    const restored = pill.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    assert.ok(restored.x >= area.x && restored.y >= area.y && restored.y + restored.height <= area.y + area.height);
    diagnostics.stage = 'renderer crash recovery';
    const crashed = pill;
    pill.webContents.forcefullyCrashRenderer();
    await waitFor(() => BrowserWindow.getAllWindows().some(window => window !== dashboard && window !== crashed));
    pill = BrowserWindow.getAllWindows().find(window => window !== dashboard && window !== crashed);
    await waitFor(() => pill.webContents.executeJavaScript("document.querySelector('.pill-mic.error')?.title.includes('restarted')").catch(() => false));
    assert.equal(pill.isVisible(), true);
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'Crash recovery must leave exactly one floating bar');
    diagnostics.stage = 'closed bar recovery';
    pill.destroy();
    await waitFor(() => BrowserWindow.getAllWindows().some(window => window !== dashboard && !window.isDestroyed()));
    const replacement = BrowserWindow.getAllWindows().find(window => window !== dashboard);
    await waitFor(() => replacement.webContents.executeJavaScript("!!document.querySelector('.pill-mic.error')").catch(() => false));
    assert.equal(replacement.isFocusable(), false);
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'Closed-bar recovery must leave exactly one floating bar');
    fs.writeFileSync(path.join(output, 'overlay-result.json'), JSON.stringify({ success: true, idle, expanded, layouts }));
    console.log('PASS: hidden/off-screen recovery; renderer crash recreation; closed-bar recreation; non-focusable controls.' + (recoveryOnly ? '' : ' Native hover also passed.'));
  } finally {
    if (lastPoint) {
      const current = JSON.parse(await pointer('-Report'));
      if (current.x === lastPoint.x && current.y === lastPoint.y) await pointer('-X', original.x, '-Y', original.y);
    }
    app.quit();
  }
}).catch(error => {
  fs.writeFileSync(path.join(output, 'overlay-result.json'), JSON.stringify({ success: false, error: error.stack, diagnostics }));
  console.error(error); app.exit(1);
});
