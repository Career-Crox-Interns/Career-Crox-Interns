const fs=require('fs'),path=require('path'),crypto=require('crypto');
let verified=null;
function currentApk(){
 const dir=path.join(require('../config/env').ROOT_DIR,'public','apk'),file=path.join(dir,'CAREER_CROX.apk');
 try{const m=JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8'));if(m.version_code!==925||String(m.version_name)!=='1.0.159'||!/^[a-f0-9]{64}$/.test(m.sha256))return null;
 const stat=fs.statSync(file);if(stat.size!==m.size_bytes)return null;const key=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,m.sha256].join(':');
 if(verified?.key!==key){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==m.sha256)return null;verified={key};}
 return {...m,file};}catch{return null}
}
module.exports={currentApk};
