const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const brand = path.resolve(__dirname, '../assets/brand');
const assetUrl = name => `data:${name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${fs.readFileSync(path.join(brand, name)).toString('base64')}`;
app.setPath('userData', path.resolve(__dirname, '../tests/.runtime/brand-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false, width:720, height:220, frame:false, transparent:true, backgroundColor:'#00000000', webPreferences:{offscreen:true, backgroundThrottling:false, contextIsolation:true}});
  const render = async (html, name, width, height) => {
    window.setSize(width, height);
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await window.webContents.executeJavaScript('Promise.all([...document.images].map(image => image.decode()))');
    await new Promise(resolve => setTimeout(resolve, 150));
    const capture = await window.webContents.capturePage({x:0, y:0, width, height});
    fs.writeFileSync(path.join(brand, name), capture.resize({width, height}).toPNG());
  };
  await render(`<style>html,body{margin:0;background:transparent}img{display:block;width:720px;height:220px}</style><img src="${assetUrl('owlio-logo.svg')}">`, 'owlio-logo.png', 720, 220);
  const icon = size => `<img width="${size}" height="${size}" src="${assetUrl(`owlio-icon-${size}.png`)}">`;
  const sizes = [16,24,32,48];
  const row = dark => `<div class="row ${dark ? 'dark' : ''}">${sizes.map(size => `<div>${icon(size)}<span>${size}px</span></div>`).join('')}</div>`;
  await render(`<style>*{box-sizing:border-box}html,body{margin:0;font-family:'Segoe UI',sans-serif;color:#58313F;background:#F5F1EB}.page{padding:28px 36px}.logo{width:470px;height:auto;display:block;margin:0 auto 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.mascot{height:206px;width:206px;object-fit:contain;display:block;margin:auto}.sample{background:#FFFDF9;border:1px solid #E8DED5;border-radius:20px;padding:22px}h2{margin:0 0 16px;font-size:15px;font-weight:600}p{font-size:12px;color:#826C75;margin:12px 0 0;text-align:center}.row{display:flex;align-items:center;justify-content:space-around;gap:12px;padding:14px 12px;border-radius:12px;height:90px}.row img{object-fit:contain;display:block;margin:auto}.row span{display:block;font-size:10px;opacity:.7;text-align:center;margin-top:8px}.dark{background:#28232B;color:#F8EEDF}</style><div class="page"><img class="logo" src="${assetUrl('owlio-logo.svg')}"><div class="grid"><div class="sample"><h2>Your owl mascot</h2><img class="mascot" src="${assetUrl('owlio-mascot.png')}"></div><div class="sample"><h2>Taskbar &amp; tray sizes</h2>${row(false)}${row(true)}<p>Transparent icons for light and dark desktops</p></div></div></div>`, 'owlio-brand-preview.png', 820, 520);
  console.log('Exported Owlio PNG wordmark and logo/icon preview.');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
