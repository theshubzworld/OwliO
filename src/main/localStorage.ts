import fs from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import type { StoragePaths } from '../shared/localSetup';

export function storagePaths(root: string): StoragePaths {
  return {root, runtimes:path.join(root,'runtimes'), models:path.join(root,'models'), cache:path.join(root,'downloads')};
}
export function within(parent:string, child:string):boolean {
  const relative=path.relative(parent,child);
  return relative!=='' && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}
// Resolve existing ancestors too, so a junction cannot hide overlapping storage folders.
export function physicalPath(folder:string):string {
  let existing=path.resolve(folder);const suffix:string[]=[];
  while(!fs.existsSync(existing)) {const parent=path.dirname(existing);if(parent===existing)break;suffix.unshift(path.basename(existing));existing=parent;}
  return path.join(fs.existsSync(existing)?fs.realpathSync(existing):existing,...suffix);
}
export function validateStorage(value:unknown):StoragePaths {
  const v=value as Partial<StoragePaths> | null;
  const result={} as StoragePaths;
  for(const key of ['root','runtimes','models','cache'] as const) {
    const folder=v?.[key];
    if(typeof folder!=='string'||folder.length>1000||!path.isAbsolute(folder)||folder.includes('\0'))throw Error('Choose an absolute storage folder.');
    result[key]=path.resolve(folder);
    if(result[key]===path.parse(result[key]).root)throw Error('Choose a folder inside the drive, rather than the drive itself.');
    if(fs.existsSync(result[key])&&!fs.statSync(result[key]).isDirectory())throw Error('A storage location must be a folder.');
  }
  const folders=[result.runtimes,result.models,result.cache].map(physicalPath);
  for(let i=0;i<folders.length;i++)for(let j=i+1;j<folders.length;j++)
    if(path.relative(folders[i],folders[j])===''||within(folders[i],folders[j])||within(folders[j],folders[i]))throw Error('Environment, models and download cache need separate folders.');
  return result;
}
export function loadStorage(profile:string):StoragePaths {
  try{return validateStorage(JSON.parse(fs.readFileSync(path.join(profile,'local-storage.json'),'utf8')));}
  catch{return storagePaths(path.join(profile,'local-speech'));}
}
export function saveStorage(profile:string,locations:StoragePaths) {
  const value=validateStorage(locations);
  for(const folder of [value.runtimes,value.models,value.cache]) {
    fs.mkdirSync(folder,{recursive:true});
    const probe=path.join(folder,`.owlio-write-${randomUUID()}`);
    try{fs.writeFileSync(probe,'',{flag:'wx'});}finally{if(fs.existsSync(probe))fs.unlinkSync(probe);}
  }
  fs.mkdirSync(profile,{recursive:true});
  const temporary=path.join(profile,`local-storage.${randomUUID()}.tmp`);
  try{fs.writeFileSync(temporary,JSON.stringify(value,null,2));fs.renameSync(temporary,path.join(profile,'local-storage.json'));}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return value;
}
export function availableBytes(folder:string):number|undefined {
  try{let existing=folder;while(!fs.existsSync(existing)){const parent=path.dirname(existing);if(parent===existing)return;existing=parent;}
    const disk=fs.statfsSync(existing);return Number(disk.bavail)*Number(disk.bsize);
  }catch{return;}
}
const CACHE_MARKER='.owlio-download-cache.json';
function owner(profile:string) {return createHash('sha256').update(path.resolve(profile).toLowerCase()).digest('hex');}
export function markCache(profile:string,cache:string) {
  fs.mkdirSync(cache,{recursive:true});
  const marker=path.join(cache,CACHE_MARKER);
  if(!fs.existsSync(marker)&&fs.readdirSync(cache).length===0)fs.writeFileSync(marker,JSON.stringify({owner:owner(profile)}));
}
export async function clearDownloadCache(profile:string,locations:StoragePaths,signal?:AbortSignal):Promise<void> {
  const cache=locations.cache;
  if(!fs.existsSync(cache))return;
  validateStorage(locations);
  if(fs.lstatSync(cache).isSymbolicLink())throw Error('Choose a download cache folder without a symbolic link before clearing it.');
  const marker=path.join(cache,CACHE_MARKER);
  const legacy=path.relative(path.join(profile,'local-speech','downloads'),cache)==='';
  let managed=false;try{managed=JSON.parse(fs.readFileSync(marker,'utf8')).owner===owner(profile);}catch{}
  if(!managed&&!legacy)throw Error('This cache was not created by this Owlio profile. Its files have been left untouched.');
  const resolvedCache=fs.realpathSync(cache);
  const remove=async(target:string):Promise<void>=>{
    signal?.throwIfAborted();
    if(!within(cache,path.resolve(target))||!within(resolvedCache,fs.realpathSync(target))||fs.lstatSync(target).isSymbolicLink())throw Error('Unexpected cache link. Its files have been left untouched.');
    const entry=await fs.promises.lstat(target);
    if(entry.isDirectory()){for(const name of await fs.promises.readdir(target))await remove(path.join(target,name));await fs.promises.rmdir(target);}
    else await fs.promises.unlink(target);
  };
  // Remove only artifacts our installer produces, retaining unknown files and the ownership marker.
  for(const name of await fs.promises.readdir(cache))if(name==='pip'||/^python-[0-9.]+\.tar\.gz(?:\.part)?$/.test(name))await remove(path.join(cache,name));
  markCache(profile,cache);
}

export async function copyModelCache(source:string,destination:string,signal:AbortSignal,progress:(received:number,total:number)=>void) {
  const origin=fs.realpathSync(source),target=physicalPath(destination);
  if(path.relative(origin,target)===''||within(origin,target)||within(target,origin))throw Error('Choose a model folder separate from the current model folder before copying.');
  fs.mkdirSync(destination,{recursive:true});
  const files:{source:string;relative:string;size:number}[]=[];
  const scan=async(folder:string)=>{
    signal.throwIfAborted();
    for(const name of await fs.promises.readdir(folder)) {
      signal.throwIfAborted();const file=path.join(folder,name),real=await fs.promises.realpath(file);
      if(!within(origin,real))throw Error('A model-cache link points outside the current model folder. Copy has stopped.');
      const entry=await fs.promises.stat(file);
      if(entry.isDirectory()) {
        if((await fs.promises.lstat(file)).isSymbolicLink())throw Error('Model-cache directory links cannot be copied automatically.');
        if(name!=='.locks')await scan(file);
      } else if(entry.isFile()&&!name.endsWith('.incomplete')&&!name.startsWith('.owlio-part-'))files.push({source:file,relative:path.relative(source,file),size:entry.size});
    }
  };
  await scan(source);
  const total=files.reduce((sum,file)=>sum+file.size,0),free=availableBytes(destination);
  const remaining=files.reduce((sum,file)=>sum+(fs.existsSync(path.join(destination,file.relative))?0:file.size),0);
  if(free!==undefined&&free<remaining+100*1024**2)throw Error(`Not enough space to copy models. Allow ${(remaining/1024**3).toFixed(1)} GB plus working space.`);
  let received=0,last=0;progress(0,total);
  const hash=async(file:string)=>{const h=createHash('sha256');for await(const chunk of fs.createReadStream(file)){signal.throwIfAborted();h.update(chunk);}return h.digest('hex');};
  for(const file of files) {
    signal.throwIfAborted();const output=path.join(destination,file.relative);
    if(!within(target,physicalPath(output)))throw Error('A destination link points outside the model folder. Copy has stopped.');
    fs.mkdirSync(path.dirname(output),{recursive:true});
    if(fs.existsSync(output)) {
      if(!fs.statSync(output).isFile()||fs.statSync(output).size!==file.size||await hash(output)!==await hash(file.source))throw Error('A different model file already exists in the destination. Choose an empty model folder.');
      received+=file.size;progress(received,total);continue;
    }
    const temporary=path.join(path.dirname(output),`.owlio-part-${randomUUID()}`);
    const meter=new Transform({transform(chunk,_encoding,callback){received+=chunk.length;if(Date.now()-last>300){progress(received,total);last=Date.now();}callback(null,chunk);}});
    try {
      await pipeline(fs.createReadStream(file.source),meter,fs.createWriteStream(temporary,{flags:'wx'}),{signal});
      signal.throwIfAborted();
      try{await fs.promises.link(temporary,output);} // Atomic, without overwriting an existing file.
      catch(error){if(!['EPERM','ENOSYS','ENOTSUP','EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code||''))throw error;
        const free=availableBytes(path.dirname(output));if(free!==undefined&&free<file.size)throw Error('This drive needs extra working space to finish copying this model.');
        await fs.promises.copyFile(temporary,output,fs.constants.COPYFILE_EXCL);}
    } finally {if(fs.existsSync(temporary))await fs.promises.unlink(temporary);}
  }
  progress(total,total);
}
