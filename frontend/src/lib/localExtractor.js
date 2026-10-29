export function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<String(text).length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell.trim());cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
export function extractLocalRows(text) {
  const csv=parseCsv(text),head=csv[0]||[];
  const aliases={name:'full_name','candidate name':'full_name',full_name:'full_name',phone:'phone',number:'phone',mobile:'phone',email:'email',location:'location',city:'location',degree:'qualification',qualification:'qualification',experience:'experience',process:'process'};
  if(head.some(col=>aliases[col.toLowerCase()] === 'phone'))return csv.slice(1,31).map((cells,index)=>({row_key:`local-${index}`,include:true,...Object.fromEntries(head.map((col,i)=>[aliases[col.toLowerCase()]||col.toLowerCase(),cells[i]||'']))}));
  return String(text).trim().split(/\n\s*\n/).slice(0,30).map((block,index)=>{
    const rawPhone=block.match(/(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}\b/)?.[0]||'';
    const phone=rawPhone.replace(/\D/g,'').slice(-10);
    const name=block.match(/(?:name|candidate)\s*[:=-]\s*([^\n,]+)/i)?.[1]||block.split('\n').find(line=>!/[0-9@]/.test(line))||'';
    return {row_key:`local-${index}`,include:true,full_name:name.trim(),phone,email:block.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0]||'',location:block.match(/(?:city|location)\s*[:=-]\s*([^\n,]+)/i)?.[1]||'',qualification:block.match(/\b(?:BCA|B[. ]?Tech|B[. ]?Sc|B[. ]?Com|MBA|MCA|BA|LLB)\b/i)?.[0]||'',raw_text:block.slice(0,2000)};
  }).filter(row=>row.phone||row.full_name);
}
