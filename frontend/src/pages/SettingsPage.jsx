import React, { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout';
import PremiumSelect from '../components/PremiumSelect';
import { useAuth } from '../lib/auth';
import { readPersonalSettings, savePersonalSettings, THEMES, PREVIOUS_THEMES, NEW_ADDED_THEMES, PREMIUM_THEMES, CHAT_THEMES, FONTS, CURSORS, resetPersonalSettings } from '../lib/personalSettings';
import { playNotificationSound, SOUND_PRESETS } from '../lib/notificationSound';
import EmojiGlyph from '../components/EmojiGlyph';
import { Link } from 'react-router-dom';

const TABS=[['appearance','Appearance','◐'],['interaction','Type & pointer','↖'],['chat','Team Chat','↗'],['sound','Sounds','♪'],['popups','Popups & reminders','◷']];

export default function SettingsPage() {
  const {user,theme,setTheme,setCustomTheme,persistTheme}=useAuth();
  const [prefs,setPrefs]=useState(readPersonalSettings);
  const [tab,setTab]=useState('appearance');
  const [soundStatus,setSoundStatus]=useState('');
  const [themeStatus,setThemeStatus]=useState('✓ Auto saved');
  const themeTimer=useRef(null), mounted=useRef(true), themeRevision=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const syncTheme=nextTheme=>{
    const revision=++themeRevision.current;
    window.clearTimeout(themeTimer.current);
    themeTimer.current=window.setTimeout(async()=>{
      try{await persistTheme(nextTheme,null);if(mounted.current&&revision===themeRevision.current)setThemeStatus('✓ Theme synced');}
      catch{if(mounted.current&&revision===themeRevision.current)setThemeStatus('Saved here · retry theme sync');}
    },300);
  };
  const update=patch=>{
    if(patch.theme){setCustomTheme(null);setTheme(patch.theme);}
    const next=savePersonalSettings(patch);setPrefs(next);
    if(patch.theme||Object.hasOwn(patch,'accent'))syncTheme(next.theme||theme);
  };
  const active=THEMES.find(t=>t[0]===(prefs.theme||theme))||THEMES[0];
  const chat=CHAT_THEMES.find(t=>t[0]===prefs.chatTheme)||CHAT_THEMES.find(t=>t[0]==='sunset');
  const role=String(user?.role||'').toLowerCase();
  const fontSelect=(label,key)=><div className="field"><label>{label}</label><PremiumSelect aria-label={label} value={prefs[key]} onChange={e=>update({[key]:e.target.value})}>{FONTS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</PremiumSelect></div>;
  const themeGrid=dark=><div className="cc787-theme-grid cc821-original-themes">{PREVIOUS_THEMES.filter(t=>(t[6]==='dark')===dark&&(!t[7]||t[7]===role||role==='admin')).map(t=><button type="button" className={`cc787-theme-swatch ${active[0]===t[0]?'selected':''}`} key={t[0]} aria-pressed={active[0]===t[0]} onClick={()=>update({theme:t[0],accent:''})} style={{'--swatch-a':t[4],'--swatch-b':t[5]}}><span className="cc787-swatch-colour"/><span>{t[1]}</span><small>{active[0]===t[0]?'Selected':'Choose'}</small></button>)}</div>;
  function moveTab(event,index) {
    let target;
    if(event.key==='ArrowRight')target=(index+1)%TABS.length;
    if(event.key==='ArrowLeft')target=(index+TABS.length-1)%TABS.length;
    if(event.key==='Home')target=0;
    if(event.key==='End')target=TABS.length-1;
    if(target!==undefined){event.preventDefault();setTab(TABS[target][0]);document.getElementById(`cc791-settings-${TABS[target][0]}`)?.focus();}
  }
  return <Layout title="Settings">
    <div className="cc791-settings-intro"><div><span className="cc791-eyebrow">WORKSPACE STUDIO</span><h2>Your everyday, upgraded.</h2></div><span className="cc787-saved-badge">{themeStatus}</span></div>
    <div className="cc787-settings-layout">
      <div className="cc787-settings-main">
        <nav className="cc791-settings-tabs" role="tablist" aria-label="Settings categories">{TABS.map(([id,label,icon],i)=><button type="button" id={`cc791-settings-${id}`} key={id} role="tab" aria-selected={tab===id} aria-controls={`cc791-panel-${id}`} tabIndex={tab===id?0:-1} className={tab===id?'active':''} onClick={()=>setTab(id)} onKeyDown={e=>moveTab(e,i)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
        <div id={`cc791-panel-${tab}`} role="tabpanel" aria-labelledby={`cc791-settings-${tab}`} className="cc791-settings-tab-content" key={tab}>
          {tab==='appearance'?<div className="cc822-theme-collections">
            {<section className="panel cc787-settings-section cc824-premium-collection" aria-labelledby="cc824-premium-themes">
              <div className="cc791-section-heading"><span>✦</span><div><h2 id="cc824-premium-themes" className="panel-title">Premium</h2></div></div>
              <div className="cc787-theme-grid">{PREMIUM_THEMES.filter(t=>role==='manager'||t[7]==='all').map(t=><button type="button" className={`cc787-theme-swatch ${active[0]===t[0]?'selected':''}`} key={t[0]} aria-pressed={active[0]===t[0]} onClick={()=>update({theme:t[0],accent:''})} style={{'--swatch-a':t[4],'--swatch-b':t[5]}}><span className="cc787-swatch-colour"/><span>{t[1]}</span><small>{active[0]===t[0]?'Selected':'Apply'}</small></button>)}</div>
            </section>}
            <section className="panel cc787-settings-section" aria-labelledby="cc822-previous-themes">
              <div className="cc791-section-heading"><span>01</span><div><h2 id="cc822-previous-themes" className="panel-title">Previous Themes</h2></div></div>
              <h3>Light collection</h3>{themeGrid(false)}
              <h3>Dark collection</h3>{themeGrid(true)}
            </section>
            <section className="panel cc787-settings-section" aria-labelledby="cc822-new-themes">
              <div className="cc791-section-heading"><span>02</span><div><h2 id="cc822-new-themes" className="panel-title">New Added</h2></div></div>
              <div className="cc787-theme-grid cc819-new-themes">{NEW_ADDED_THEMES.map(t=><button type="button" className={`cc787-theme-swatch ${active[0]===t[0]?'selected':''}`} key={t[0]} aria-pressed={active[0]===t[0]} onClick={()=>update({theme:t[0],accent:''})} style={{'--swatch-a':t[4],'--swatch-b':t[5]}}><span className="cc787-swatch-colour"/><span>{t[1]}</span><small>{active[0]===t[0]?'Selected':'Apply'}</small></button>)}</div>
            </section>
          </div>:null}
          {tab==='interaction'?<section className="panel cc787-settings-section"><div className="cc791-section-heading"><span>02</span><div><h2 className="panel-title">Type & interaction</h2></div></div><div className="cc787-control-grid">{fontSelect('Workspace font','font')}<div className="field"><label htmlFor="cc787-font-size">Text size · {prefs.fontSize}px</label><input id="cc787-font-size" aria-label="Text size" type="range" min="13" max="18" value={prefs.fontSize} onChange={e=>update({fontSize:Number(e.target.value)})}/></div><div className="field"><label htmlFor="cc787-accent">Personal accent</label><input type="color" id="cc787-accent" value={prefs.accent||active[4]} onChange={e=>update({accent:e.target.value})}/></div><div className="field"><label>Cursor</label><PremiumSelect aria-label="Cursor" value={prefs.cursor} onChange={e=>update({cursor:e.target.value})}>{CURSORS.map(([id,label])=><option value={id} key={id}>{label}</option>)}</PremiumSelect></div></div><div className="cc791-pointer-collection" aria-label="Precision pointers">{CURSORS.filter(([id])=>id.startsWith('precision')).map(([id,label])=><button type="button" key={id} data-pointer={id} className={prefs.cursor===id?'selected':''} aria-pressed={prefs.cursor===id} onClick={()=>update({cursor:id})}><svg viewBox="0 0 28 32" width="23" height="28" aria-hidden="true"><path d="M5 3v23l6-6 5 10 4-2-5-10h9Z" fill="currentColor" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></svg><span>{label}</span></button>)}</div><label className="cc787-toggle"><input type="checkbox" checked={prefs.reduceMotion} onChange={e=>update({reduceMotion:e.target.checked})}/> Reduce animations</label></section>:null}
          {tab==='chat'?<section className="panel cc787-settings-section"><div className="cc791-section-heading"><span>03</span><div><h2 className="panel-title">Team Chat studio</h2><p className="helper-text">Sunset Studio is the default. Pick your own conversation palette.</p></div></div><div className="cc787-theme-grid">{CHAT_THEMES.map(t=><button type="button" key={t[0]} aria-pressed={prefs.chatTheme===t[0]} className={`cc787-theme-swatch ${prefs.chatTheme===t[0]?'selected':''}`} style={{'--swatch-a':t[3],'--swatch-b':t[4]}} onClick={()=>update({chatTheme:t[0]})}><span className="cc787-swatch-colour"/><span>{t[1]}</span><small>{prefs.chatTheme===t[0]?'Selected':'Choose'}</small></button>)}</div>{fontSelect('Team Chat font','chatFont')}</section>:null}
          {tab==='popups'?<section className="panel cc787-settings-section cc875-popup-settings"><div className="cc791-section-heading"><span>05</span><div><h2 className="panel-title">Popups & reminders</h2><p className="helper-text">Choose how reminders appear in your workspace.</p></div></div>{['manager','admin'].includes(role)?<label className="cc787-toggle"><input type="checkbox" checked={prefs.managerTeamPopups} onChange={e=>update({managerTeamPopups:e.target.checked})}/><span>Show my team’s popups<small>Include TL and recruiter follow-ups, interviews, submissions and tasks. Turn off for only your own reminders.</small></span></label>:null}<label className="cc787-toggle"><input type="checkbox" disabled={!['manager','admin'].includes(role)} checked={prefs.popupAutoHide} onChange={e=>update({popupAutoHide:e.target.checked})}/><span>Hide popups automatically<small>Reminders remain in the Reminders list until resolved or dismissed.</small></span></label><div className="field"><label htmlFor="cc875-popup-seconds">Display for (seconds)</label><input id="cc875-popup-seconds" type="number" min="1" max="300" value={prefs.popupSeconds} disabled={!['manager','admin'].includes(role)||!prefs.popupAutoHide} onChange={e=>update({popupSeconds:Math.max(1,Math.min(300,Number(e.target.value)||10))})}/></div><p className="helper-text">{!['manager','admin'].includes(role)?'Recruiter and TL popups stay visible until handled or explicitly snoozed. Automatic hiding is available only to managers.':prefs.popupAutoHide?`Popups hide after ${prefs.popupSeconds} seconds.`:'Popups stay until you close them.'} Access locks and required confirmation screens stay visible.</p><a className="ghost-btn" href="#" onClick={e=>{e.preventDefault();document.getElementById('cc603-reminders-refresh')?.click();}}>Open organized Reminders ↗</a></section>:null}
          {tab==='sound'?<section className="panel cc787-settings-section"><div className="cc791-section-heading"><span>04</span><div><h2 className="panel-title">Notification sounds</h2></div></div><div className="cc787-control-grid"><div className="field"><label>Notification sound</label><PremiumSelect aria-label="Notification sound" value={prefs.sound} onChange={e=>update({sound:e.target.value})}><option value="silent">Silent</option>{SOUND_PRESETS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</PremiumSelect></div><div className="field"><label htmlFor="cc787-volume">Volume · {prefs.soundVolume}%</label><input id="cc787-volume" type="range" min="0" max="100" value={prefs.soundVolume} onChange={e=>update({soundVolume:Number(e.target.value)})}/></div></div><div className="row-actions"><button type="button" className="add-profile-btn" onClick={async()=>{const played=await playNotificationSound(prefs.sound,true);setSoundStatus(played?'Preview played':prefs.sound==='silent'||prefs.soundVolume===0?'Sound is muted':'Click again to enable browser audio');}}>Play preview</button><span role="status" className="helper-text">{soundStatus}</span></div></section>:null}
        </div>
        <section className="panel cc790-reset-settings"><div><h2 className="panel-title">Fresh start</h2><p className="helper-text">Restore your personal theme, fonts, pointer and sounds.</p></div><button type="button" className="ghost-btn" onClick={()=>{setCustomTheme(null);setTheme('orange');setPrefs(resetPersonalSettings());syncTheme('orange');setSoundStatus('Personal settings reset');}}>Reset settings</button><span role="status">{soundStatus==='Personal settings reset'?soundStatus:''}</span></section>
        {['manager','admin'].includes(role)?<section className="panel cc791-safety-link"><div><h2 className="panel-title">Data Backup</h2><p className="helper-text">Keep a complete copy of your CRM and review a restore.</p></div><Link className="add-profile-btn" to="/data-backup">Open Data Backup ↗</Link></section>:null}
      </div>
      <aside className="cc787-settings-preview"><div className="panel"><span className="cc791-eyebrow">LIVE PREVIEW</span><div className="cc787-preview-workspace" style={{background:`linear-gradient(140deg,${active[2]},${active[3]})`}}><span className="cc787-preview-dot" style={{background:prefs.accent||active[4]}}/><h3>{active[1]}</h3><div className="cc787-preview-cards"><div>Profiles<strong>128</strong></div><div>Connected<strong>42</strong></div></div><button type="button" className="add-profile-btn" disabled>Save profile</button></div><div className="cc787-preview-chat" style={{background:chat[2],fontFamily:FONTS.find(f=>f[0]===prefs.chatFont)?.[2],color:chat[6]?'#eff5ff':'#17324b'}}><small>{chat[1]} · Team Chat</small><div className="cc787-preview-incoming" style={{background:chat[6]?'#2c4255':'#fff',color:chat[6]?'#eff5ff':'#17324b'}}>Ready for the next call?</div><div className="cc787-preview-outgoing" style={{background:`linear-gradient(125deg,${chat[3]},${chat[4]})`,color:chat[5]}}>Absolutely <EmojiGlyph value="✨"/></div></div><dl className="cc791-preview-details"><div><dt>Pointer</dt><dd>{CURSORS.find(c=>c[0]===prefs.cursor)?.[1]}</dd></div><div><dt>Workspace type</dt><dd>{FONTS.find(f=>f[0]===prefs.font)?.[1]} · {prefs.fontSize}px</dd></div></dl></div></aside>
    </div>
  </Layout>;
}
