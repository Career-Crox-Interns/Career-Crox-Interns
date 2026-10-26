import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),backend=path.join(root,'backend'),archive=path.join(backend,'source.bundle.json.gz'),manifestFile=path.join(backend,'source-manifest.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
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
 console.log('CC930: '+manifest.file_count+' plain backend files present; '+changed+' edited files'+(sync?' will be recorded by this build.':'; checksums verified.'));
}else if(process.argv.includes('--pack')){
 const files=sources();fs.writeFileSync(archive,zlib.gzipSync(JSON.stringify({release:'CC930',files}),{level:9}));console.log('Packed '+Object.keys(files).length+' complete backend source files.');
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
if(sync){const files=sources();fs.writeFileSync(manifestFile,JSON.stringify({format:'loose-backend-v1',release:'CC930',file_count:Object.keys(files).length,sha256:Object.fromEntries(Object.entries(files).map(([name,item])=>[name,item.sha256]))},null,2)+'\n');console.log('CC930: Backend source manifest updated without replacing edited source.');}
