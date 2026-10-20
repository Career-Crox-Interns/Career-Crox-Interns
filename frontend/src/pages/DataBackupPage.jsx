import React from 'react';
import {Link} from 'react-router-dom';
import Layout from '../components/Layout';
import FullExcelBackupPanel from '../components/FullExcelBackupPanel';
export default function DataBackupPage(){
 return <Layout title="Full CRM Excel Backup"><main className="cc874-page">
  <header className="cc874-hero"><div><span className="cc874-kicker">CAREER CROX · MANAGER BACKUP</span><h1>Project Multiple CRM</h1><p>First CRM → Excel Backup → Second / Third CRM → Restore. No extra Render secret or recovery PIN.</p></div><Link className="ghost-btn" to="/admin">Admin Control ↗</Link></header>
  <section className="cc874-instances">{['FIRST','SECOND','THIRD'].map((slot,i)=><article key={slot} className="cc874-instance"><span className="cc874-orb">0{i+1}</span><div><strong>{slot[0]+slot.slice(1).toLowerCase()} CRM</strong><small>Use Download on your current CRM and Restore on the selected destination.</small></div></article>)}</section>
  <FullExcelBackupPanel/>
  <p className="helper-text" style={{marginTop:12}}>Reminder: after three days without a confirmed saved Excel, the Manager sees a backup reminder. Remind after 6 hours remains available, including after day three. No backup reminders block employee work.</p>
 </main></Layout>;
}
