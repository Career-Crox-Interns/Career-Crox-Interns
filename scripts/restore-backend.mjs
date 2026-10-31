import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),backend=path.join(root,'backend'),archive=path.join(backend,'source.bundle.json.gz'),manifestFile=path.join(backend,'source-manifest.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// CC141: merged the original dependency installer into this already-required
// deployment script. Identical locked, cached npm-ci behavior; one fewer GitHub
// upload file. This mode exits before source restoration/verification.
if(process.argv.includes('--safe-install')){
 const idx=process.argv.indexOf('--safe-install');
 const target=process.argv[idx+1];
 if(!['frontend','backend'].includes(target))throw Error('Invalid install target');
 const dir=path.join(root,target),pkgPath=path.join(dir,'package.json');
 const lockPath=path.join(dir,'package-lock.json');
 if(!fs.existsSync(pkgPath)||!fs.existsSync(lockPath))throw Error('Missing locked package '+target);
 const nodeModules=path.join(dir,'node_modules');
 const marker=path.join(nodeModules,'.career-crox-deps.sha256');
 const digest=crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).update(fs.readFileSync(lockPath)).digest('hex');
 let ready=false;
 try{
  if(fs.existsSync(marker)&&fs.readFileSync(marker,'utf8').trim()===digest){
   const require=createRequire(pkgPath),pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
   const names=[...Object.keys(pkg.dependencies||{}),...(target==='frontend'?Object.keys(pkg.devDependencies||{}):[])];
   ready=names.every(name=>{try{require.resolve(name);return true;}catch{return false;}});
  }
 }catch{}
 if(ready)console.log(target+' dependencies unchanged and cached. Skipping npm install.');
 else{
  const args=['ci','--prefix',target,target==='frontend'?'--include=dev':'--omit=dev','--prefer-offline','--no-audit','--no-fund','--progress=false'];
  if(target==='backend')args.push('--ignore-scripts');
  console.log('Installing locked '+target+' dependencies.');
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',args,{stdio:'inherit',cwd:root,env:{...process.env,NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_PROGRESS:'false'}});
  fs.mkdirSync(nodeModules,{recursive:true});fs.writeFileSync(marker,digest+'\n');
  console.log('Dependency cache marker updated.');
 }
 process.exit(0);
}
const sync=process.argv.includes('--sync-manifest');
function sources(){const files={};function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())scan(file);else if(item.isFile()){const bytes=fs.readFileSync(file),relative=path.relative(backend,file).replaceAll('\\','/');files[relative]={sha256:hash(bytes),base64:bytes.toString('base64')};}else throw Error('Backend source must be a regular file: '+file);}}scan(path.join(backend,'src'));return files;}
function validPath(relative){return relative.startsWith('src/')&&!relative.includes('\\')&&!relative.includes('\0')&&!relative.split('/').some(s=>!s||s==='.'||s==='..');}
if(!process.argv.includes('--pack')&&fs.existsSync(manifestFile)){
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),expected=manifest.sha256;
 if(manifest.format!=='loose-backend-v1'||!expected||typeof expected!=='object'||!Number.isInteger(manifest.file_count)||Object.keys(expected).length!==manifest.file_count||!Object.hasOwn(expected,'src/server.js'))throw Error('Invalid loose backend source manifest.');
 let changed=0;
 for(const [relative,digest]of Object.entries(expected)){
  if(!validPath(relative)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid source entry in manifest: '+relative);
  const file=path.resolve(backend,relative);
  if(!file.startsWith(backend+path.sep)||!fs.existsSync(file))throw Error('Missing backend source: '+relative+'. Upload the complete backend folder.');
  if(hash(fs.readFileSync(file))!==digest){changed++;if(!sync)throw Error('Modified backend source: '+relative+'. Run npm run render-build to build and record your edits.');}
 }
 console.log('CC135: '+manifest.file_count+' plain backend files present; '+changed+' edited files'+(sync?' will be recorded by this build.':'; checksums verified.'));
}else if(process.argv.includes('--pack')){
 const files=sources();fs.writeFileSync(archive,zlib.gzipSync(JSON.stringify({release:'CC135',files}),{level:9}));console.log('Packed '+Object.keys(files).length+' complete backend source files.');
}else{
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(archive),{maxOutputLength:40*1024*1024}).toString('utf8'));
 if(!data.files||typeof data.files!=='object')throw Error('Backend source archive is incomplete.');
 const pending=[];
 for(const [relative,item]of Object.entries(data.files)){
  if(!validPath(relative))throw Error('Invalid source path.');const file=path.resolve(backend,relative);
  if(!file.startsWith(backend+path.sep))throw Error('Invalid source location.');
  const bytes=Buffer.from(item.base64,'base64');if(hash(bytes)!==item.sha256)throw Error('Backend source checksum failed: '+relative);pending.push({file,bytes});
 }
 if(!pending.some(x=>x.file===path.join(backend,'src/server.js')))throw Error('Backend server source is missing.');
 for(const {file,bytes}of pending){if(fs.existsSync(file)&&hash(fs.readFileSync(file))===hash(bytes))continue;fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.restore-'+process.pid;fs.writeFileSync(temp,bytes);fs.renameSync(temp,file);}
 console.log('Verified '+pending.length+' backend source files; startup paths preserved.');
}
if(sync){const files=sources();fs.writeFileSync(manifestFile,JSON.stringify({format:'loose-backend-v1',release:'CC135',file_count:Object.keys(files).length,sha256:Object.fromEntries(Object.entries(files).map(([name,item])=>[name,item.sha256]))},null,2)+'\n');console.log('CC135: Backend source manifest updated without replacing edited source.');}

// CC120: restore the complete notification/page sources from the compact upload.
// Local Test uses the already compiled UI and never runs a frontend build.
const frontend=path.join(root,'frontend'),pagesArchive=path.join(frontend,'source-pages.json.gz');
if(fs.existsSync(pagesArchive)){
 const packed=JSON.parse(zlib.gunzipSync(fs.readFileSync(pagesArchive),{maxOutputLength:40*1024*1024}).toString('utf8'));
 if(packed.format!=='cc120-frontend-pages-v1'||!packed.files||typeof packed.files!=='object')throw Error('Invalid frontend page archive.');
 const pending=[];
 for(const [relative,item]of Object.entries(packed.files)){
  if(!relative.startsWith('src/pages/')||!relative.endsWith('.jsx')||relative.includes('\\')||relative.includes('\0')||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid frontend page path.');
  const file=path.resolve(frontend,relative),bytes=Buffer.from(item.base64,'base64');
  if(!file.startsWith(frontend+path.sep)||hash(bytes)!==item.sha256)throw Error('Frontend page integrity check failed: '+relative);
  pending.push({file,bytes});
 }
 if(!pending.some(item=>item.file===path.join(frontend,'src/pages/NotificationsPage.jsx')))throw Error('Notification page source is missing.');
 for(const {file,bytes}of pending){if(fs.existsSync(file)&&hash(fs.readFileSync(file))===hash(bytes))continue;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 console.log('Verified '+pending.length+' complete frontend page sources.');
}
