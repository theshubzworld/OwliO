// Render the README banner using the existing Owlio logo; app profiles are untouched.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'assets/brand');
app.setPath('userData', path.join(root, 'tests/.runtime/readme-render-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const logo = fs.readFileSync(path.join(brand, 'owlio-logo.png')).toString('base64');
  const window = new BrowserWindow({ show: false, width: 1440, height: 600, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:1440px;height:600px}
      body{background:#F7F3EC;color:#58313F;font-family:'Segoe UI',sans-serif;overflow:hidden}
      .frame{position:absolute;inset:22px;border:1px solid #E4D9CE;border-radius:30px;overflow:hidden;
        background:radial-gradient(ellipse at 5% 95%,#E8ECE1 0,transparent 40%),radial-gradient(ellipse at 95% 0,#F0DEDF 0,transparent 44%)}
      .content{position:relative;text-align:center;padding-top:52px}
      .eyebrow{font-size:14px;font-weight:650;letter-spacing:4px;color:#826773}
      .logo{display:block;width:560px;margin:28px auto 22px;transform:translateX(40px)}
      h1{font-family:Georgia,serif;font-size:52px;font-weight:400;letter-spacing:-1px;margin:0 0 12px}
      p{font-size:20px;color:#7B6870;margin:0}
      .tags{display:flex;justify-content:center;gap:14px;margin-top:35px}
      .tags span{border:1px solid #D9CEC5;border-radius:100px;padding:9px 18px;font-size:14px;color:#66514C;background:#FFFDF780}
      .dot{width:8px;height:8px;border-radius:50%;background:#CCAC85;position:absolute}
      .dot.a{left:110px;top:165px}.dot.b{right:115px;bottom:155px}.dot.c{right:185px;top:110px;width:5px;height:5px}
    </style>
    <div class="frame"><i class="dot a"></i><i class="dot b"></i><i class="dot c"></i>
      <div class="content"><div class="eyebrow">YOUR LITTLE WRITING COMPANION</div>
      <img class="logo" src="data:image/png;base64,${logo}" alt="Owlio">
      <h1>Your voice. Your words.</h1><p>A little owl for your everyday writing.</p>
      <div class="tags"><span>Made for Windows</span><span>Local speech</span><span>English · Hindi · Hinglish</span></div></div>
    </div>`));
  await window.webContents.executeJavaScript('Promise.all([...document.images].map(image => image.decode()))');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(brand, 'readme-banner.png'), (await window.webContents.capturePage()).toPNG());
  window.destroy();
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
