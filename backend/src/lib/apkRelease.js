const fs=require('fs'),path=require('path'),crypto=require('crypto');
function currentApk(){
 const dir=path.join(require('../config/env').ROOT_DIR,'public','apk'),file=path.join(dir,'CAREER_CROX.apk');
 try{const m=JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8'));if(m.version_code!==283||!String(m.version_name).startsWith('CC882')||!/^[a-f0-9]{64}$/.test(m.sha256))return null;if(!fs.existsSync(file))return null;const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(hash!==m.sha256)return null;return{file,...m}}catch{return null}
}
module.exports={currentApk};
