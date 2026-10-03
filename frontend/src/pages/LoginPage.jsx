import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const BRAND_LOGO = '/assets/img/career-crox-logo.svg?v=CC26_776_BRAND_FIX';
const SLIDES = Array.from({ length: 10 }, (_, index) => `/assets/img/login-style15-slides/slide_${String(index + 1).padStart(2, '0')}.png`);
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successPhase, setSuccessPhase] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState(() => {
    try {
      const message = sessionStorage.getItem('careerCroxSessionExpiredMessage') || '';
      if (message) sessionStorage.removeItem('careerCroxSessionExpiredMessage');
      return message;
    } catch {
      return '';
    }
  });

  useEffect(() => {
    document.body.classList.add('cc-style15-login-body');
    document.body.classList.add('app-ready'); // cc374-login-visible
    document.getElementById('root')?.classList?.remove('react-hidden-until-ready'); // cc373-login-visible
    return () => document.body.classList.remove('cc-style15-login-body');
  }, []);

  useEffect(() => {
    // Egress-safe: browser loads current slide naturally; preload only the next one.
    const img = new Image();
    img.src = SLIDES[(slideIndex + 1) % SLIDES.length];
  }, [slideIndex]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % SLIDES.length);
    }, 2400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // CC26_754: warm only the static Candidates chunk after the login UI is visible.
    // This is not an API/Supabase request and avoids a second layout while signing in.
    let idleId = 0;
    let timer = 0;
    const warm = () => import('./CandidatesPage').catch(() => {});
    if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(warm, { timeout: 1200 });
    else timer = window.setTimeout(warm, 350);
    return () => {
      if (idleId && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!successPhase) return undefined;
    // CC26_754: stay inside the SPA. A hard location.replace caused the static
    // boot shell to flash between Login and Candidates.
    const timer = window.setTimeout(() => navigate('/candidates', { replace: true }), 80);
    return () => window.clearTimeout(timer);
  }, [successPhase, navigate]);

  async function submit(event) {
    event.preventDefault();
    if (loading || successPhase) return;
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      try { sessionStorage.setItem('careerCroxLoginTransition', '1'); } catch {}
      setSuccessPhase(true);
    } catch (err) {
      setError(err?.message || 'Sign in failed');
      setLoading(false);
    }
  }

  return (
    <div className={`cc-style15-login ${successPhase ? 'is-success' : ''}`}>
      <style>{`
        .cc-style15-login, .cc-style15-login * { box-sizing: border-box; }
        .cc-style15-login-body { overflow: hidden; }
        .cc-style15-login {
          min-height: 100vh;
          width: 100%;
          position: relative;
          overflow: hidden;
          color: #1f2432;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          background: linear-gradient(135deg, #fff6ef 0%, #ffffff 55%, #fff0f6 100%);
        }
        .cc-style15-login::before {
          content: '';
          position: fixed;
          inset: 0;
          background:
            linear-gradient(rgba(124,92,181,.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(124,92,181,.022) 1px, transparent 1px);
          background-size: 62px 62px;
          opacity: .9;
          pointer-events: none;
          mask-image: linear-gradient(180deg, #000 0%, transparent 96%);
        }
        .shape-top {
          position: fixed;
          top: -34px;
          right: -36px;
          width: 420px;
          height: 190px;
          background: linear-gradient(135deg, #fed7aa, #fecdd3);
          border-bottom-left-radius: 120px;
          animation: shapeFloat 12s ease-in-out infinite;
        }
        .shape-top::after {
          content: '';
          position: absolute;
          left: -170px;
          top: 32px;
          width: 220px;
          height: 120px;
          background: rgba(255,255,255,.74);
          border-bottom-right-radius: 110px;
          border-top-left-radius: 110px;
          filter: blur(.5px);
        }
        .shape-left {
          position: fixed;
          left: -20px;
          bottom: -22px;
          width: 120px;
          height: 140px;
          background: linear-gradient(180deg, #ffedd5, #ffe4e6);
          border-top-right-radius: 48px;
          animation: shapeFloat 14s ease-in-out infinite reverse;
        }
        @keyframes shapeFloat { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(12px,-10px,0); } }
        @keyframes shimmer { 0% { transform: translateX(-140%); } 100% { transform: translateX(140%); } }
        @keyframes enterCard { from { opacity: 0; transform: translateY(20px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes successPop { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .style15-wrap {
          min-height: 100vh;
          display: grid;
          place-items: stretch;
          padding: 0;
          position: relative;
          z-index: 2;
        }
        .style15-card {
          width: 100%;
          min-height: 100vh;
          background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(255,255,255,.78));
          border: 0;
          border-radius: 0;
          box-shadow: none;
          display: grid;
          grid-template-columns: minmax(430px, 44vw) 1fr;
          overflow: hidden;
          position: relative;
          backdrop-filter: blur(14px);
          opacity: 1;
          animation: none;
        }
        .style15-left {
          padding: clamp(44px, 7vh, 82px) clamp(46px, 6vw, 96px);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 2;
        }
        .style15-inner {
          width: 100%;
          max-width: 590px;
        }
        .style15-logo {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          padding: 0;
          border-radius: 0;
          background: transparent;
          border: none;
          box-shadow: none;
          margin-bottom: 48px;
        }
        .style15-logo img {
          height: 108px;
          max-width: 470px;
          object-fit: contain;
          display: block;
        }
        .style15-title {
          margin: 0 0 30px;
          font-size: clamp(42px, 4.05vw, 58px);
          line-height: 1.05;
          letter-spacing: -1.2px;
          font-weight: 780;
          color: #232b3a;
        }
        .style15-title-base {
          display: block;
          font-size: .56em;
          letter-spacing: -.25px;
          color: #3f4858;
          margin-bottom: 14px;
          font-weight: 760;
        }
        .style15-title-rotator {
          display: inline-block;
          color: #f26b2a;
          text-shadow: none;
          filter: none;
        }
        .style15-title { margin-bottom: 28px; }
        .style15-sub { display: none; }
        .style15-error {
          margin: 0 0 15px;
          padding: 12px 14px;
          border-radius: 15px;
          color: #9f1239;
          background: rgba(255, 228, 230, .86);
          border: 1px solid rgba(251,113,133,.28);
          font-size: 13px;
          font-weight: 700;
        }
        .style15-field { margin-bottom: 16px; }
        .style15-field input {
          width: 100%;
          height: 58px;
          border-radius: 16px;
          border: 1px solid #ddd6cf;
          background: rgba(255,255,255,.97);
          outline: none;
          padding: 0 18px;
          font-size: 16px;
          color: #21283a;
          transition: .22s ease;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.9);
          font-weight: 750;
        }
        .style15-field input::placeholder { color: #948272; opacity: 1; font-weight: 600; }
        .style15-field input:focus {
          border-color: #fdba74;
          box-shadow: 0 0 0 4px rgba(249,115,22,.12);
          transform: translateY(-1px);
        }
        .password-field { position: relative; }
        .password-field input { padding-right: 52px; }
        .show-pass {
          position: absolute;
          right: 15px;
          top: 50%;
          transform: translateY(-50%);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 0;
          background: transparent;
          cursor: pointer;
          color: #9b7d66;
          opacity: .95;
          padding: 0;
        }
        .show-pass svg { width: 19px; height: 19px; stroke: currentColor; fill: none; stroke-width: 2; }
        .remember-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 4px 0 18px;
        }
        .remember-row label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #8b796b;
          font-size: 13.5px;
          font-weight: 750;
        }
        .remember-row input { width: 16px; height: 16px; accent-color: #f97316; }
        .access-note {
          color: #a06b4b;
          font-size: 12.5px;
          font-weight: 800;
          white-space: nowrap;
        }
        .style15-btn {
          width: 100%;
          height: 54px;
          border: 0;
          border-radius: 15px;
          background: linear-gradient(135deg, #f97316, #fb7185);
          color: #fff;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 18px 42px rgba(249,115,22,.25);
          position: relative;
          overflow: hidden;
          transition: .24s ease;
        }
        .style15-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent);
          transform: translateX(-130%);
          animation: shimmer 3.4s linear infinite;
        }
        .style15-btn:hover { transform: translateY(-2px); }
        .style15-btn:disabled { opacity: .72; cursor: not-allowed; transform: none; }
        .style15-footer {
          margin-top: 24px;
          font-size: 13.5px;
          line-height: 1.7;
          color: #3f4a5c;
          font-weight: 800;
          letter-spacing: .01em;
        }
        .style15-right {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(24px, 4.2vw, 54px);
          z-index: 2;
        }
        .illu-shell {
          position: relative;
          width: min(940px, 99%);
          max-width: 940px;
          height: min(90vh, 820px);
          min-height: 660px;
          border-radius: 0;
          background: transparent;
          border: 0;
          box-shadow: none;
          overflow: visible;
          filter: drop-shadow(0 32px 74px rgba(108,84,164,.06));
        }
        .slide-stage { position: absolute; inset: 0; }
        .slide {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity .95s ease, transform 1.05s cubic-bezier(.2,.8,.2,1), filter 1.05s ease;
          transform: translateY(12px) scale(.985);
          filter: blur(10px) saturate(.96);
        }
        .slide.active {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0) saturate(1.03);
        }
        .slide img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          object-position: center 47%;
          clip-path: inset(150px 0 0 0);
          transform: scale(1.20) translateY(38px);
          filter: saturate(1.03) contrast(.99);
          -webkit-mask-image: radial-gradient(ellipse at center, #000 48%, rgba(0,0,0,.82) 61%, rgba(0,0,0,.34) 73%, transparent 86%);
          mask-image: radial-gradient(ellipse at center, #000 48%, rgba(0,0,0,.82) 61%, rgba(0,0,0,.34) 73%, transparent 86%);
        }
        .slide::before {
          content: '';
          position: absolute;
          inset: -24px;
          background: radial-gradient(ellipse at center, transparent 50%, rgba(255,255,255,.42) 72%, rgba(255,255,255,.86) 100%);
          filter: blur(8px);
          z-index: 2;
          pointer-events: none;
        }
        .slide::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 0;
          z-index: 2;
          pointer-events: none;
        }
        .success-overlay {
          position: fixed;
          inset: 0;
          z-index: 20;
          display: grid;
          place-items: center;
          background: radial-gradient(circle at center, rgba(255,255,255,.82), rgba(255,246,239,.72));
          backdrop-filter: blur(18px);
          pointer-events: none;
          opacity: 0;
          transition: .25s ease;
        }
        .cc-style15-login.is-success .success-overlay { opacity: 1; }
        .success-card {
          width: min(760px, 92vw);
          min-height: 380px;
          border-radius: 46px;
          padding: 58px 64px;
          display: grid;
          justify-items: center;
          align-content: center;
          gap: 28px;
          background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(255,246,239,.84));
          border: 1px solid rgba(249,115,22,.12);
          box-shadow: 0 44px 130px rgba(112, 82, 180, .18);
          color: #1f2432;
          font-size: 30px;
          font-weight: 850;
          letter-spacing: -.4px;
          animation: successPop .35s ease forwards;
        }
        .success-card img { width: 310px; max-width: 78%; height: auto; }
        @media (max-width: 980px) {
          .cc-style15-login-body { overflow: auto; }
          .style15-wrap { padding: 0; }
          .style15-card { grid-template-columns: 1fr; min-height: 100vh; }
          .style15-left { padding: 34px 24px 18px; }
          .style15-right { padding: 10px 20px 24px; }
          .style15-inner { max-width: 560px; }
          .illu-shell { width: min(680px, 98%); height: 620px; min-height: 500px; }
          .style15-title { font-size: 38px; }
        }
        @media (max-width: 560px) {
          .style15-left { padding: 28px 18px 16px; }
          .style15-title { font-size: 31px; }
          .style15-logo img { height: 78px; max-width: 330px; }
          .illu-shell { height: 470px; }
          .remember-row { align-items: flex-start; flex-direction: column; }
        }
      `}</style>

      <div className="shape-top" />
      <div className="shape-left" />

      <main className="style15-wrap" aria-label="Career Crox CRM login">
        <section className="style15-card">
          <section className="style15-left">
            <div className="style15-inner">
              <div className="style15-logo"><img src={BRAND_LOGO} alt="Career Crox Logo" /></div>
              <h1 className="style15-title">
                <span className="style15-title-base">Welcome To,</span>
                <span className="style15-title-rotator">Career Crox CRM</span>
              </h1>
              {error ? <div className="style15-error">{error}</div> : null}
              <form onSubmit={submit}>
                <div className="style15-field">
                  <input
                    type="text"
                    placeholder="Email or Username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                  />
                </div>
                <div className="style15-field password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    className="show-pass"
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3.2" />
                    </svg>
                  </button>
                </div>
                <div className="remember-row">
                  <label><input type="checkbox" defaultChecked /> Keep signed in</label>
                  <span className="access-note">Authorized team access</span>
                </div>
                <button className="style15-btn" type="submit" disabled={loading || successPhase}>
                  {loading || successPhase ? 'Checking access...' : 'Sign In'}
                </button>
                <div className="style15-footer">Career Crox CRM • Authorized recruitment workspace only.</div>
              </form>
            </div>
          </section>

          <section className="style15-right" aria-label="Career Crox CRM highlights">
            <div className="illu-shell">
              <div className="slide-stage">
                {SLIDES.map((src, index) => (
                  <div className={`slide ${index === slideIndex ? 'active' : ''}`} key={src}>
                    <img
                      src={src}
                      alt="Career Crox CRM workspace visual"
                      loading={index === 0 ? 'eager' : 'lazy'}
                      fetchPriority={index === 0 ? 'high' : 'auto'}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </main>

      <div className="success-overlay">
        <div className="success-card"><img src={BRAND_LOGO} alt="Career Crox" /><span>Opening workspace...</span></div>
      </div>
    </div>
  );
}
