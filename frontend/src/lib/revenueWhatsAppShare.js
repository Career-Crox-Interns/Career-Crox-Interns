// Original attachments stay in this open form. No document upload/storage here.
const MAX_BYTES=6*1024*1024;
const MIME=Object.freeze({pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'});
export function fileExtension(file){return String(file?.name||'').split('.').pop().toLowerCase();}
export function fileKind(file){const ext=fileExtension(file);return ['doc','docx'].includes(ext)?'Word':ext==='pdf'?'PDF':['jpg','jpeg','png','webp'].includes(ext)?'Image':'File';}
export function fileGlyph(file){return fileKind(file)==='Image'?'🖼️':fileKind(file)==='Word'?'W':'📄';}
export function fileSizeLabel(bytes){const size=Number(bytes)||0;return size<1024?size+' B':size<1024*1024?(size/1024).toFixed(0)+' KB':(size/(1024*1024)).toFixed(1)+' MB';}
export function prepareAttachment(file){
 const ext=fileExtension(file);
 if(!file||!String(file.name||'').trim()||!MIME[ext])throw Error('Choose a PDF, Word, JPG, PNG or WEBP file.');
 if(!Number.isFinite(file.size)||file.size<=0)throw Error('This file is empty. Choose another file.');
 if(file.size>MAX_BYTES)throw Error('Choose a file up to 6 MB.');
 if(typeof file.arrayBuffer!=='function'||typeof file.slice!=='function')throw Error('This file cannot be read. Choose it again.');
 if(file.type!==MIME[ext])return new File([file],file.name,{type:MIME[ext],lastModified:file.lastModified||Date.now()});
 return file;
}
export async function validateAttachment(file){
 const ready=prepareAttachment(file),ext=fileExtension(ready);
 const bytes=new Uint8Array(await ready.slice(0,1024).arrayBuffer());
 const begins=(...value)=>value.every((v,i)=>bytes[i]===v);
 const text=new TextDecoder('latin1').decode(bytes);
 const valid=ext==='pdf'?text.includes('%PDF-'):ext==='docx'?begins(0x50,0x4b,0x03,0x04):ext==='doc'?begins(0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1):ext==='png'?begins(137,80,78,71,13,10,26,10):['jpg','jpeg'].includes(ext)?begins(255,216,255):ext==='webp'?text.startsWith('RIFF')&&text.slice(8,12)==='WEBP':false;
 if(!valid)throw Error('The contents do not match this file type. Choose the original file; changing its extension does not convert it.');
 return ready;
}
export function shareCapability(nav,files){
 if(!Array.isArray(files)||!files.length)return {ok:false,code:'NO_FILES',reason:'Choose at least one attachment.'};
 try{files.forEach(prepareAttachment);}catch(error){return {ok:false,code:'INVALID_FILE',reason:error.message};}
 // Chromium rejects Office files even when canShare reports true.
 // Keep the Word filename/MIME and original bytes; never disguise them as PDF.
 if(files.some(file=>fileKind(file)==='Word'))return {ok:false,code:'WORD_ATTACH',reason:'Word files use WhatsApp Attach > Document. Keep the original Word file; PDF conversion is not required.'};
 if(!nav||typeof nav.share!=='function')return {ok:false,code:'SHARE_UNAVAILABLE',reason:'Use Open WhatsApp, then Attach to choose the original files.'};
 if(typeof nav.canShare==='function'){
  try{if(!nav.canShare({files}))return {ok:false,code:'FILES_UNSUPPORTED',reason:'This device cannot share this selection together.'};}
  catch{return {ok:false,code:'FILES_UNSUPPORTED',reason:'This device could not prepare the Share panel.'};}
 }
 return {ok:true,code:'NATIVE',reason:''};
}
export function planAttachmentShare(nav,sourceFiles){
 const files=(sourceFiles||[]).filter(Boolean);
 if(!files.length)return {mode:'empty',files,reason:'Choose at least one attachment.'};
 const support=shareCapability(nav,files);
 if(support.ok)return {mode:'native',files,reason:''};
 if(support.code==='INVALID_FILE')return {mode:'invalid',files,reason:support.reason};
 if(files.length>1&&support.code==='FILES_UNSUPPORTED'&&files.every(file=>shareCapability(nav,[file]).ok))return {mode:'individual',files,reason:'Both files are ready. This device needs one Share action per attachment.'};
 return {mode:'manual',files,code:support.code,reason:support.reason};
}
export function nativeWhatsAppDocumentShare(nav,sourceFiles,{title='',text=''}={}){
 const files=(sourceFiles||[]).map(prepareAttachment),support=shareCapability(nav,files);
 if(!support.ok)throw Object.assign(Error(support.reason),{code:support.code});
 // Keep this on the click stack; no awaited API/clipboard work before it.
 return nav.share({files,title:String(title),text:String(text)});
}
export function shareFailure(error){
 if(error?.name==='AbortError')return {cancelled:true,reason:'Share cancelled. Your attachments are still ready.'};
 if(error?.name==='InvalidStateError')return {reason:'Another Share panel is open. Close it, then try again.'};
 if(error?.name==='NotAllowedError'||/permission denied/i.test(error?.message||''))return {reason:'The browser did not allow this Share action. Use Open WhatsApp and attach the original files there.'};
 return {reason:'The Share panel could not hand off these files. Use Open WhatsApp and attach the originals there.'};
}
export function downloadOriginalAttachment(file,{document:doc=globalThis.document,url=globalThis.URL,schedule=setTimeout}={}){
 const original=prepareAttachment(file);
 if(!doc?.body||typeof url?.createObjectURL!=='function')throw Error('Download is unavailable. Use the original file you selected.');
 const href=url.createObjectURL(original),anchor=doc.createElement('a');
 anchor.href=href;anchor.download=original.name;anchor.style.display='none';
 try{doc.body.appendChild(anchor);anchor.click();}catch(error){url.revokeObjectURL(href);throw error;}finally{anchor.remove();}
 schedule(()=>url.revokeObjectURL(href),60000);
 return original.name;
}
