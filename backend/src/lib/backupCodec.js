const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const derive = promisify(crypto.pbkdf2), gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const FORMAT = 'career-crox-backup', ITERATIONS = 210000, MAX_PLAIN = 256 * 1024 * 1024;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function secret(value) {
  const s = String(value || '');
  if (s.length < 12 || s.length > 256) throw Object.assign(new Error('Use a backup passphrase of 12–256 characters.'), { status: 400 });
  return s;
}
async function seal(payload, passphrase) {
  secret(passphrase);
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > MAX_PLAIN) throw Object.assign(new Error('Backup exceeds the 256 MB uncompressed limit.'), { status: 413 });
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await derive(passphrase, salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(await gzip(plain)), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return { format: FORMAT, version: 1, build: 'CC861', created_at: payload.created_at, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), sha256: sha(encrypted) };
}
async function open(envelope, passphrase) {
  secret(passphrase);
  if (envelope?.format !== FORMAT || envelope.version !== 1 || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw Object.assign(new Error('Unsupported backup file.'), { status: 400 });
  const encrypted = Buffer.from(String(envelope.ciphertext || ''), 'base64'), salt = Buffer.from(String(envelope.salt || ''), 'base64'), iv = Buffer.from(String(envelope.iv || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || encrypted.length < 17 || encrypted.length > 64 * 1024 * 1024 || sha(encrypted) !== envelope.sha256) throw Object.assign(new Error('Backup file is damaged or too large.'), { status: 400 });
  const key = await derive(passphrase, salt, ITERATIONS, 32, 'sha256');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(encrypted.subarray(-16));
    const packed = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
    return JSON.parse((await gunzip(packed, { maxOutputLength: MAX_PLAIN })).toString('utf8'));
  } catch { throw Object.assign(new Error('Wrong passphrase or damaged backup.'), { status: 400 }); }
  finally { key.fill(0); }
}
module.exports = { seal, open, sha };

// CC874: bounded, independently authenticated frames. The legacy reader above
// is retained only for explicit compatibility inspection, never a PIN bypass.
const zlibV2=require('zlib'),{once:onceV2}=require('events');
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function publicFingerprint(pem){return sha(crypto.createPublicKey(pem).export({type:'spki',format:'der'}));}
function frameAad(header,index){return Buffer.from(canonical({format:header.format,version:2,backup_id:header.backup_id,index,header_hash:header.header_hash}));}
function sealFrame(header,key,index,payload){
 const plain=Buffer.from(JSON.stringify(payload));if(plain.length>4*1024*1024)throw Object.assign(new Error('Backup frame is too large.'),{status:413});
 const iv=Buffer.alloc(12);Buffer.from(header.nonce_prefix,'base64').copy(iv);iv.writeBigUInt64BE(BigInt(index),4);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});cipher.setAAD(frameAad(header,index));
 const packed=zlibV2.gzipSync(plain,{level:6}),data=Buffer.concat([cipher.update(packed),cipher.final()]);
 return {index,iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function openFrame(header,key,frame,index){
 if(frame.index!==index||index<0)throw Error('Backup frame order is invalid.');
 const iv=Buffer.from(frame.iv||'','base64'),tag=Buffer.from(frame.tag||'','base64'),data=Buffer.from(frame.data||'','base64');
 const expected=Buffer.alloc(12);Buffer.from(header.nonce_prefix||'','base64').copy(expected);expected.writeBigUInt64BE(BigInt(index),4);
 if(iv.length!==12||!iv.equals(expected)||tag.length!==16||data.length>5*1024*1024)throw Error('Invalid encrypted backup frame.');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});decipher.setAAD(frameAad(header,index));decipher.setAuthTag(tag);
 const packed=Buffer.concat([decipher.update(data),decipher.final()]);return JSON.parse(zlibV2.gunzipSync(packed,{maxOutputLength:4*1024*1024}).toString('utf8'));
}
async function createWriter(output,recoveryPublicKey,backupId){
 const recipient=crypto.createPublicKey(recoveryPublicKey);if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength<3072)throw Error('A valid RSA-3072 recovery public key is required.');
 const key=crypto.randomBytes(32),header={format:'career-crox-multiple-crm',version:2,backup_id:backupId,cipher:'AES-256-GCM',compression:'gzip',nonce_prefix:crypto.randomBytes(4).toString('base64'),recipient:publicFingerprint(recoveryPublicKey),wrapped_key:crypto.publicEncrypt({key:recipient,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64')};
 header.header_hash=sha(Buffer.from(canonical(header)));let index=0,bytes=0;const digest=crypto.createHash('sha256');
 async function line(value){const raw=Buffer.from(JSON.stringify(value)+'\n');digest.update(raw);bytes+=raw.length;if(!output.write(raw))await onceV2(output,'drain');}
 await line(header);
 return {header,async packet(payload){await line(sealFrame(header,key,index++,payload));},async finish(payload){await line(sealFrame(header,key,index++,{...payload,kind:'end',frames:index-1}));output.end();await onceV2(output,'finish');key.fill(0);return {sha256:digest.digest('hex'),bytes,frames:index};}};
}
function verifyHeader(header){if(header?.format!=='career-crox-multiple-crm'||header.version!==2||header.cipher!=='AES-256-GCM'||header.compression!=='gzip')throw Error('Unsupported full-CRM archive.');const {header_hash,...rest}=header;if(sha(Buffer.from(canonical(rest)))!==header_hash)throw Error('Backup header checksum failed.');return true;}
module.exports.v2={canonical,publicFingerprint,frameAad,sealFrame,openFrame,createWriter,verifyHeader};
