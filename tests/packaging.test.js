const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
async function packageAttempt(existingInstaller) {
  const result={commands:[],errors:[],builds:0,exit:undefined};
  const replacements={
    'node:fs':{existsSync:()=>existingInstaller},
    'node:child_process':{spawnSync:(command,args)=>{result.commands.push(args);return {status:0};}},
    'electron-builder':{build:()=>{result.builds++;},Platform:{},Arch:{}},
    '../package.json':{version:'1.0.16',build:{}},
    '../dist/shared/legal':{LEGAL_REVIEWED:false,TERMS_VERSION:'draft',PRIVACY_VERSION:'draft'}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'scripts/package_windows.cjs'),'utf8'),{
    __dirname:path.join(root,'scripts'),require:name=>replacements[name]||require(name),
    console:{error:message=>result.errors.push(message)},
    process:{platform:'win32',env:{npm_execpath:'npm.cjs'},execPath:'node',exit:code=>{result.exit=code;}}
  });
  await new Promise(resolve=>setImmediate(resolve));return result;
}
test('packaging refuses to overwrite an existing installer before invoking build tools',async()=>{
  const result=await packageAttempt(true);assert.equal(result.exit,1);assert.match(result.errors[0],/already exists/);assert.equal(result.commands.length,0);assert.equal(result.builds,0);
});
test('draft document review blocks public packaging before helper compilation or installer creation',async()=>{
  const result=await packageAttempt(false);assert.equal(result.exit,1);assert.match(result.errors[0],/owner review/);assert.equal(result.commands.length,2);assert.equal(result.builds,0);
});
