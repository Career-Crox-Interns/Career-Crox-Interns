// CC853: Native OS share workflow for ORIGINAL candidate documents.
// There is deliberately NO upload, browser storage, object URL or auto-send here.
// The destination is chosen by the user inside WhatsApp (Windows/Android share sheet).
const FILE_MIMES=Object.freeze({
 pdf:'application/pdf',doc:'application/msword',
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',
});

export function fileSizeLabel(bytes){
 const size=Number(bytes)||0;
 return size<1024?size+' B':size<1024*1024?(size/1024).toFixed(0)+' KB':(size/(1024*1024)).toFixed(1)+' MB';
}

export function shareCapability(nav,files){
 if(!Array.isArray(files)||!files.length||files.some(file=>!file||typeof file.name!=='string'||!(file.size>0)))
  return {ok:false,reason:'Select a valid document first.'};
 if(!nav||typeof nav.share!=='function')
  return {ok:false,reason:'Your browser does not support sharing documents through the system Share panel.'};
 // Older implementations may have navigator.share but not navigator.canShare.
 if(typeof nav.canShare==='function'){
  try{if(!nav.canShare({files}))return {ok:false,reason:'Your device does not allow these file attachments in its Share panel.'};}
  catch{return {ok:false,reason:'Your browser refused this file attachment.'};}
 }
 return {ok:true,reason:''};
}

function preparedFile(file){
 const name=String(file.name||'').trim();
 const ext=name.split('.').pop().toLowerCase();
 const mime=FILE_MIMES[ext];
 if(!mime||!name||!file.size||file.size>6*1024*1024)
  throw Error('Select a supported PDF, Word document or image up to 6 MB.');
 // Some devices label local PDFs as application/octet-stream; fix only MIME metadata.
 // This creates an in-memory File, never a stored copy or a server request.
 if(!file.type||file.type==='application/octet-stream')
  return new File([file],name,{type:mime,lastModified:file.lastModified||Date.now()});
 return file;
}

export function nativeWhatsAppDocumentShare(nav,sourceFiles,{title='',text=''}={}){
 const files=(sourceFiles||[]).map(preparedFile);
 const support=shareCapability(nav,files);
 if(!support.ok)throw Error(support.reason);
 // IMPORTANT: call navigator.share immediately during the click event.
 // Returning its Promise lets the UI await it AFTER activation is consumed.
 return nav.share({files,title:String(title),text:String(text)});
}
