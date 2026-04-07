import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

const DOC_FIELDS = [
  { key: 'aadhaar', label: 'Aadhaar Card' },
  { key: 'pan', label: 'PAN Card' },
  { key: 'high_school', label: 'High School Marksheet' },
  { key: 'intermediate', label: 'Intermediate Marksheet' },
  { key: 'resume', label: 'Resume' },
];

function fileToPayload(file, documentType) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      document_type: documentType,
      original_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: String(file.size || 0),
      content_base64: String(reader.result || ''),
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(() => {
    try {
      const message = sessionStorage.getItem('careerCroxSessionExpiredMessage') || '';
      if (message) sessionStorage.removeItem('careerCroxSessionExpiredMessage');
      return message;
    } catch {
      return '';
    }
  });
  const [loading, setLoading] = useState(false);
  const [successPhase, setSuccessPhase] = useState(false);
  const [selfCreateBusy, setSelfCreateBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [selfServiceMessage, setSelfServiceMessage] = useState('');
  const [selfCreate, setSelfCreate] = useState({
    full_name: '',
    email: '',
    password: '',
    confirm_password: '',
    designation: 'Freelancer',
  });
  const [files, setFiles] = useState({});
  const [passwordReset, setPasswordReset] = useState({ email: '', reason: 'Forgot password request' });

  const welcomeName = useMemo(() => {
    if (!username.trim()) return 'your workspace';
    return username
      .split(/[._\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
      .slice(0, 28);
  }, [username]);

  useEffect(() => {
    document.body.classList.add('no-scroll-login-shell');
    return () => document.body.classList.remove('no-scroll-login-shell');
  }, []);

  useEffect(() => {
    if (!successPhase) return undefined;
    const timer = window.setTimeout(() => navigate('/dashboard'), 900);
    return () => window.clearTimeout(timer);
  }, [navigate, successPhase]);

  async function submit(event) {
    event.preventDefault();
    if (loading || successPhase) return;
    setError('');
    setSelfServiceMessage('');
    setLoading(true);
    try {
      await login(username, password);
      try { sessionStorage.setItem('careerCroxLoginTransition', '1'); } catch {}
      setSuccessPhase(true);
    } catch (err) {
      setError(err.message || 'Sign in failed');
      setLoading(false);
    }
  }

  async function submitSelfCreate(event) {
    event.preventDefault();
    if (selfCreateBusy) return;
    setError('');
    setSelfServiceMessage('');
    const email = String(selfCreate.email || '').trim().toLowerCase();
    if (!selfCreate.full_name.trim()) {
      setSelfServiceMessage('Full name is required.');
      return;
    }
    if (!email || !email.includes('@')) {
      setSelfServiceMessage('Valid email is required.');
      return;
    }
    if (String(selfCreate.password || '').length < 4) {
      setSelfServiceMessage('Password must be at least 4 characters.');
      return;
    }
    if (selfCreate.password !== selfCreate.confirm_password) {
      setSelfServiceMessage('Password and confirm password must match.');
      return;
    }

    setSelfCreateBusy(true);
    try {
      const documents = (await Promise.all(DOC_FIELDS.map(async (field) => fileToPayload(files[field.key], field.label)))).filter(Boolean);
      const result = await api.post('/api/auth/self-register', {
        full_name: selfCreate.full_name,
        email,
        password: selfCreate.password,
        designation: selfCreate.designation,
        documents,
      }, { timeoutMs: 30000 });
      setSelfServiceMessage(result.message || 'ID created successfully.');
      setUsername(email);
      setPassword(selfCreate.password);
      setSelfCreate({ full_name: '', email: '', password: '', confirm_password: '', designation: 'Freelancer' });
      setFiles({});
      setActiveTab('login');
    } catch (err) {
      setSelfServiceMessage(err.message || 'ID could not be created.');
    } finally {
      setSelfCreateBusy(false);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    if (resetBusy) return;
    setError('');
    setSelfServiceMessage('');
    if (!String(passwordReset.email || '').trim()) {
      setSelfServiceMessage('Email is required for password reset request.');
      return;
    }
    setResetBusy(true);
    try {
      const result = await api.post('/api/auth/password-reset-request', passwordReset);
      setSelfServiceMessage(result.message || 'Password reset request submitted.');
      setPasswordReset({ email: '', reason: 'Forgot password request' });
      setActiveTab('login');
    } catch (err) {
      setSelfServiceMessage(err.message || 'Password reset request failed.');
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className={`login-body cc-subtle-login-shell cc-login-v23 ${successPhase ? 'login-success-active' : ''}`}>
      <style>{`
        .cc-self-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px;}
        .cc-self-tab{border:none;border-radius:999px;padding:9px 14px;font-weight:800;font-size:12px;letter-spacing:.02em;background:rgba(226,234,249,.92);color:#4d5d7c;cursor:pointer;transition:transform .18s ease, box-shadow .18s ease, background .18s ease;}
        .cc-self-tab.active{background:linear-gradient(135deg,#43b86a,#2b9f58);color:#fff;box-shadow:0 14px 28px rgba(67,184,106,.18);transform:translateY(-1px);}
        .cc-self-panel{display:flex;flex-direction:column;gap:14px;}
        .cc-self-block{padding:14px 14px 16px;border-radius:22px;border:1px solid rgba(164,184,220,.26);background:linear-gradient(180deg,rgba(250,252,255,.96),rgba(241,247,255,.94));box-shadow:0 18px 36px rgba(31,52,93,.08);}
        .cc-self-block h3{margin:0;font-size:18px;color:#17315e;}
        .cc-self-block p{margin:6px 0 0;color:#6980a8;font-size:12px;line-height:1.55;}
        .cc-self-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
        .cc-doc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
        .cc-doc-chip{padding:10px 12px;border-radius:16px;border:1px solid rgba(177,196,227,.45);background:rgba(255,255,255,.82);display:flex;flex-direction:column;gap:6px;}
        .cc-doc-chip span{font-size:12px;font-weight:800;color:#314e82;}
        .cc-doc-chip small{font-size:11px;color:#7185a8;min-height:16px;}
        .cc-doc-chip input{font-size:11px;}
        .cc-self-submit{width:100%;border:none;border-radius:18px;padding:14px 16px;font-weight:900;color:#fff;background:linear-gradient(135deg,#3f78ff,#30b9ff);box-shadow:0 18px 30px rgba(58,108,255,.20);cursor:pointer;transition:transform .18s ease, box-shadow .18s ease;}
        .cc-self-submit:hover{transform:translateY(-1px);box-shadow:0 20px 34px rgba(58,108,255,.24);}
        .cc-self-submit:disabled{opacity:.7;cursor:wait;transform:none;}
        .cc-self-note{padding:11px 13px;border-radius:16px;background:rgba(64,176,115,.10);border:1px solid rgba(64,176,115,.18);color:#1f7a45;font-size:12px;font-weight:800;line-height:1.5;}
        .cc-subtle-form-panel.scrollable{max-height:88vh;overflow:auto;}
        @media (max-width:960px){.cc-self-grid,.cc-doc-grid{grid-template-columns:1fr;}}
      
        .cc-subtle-login-stage{width:min(1220px,calc(100vw - 36px));margin:0 auto;}
        .cc-subtle-login-card{display:grid;grid-template-columns:minmax(320px,.92fr) minmax(430px,1.08fr);align-items:stretch;min-height:min(88vh,760px);border-radius:34px;overflow:hidden;box-shadow:0 28px 80px rgba(18,40,86,.18);backdrop-filter:blur(10px);}
        .cc-subtle-brand-panel{display:flex;align-items:center;justify-content:center;padding:30px 24px;background:linear-gradient(180deg,rgba(247,251,255,.92),rgba(236,244,255,.88));border-right:1px solid rgba(170,190,226,.26);}
        .cc-v23-brand-wrap{width:100%;display:flex;align-items:center;justify-content:center;}
        .cc-v23-brand-hero{max-width:min(100%,460px);max-height:620px;object-fit:contain;display:block;}
        .cc-subtle-form-panel.scrollable{max-height:min(88vh,760px);overflow:auto;padding:32px 34px 28px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(247,251,255,.94));}
        .cc-self-tabs{display:grid;grid-template-columns:1fr 1.55fr 1fr;gap:10px;margin:0 0 24px;padding:8px;border-radius:22px;background:linear-gradient(180deg,rgba(244,248,255,.96),rgba(236,243,255,.92));border:1px solid rgba(180,198,231,.28);position:sticky;top:0;z-index:3;backdrop-filter:blur(16px);}
        .cc-self-tab{min-height:48px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.25;padding:10px 14px;}
        .cc-subtle-form{display:flex;flex-direction:column;gap:16px;}
        .cc-subtle-form-copy{margin-bottom:2px;}
        .cc-subtle-form-copy h2{margin:0 0 6px;}
        .cc-subtle-form-copy p{margin:0;color:#62779e;line-height:1.55;}
        .cc-subtle-form-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center;}
        .cc-self-block{padding:16px 16px 18px;}
        .cc-self-block h3{line-height:1.25;}
        @media (max-width:960px){.cc-subtle-login-card{grid-template-columns:1fr;min-height:auto;}.cc-subtle-brand-panel{padding:22px 18px;min-height:220px;border-right:none;border-bottom:1px solid rgba(170,190,226,.26);}.cc-subtle-form-panel.scrollable{max-height:none;padding:22px 18px 20px;}.cc-self-tabs{grid-template-columns:1fr;position:static;}.cc-subtle-form-meta{grid-template-columns:1fr;}}
        .cc-subtle-login-stage{width:min(1260px,calc(100vw - 28px));padding:14px 0 18px;}
        .cc-subtle-login-card{grid-template-columns:minmax(420px,.96fr) minmax(520px,1.04fr);min-height:min(88vh,780px);background:rgba(255,255,255,.78);}
        .cc-subtle-brand-panel{padding:36px 34px;background:linear-gradient(135deg,rgba(255,255,255,.72),rgba(248,251,255,.86));}
        .cc-v23-brand-wrap{min-height:100%;}
        .cc-v23-brand-hero{width:min(100%,520px);max-height:none;border-radius:28px;box-shadow:0 20px 45px rgba(30,44,88,.14);}
        .cc-subtle-form-panel.scrollable{padding:28px 32px 26px;display:flex;flex-direction:column;justify-content:flex-start;}
        .cc-self-tabs{display:flex;flex-wrap:wrap;gap:10px;padding:10px;position:static;border-radius:24px;align-items:stretch;}
        .cc-self-tab{flex:1 1 180px;min-width:170px;min-height:46px;white-space:normal;}
        .cc-subtle-form-copy h2{font-size:clamp(40px,5vw,66px);line-height:.95;margin-bottom:12px;color:#102a58;}
        .cc-subtle-field span{font-weight:900;letter-spacing:.04em;}
        .cc-subtle-input-shell{min-height:62px;border-radius:22px;}
        .cc-subtle-password-toggle{min-width:96px;}
        .cc-subtle-submit{min-height:62px;border-radius:22px;}
        @media (max-width:1120px){.cc-subtle-login-card{grid-template-columns:1fr;}.cc-subtle-brand-panel{min-height:260px;border-right:none;border-bottom:1px solid rgba(170,190,226,.26);}.cc-v23-brand-hero{max-height:260px;width:auto;}}
        .cc-subtle-login-shell{overflow-x:hidden;}
        .cc-subtle-login-stage{width:min(1240px,calc(100vw - 24px));padding:18px 0 22px;}
        .cc-subtle-login-card{grid-template-columns:minmax(460px,.98fr) minmax(520px,1.02fr);min-height:min(86vh,760px);align-items:stretch;}
        .cc-subtle-brand-panel{padding:28px 24px;min-width:0;}
        .cc-v23-brand-wrap{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
        .cc-v23-brand-hero{width:min(100%,500px);max-height:580px;object-fit:contain;margin:0 auto;}
        .cc-subtle-form-panel.scrollable{padding:24px 26px 24px;overflow-y:auto;overflow-x:hidden;min-width:0;}
        .cc-self-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0;background:transparent;border:none;box-shadow:none;align-items:stretch;}
        .cc-self-tab{min-width:0;min-height:48px;padding:10px 12px;font-size:12px;line-height:1.25;border:1px solid rgba(180,198,231,.36);background:linear-gradient(180deg,rgba(245,249,255,.96),rgba(234,242,255,.92));box-shadow:none;}
        .cc-self-tab.active{box-shadow:0 12px 24px rgba(67,184,106,.18);}
        .cc-subtle-form-copy h2{font-size:clamp(44px,5vw,72px);line-height:.92;}
        .cc-subtle-form{gap:14px;}
        @media (max-width:1120px){.cc-subtle-login-card{grid-template-columns:1fr;}.cc-subtle-brand-panel{min-height:240px;padding:22px 18px;border-right:none;border-bottom:1px solid rgba(170,190,226,.26);}.cc-v23-brand-hero{max-height:240px;width:auto;}.cc-subtle-form-panel.scrollable{padding:22px 18px 20px;}.cc-self-tabs{grid-template-columns:1fr;}}

        .cc-login-v23 .cc-subtle-login-shell{overflow-x:hidden;}
        .cc-login-v23 .cc-subtle-login-stage{width:min(1220px,calc(100vw - 28px));padding:18px 0 24px;}
        .cc-login-v23 .cc-subtle-login-card{display:grid;grid-template-columns:minmax(400px,44%) minmax(520px,56%);min-height:min(86vh,760px);align-items:stretch;border-radius:34px;overflow:hidden;background:rgba(255,255,255,.82);box-shadow:0 28px 80px rgba(18,40,86,.18);}
        .cc-login-v23 .cc-subtle-brand-panel{padding:28px 22px;background:linear-gradient(180deg,rgba(255,255,255,.68),rgba(244,249,255,.9));border-right:1px solid rgba(170,190,226,.28);}
        .cc-login-v23 .cc-v23-brand-wrap{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
        .cc-login-v23 .cc-v23-brand-hero{width:min(100%,500px);max-height:600px;object-fit:contain;margin:0 auto;border-radius:28px;box-shadow:0 22px 48px rgba(29,46,90,.14);}
        .cc-login-v23 .cc-subtle-form-panel.scrollable{padding:28px 30px 26px;overflow-y:auto;overflow-x:hidden;min-width:0;display:flex;flex-direction:column;justify-content:flex-start;}
        .cc-login-v23 .cc-self-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 22px;padding:0;background:transparent;border:none;box-shadow:none;position:static;}
        .cc-login-v23 .cc-self-tab{min-width:0;min-height:50px;padding:12px 12px;font-size:12px;line-height:1.2;border:1px solid rgba(180,198,231,.36);background:linear-gradient(180deg,rgba(245,249,255,.96),rgba(234,242,255,.92));text-wrap:balance;white-space:normal;}
        .cc-login-v23 .cc-self-tab.active{box-shadow:0 14px 26px rgba(67,184,106,.18);}
        .cc-login-v23 .cc-subtle-form{gap:14px;}
        .cc-login-v23 .cc-subtle-form-copy h2{font-size:clamp(46px,5vw,74px);line-height:.92;margin-bottom:12px;color:#102a58;}
        .cc-login-v23 .cc-subtle-form-copy p{max-width:420px;color:#657ca4;}
        .cc-login-v23 .cc-subtle-input-shell{min-height:60px;border-radius:22px;}
        .cc-login-v23 .cc-subtle-password-toggle{min-width:100px;}
        .cc-login-v23 .cc-subtle-submit,.cc-login-v23 .cc-self-submit{min-height:58px;border-radius:22px;}
        .cc-login-v23 .cc-self-grid,.cc-login-v23 .cc-doc-grid{gap:12px;}
        @media (max-width:1080px){.cc-login-v23 .cc-subtle-login-card{grid-template-columns:1fr;}.cc-login-v23 .cc-subtle-brand-panel{min-height:220px;border-right:none;border-bottom:1px solid rgba(170,190,226,.28);}.cc-login-v23 .cc-v23-brand-hero{max-height:240px;width:auto;}.cc-login-v23 .cc-subtle-form-panel.scrollable{padding:22px 18px 20px;}.cc-login-v23 .cc-self-tabs{grid-template-columns:1fr;}}
        `}</style>
      <div className="cc-subtle-login-bg" aria-hidden="true">
        <span className="cc-subtle-orb cc-subtle-orb-a" />
        <span className="cc-subtle-orb cc-subtle-orb-b" />
        <span className="cc-subtle-orb cc-subtle-orb-c" />
        <span className="cc-subtle-grid" />
      </div>

      <section className="cc-subtle-login-stage">
        <div className="cc-subtle-login-card">
          <div className="cc-subtle-brand-panel">
            <div className="cc-v23-brand-wrap">
              <img src="/assets/img/login-brand-hero-v23.png" alt="Career Crox" className="cc-v23-brand-hero" />
            </div>
          </div>

          <div className="cc-subtle-form-panel scrollable">
            <div className="cc-self-tabs">
              <button className={`cc-self-tab ${activeTab === 'login' ? 'active' : ''}`} type="button" onClick={() => setActiveTab('login')}>Sign in</button>
              <button className={`cc-self-tab ${activeTab === 'create' ? 'active' : ''}`} type="button" onClick={() => setActiveTab('create')}>Create ID</button>
              <button className={`cc-self-tab ${activeTab === 'reset' ? 'active' : ''}`} type="button" onClick={() => setActiveTab('reset')}>Reset Request</button>
            </div>

            {activeTab === 'login' ? (
              <form className="cc-subtle-form" onSubmit={submit}>
                <div className="cc-subtle-form-copy">
                  <h2>Sign in</h2>
                  <p>Use your assigned credentials to continue to the live workspace.</p>
                </div>

                <label className="cc-subtle-field">
                  <span>Username</span>
                  <div className="cc-subtle-input-shell">
                    <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Email or username" autoComplete="username" disabled={loading || successPhase} />
                  </div>
                </label>

                <label className="cc-subtle-field">
                  <span>Password</span>
                  <div className="cc-subtle-input-shell cc-subtle-password-shell">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" disabled={loading || successPhase} />
                    <button className="cc-subtle-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} disabled={loading || successPhase}>{showPassword ? 'Hide' : 'Show'}</button>
                  </div>
                </label>

                <div className="cc-subtle-form-meta">
                  <label className="cc-subtle-remember-line">
                    <input type="checkbox" checked readOnly />
                    <span>Keep this device signed in</span>
                  </label>
                  <span className="cc-subtle-meta-copy">Protected production session</span>
                </div>

                <button className="cc-subtle-submit" type="submit" disabled={loading || successPhase}>
                  <span>{loading ? 'Signing in...' : successPhase ? 'Opening CRM...' : 'Login'}</span>
                </button>
              </form>
            ) : null}

            {activeTab === 'create' ? (
              <form className="cc-self-panel" onSubmit={submitSelfCreate}>
                <div className="cc-self-block">
                  <h3>Start your career with Career Crox</h3>
                  <p>Create your CRM ID from the same screen and submit the required joining documents in one flow.</p>
                </div>
                <div className="cc-self-grid">
                  <label className="cc-subtle-field"><span>Full Name</span><div className="cc-subtle-input-shell"><input type="text" value={selfCreate.full_name} onChange={(e) => setSelfCreate((prev) => ({ ...prev, full_name: e.target.value }))} placeholder="Enter full name" /></div></label>
                  <label className="cc-subtle-field"><span>Email ID</span><div className="cc-subtle-input-shell"><input type="email" value={selfCreate.email} onChange={(e) => setSelfCreate((prev) => ({ ...prev, email: e.target.value }))} placeholder="Enter email" /></div></label>
                  <label className="cc-subtle-field"><span>Password</span><div className="cc-subtle-input-shell"><input type="password" value={selfCreate.password} onChange={(e) => setSelfCreate((prev) => ({ ...prev, password: e.target.value }))} placeholder="Create password" /></div></label>
                  <label className="cc-subtle-field"><span>Confirm Password</span><div className="cc-subtle-input-shell"><input type="password" value={selfCreate.confirm_password} onChange={(e) => setSelfCreate((prev) => ({ ...prev, confirm_password: e.target.value }))} placeholder="Confirm password" /></div></label>
                </div>
                <div className="cc-self-block">
                  <h3>Document submission</h3>
                  <p>Upload Aadhaar, PAN, school marksheets, and resume here. Leadership gets notified after submission.</p>
                  <div className="cc-doc-grid" style={{ marginTop: 12 }}>
                    {DOC_FIELDS.map((field) => (
                      <label key={field.key} className="cc-doc-chip">
                        <span>{field.label}</span>
                        <small>{files[field.key]?.name || 'No file selected'}</small>
                        <input type="file" onChange={(event) => setFiles((prev) => ({ ...prev, [field.key]: event.target.files?.[0] || null }))} />
                      </label>
                    ))}
                  </div>
                </div>
                <button className="cc-self-submit" type="submit" disabled={selfCreateBusy}>{selfCreateBusy ? 'Creating ID...' : 'Create ID & Submit Documents'}</button>
              </form>
            ) : null}

            {activeTab === 'reset' ? (
              <form className="cc-self-panel" onSubmit={submitReset}>
                <div className="cc-self-block">
                  <h3>Forgot password request</h3>
                  <p>Direct password change is blocked here. Drop a reset request and leadership can handle it without breaking your account flow.</p>
                </div>
                <label className="cc-subtle-field"><span>Email ID</span><div className="cc-subtle-input-shell"><input type="email" value={passwordReset.email} onChange={(e) => setPasswordReset((prev) => ({ ...prev, email: e.target.value }))} placeholder="Registered email" /></div></label>
                <label className="cc-subtle-field"><span>Reason</span><div className="cc-subtle-input-shell"><input type="text" value={passwordReset.reason} onChange={(e) => setPasswordReset((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Reason for request" /></div></label>
                <button className="cc-self-submit" type="submit" disabled={resetBusy}>{resetBusy ? 'Submitting...' : 'Request Password Reset'}</button>
              </form>
            ) : null}

            {error ? <div className="cc-subtle-error">{error}</div> : null}
            {selfServiceMessage ? <div className="cc-self-note">{selfServiceMessage}</div> : null}
          </div>
        </div>
      </section>

      <div className={`login-success-overlay ${successPhase ? 'active' : ''}`} aria-hidden={!successPhase}>
        <div className="login-success-backdrop" />
        <div className="login-success-content cc-subtle-success">
          <div className="login-success-logo-ring cc-subtle-success-ring">
            <img src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" className="login-success-logo" />
          </div>
          <div className="login-success-text">Access granted</div>
          <div className="login-success-subtext">Opening workspace for {welcomeName}</div>
        </div>
      </div>
    </div>
  );
}
