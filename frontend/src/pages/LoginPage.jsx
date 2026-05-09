import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
  const [introReady, setIntroReady] = useState(false);

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
    const timer = window.setTimeout(() => setIntroReady(true), 60);
    return () => {
      document.body.classList.remove('no-scroll-login-shell');
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!successPhase) return undefined;
    const timer = window.setTimeout(() => navigate('/candidates'), 1150);
    return () => window.clearTimeout(timer);
  }, [navigate, successPhase]);

  async function submit(event) {
    event.preventDefault();
    if (loading || successPhase) return;
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      try {
        sessionStorage.setItem('careerCroxLoginTransition', '1');
      } catch {}
      setSuccessPhase(true);
    } catch (err) {
      setError(err.message || 'Sign in failed');
      setLoading(false);
    }
  }

  return (
    <div className={`cc-login-v57 ${introReady ? 'intro-ready' : ''} ${successPhase ? 'login-success-active' : ''}`}>
      <style>{`
        .cc-login-v57 {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 22px;
          background:
            radial-gradient(circle at 10% 18%, rgba(255, 125, 158, .42), transparent 26%),
            radial-gradient(circle at 84% 12%, rgba(111, 198, 255, .18), transparent 22%),
            radial-gradient(circle at 78% 82%, rgba(255, 199, 118, .18), transparent 25%),
            linear-gradient(135deg, #ff93a6 0%, #efa173 45%, #f5c58f 100%);
          isolation: isolate;
        }
        .cc-login-v57 * { box-sizing: border-box; }
        .cc-login-v57::before,
        .cc-login-v57::after {
          content: '';
          position: absolute;
          border-radius: 999px;
          filter: blur(60px);
          pointer-events: none;
          opacity: .45;
          animation: ccLoginGlow 12s ease-in-out infinite;
        }
        .cc-login-v57::before {
          width: 360px;
          height: 360px;
          left: -90px;
          bottom: -100px;
          background: rgba(255,255,255,.26);
        }
        .cc-login-v57::after {
          width: 320px;
          height: 320px;
          right: -80px;
          top: -100px;
          background: rgba(255,255,255,.20);
          animation-delay: -5s;
        }
        .cc-login-v57-shell {
          width: min(1120px, 100%);
          min-height: min(86vh, 760px);
          display: grid;
          grid-template-columns: minmax(450px, 46%) minmax(420px, 54%);
          background: rgba(248, 251, 255, .92);
          border: 1px solid rgba(255,255,255,.36);
          border-radius: 34px;
          overflow: hidden;
          box-shadow: 0 34px 80px rgba(82, 49, 43, .16);
          backdrop-filter: blur(14px);
          transform: translateY(18px) scale(.986);
          opacity: 0;
          transition: transform .75s cubic-bezier(.22,1,.36,1), opacity .75s ease;
          position: relative;
          z-index: 1;
        }
        .cc-login-v57.intro-ready .cc-login-v57-shell {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .cc-login-v57-visual {
          position: relative;
          padding: 16px;
          background:
            radial-gradient(circle at 25% 20%, rgba(255,255,255,.78), transparent 42%),
            linear-gradient(180deg, rgba(255,255,255,.40), rgba(244,248,255,.82));
          border-right: 1px solid rgba(179, 198, 229, .40);
          display: flex;
        }
        .cc-login-v57-visual::before {
          content: '';
          position: absolute;
          inset: 16px;
          border-radius: 28px;
          background: linear-gradient(145deg, rgba(255,255,255,.44), rgba(255,255,255,.10));
          border: 1px solid rgba(255,255,255,.38);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.52);
          pointer-events: none;
        }
        .cc-login-v57-visual-inner {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cc-login-v57-hero-frame {
          width: 100%;
          height: min(78vh, 640px);
          border-radius: 30px;
          padding: 14px;
          background: linear-gradient(145deg, rgba(255,255,255,.40), rgba(255,255,255,.10));
          border: 1px solid rgba(255,255,255,.44);
          box-shadow: 0 28px 62px rgba(48, 66, 110, .16);
          opacity: 0;
          transform: translateY(18px) scale(.985);
          transition: transform .95s cubic-bezier(.22,1,.36,1) .05s, opacity .9s ease .05s;
        }
        .cc-login-v57.intro-ready .cc-login-v57-hero-frame {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .cc-login-v57-hero {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          object-position: center;
          border-radius: 22px;
          transform: scale(1.08);
          animation: ccLoginFloat 7s ease-in-out infinite;
          box-shadow: 0 16px 38px rgba(34, 49, 86, .16);
        }
        .cc-login-v57-formside {
          padding: 36px 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, rgba(255,255,255,.94), rgba(248,251,255,.96));
        }
        .cc-login-v57-formwrap {
          width: min(100%, 460px);
          display: flex;
          flex-direction: column;
          gap: 22px;
          opacity: 0;
          transform: translateY(18px);
          transition: transform .82s cubic-bezier(.22,1,.36,1) .12s, opacity .82s ease .12s;
        }
        .cc-login-v57.intro-ready .cc-login-v57-formwrap {
          opacity: 1;
          transform: translateY(0);
        }
        .cc-login-v57-kicker {
          display: inline-flex;
          width: fit-content;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 999px;
          background: rgba(238,244,255,.86);
          border: 1px solid rgba(183,200,232,.62);
          color: #3f5f95;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
          box-shadow: 0 12px 24px rgba(62, 91, 149, .08);
        }
        .cc-login-v57-title {
          display: grid;
          gap: 10px;
        }
        .cc-login-v57-title h2 {
          margin: 0;
          font-size: clamp(42px, 5vw, 68px);
          line-height: .92;
          color: #102a58;
          letter-spacing: -.05em;
          font-weight: 950;
        }
        .cc-login-v57-title p {
          margin: 0;
          color: #6a81a6;
          font-size: 15px;
          line-height: 1.7;
          max-width: 430px;
          font-weight: 600;
        }
        .cc-login-v57-form {
          display: grid;
          gap: 16px;
        }
        .cc-login-v57-field {
          display: grid;
          gap: 8px;
        }
        .cc-login-v57-field span {
          color: #37537f;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .cc-login-v57-inputwrap {
          display: flex;
          align-items: center;
          min-height: 64px;
          padding: 0 16px 0 18px;
          border-radius: 22px;
          border: 1px solid rgba(181, 199, 230, .72);
          background: linear-gradient(180deg, rgba(244,248,255,.95), rgba(237,243,252,.92));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.68);
          transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
        }
        .cc-login-v57-inputwrap:focus-within {
          border-color: rgba(73, 128, 255, .7);
          box-shadow: 0 0 0 4px rgba(77, 130, 255, .12), inset 0 1px 0 rgba(255,255,255,.72);
          transform: translateY(-1px);
        }
        .cc-login-v57-inputwrap input {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          color: #18335f;
          font-size: 16px;
          font-weight: 800;
        }
        .cc-login-v57-inputwrap input::placeholder { color: #8aa0c1; }
        .cc-login-v57-toggle {
          min-width: 88px;
          border: none;
          border-radius: 16px;
          padding: 12px 14px;
          background: linear-gradient(135deg,#4d86ff,#35b2ff);
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 12px 22px rgba(73,129,255,.2);
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .cc-login-v57-toggle:hover { transform: translateY(-1px); box-shadow: 0 15px 26px rgba(73,129,255,.24); }
        .cc-login-v57-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding-top: 2px;
        }
        .cc-login-v57-remember {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: #3f5d8e;
          font-size: 13px;
          font-weight: 800;
        }
        .cc-login-v57-remember input { accent-color: #467dff; width: 16px; height: 16px; }
        .cc-login-v57-meta small {
          color: #6d83a7;
          font-size: 12px;
          font-weight: 700;
        }
        .cc-login-v57-submit {
          min-height: 62px;
          border: none;
          border-radius: 22px;
          padding: 14px 18px;
          background: linear-gradient(135deg, #ffb14f 0%, #f05c7c 100%);
          color: #fff;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -.01em;
          cursor: pointer;
          box-shadow: 0 22px 34px rgba(240, 92, 124, .2);
          transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
        }
        .cc-login-v57-submit:hover { transform: translateY(-1px); box-shadow: 0 24px 40px rgba(240, 92, 124, .24); filter: saturate(1.04); }
        .cc-login-v57-submit:disabled { opacity: .78; cursor: wait; transform: none; }
        .cc-login-v57-error {
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(245, 95, 117, .12);
          border: 1px solid rgba(245, 95, 117, .18);
          color: #b1374d;
          font-size: 13px;
          line-height: 1.6;
          font-weight: 800;
        }
        .cc-login-v57-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 25;
          opacity: 0;
          pointer-events: none;
          transition: opacity .32s ease;
        }
        .cc-login-v57-overlay.active { opacity: 1; pointer-events: auto; }
        .cc-login-v57-overlaybg {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at center, rgba(255,255,255,.18), rgba(19,34,66,.66));
          backdrop-filter: blur(12px);
        }
        .cc-login-v57-overlaycard {
          position: relative;
          z-index: 1;
          width: min(420px, calc(100vw - 34px));
          padding: 38px 28px 32px;
          border-radius: 30px;
          background: rgba(255,255,255,.92);
          border: 1px solid rgba(255,255,255,.4);
          box-shadow: 0 26px 80px rgba(20, 38, 72, .26);
          text-align: center;
          transform: translateY(16px) scale(.92);
          opacity: 0;
          transition: transform .54s cubic-bezier(.22,1,.36,1), opacity .54s ease;
        }
        .cc-login-v57-overlay.active .cc-login-v57-overlaycard {
          transform: translateY(0) scale(1);
          opacity: 1;
        }
        .cc-login-v57-ring {
          width: 124px;
          height: 124px;
          margin: 0 auto 18px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: radial-gradient(circle, rgba(255,255,255,.95), rgba(255,255,255,.72));
          box-shadow: 0 0 0 18px rgba(75,123,255,.10), 0 0 0 38px rgba(240,92,124,.08);
          animation: ccLoginSuccessPulse 1.2s ease-in-out infinite;
        }
        .cc-login-v57-ring img { width: 72px; height: 72px; object-fit: contain; }
        .cc-login-v57-overlaycard h3 {
          margin: 0 0 8px;
          color: #14305d;
          font-size: 30px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -.03em;
        }
        .cc-login-v57-overlaycard p {
          margin: 0;
          color: #6780a6;
          font-size: 14px;
          line-height: 1.7;
          font-weight: 700;
        }
        @keyframes ccLoginFloat {
          0%,100% { transform: translateY(0) scale(1.08); }
          50% { transform: translateY(-8px) scale(1.095); }
        }
        @keyframes ccLoginGlow {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50% { transform: translate3d(14px,-16px,0) scale(1.08); }
        }
        @keyframes ccLoginSuccessPulse {
          0%,100% { box-shadow: 0 0 0 18px rgba(75,123,255,.10), 0 0 0 38px rgba(240,92,124,.08); }
          50% { box-shadow: 0 0 0 24px rgba(75,123,255,.12), 0 0 0 50px rgba(240,92,124,.06); }
        }
        @media (max-width: 1040px) {
          .cc-login-v57-shell { grid-template-columns: 1fr; min-height: auto; }
          .cc-login-v57-visual { padding: 14px; border-right: none; border-bottom: 1px solid rgba(173,193,226,.36); }
          .cc-login-v57-hero-frame { height: min(48vh, 360px); }
          .cc-login-v57-formside { padding: 24px 18px 28px; }
        }
        @media (max-width: 720px) {
          .cc-login-v57 { padding: 12px; }
          .cc-login-v57-shell { border-radius: 24px; }
          .cc-login-v57-title h2 { font-size: 42px; }
          .cc-login-v57-title p { font-size: 14px; }
          .cc-login-v57-meta { align-items: flex-start; }
          .cc-login-v57-hero-frame { height: min(42vh, 300px); }
        }
      `}</style>

      <section className="cc-login-v57-shell">
        <aside className="cc-login-v57-visual">
          <div className="cc-login-v57-visual-inner">
            <div className="cc-login-v57-hero-frame">
              <img src="/assets/img/login-brand-hero-v23.png" alt="Career Crox" className="cc-login-v57-hero" />
            </div>
          </div>
        </aside>

        <div className="cc-login-v57-formside">
          <div className="cc-login-v57-formwrap">
            <div className="cc-login-v57-kicker">Authorized sign in</div>

            <div className="cc-login-v57-title">
              <h2>Sign in</h2>
              <p>Use your assigned username and password to enter the live workspace. The session opens with your role, access rules, and active workspace.</p>
            </div>

            <form className="cc-login-v57-form" onSubmit={submit}>
              <label className="cc-login-v57-field">
                <span>Username</span>
                <div className="cc-login-v57-inputwrap">
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Enter your username"
                    autoComplete="username"
                    disabled={loading || successPhase}
                  />
                </div>
              </label>

              <label className="cc-login-v57-field">
                <span>Password</span>
                <div className="cc-login-v57-inputwrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={loading || successPhase}
                  />
                  <button
                    className="cc-login-v57-toggle"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={loading || successPhase}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              <div className="cc-login-v57-meta">
                <label className="cc-login-v57-remember">
                  <input type="checkbox" checked readOnly />
                  <span>Keep this device signed in</span>
                </label>
                <small>Protected production session</small>
              </div>

              <button className="cc-login-v57-submit" type="submit" disabled={loading || successPhase}>
                {loading ? 'Signing in...' : successPhase ? 'Opening CRM...' : 'Login'}
              </button>
            </form>

            {error ? <div className="cc-login-v57-error">{error}</div> : null}
          </div>
        </div>
      </section>

      <div className={`cc-login-v57-overlay ${successPhase ? 'active' : ''}`} aria-hidden={!successPhase}>
        <div className="cc-login-v57-overlaybg" />
        <div className="cc-login-v57-overlaycard">
          <div className="cc-login-v57-ring">
            <img src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" />
          </div>
          <h3>Access granted</h3>
          <p>Opening workspace for {welcomeName}.</p>
        </div>
      </div>
    </div>
  );
}
