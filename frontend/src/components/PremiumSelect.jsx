import { toCrmDateTimeLocalInput } from '../lib/workspaceHelpers';
import React, { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayStaffName } from '../lib/api';

// Retain the native select for labels, forms and React's existing onChange flow.
// Only its desktop option menu is enhanced; no fields or values are rewritten.
const PremiumSelect = forwardRef(function PremiumSelect(props, forwardedRef) {
  const { children, onMouseDown, onKeyDown, onClick, onEditOption, ...rest } = props;
  const [,refreshNames]=useState(0);
  useEffect(()=>{const update=()=>refreshNames(n=>n+1);window.addEventListener('cc814-staff-names',update);return()=>window.removeEventListener('cc814-staff-names',update);},[]);
  const namedChildren=React.Children.map(children,child=>{if(!React.isValidElement(child)||child.type!=='option'||!child.props.value)return child;const fallback=child.props.children;const name=displayStaffName(child.props.value,fallback);return name===fallback?child:React.cloneElement(child,{},name);});
  const selectRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [present,setPresent] = useState(false);
  const [marker,setMarker] = useState(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 260, height: 300 });
  const id = useId();
  const filtered = items.filter(item => !query || item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const allowed = filtered.filter(item => !item.disabled);
  const highlight = allowed[Math.min(active, Math.max(0, allowed.length - 1))]?.value;
  const attach = node => {
    selectRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };
  function updatePosition() {
    const rect = selectRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.visualViewport?.width || window.innerWidth || 1280;
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 720;
    const width = Math.min(Math.max(rect.width, 250), Math.max(220, viewportWidth - 24));
    const top = Math.max(12, rect.bottom + 6);
    const roomBelow = Math.max(96, viewportHeight - top - 12);
    const height = Math.min(340, roomBelow);
    setPosition({ left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)), top, width, height });
  }
  function show() {
    if (rest.disabled || rest.multiple || !selectRef.current) return;
    const options = [...selectRef.current.options].map(option => ({ value: option.value, label: option.label, disabled: option.disabled || option.parentElement?.disabled, selected: option.selected }));
    setItems(options); setQuery('');
    const enabled = options.filter(option => !option.disabled);
    setActive(Math.max(0, enabled.findIndex(option => option.selected)));
    const revealBelow = () => { updatePosition(); setOpen(true); };
    const rect = selectRef.current.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 720;
    // CRM rule: dropdowns always open under their own field. If there is too
    // little room below, reveal room first instead of flipping the menu above.
    if (viewportHeight - rect.bottom < 150) {
      selectRef.current.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      window.requestAnimationFrame(revealBelow);
    } else revealBelow();
  }
  function choose(value) {
    const select = selectRef.current;
    if (!select || rest.disabled) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false); select.focus({ preventScroll: true });
  }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); selectRef.current?.focus({ preventScroll: true }); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, allowed.length)) % Math.max(1, allowed.length));
    } else if (event.key === 'Enter' && highlight !== undefined) { event.preventDefault(); choose(highlight); }
  }
  useLayoutEffect(() => {
    if (open) { setPresent(true); return; }
    const timer=setTimeout(()=>setPresent(false),180);
    return ()=>clearTimeout(timer);
  },[open]);
  useLayoutEffect(() => {
    if (!present || !open) return;
    const option=menuRef.current?.querySelector('[data-highlighted="true"]');
    if(option) { option.scrollIntoView({block:'nearest'}); setMarker({top:onEditOption?option.parentElement.offsetTop:option.offsetTop,height:option.offsetHeight}); }
    else setMarker(null);
  },[present,open,active,query,items]);
  useLayoutEffect(() => {
    if (!open || !present) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open,present]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!menuRef.current?.contains(event.target) && event.target !== selectRef.current) setOpen(false); };
    const reposition = event => { if (!menuRef.current?.contains(event.target)) updatePosition(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', reposition); document.removeEventListener('scroll', reposition, true); };
  }, [open]);
  useEffect(() => { menuRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query]);
  useEffect(() => { if (rest.disabled) setOpen(false); }, [rest.disabled]);
  return <>
    <select {...rest} ref={attach} data-premium-select="true" aria-controls={open ? id : undefined} aria-expanded={open || undefined}
      onMouseDown={event => { onMouseDown?.(event); if (!event.defaultPrevented && event.button === 0 && !rest.multiple && !rest.disabled) { event.preventDefault(); open ? setOpen(false) : show(); } }}
      onClick={event => { onClick?.(event); if (!open && !rest.multiple && !rest.disabled && event.detail === 0 && !event.defaultPrevented) { event.preventDefault(); show(); } }}
      onKeyDown={event => { onKeyDown?.(event); if (event.defaultPrevented || rest.multiple || rest.disabled) return; if (open) keys(event); else if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } }}>
      {namedChildren}
    </select>
    {present && createPortal(<div ref={menuRef} data-cc791-presence="true" aria-hidden={!open || undefined} className={`cc785-select-menu ${open?'cc791-menu-open':'cc791-menu-closing'}`} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }} onKeyDown={keys}>
      <div className="cc785-select-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} aria-label="Search options" placeholder="Search options…" aria-controls={id} aria-activedescendant={highlight !== undefined ? `${id}-${items.findIndex(item => item.value === highlight)}` : undefined}/><button type="button" aria-label="Close options" onClick={() => { setOpen(false); selectRef.current?.focus({ preventScroll: true }); }}>×</button></div>
      <div id={id} role="listbox" aria-label={rest['aria-label'] || selectRef.current?.labels?.[0]?.textContent || 'Options'} className="cc785-select-options">
        {marker && <div aria-hidden="true" className="cc791-option-marker" style={{height:marker.height,transform:`translateY(${marker.top}px)`}}/>}
        {filtered.map(item => <React.Fragment key={`${item.value}-${items.indexOf(item)}`}><div className={onEditOption?'cc878-editable-option':'cc878-option-row'}><button id={`${id}-${items.indexOf(item)}`} type="button" role="option" aria-selected={item.selected} disabled={item.disabled} data-highlighted={item.value === highlight} onMouseEnter={() => setActive(Math.max(0, allowed.findIndex(option => option.value === item.value)))} onClick={() => choose(item.value)}><span>{item.label || 'Choose…'}</span>{item.selected && <span aria-hidden="true">✓</span>}</button>{onEditOption&&item.value&&item.value!=='__add_new__'&&<button type="button" className="cc878-template-pencil" aria-label={`Edit ${item.label}`} title={`Edit ${item.label}`} onKeyDown={e=>e.stopPropagation()} onClick={e=>{e.preventDefault();e.stopPropagation();setOpen(false);onEditOption(item.value);}}>✎</button>}</div></React.Fragment>)}
        {!filtered.length && <div className="cc785-select-empty">No matching options</div>}
      </div>
    </div>, document.body)}
  </>;
});
export default PremiumSelect;


// Full scoped roster, independent of the current page and active row filters.
export function RecruiterMultiSelect({options=[],value=[],onChange,label='All Recruiters'}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[rect,setRect]=useState(null);
 const anchor=useRef(null),menu=useRef(null),menuId=useId();
 useEffect(()=>{if(!open)return;const close=e=>{if(!anchor.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);anchor.current?.focus();}};const reposition=()=>setRect(anchor.current?.getBoundingClientRect());window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};},[open]);
 const labelFor=key=>options.find(o=>o.value===key)?.label||displayStaffName(key,key);
 return <><button ref={anchor} type="button" className="cc834-roster-toggle" aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={()=>{setRect(anchor.current.getBoundingClientRect());setOpen(v=>!v);setQuery('');}}>{value.length===0?label:value.length===1?labelFor(value[0]):`${value.length} recruiters`} <span aria-hidden="true">⌄</span></button>{open&&rect&&createPortal(<div ref={menu} id={menuId} role="dialog" aria-label="Recruiter filter" className="cc834-roster-menu cc837-roster-menu" style={{position:'fixed',zIndex:120000,left:Math.max(8,Math.min(rect.left,window.innerWidth-300)),top:Math.max(8,Math.min(rect.bottom+6,window.innerHeight-330)),width:290,maxHeight:320}}><input autoFocus aria-label="Search recruiters" placeholder="Search recruiters" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" onClick={()=>onChange([])} className="ghost-btn">All Recruiters</button><div className="cc834-roster-options">{options.filter(o=>o.label.toLowerCase().includes(query.toLowerCase())).map(o=><label key={o.value}><input type="checkbox" checked={value.includes(o.value)} onChange={()=>onChange(value.includes(o.value)?value.filter(k=>k!==o.value):[...value,o.value])}/><span>{o.label}</span></label>)}</div><button className="mini-btn" type="button" onClick={()=>setOpen(false)}>Done</button></div>,document.body)}</>;
}

// Explicit India-time inputs, independent of the device's 12/24-hour preference.
// Their value contract remains YYYY-MM-DDTHH:mm / HH:mm for existing forms.
export function CrmDateTimeInput({type='datetime-local',value='',onChange,name,id,className='',required,disabled,readOnly,min,max,step,...rest}) {
  const datetime=type==='datetime-local';
  const wall=value?(datetime?toCrmDateTimeLocalInput(value):String(value).slice(0,5)):'';
  const parts=raw=>{const [h,m]=(datetime?raw.split('T')[1]:raw||'')?.split(':')||[];return{date:datetime?raw.slice(0,10):'',hour:h===undefined?'':String(Number(h)%12||12),minute:m||'00',period:Number(h)>=12?'PM':'AM'};};
  const [draft,setDraft]=useState(()=>parts(wall));
  const lastEmitted=useRef(wall);
  useEffect(()=>{if(wall!==lastEmitted.current){lastEmitted.current=wall;setDraft(parts(wall));}},[wall,datetime]);
  function update(key,next){const state={...draft,[key]:next};setDraft(state);
    if(!state.hour||(datetime&&!state.date)){if((key==='date'&&!next)||(key==='hour'&&!next)){lastEmitted.current='';onChange?.({target:{value:'',name},currentTarget:{value:'',name}});}return;}
    const clock=String(Number(state.hour)%12+(state.period==='PM'?12:0)).padStart(2,'0')+':'+state.minute;
    const nextValue=datetime?state.date+'T'+clock:clock;lastEmitted.current=nextValue;
    onChange?.({target:{value:nextValue,name},currentTarget:{value:nextValue,name}});
  }
  const label=rest['aria-label']||'Time';const off=disabled||readOnly;
  return <span className={'cc839-time-input '+className} data-cc839-time="react" role="group" aria-label={label+' · IST'}>
    {datetime?<input id={id} type="date" aria-label={label+' date · IST'} value={draft.date} min={min?.slice(0,10)} max={max?.slice(0,10)} required={required} disabled={disabled} readOnly={readOnly} onChange={e=>update('date',e.target.value)}/>:null}
    <select id={datetime?undefined:id} aria-label={label+' hour · IST'} value={draft.hour} disabled={off} required={required} onChange={e=>update('hour',e.target.value)}><option value="">Hour</option>{Array.from({length:12},(_,i)=><option key={i} value={String(i+1)}>{String(i+1).padStart(2,'0')}</option>)}</select>
    <select aria-label={label+' minute · IST'} value={draft.minute} disabled={off} onChange={e=>update('minute',e.target.value)}>{Array.from({length:60},(_,i)=><option key={i} value={String(i).padStart(2,'0')}>{String(i).padStart(2,'0')}</option>)}</select>
    <select aria-label={label+' AM or PM · IST'} value={draft.period} disabled={off} onChange={e=>update('period',e.target.value)}><option>AM</option><option>PM</option></select><small>IST</small>
    {name?<input type="hidden" name={name} value={wall}/>:null}
  </span>;
}
