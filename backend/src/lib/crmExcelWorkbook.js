'use strict';
// Self-contained real XLSX reader/writer: no extra npm package or hosting secret.
// A readable worksheet stores each database row as JSON, split across cells when needed.
const zlib=require('zlib'),crypto=require('crypto');
const LIMIT=48*1024*1024,MAX_UNPACKED=96*1024*1024;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const xml=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
const unxml=x=>String(x).replace(/&(?:amp|lt|gt|quot|apos|#(?:x[0-9a-fA-F]+|\d+));/g,m=>({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m]??(m.startsWith('&#')?String.fromCodePoint(m[2].toLowerCase()==='x'?parseInt(m.slice(3,-1),16):Number(m.slice(2,-1))):m)));
const crcTable=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(buf){let c=-1;for(let i=0;i<buf.length;i++)c=crcTable[(c^buf[i])&255]^(c>>>8);return (c^-1)>>>0;}
function zip(files){const locals=[],centers=[];let offset=0;for(const [name,value] of files){const data=Buffer.from(value),packed=zlib.deflateRawSync(data),nameBuf=Buffer.from(name),crc=crc32(data);const local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBuf.length,26);locals.push(local,nameBuf,packed);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(nameBuf.length,28);central.writeUInt32LE(offset,42);centers.push(central,nameBuf);offset+=local.length+nameBuf.length+packed.length;}
const central=Buffer.concat(centers),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,end]);}
function unzipSingle(buffer,wanted){
 if(!Buffer.isBuffer(buffer)||buffer.length>LIMIT||buffer.length<30)throw Error('Workbook is too large or invalid.');
 const tail=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 if(tail<0||tail+22>buffer.length||tail+22+buffer.readUInt16LE(tail+20)!==buffer.length)throw Error('This is not a complete Excel workbook.');
 const entries=buffer.readUInt16LE(tail+10),startIndex=buffer.readUInt32LE(tail+16),indexSize=buffer.readUInt32LE(tail+12);
 if(buffer.readUInt16LE(tail+4)||buffer.readUInt16LE(tail+6)||buffer.readUInt16LE(tail+8)!==entries||entries<1||entries>30||startIndex+indexSize!==tail)throw Error('Unsupported or damaged XLSX index.');
 let p=startIndex,found=null;
 for(let i=0;i<entries;i++){
  if(p+46>tail||buffer.readUInt32LE(p)!==0x02014b50)throw Error('Broken XLSX index.');
  const flags=buffer.readUInt16LE(p+8),method=buffer.readUInt16LE(p+10),crc=buffer.readUInt32LE(p+16),size=buffer.readUInt32LE(p+20),outSize=buffer.readUInt32LE(p+24),len=buffer.readUInt16LE(p+28),extra=buffer.readUInt16LE(p+30),comment=buffer.readUInt16LE(p+32),loc=buffer.readUInt32LE(p+42);
  if(p+46+len+extra+comment>tail)throw Error('Truncated XLSX index entry.');
  const name=buffer.subarray(p+46,p+46+len).toString();p+=46+len+extra+comment;
  if(name!==wanted)continue;
  if(found)throw Error('The workbook repeats a required worksheet/container.');
  const maximum=wanted==='xl/worksheets/sheet1.xml'?MAX_UNPACKED:1024*1024;
  if(flags&1||![0,8].includes(method)||size>LIMIT||outSize>maximum||loc+30>startIndex||buffer.readUInt32LE(loc)!==0x04034b50||buffer.readUInt16LE(loc+8)!==method)throw Error('Invalid or unsupported workbook content.');
  const localLen=buffer.readUInt16LE(loc+26),localExtra=buffer.readUInt16LE(loc+28),start=loc+30+localLen+localExtra;
  if(start+size>startIndex||buffer.subarray(loc+30,loc+30+localLen).toString()!==wanted)throw Error('Incomplete or mismatched workbook entry.');
  const content=method===8?zlib.inflateRawSync(buffer.subarray(start,start+size),{maxOutputLength:maximum}):buffer.subarray(start,start+size);
  if(content.length!==outSize||crc32(content)!==crc)throw Error('Damaged XLSX worksheet.');
  found=content.toString('utf8');
 }
 if(p!==tail)throw Error('Unexpected XLSX index length.');
 if(found===null)throw Error('Backup worksheet missing. Use the original Career Crox Excel file.');
 return found;
}
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const cell=(v,r,c)=>`<c r="${col(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
function makeWorkbook(payload){const jsonRows=[];for(const [name,rows] of Object.entries(payload.tables)){for(const row of rows){const j=JSON.stringify(row);if(j.length>250000)throw Error('A '+name+' record is too large for the safe Excel format.');const segments=[];for(let i=0;i<j.length;){let end=Math.min(i+16000,j.length);if(end<j.length&&/^[\uD800-\uDBFF]$/.test(j[end-1])&&/^[\uDC00-\uDFFF]$/.test(j[end]))end--;segments.push(j.slice(i,end));i=end;}if(segments.length>24)throw Error('A CRM row has too much text for an Excel worksheet.');jsonRows.push([name,...segments]);}}
if(jsonRows.length>250000)throw Error('CRM has too many rows for one Excel worksheet.');const metadata={format:'career-crox-full-excel',version:1,created_at:payload.created_at,highwater:payload.highwater,schema:payload.schema,table_counts:Object.fromEntries(Object.entries(payload.tables).map(([t,rows])=>[t,rows.length])),checksum:sha(JSON.stringify(jsonRows))};const manifestText=JSON.stringify(metadata),manifestCells=[];for(let i=0;i<manifestText.length;i+=16000)manifestCells.push(manifestText.slice(i,i+16000));if(manifestCells.length>25)throw Error('CRM schema manifest exceeds the Excel format limit.');const rows=[['Career Crox full CRM Excel backup — private data; do not share'],['Manifest',...manifestCells],['Table','Record JSON (part 1)','Record JSON (part 2)…'],...jsonRows];const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((v,c)=>cell(v,i+1,c)).join('')}</row>`).join('')}</sheetData></worksheet>`;if(Buffer.byteLength(sheet)>MAX_UNPACKED)throw Error('CRM exceeds the supported uncompressed Excel size. No partial file was made.');const output=zip([['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CRM Database" sheetId="1" r:id="rId1"/></sheets></workbook>'],['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet]]);if(output.length>LIMIT)throw Error('CRM exceeds the supported 48 MB Excel file size.');return output;}
function readWorkbook(buffer){for(const name of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels'])unzipSingle(buffer,name);const sheet=unzipSingle(buffer,'xl/worksheets/sheet1.xml'),records=[];const rowPattern=/<row\s[^>]*>([\s\S]*?)<\/row>/g,cellPattern=/<c\s[^>]*>([\s\S]*?)<\/c>/g;let r;while((r=rowPattern.exec(sheet))){let c,cols=[];while((c=cellPattern.exec(r[1]))){const t=/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(c[1]);cols.push(t?unxml(t[1]):'');}records.push(cols);if(records.length>250003)throw Error('Workbook row limit exceeded.');cellPattern.lastIndex=0;}
if(records[1]?.[0]!=='Manifest'||records[2]?.[0]!=='Table')throw Error('Not a Career Crox full backup Excel file.');const manifest=JSON.parse(records[1].slice(1).join(''));if(manifest.format!=='career-crox-full-excel'||manifest.version!==1||!manifest.schema||!manifest.table_counts)throw Error('Unsupported backup version.');const entries=records.slice(3);if(Array.isArray(manifest.schema)||Array.isArray(manifest.table_counts)||typeof manifest.table_counts!=='object'||Object.values(manifest.table_counts).some(n=>!Number.isSafeInteger(n)||n<0||n>250000)||Object.values(manifest.table_counts).reduce((a,b)=>a+b,0)>250000)throw Error('Invalid backup table counts.');if(sha(JSON.stringify(entries))!==manifest.checksum)throw Error('Workbook records were modified or corrupted. Download a fresh original.');const tables=Object.fromEntries(Object.keys(manifest.table_counts).map(name=>[name,[]]));for(const entry of entries){const name=entry[0];if(!Object.hasOwn(tables,name))throw Error('Unknown table in workbook.');const obj=JSON.parse(entry.slice(1).join(''));if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Invalid workbook row.');tables[name].push(obj);}for(const [name,count] of Object.entries(manifest.table_counts))if(tables[name].length!==count)throw Error('Backup is missing records from '+name);return {...manifest,tables};}
module.exports={makeWorkbook,readWorkbook,sha,_test:{zip,unzipSingle}};

// Editable workbooks use ordinary Excel cells. Their manifest carries row
// identities and original field fingerprints, separate from the backup format.
const WORK_FORMAT = 'career-crox-working-copy-206';
const WORK_BYTES = 48 * 1024 * 1024;
const WORK_XML_BYTES = 96 * 1024 * 1024;
const WORK_ROWS = 250000;
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const XLSX_PASSWORD_URI = 'http://schemas.microsoft.com/office/2006/keyEncryptor/password';

function workError(message) {
  return Object.assign(new Error(message), { status: 422 });
}
function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}
function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}
function padded(bytes, size) {
  const result = Buffer.alloc(Math.ceil(bytes.length / size) * size);
  bytes.copy(result);
  return result;
}
function equalBytes(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function hashBytes(algorithm, ...parts) {
  const digest = crypto.createHash(algorithm);
  for (const part of parts) digest.update(part);
  return digest.digest();
}
function aesCbc(bytes, key, iv, decrypt = false) {
  const method = decrypt ? crypto.createDecipheriv : crypto.createCipheriv;
  const cipher = method('aes-' + key.length * 8 + '-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
function passwordHash(password, salt, algorithm, spins) {
  let result = hashBytes(algorithm, salt, Buffer.from(password, 'utf16le'));
  const counter = Buffer.alloc(4);
  for (let i = 0; i < spins; i++) {
    counter.writeUInt32LE(i);
    result = hashBytes(algorithm, counter, result);
  }
  return result;
}
const OFFICE_BLOCKS = Object.fromEntries(Object.entries({
  verifier:'fea7d2763b4b9e79', verifierHash:'d7aa0f6d3061344e',
  secret:'146e0be7abacd0d6', hmacKey:'5fb2ad010cb9e1f6', hmacValue:'a0677f02b22c8433'
}).map(([name, hex]) => [name, Buffer.from(hex, 'hex')]));
function officeKey(passwordDigest, block, algorithm, size) {
  const derived = hashBytes(algorithm, passwordDigest, block);
  const key = Buffer.alloc(size, 0x36);
  derived.copy(key, 0, 0, size);
  return key;
}
function officeIv(salt, block, algorithm) {
  return hashBytes(algorithm, salt, block).subarray(0, 16);
}

// Compound File Binary v3 writer. Small streams use MiniFAT. Large packages
// include DIFAT sectors when the header's FAT pointers are exhausted.
const CFB_FREE = 0xffffffff;
const CFB_END = 0xfffffffe;
const CFB_FAT = 0xfffffffd;
const CFB_DIF = 0xfffffffc;
function officeContainer(encryptionInfo, encryptedPackage) {
  const wide = value => {
    const bytes = Buffer.from(value, 'utf16le');
    return Buffer.concat([u32(bytes.length), padded(bytes, 4)]);
  };
  const versions = Buffer.from('010000000100000001000000', 'hex');
  const transformName = 'Microsoft.Container.EncryptionTransform';
  const map = Buffer.concat([u32(1), u32(0), wide('EncryptedPackage'), wide('StrongEncryptionDataSpace')]);
  const transform = Buffer.concat([u32(1), wide('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}')]);
  const directory = [];
  function add(name, kind, parent, data = Buffer.alloc(0)) {
    const entry = { name, kind, children:[], data, first:CFB_END, size:0, left:CFB_FREE, right:CFB_FREE, child:CFB_FREE, color:1 };
    const index = directory.push(entry) - 1;
    if (parent !== null) directory[parent].children.push(index);
    return index;
  }
  add('Root Entry', 5, null);
  const spaces = add('\x06DataSpaces', 1, 0);
  add('Version', 2, spaces, Buffer.concat([wide('Microsoft.Container.DataSpaces'), versions]));
  add('DataSpaceMap', 2, spaces, Buffer.concat([u32(8), u32(1), u32(map.length + 4), map]));
  const info = add('DataSpaceInfo', 1, spaces);
  add('StrongEncryptionDataSpace', 2, info, Buffer.concat([u32(8), u32(1), wide('StrongEncryptionTransform')]));
  const transformInfo = add('TransformInfo', 1, spaces);
  const strong = add('StrongEncryptionTransform', 1, transformInfo);
  add('\x06Primary', 2, strong, Buffer.concat([u32(transform.length+4), transform, wide(transformName), versions, u32(0), u32(0), u32(4)]));
  add('EncryptionInfo', 2, 0, encryptionInfo);
  add('EncryptedPackage', 2, 0, encryptedPackage);

  function buildTree(indices) {
    const depthLimit = Math.floor(Math.log2(indices.length));
    const build = (start, end, depth) => {
      if (start >= end) return CFB_FREE;
      const middle = (start + end) >> 1;
      const index = indices[middle], entry = directory[index];
      entry.left = build(start, middle, depth + 1);
      entry.right = build(middle + 1, end, depth + 1);
      entry.color = depth && depth === depthLimit ? 0 : 1;
      return index;
    };
    return build(0, indices.length, 0);
  }
  const fat = [], body = [], miniFat = [], mini = [];
  function allocate(data, list, blocks, sectorSize) {
    if (!data.length) return CFB_END;
    const first = list.length;
    const count = Math.ceil(data.length / sectorSize);
    for (let i = 0; i < count; i++) list.push(i === count - 1 ? CFB_END : first + i + 1);
    blocks.push(padded(data, sectorSize));
    return first;
  }
  for (const entry of directory) {
    entry.children.sort((a,b) => {
      const left=directory[a].name.toUpperCase(),right=directory[b].name.toUpperCase();
      return left.length-right.length || (left < right ? -1 : left > right ? 1 : 0);
    });
    entry.child = buildTree(entry.children);
    if (entry.kind !== 2) continue;
    entry.size = entry.data.length;
    entry.first = entry.size < 4096
      ? allocate(entry.data, miniFat, mini, 64) : allocate(entry.data, fat, body, 512);
  }
  const miniStream = Buffer.concat(mini);
  directory[0].first = allocate(miniStream, fat, body, 512);
  directory[0].size = miniStream.length;
  const miniTable = Buffer.alloc(Math.ceil(miniFat.length/128)*512, 0xff);
  miniFat.forEach((value,index) => miniTable.writeUInt32LE(value,index*4));
  const firstMiniFat = allocate(miniTable, fat, body, 512);
  const directoryBytes = Buffer.alloc(directory.length*128);
  directory.forEach((entry,index) => {
    const at=index*128,name=Buffer.from(entry.name+'\0','utf16le');
    name.copy(directoryBytes,at);directoryBytes.writeUInt16LE(name.length,at+64);
    directoryBytes[at+66]=entry.kind;directoryBytes[at+67]=entry.color;
    directoryBytes.writeUInt32LE(entry.left,at+68);directoryBytes.writeUInt32LE(entry.right,at+72);
    directoryBytes.writeUInt32LE(entry.child,at+76);directoryBytes.writeUInt32LE(entry.first,at+116);
    u64(entry.size).copy(directoryBytes,at+120);
  });
  const firstDirectory = allocate(directoryBytes, fat, body, 512);
  let fatCount=0,difatCount=0;
  while (true) {
    const nextFat=Math.ceil((fat.length+fatCount+difatCount)/128);
    const nextDifat=Math.ceil(Math.max(nextFat-109,0)/127);
    if (nextFat===fatCount&&nextDifat===difatCount) break;
    fatCount=nextFat;difatCount=nextDifat;
  }
  const firstFat=fat.length,firstDifat=firstFat+fatCount;
  const header=Buffer.alloc(512);
  OFFICE_MAGIC.copy(header);header.writeUInt16LE(0x3e,24);header.writeUInt16LE(3,26);
  header.writeUInt16LE(0xfffe,28);header.writeUInt16LE(9,30);header.writeUInt16LE(6,32);
  header.writeUInt32LE(fatCount,44);header.writeUInt32LE(firstDirectory,48);
  header.writeUInt32LE(4096,56);header.writeUInt32LE(firstMiniFat,60);
  header.writeUInt32LE(miniTable.length/512,64);
  header.writeUInt32LE(difatCount?firstDifat:CFB_END,68);header.writeUInt32LE(difatCount,72);
  header.fill(0xff,76);
  for (let i=0;i<Math.min(109,fatCount);i++) header.writeUInt32LE(firstFat+i,76+i*4);
  const fatBytes=Buffer.alloc(fatCount*512,0xff);
  fat.forEach((value,index)=>fatBytes.writeUInt32LE(value,index*4));
  for(let i=0;i<fatCount;i++)fatBytes.writeUInt32LE(CFB_FAT,(firstFat+i)*4);
  for(let i=0;i<difatCount;i++)fatBytes.writeUInt32LE(CFB_DIF,(firstDifat+i)*4);
  const difatBytes=Buffer.alloc(difatCount*512,0xff);
  for(let i=109;i<fatCount;i++){
    const slot=i-109;
    difatBytes.writeUInt32LE(firstFat+i,Math.floor(slot/127)*512+(slot%127)*4);
  }
  for(let i=0;i<difatCount;i++)difatBytes.writeUInt32LE(i+1===difatCount?CFB_END:firstDifat+i+1,i*512+508);
  return Buffer.concat([header,...body,fatBytes,difatBytes]);
}
function officeStreams(file) {
  if (file.length<512||file.length>WORK_BYTES||!file.subarray(0,8).equals(OFFICE_MAGIC)) throw workError('Choose the password-protected .xlsx from Working Copy.');
  const major=file.readUInt16LE(26),shift=file.readUInt16LE(30);
  if (![[3,9],[4,12]].some(pair=>pair[0]===major&&pair[1]===shift)||file.readUInt16LE(32)!==6||file.readUInt16LE(28)!==0xfffe) throw workError('Unsupported Excel encryption container.');
  const sectorSize=1<<shift,sectors=Math.floor(file.length/sectorSize)-1;
  const sector = index => {
    if (index>=sectors) throw workError('The Excel file is incomplete.');
    return file.subarray((index+1)*sectorSize,(index+2)*sectorSize);
  };
  const fatCount=file.readUInt32LE(44),difatCount=file.readUInt32LE(72),fatSectors=[];
  if (!fatCount||fatCount>sectors||difatCount>sectors) throw workError('Invalid Excel storage index.');
  for (let i=0;i<109;i++) {
    const index=file.readUInt32LE(76+i*4);
    if (index!==CFB_FREE) fatSectors.push(index);
  }
  let next=file.readUInt32LE(68);
  const seenDifat=new Set();
  for (let i=0;i<difatCount;i++) {
    if(seenDifat.has(next))throw workError('Invalid Excel storage index.');
    seenDifat.add(next);
    const page=sector(next);
    for(let at=0;at<sectorSize-4;at+=4){
      const index=page.readUInt32LE(at);
      if(index!==CFB_FREE)fatSectors.push(index);
    }
    next=page.readUInt32LE(sectorSize-4);
  }
  if(fatSectors.length!==fatCount||new Set(fatSectors).size!==fatCount)throw workError('Invalid Excel storage index.');
  const fat=Buffer.concat(fatSectors.map(sector));
  function chain(first,index,getBlock,blockSize,maxBytes,size) {
    const blocks=[],seen=new Set();
    let current=first,length=0;
    while(current!==CFB_END){
      if(seen.has(current)||current*4+4>index.length||length+blockSize>maxBytes)throw workError('Invalid or oversized Excel stream.');
      seen.add(current);blocks.push(getBlock(current));length+=blockSize;
      current=index.readUInt32LE(current*4);
    }
    if(size!==undefined&&(size>length||length-size>=blockSize))throw workError('Incomplete Excel stream.');
    const value=Buffer.concat(blocks);
    return size===undefined?value:value.subarray(0,size);
  }
  const directory=chain(file.readUInt32LE(48),fat,sector,sectorSize,2*1024*1024);
  const streams=new Map();
  let root;
  for(let at=0;at+128<=directory.length;at+=128){
    const length=directory.readUInt16LE(at+64),type=directory[at+66];
    if(![2,5].includes(type)||length<2||length>64||length%2)continue;
    const name=directory.subarray(at,at+length-2).toString('utf16le');
    const item={first:directory.readUInt32LE(at+116),size:Number(directory.readBigUInt64LE(at+120))};
    if(type===5)root=item;
    if(type===2&&['EncryptionInfo','EncryptedPackage'].includes(name)){
      if(streams.has(name))throw workError('Duplicate Excel encryption stream.');
      streams.set(name,item);
    }
  }
  if(!root||streams.size!==2)throw workError('Excel encryption metadata is missing.');
  const miniIndex=chain(file.readUInt32LE(60),fat,sector,sectorSize,2*1024*1024,file.readUInt32LE(64)*sectorSize);
  const miniStream=chain(root.first,fat,sector,sectorSize,4*1024*1024,root.size);
  const getMini=index=>{
    if(index*64+64>miniStream.length)throw workError('Invalid Excel mini-stream.');
    return miniStream.subarray(index*64,index*64+64);
  };
  return Object.fromEntries([...streams].map(([name,item])=>[
    name,item.size<4096?chain(item.first,miniIndex,getMini,64,4096,item.size)
      :chain(item.first,fat,sector,sectorSize,WORK_BYTES,item.size)
  ]));
}
function encryptOfficeWorkbook(workbook,password) {
  const algorithm='sha512',passwordSalt=crypto.randomBytes(16),dataSalt=crypto.randomBytes(16);
  const spins=100000,key=crypto.randomBytes(32),verifier=crypto.randomBytes(16),hmacKey=crypto.randomBytes(64);
  const passwordDigest=passwordHash(password,passwordSalt,algorithm,spins);
  const locked=(bytes,block)=>aesCbc(bytes,officeKey(passwordDigest,block,algorithm,key.length),passwordSalt).toString('base64');
  const encrypted=[u64(workbook.length)];
  for(let at=0;at<workbook.length;at+=4096)encrypted.push(aesCbc(padded(workbook.subarray(at,at+4096),16),key,officeIv(dataSalt,u32(at/4096),algorithm)));
  const stream=Buffer.concat(encrypted);
  const mac=crypto.createHmac(algorithm,hmacKey).update(stream).digest();
  const hmac=(bytes,block)=>aesCbc(bytes,key,officeIv(dataSalt,block,algorithm)).toString('base64');
  const attrs='saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512"';
  const xmlInfo='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="'+XLSX_PASSWORD_URI+'">'
    +'<keyData '+attrs+' saltValue="'+dataSalt.toString('base64')+'"/>'
    +'<dataIntegrity encryptedHmacKey="'+hmac(hmacKey,OFFICE_BLOCKS.hmacKey)+'" encryptedHmacValue="'+hmac(mac,OFFICE_BLOCKS.hmacValue)+'"/>'
    +'<keyEncryptors><keyEncryptor uri="'+XLSX_PASSWORD_URI+'"><p:encryptedKey spinCount="'+spins+'" '+attrs+' saltValue="'+passwordSalt.toString('base64')+'"'
    +' encryptedVerifierHashInput="'+locked(verifier,OFFICE_BLOCKS.verifier)+'" encryptedVerifierHashValue="'+locked(hashBytes(algorithm,verifier),OFFICE_BLOCKS.verifierHash)+'"'
    +' encryptedKeyValue="'+locked(key,OFFICE_BLOCKS.secret)+'"/></keyEncryptor></keyEncryptors></encryption>';
  return officeContainer(Buffer.concat([Buffer.from('0400040040000000','hex'),Buffer.from(xmlInfo)]),stream);
}
function xmlAttributes(source) {
  const attrs=Object.create(null);
  for(const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[match[1]]=unxml(match[2]??match[3]);
  return attrs;
}
function decryptOfficeWorkbook(file,password) {
  const {EncryptionInfo:info,EncryptedPackage:stream}=officeStreams(file);
  if(info.length<8||info.readUInt16LE(0)!==4||info.readUInt16LE(2)!==4||stream.length<24)throw workError('Use the current Excel .xlsx password format.');
  const data=info.subarray(8).toString('utf8');
  const tag=name=>xmlAttributes((data.match(new RegExp('<(?:[\\w]+:)?'+name+'\\b([^>]*)>'))||[])[1]||'');
  const keyData=tag('keyData'),passwordData=tag('encryptedKey'),integrity=tag('dataIntegrity');
  function spec(attrs) {
    const name=String(attrs.hashAlgorithm||'').toLowerCase(),size=Number(attrs.keyBits)/8,salt=Buffer.from(attrs.saltValue||'','base64');
    if(!['sha1','sha256','sha384','sha512'].includes(name)||![16,24,32].includes(size)||salt.length!==16||attrs.blockSize!=='16'||attrs.cipherAlgorithm!=='AES'||attrs.cipherChaining!=='ChainingModeCBC')throw workError('Unsupported Excel password settings.');
    return {name,size,salt};
  }
  const p=spec(passwordData),k=spec(keyData),spins=Number(passwordData.spinCount);
  if(!Number.isSafeInteger(spins)||spins<1||spins>1000000)throw workError('Unsupported Excel password work factor.');
  const digest=passwordHash(password,p.salt,p.name,spins);
  const unlock=(value,block)=>aesCbc(Buffer.from(value||'','base64'),officeKey(digest,block,p.name,p.size),p.salt,true);
  const verifier=unlock(passwordData.encryptedVerifierHashInput,OFFICE_BLOCKS.verifier).subarray(0,16);
  const expected=hashBytes(p.name,verifier);
  if(!equalBytes(expected,unlock(passwordData.encryptedVerifierHashValue,OFFICE_BLOCKS.verifierHash).subarray(0,expected.length)))throw workError('The Excel file password is incorrect.');
  const secret=unlock(passwordData.encryptedKeyValue,OFFICE_BLOCKS.secret).subarray(0,k.size);
  if(secret.length!==k.size)throw workError('Excel encryption key is incomplete.');
  const macSize=hashBytes(k.name,Buffer.alloc(0)).length;
  const unlockMac=(value,block)=>aesCbc(Buffer.from(value||'','base64'),secret,officeIv(k.salt,block,k.name),true).subarray(0,macSize);
  const macKey=unlockMac(integrity.encryptedHmacKey,OFFICE_BLOCKS.hmacKey);
  const mac=crypto.createHmac(k.name,macKey).update(stream).digest();
  if(macKey.length!==macSize||!equalBytes(mac,unlockMac(integrity.encryptedHmacValue,OFFICE_BLOCKS.hmacValue)))throw workError('Excel file integrity check failed.');
  const size=Number(stream.readBigUInt64LE(0));
  if(size<1||size>WORK_BYTES||stream.length!==8+Math.ceil(size/16)*16)throw workError('The encrypted Excel file is incomplete.');
  const bytes=[];
  for(let at=8;at<stream.length;at+=4096)bytes.push(aesCbc(stream.subarray(at,at+4096),secret,officeIv(k.salt,u32((at-8)/4096),k.name),true));
  return Buffer.concat(bytes).subarray(0,size);
}

// ZIP/CSV uses the AES-256 WinZip AE-2 format. The two-byte password verifier
// and HMAC are checked before inflating each member.
const ZIP_AES_EXTRA = Buffer.from('0199070002004145030800','hex');
function zipAesKeys(password,salt) {
  const keys=crypto.pbkdf2Sync(Buffer.from(password,'utf8'),salt,1000,66,'sha1');
  return [keys.subarray(0,32),keys.subarray(32,64),keys.subarray(64)];
}
function zipAesCtr(bytes,key) {
  const counter=Buffer.alloc(Math.ceil(bytes.length/16)*16);
  for(let at=0;at<counter.length;at+=16)counter.writeUInt32LE(at/16+1,at);
  const cipher=crypto.createCipheriv('aes-256-ecb',key,null);
  cipher.setAutoPadding(false);
  const stream=cipher.update(counter);
  for(let at=0;at<bytes.length;at++)stream[at]^=bytes[at];
  return stream.subarray(0,bytes.length);
}
function workingZip(entries,password='') {
  let offset=0,expanded=0;
  const locals=[],directory=[];
  for(const [name,value] of entries){
    const data=Buffer.from(value),nameBytes=Buffer.from(name);
    expanded+=data.length;
    if(expanded>WORK_XML_BYTES)throw workError('This copy is too large. Choose a date range and try again.');
    const zipped=zlib.deflateRawSync(data,{level:4});
    let payload=zipped,extra=Buffer.alloc(0),method=8,flags=0x800,crc=crc32(data);
    if(password){
      const salt=crypto.randomBytes(16),[cipherKey,macKey,verifier]=zipAesKeys(password,salt);
      const locked=zipAesCtr(zipped,cipherKey);
      payload=Buffer.concat([salt,verifier,locked,crypto.createHmac('sha1',macKey).update(locked).digest().subarray(0,10)]);
      extra=ZIP_AES_EXTRA;method=99;flags|=1;crc=0;
    }
    const local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(password?51:20,4);
    local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);
    local.writeUInt32LE(payload.length,18);local.writeUInt32LE(data.length,22);
    local.writeUInt16LE(nameBytes.length,26);local.writeUInt16LE(extra.length,28);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(51,4);central.writeUInt16LE(password?51:20,6);
    central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);
    central.writeUInt32LE(payload.length,20);central.writeUInt32LE(data.length,24);
    central.writeUInt16LE(nameBytes.length,28);central.writeUInt16LE(extra.length,30);central.writeUInt32LE(offset,42);
    locals.push(local,nameBytes,extra,payload);directory.push(central,nameBytes,extra);
    offset+=local.length+nameBytes.length+extra.length+payload.length;
    if(offset>WORK_BYTES)throw workError('This copy is too large. Choose a date range and try again.');
  }
  const index=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,index,end]);
}
function workingZipEntries(file,password='') {
  if(file.length<22||file.length>WORK_BYTES)throw workError('Working Copy file size is invalid.');
  let end=file.length-22;
  while(end>=Math.max(0,file.length-65557)){
    if(file.readUInt32LE(end)===0x06054b50&&end+22+file.readUInt16LE(end+20)===file.length)break;
    end--;
  }
  if(end<Math.max(0,file.length-65557))throw workError('The file is incomplete. Choose the saved .xlsx or .zip.');
  const count=file.readUInt16LE(end+10),start=file.readUInt32LE(end+16);
  if(!count||count>180||start+file.readUInt32LE(end+12)!==end||file.readUInt16LE(end+4)||file.readUInt16LE(end+6)||file.readUInt16LE(end+8)!==count)throw workError('Unsupported workbook archive.');
  const entries=new Map();let at=start,expanded=0;
  for(let i=0;i<count;i++){
    if(at+46>end||file.readUInt32LE(at)!==0x02014b50)throw workError('Invalid workbook archive directory.');
    const flags=file.readUInt16LE(at+8),method=file.readUInt16LE(at+10),crc=file.readUInt32LE(at+16);
    const length=file.readUInt32LE(at+20),outLength=file.readUInt32LE(at+24),n=file.readUInt16LE(at+28),e=file.readUInt16LE(at+30);
    const comment=file.readUInt16LE(at+32),loc=file.readUInt32LE(at+42),name=file.subarray(at+46,at+46+n).toString('utf8');
    const extras=file.subarray(at+46+n,at+46+n+e);
    at+=46+n+e+comment;
    if(at>end||!name||entries.has(name)||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..')||/vbaProject|externalLinks/i.test(name))throw workError('Unsafe or unsupported workbook entry.');
    expanded+=outLength;
    if(expanded>WORK_XML_BYTES||loc+30>start||file.readUInt32LE(loc)!==0x04034b50||file.readUInt16LE(loc+8)!==method)throw workError('Invalid or oversized workbook entry.');
    const localName=file.readUInt16LE(loc+26),localExtra=file.readUInt16LE(loc+28),pos=loc+30+localName+localExtra;
    if(pos+length>start||!file.subarray(loc+30,loc+30+localName).equals(Buffer.from(name)))throw workError('Invalid workbook entry location.');
    entries.set(name,()=>{
      let compressed=file.subarray(pos,pos+length),compression=method,checkCrc=true;
      if(password){
        let aes;
        for(let k=0;k+4<=extras.length;){
          const id=extras.readUInt16LE(k),size=extras.readUInt16LE(k+2);
          if(k+4+size>extras.length)throw workError('Invalid CSV ZIP encryption settings.');
          if(id===0x9901)aes=extras.subarray(k+4,k+4+size);
          k+=4+size;
        }
        if(!(flags&1)||method!==99||aes?.length!==7||aes[4]!==3||compressed.length<28)throw workError('Choose the AES password-protected Working Copy ZIP.');
        const [key,macKey,verifier]=zipAesKeys(password,compressed.subarray(0,16));
        if(!equalBytes(verifier,compressed.subarray(16,18)))throw workError('The CSV ZIP password is incorrect.');
        const content=compressed.subarray(18,-10);
        const mac=crypto.createHmac('sha1',macKey).update(content).digest().subarray(0,10);
        if(!equalBytes(mac,compressed.subarray(-10)))throw workError('The CSV ZIP failed its password or integrity check.');
        compressed=zipAesCtr(content,key);compression=aes.readUInt16LE(5);checkCrc=aes.readUInt16LE(0)===1;
      }else if(flags&1)throw workError('Unexpected encrypted entry in workbook.');
      if(![0,8].includes(compression))throw workError('Unsupported workbook compression.');
      const bytes=compression===0?compressed:zlib.inflateRawSync(compressed,{maxOutputLength:Math.max(1,outLength)});
      if(bytes.length!==outLength||(checkCrc&&crc32(bytes)!==crc))throw workError('A workbook entry is damaged.');
      return bytes;
    });
  }
  if(at!==end)throw workError('Invalid workbook archive directory length.');
  return entries;
}

const EXCEL_EPOCH = Date.UTC(1899,11,30);
const IST_MS = 19800000;
const DAY_MS = 86400000;
function workValue(value,type,serial=false) {
  if(value===null||value===undefined||value==='')return '';
  if(type==='number'&&/^-?\d+(?:\.\d+)?$/.test(String(value))&&Number.isFinite(Number(value)))return String(Number(value));
  if(!['date','datetime'].includes(type))return String(value);
  if(serial && /^\d+(?:\.\d+)?$/.test(String(value))){
    const numeric=Number(value);
    if(numeric<61||numeric>2958465)throw workError('An Excel date is outside the supported calendar.');
    const instant=EXCEL_EPOCH+Math.round(numeric*DAY_MS/1000)*1000;
    return type==='date'?new Date(instant).toISOString().slice(0,10):new Date(instant-IST_MS).toISOString();
  }
  let raw=String(value).trim().replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}$/.test(raw))raw+=':00';
  if(type==='date' && /^\d{4}-\d{2}-\d{2}/.test(raw)){
    const day=raw.slice(0,10),instant=Date.parse(day);
    if(Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===day)return day;
  }
  if(type==='datetime'&&/^\d{4}-\d{2}-\d{2}$/.test(raw))raw+='T00:00:00';
  if(type==='datetime'&&/^\d{4}-\d{2}-\d{2}T/.test(raw)){
    const instant=Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?raw:raw+'+05:30');
    if(Number.isFinite(instant))return new Date(Math.floor(instant/1000)*1000).toISOString();
  }
  return String(value);
}
function workFingerprint(value,type) {
  return hashBytes('sha256',Buffer.from(workValue(value,type))).subarray(0,12).toString('base64url');
}
function workCell(value,row,index,type='text') {
  const canonical=workValue(value,type),address=col(index)+row;
  if(canonical.length>32767)throw workError('An Excel cell is longer than 32,767 characters. Choose CSV for the full text.');
  if(type==='number'&&/^-?\d+(?:\.\d+)?$/.test(canonical))return '<c r="'+address+'"><v>'+canonical+'</v></c>';
  if(type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(canonical)){
    const date=Date.parse(canonical);
    if(Number.isFinite(date)&&date>=EXCEL_EPOCH+61*DAY_MS)return '<c r="'+address+'" s="2"><v>'+((date-EXCEL_EPOCH)/DAY_MS)+'</v></c>';
  }
  if(type==='datetime'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(canonical)){
    const date=Date.parse(canonical);
    if(Number.isFinite(date)&&date+IST_MS>=EXCEL_EPOCH+61*DAY_MS)return '<c r="'+address+'" s="3"><v>'+((date+IST_MS-EXCEL_EPOCH)/DAY_MS)+'</v></c>';
  }
  const text=xml(canonical.replace(/_x([0-9a-f]{4})_/gi,'_x005f_x$1_'));
  return '<c r="'+address+'" t="inlineStr"'+(type==='note'?' s="1"':'')+'><is><t xml:space="preserve">'+text+'</t></is></c>';
}
const WORK_STYLES='<?xml version="1.0" encoding="UTF-8"?>'
  +'<styleSheet xmlns="'+MAIN_NS+'">'
  +'<numFmts count="2"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="dd mmm yyyy hh:mm"/></numFmts>'
  +'<fonts count="1"><font><sz val="11"/><name val="Calibri"/><color rgb="FF17324D"/></font></fonts>'
  +'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  +'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  +'<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  +'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  +'<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +'<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  +'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const workHeader=(definition)=>['Sr No.',definition.idLabel||'Record ID',...definition.columns.map(column=>column.label)];
function makeWorkingCopy(snapshot,format,password) {
  const manifest={format:WORK_FORMAT,created:snapshot.created,origin:snapshot.origin,range:snapshot.range,sheets:{}};
  let rowsTotal=0;
  const data=snapshot.sheets.map(({definition,rows})=>{
    const dateFields={submissions:['effective_submission_at','submitted_at'],interviews:['interview_reschedule_date','interview_date','scheduled_at'],
      pipeline:['interview_datetime','interview_date'],updates:['updated_at'],breaks:['started_at'],attendance:['work_date'],
      followups:['follow_up_at'],notes:['created_at'],calls:['call_started_at'],tasks:['due_at','due_date']}[definition.key];
    if(dateFields){
      const time=row=>dateFields.map(key=>row[key]).find(Boolean)||'';
      rows=rows.map(row=>({row,when:workValue(time(row),'datetime'),recruiter:row.recruiter_name||row.employee_name||row.full_name||''}))
        .sort((a,b)=>(a.when||'9999').localeCompare(b.when||'9999')||a.recruiter.localeCompare(b.recruiter)).map(item=>item.row);
    }
    rowsTotal+=rows.length;
    if(rowsTotal>WORK_ROWS)throw workError('This snapshot has too many rows. Choose a date range.');
    const headers=workHeader(definition),identity=definition.columns.map(column=>column.key);
    manifest.sheets[definition.key]={
      fields:identity,
      rows:rows.map(row=>[
        String(row[definition.pk]),definition.columns.filter(c=>c.link).map(c=>workValue(row[c.key],c.type)),
        definition.columns.map(c=>workFingerprint(row[c.key],c.type))
      ])
    };
    return {definition,rows,headers};
  });
  const rawManifest=Buffer.from(JSON.stringify(manifest));
  if(rawManifest.length>WORK_XML_BYTES/2)throw workError('Too many original row fingerprints. Choose a smaller date range.');
  if(format==='csv'){
    const csvValue=value=>{
      const cell=String(value??'');
      // A text cell starting with a formula trigger must stay text in Excel.
      const safe=/^\s*[=+@-]/.test(cell)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(cell)?"'"+cell:cell;
      return '"'+safe.replace(/"/g,'""')+'"';
    };
    const entries=data.map(({definition,rows,headers})=>[
      definition.title+'.csv',
      '\ufeff'+[headers,...rows.map((r,i)=>[i+1,r[definition.pk],...definition.columns.map(c=>workValue(r[c.key],c.type))])].map(row=>row.map(csvValue).join(',')).join('\r\n')+'\r\n'
    ]);
    return workingZip([...entries,['_working-copy.json',rawManifest]],password);
  }
  const parts=[],workbookSheets=[],relationships=[],types=[];
  const workbookRel=(id,type,target)=>'<Relationship Id="'+id+'" Type="'+REL_NS+'/'+type+'" Target="'+target+'"/>';
  data.forEach(({definition,rows,headers},index)=>{
    const number=index+1,last=col(headers.length-1)+Math.max(rows.length+1,2);
    const widths=headers.map(h=>Math.max(10,h.length+3));
    const records=['<row r="1">'+headers.map((h,c)=>workCell(h,1,c)).join('')+'</row>'];
    for(let i=0;i<rows.length;i++){
      const values=[i+1,rows[i][definition.pk],...definition.columns.map(c=>rows[i][c.key])];
      for(let c=0;c<values.length;c++){
        const text=String(values[c]??'');
        widths[c]=Math.max(widths[c],Math.min(c>=2&&definition.columns[c-2].type==='note'?48:46,[...text.slice(0,220)].length+3));
      }
      records.push('<row r="'+(i+2)+'">'+values.map((v,c)=>workCell(v,i+2,c,c===0?'number':definition.columns[c-2]?.type)).join('')+'</row>');
    }
    if(!rows.length)records.push('<row r="2"/>');
    const sheet='xl/worksheets/sheet'+number+'.xml',table='xl/tables/table'+number+'.xml';
    parts.push([sheet,'<?xml version="1.0" encoding="UTF-8"?>'
      +'<worksheet xmlns="'+MAIN_NS+'" xmlns:r="'+REL_NS+'"><dimension ref="A1:'+last+'"/>'
      +'<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
      +'<sheetFormatPr defaultRowHeight="16"/><cols>'+widths.map((width,c)=>'<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+width+'" bestFit="1" customWidth="1"/>').join('')+'</cols>'
      +'<sheetData>'+records.join('')+'</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>']);
    parts.push(['xl/worksheets/_rels/sheet'+number+'.xml.rels','<Relationships xmlns="'+PKG_REL_NS+'">'+workbookRel('rId1','table','../tables/table'+number+'.xml')+'</Relationships>']);
    parts.push([table,'<table xmlns="'+MAIN_NS+'" id="'+number+'" name="CC206_Table_'+number+'" displayName="CC206_Table_'+number+'" ref="A1:'+last+'" totalsRowShown="0">'
      +'<autoFilter ref="A1:'+last+'"/><tableColumns count="'+headers.length+'">'+headers.map((h,i)=>'<tableColumn id="'+(i+1)+'" name="'+xml(h)+'"/>').join('')
      +'</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>']);
    workbookSheets.push('<sheet name="'+xml(definition.title)+'" sheetId="'+number+'" r:id="rId'+number+'"/>');
    relationships.push(workbookRel('rId'+number,'worksheet','worksheets/sheet'+number+'.xml'));
    types.push([sheet,'spreadsheetml.worksheet'],[table,'spreadsheetml.table']);
  });
  const metaNumber=data.length+1,metaPath='xl/worksheets/sheet'+metaNumber+'.xml';
  const metaText=zlib.deflateRawSync(rawManifest,{level:5}).toString('base64');
  const chunks=metaText.match(/.{1,24000}/g)||[];
  parts.push([metaPath,'<worksheet xmlns="'+MAIN_NS+'"><sheetData>'+[WORK_FORMAT,sha(rawManifest),...chunks].map((v,i)=>'<row r="'+(i+1)+'">'+workCell(v,i+1,0)+'</row>').join('')+'</sheetData></worksheet>']);
  workbookSheets.push('<sheet name="_CC206" state="veryHidden" sheetId="'+metaNumber+'" r:id="rId'+metaNumber+'"/>');
  relationships.push(workbookRel('rId'+metaNumber,'worksheet','worksheets/sheet'+metaNumber+'.xml'),workbookRel('rIdStyle','styles','styles.xml'));
  types.push([metaPath,'spreadsheetml.worksheet'],['xl/styles.xml','spreadsheetml.styles'],['xl/workbook.xml','spreadsheetml.sheet.main']);
  parts.push(['xl/styles.xml',WORK_STYLES],
    ['xl/workbook.xml','<workbook xmlns="'+MAIN_NS+'" xmlns:r="'+REL_NS+'"><bookViews><workbookView/></bookViews><sheets>'+workbookSheets.join('')+'</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="'+PKG_REL_NS+'">'+relationships.join('')+'</Relationships>'],
    ['_rels/.rels','<Relationships xmlns="'+PKG_REL_NS+'">'+workbookRel('rId1','officeDocument','xl/workbook.xml')+'</Relationships>'],
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      +types.map(([name,type])=>'<Override PartName="/'+name+'" ContentType="application/vnd.openxmlformats-officedocument.'+type+'+xml"/>').join('')+'</Types>']);
  const workbook=encryptOfficeWorkbook(workingZip(parts),password);
  if(workbook.length>WORK_BYTES)throw workError('Working Copy exceeds 48 MB. Choose a date range.');
  return workbook;
}
function workText(source) {
  // Excel encodes literal control characters as _xNNNN_.
  return unxml(source).replace(/_x([0-9a-f]{4})_/gi,(_,code)=>String.fromCharCode(parseInt(code,16)));
}
function readWorkRows(sheet,sharedStrings) {
  const rows=[];
  for(const row of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)){
    const values=[];
    for(const cell of (row[2]||'').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)){
      const attrs=xmlAttributes(cell[1]),letter=(attrs.r||'').match(/^([A-Z]{1,3})[1-9]\d*$/)?.[1];
      if(!letter)throw workError('Workbook cell address is invalid.');
      let index=0;
      for(const c of letter)index=index*26+c.charCodeAt(0)-64;
      if(index>150||values[index-1]!==undefined)throw workError('Unexpected extra or repeated Excel column.');
      const content=cell[2]||'',tag=/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(content)?.[1]||'';
      if(/<(?:\w+:)?f\b/.test(content))throw workError('Row '+(xmlAttributes(row[1]).r||rows.length+1)+' contains a formula. Paste its value before import.');
      const value=attrs.t==='inlineStr'?[...content.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>workText(m[1])).join('')
        :attrs.t==='s'?sharedStrings[Number(tag)]:workText(tag);
      if(value===undefined||attrs.t==='e')throw workError('An Excel cell contains an error or missing text.');
      values[index-1]={value,numeric:!attrs.t||attrs.t==='n'};
    }
    rows.push({row:Number(xmlAttributes(row[1]).r)||rows.length+1,values});
    if(rows.length>WORK_ROWS+2)throw workError('Too many workbook rows.');
  }
  return rows;
}
function readCsv(source) {
  const rows=[];let cells=[],text='',quoted=false;
  for(let i=source.charCodeAt(0)===0xfeff?1:0;i<source.length;i++){
    const c=source[i];
    if(quoted){
      if(c==='"'&&source[i+1]==='"'){text+='"';i++;}
      else if(c==='"')quoted=false;
      else text+=c;
    }else if(c==='"'&&!text)quoted=true;
    else if(c===','||c==='\n'||c==='\r'){
      cells.push({value:text.replace(/^'(?=\s*[=+@-])/,'')});text='';
      if(c!==','){rows.push({row:rows.length+1,values:cells});cells=[];if(c==='\r'&&source[i+1]==='\n')i++;}
    }else text+=c;
    if(cells.length>150||rows.length>WORK_ROWS+1||text.length>1024*1024)throw workError('CSV exceeds its row or cell limit.');
  }
  if(quoted)throw workError('A CSV cell has an unclosed quote.');
  if(cells.length||text)rows.push({row:rows.length+1,values:[...cells,{value:text}]});
  return rows;
}
function readWorkingCopy(file,password,definitions) {
  const excel=file.subarray(0,8).equals(OFFICE_MAGIC);
  const entries=workingZipEntries(excel?decryptOfficeWorkbook(file,password):file,excel?'':password);
  const read=name=>{
    const entry=entries.get(name);
    if(!entry)throw workError('Missing '+name+' in the Working Copy.');
    return entry().toString('utf8');
  };
  let manifest,readSheet;
  if(excel){
    const rels=new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)].map(m=>{
      const attrs=xmlAttributes(m[1]);return [attrs.Id,attrs.Target];
    }));
    const paths=new Map([...read('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]*)>/g)].map(m=>{
      const attrs=xmlAttributes(m[1]),path=rels.get(attrs['r:id'])||'';
      const target=path.startsWith('/')?path.slice(1):'xl/'+path;
      if(!/^xl\/worksheets\/[^/]+\.xml$/.test(target))throw workError('Invalid workbook sheet path.');
      return [attrs.name,target];
    }));
    const strings=entries.has('xl/sharedStrings.xml')?[...read('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m=>[...m[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(x=>workText(x[1])).join('')):[];
    readSheet=name=>readWorkRows(read(paths.get(name)||name),strings);
    const meta=readSheet('_CC206').map(row=>row.values[0]?.value||'');
    if(meta[0]!==WORK_FORMAT)throw workError('Choose a Working Copy. Whole CRM backups use their own import option.');
    const data=zlib.inflateRawSync(Buffer.from(meta.slice(2).join(''),'base64'),{maxOutputLength:WORK_XML_BYTES/2});
    if(sha(data)!==meta[1])throw workError('Working Copy identity metadata is damaged. Use the original file structure.');
    manifest=JSON.parse(data);
  }else{
    manifest=JSON.parse(read('_working-copy.json'));
    readSheet=name=>readCsv(read(name+'.csv'));
  }
  if(manifest?.format!==WORK_FORMAT||!manifest.sheets||!manifest.origin)throw workError('Working Copy metadata is missing or invalid.');
  let total=0;
  const sheets=definitions.map(definition=>{
    const stored=manifest.sheets[definition.key],headers=workHeader(definition);
    if(!stored||JSON.stringify(stored.fields)!==JSON.stringify(definition.columns.map(c=>c.key))||!Array.isArray(stored.rows))throw workError('This Working Copy has an unsupported column version.');
    const list=readSheet(definition.title),actual=list.shift()?.values.map(cell=>cell?.value??'');
    if(!actual||headers.some((h,i)=>actual[i]!==h)||actual.slice(headers.length).some(Boolean))throw workError(definition.title+' headers changed. Keep the original header row.');
    const base=new Map();
    for(const item of stored.rows){
      if(!Array.isArray(item)||!item[0]||base.has(item[0])||!Array.isArray(item[1])||!Array.isArray(item[2])||item[2].length!==definition.columns.length||item[2].some(h=>!/^[\w-]{16}$/.test(h)))throw workError('Invalid original row identity in '+definition.title+'.');
      base.set(item[0],{links:item[1],hashes:item[2]});
    }
    const rows=[],seen=new Set();
    for(const row of list){
      const id=String(row.values[1]?.value||'').trim();
      const values=Object.fromEntries(definition.columns.map((c,i)=>[c.key,workValue(row.values[i+2]?.value,c.type,!!row.values[i+2]?.numeric)]));
      if(!id&&Object.values(values).every(v=>v===''))continue;
      if(row.values.slice(headers.length).some(c=>c?.value))throw workError(definition.title+' row '+row.row+' has an extra field.');
      if(id&&(seen.has(id)||!base.has(id)&&!(definition.key==='profiles'&&/^NEW-[A-Z0-9_-]{1,48}$/.test(id))))throw workError(definition.title+' row '+row.row+' has a changed or duplicate Record ID.');
      if(id)seen.add(id);
      const original=base.get(id)||null;
      const changedKeys=definition.columns.filter((column,i)=>original
        ?workFingerprint(values[column.key],column.type)!==original.hashes[i]
        :values[column.key]!=='').map(column=>column.key);
      rows.push({id,row:row.row,values,base:original,changedKeys});
      if(++total>WORK_ROWS)throw workError('The import exceeds the row limit.');
    }
    return {key:definition.key,rows};
  });
  return {origin:manifest.origin,created:manifest.created,range:manifest.range,sheets};
}
function runWorkingFileJob(kind,input) {
  const {Worker}=require('worker_threads');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{workerData:{kind,input},resourceLimits:{maxOldGenerationSizeMb:224}});
    const timer=setTimeout(()=>{
      void worker.terminate();
      reject(workError('The file took too long to prepare. Use a smaller date range.'));
    },90000);
    worker.once('message',result=>{
      clearTimeout(timer);
      if(result.error)reject(workError(result.error));else resolve(result.value);
    });
    worker.once('error',()=>{clearTimeout(timer);reject(workError('The workbook is too large or could not be read. Try a smaller date range.'));});
    worker.once('exit',code=>{clearTimeout(timer);if(code)reject(workError('The workbook worker stopped. Try a smaller date range.'));});
  });
}
Object.assign(module.exports,{makeWorkingCopy,readWorkingCopy,runWorkingFileJob,workFingerprint,workValue,WORK_BYTES});
Object.assign(module.exports._test,{officeContainer,officeStreams,encryptOfficeWorkbook,decryptOfficeWorkbook,workingZip,workingZipEntries});
const {isMainThread,workerData,parentPort}=require('worker_threads');
if(!isMainThread && ['export','import'].includes(workerData?.kind)){
  try{
    const input=workerData.input;
    const value=workerData.kind==='export'
      ?makeWorkingCopy(input.snapshot,input.format,input.password)
      :readWorkingCopy(Buffer.from(input.file),input.password,input.definitions);
    if(Buffer.isBuffer(value)){
      const bytes=Uint8Array.from(value);
      parentPort.postMessage({value:bytes},[bytes.buffer]);
    }else parentPort.postMessage({value});
  }catch(error){
    parentPort.postMessage({error:error.status===422?error.message:'This file is damaged or its password settings are unsupported.'});
  }
}
