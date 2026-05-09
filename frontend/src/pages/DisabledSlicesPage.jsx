import React from 'react';
import Layout from '../components/Layout';

const disabledSlices = [
  {
    title: 'Data Extractor',
    tag: 'Heavy import tools',
    body: 'Kept as a visual reference only. Backend, parser, public URL import, and Supabase touch are fully disabled.',
    points: ['Raw lead cleanup', 'Poster/screenshot import', 'Bulk extraction preview'],
    accent: '#fb923c',
  },
  {
    title: 'Quality Analyst',
    tag: 'QA review tools',
    body: 'Archived for future review. This card does not call any API, table, route, or Supabase query.',
    points: ['Call quality review', 'Checklist scoring', 'QA history panel'],
    accent: '#38bdf8',
  },
  {
    title: 'HR Head',
    tag: 'HR documents',
    body: 'Frozen to save network load. HR Head backend routes are disabled and the old slice is not mounted.',
    points: ['Offer / joining docs', 'HR logs', 'Template reference'],
    accent: '#a78bfa',
  },
];

function FloatingDot({ style }) {
  return <span className="disabled-slice-dot" style={style} aria-hidden="true" />;
}

export default function DisabledSlicesPage() {
  return (
    <Layout title="Disabled Slices" subtitle="Archived feature preview only. No backend calls. No Supabase touch. No network load circus.">
      <style>{`
        .disabled-slices-shell {
          position: relative;
          overflow: hidden;
          min-height: 72vh;
          padding: 28px;
          border-radius: 30px;
          border: 1px solid rgba(255,255,255,.58);
          background:
            radial-gradient(circle at top left, rgba(251,146,60,.26), transparent 32%),
            radial-gradient(circle at 90% 10%, rgba(56,189,248,.25), transparent 30%),
            radial-gradient(circle at 40% 95%, rgba(167,139,250,.26), transparent 34%),
            linear-gradient(135deg, rgba(15,23,42,.94), rgba(30,41,59,.91));
          box-shadow: 0 26px 70px rgba(15,23,42,.22);
          color: #fff;
        }
        .disabled-slice-dot {
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: rgba(255,255,255,.7);
          filter: blur(.2px);
          animation: disabledFloat 7s ease-in-out infinite;
        }
        .disabled-slice-hero {
          position: relative;
          z-index: 1;
          max-width: 820px;
          display: grid;
          gap: 12px;
        }
        .disabled-slice-pill {
          width: max-content;
          padding: 8px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
          background: rgba(255,255,255,.12);
          border: 1px solid rgba(255,255,255,.22);
          backdrop-filter: blur(12px);
        }
        .disabled-slice-title {
          margin: 0;
          font-size: clamp(28px, 4vw, 48px);
          line-height: 1.03;
          letter-spacing: -.04em;
        }
        .disabled-slice-copy {
          margin: 0;
          color: rgba(255,255,255,.78);
          line-height: 1.7;
          max-width: 680px;
          font-size: 15px;
        }
        .disabled-slice-grid {
          position: relative;
          z-index: 1;
          margin-top: 28px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 18px;
        }
        .disabled-slice-card {
          position: relative;
          overflow: hidden;
          min-height: 245px;
          padding: 22px;
          border-radius: 26px;
          background: rgba(255,255,255,.13);
          border: 1px solid rgba(255,255,255,.2);
          box-shadow: 0 18px 42px rgba(0,0,0,.18);
          backdrop-filter: blur(18px);
          animation: disabledCardIn .62s cubic-bezier(.2,.8,.2,1) both;
        }
        .disabled-slice-card::before {
          content: "";
          position: absolute;
          inset: -80px -80px auto auto;
          width: 165px;
          height: 165px;
          border-radius: 999px;
          background: var(--slice-accent);
          opacity: .24;
          filter: blur(4px);
          animation: disabledPulse 3.4s ease-in-out infinite;
        }
        .disabled-slice-card h3 {
          position: relative;
          margin: 0 0 8px;
          font-size: 24px;
          letter-spacing: -.02em;
        }
        .disabled-slice-tag {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 11px;
          border-radius: 999px;
          background: rgba(255,255,255,.12);
          color: rgba(255,255,255,.82);
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 14px;
        }
        .disabled-slice-card p {
          position: relative;
          margin: 0 0 14px;
          color: rgba(255,255,255,.78);
          line-height: 1.6;
          font-size: 14px;
        }
        .disabled-slice-card ul {
          position: relative;
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 9px;
        }
        .disabled-slice-card li {
          display: flex;
          align-items: center;
          gap: 9px;
          color: rgba(255,255,255,.88);
          font-size: 13px;
          font-weight: 800;
        }
        .disabled-slice-card li::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--slice-accent);
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--slice-accent) 18%, transparent);
        }
        .disabled-slice-footer {
          position: relative;
          z-index: 1;
          margin-top: 22px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .disabled-slice-safe-chip {
          padding: 10px 13px;
          border-radius: 14px;
          background: rgba(16,185,129,.14);
          border: 1px solid rgba(16,185,129,.35);
          color: #d1fae5;
          font-size: 13px;
          font-weight: 900;
        }
        @keyframes disabledFloat {
          0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: .55; }
          50% { transform: translate3d(16px,-24px,0) scale(1.35); opacity: .95; }
        }
        @keyframes disabledCardIn {
          from { opacity: 0; transform: translateY(18px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes disabledPulse {
          0%, 100% { transform: scale(1); opacity: .20; }
          50% { transform: scale(1.15); opacity: .32; }
        }
      `}</style>
      <div className="disabled-slices-shell fade-up">
        <FloatingDot style={{ left: '6%', top: '18%', animationDelay: '.1s' }} />
        <FloatingDot style={{ right: '11%', top: '22%', animationDelay: '1.1s' }} />
        <FloatingDot style={{ left: '47%', top: '9%', animationDelay: '2s' }} />
        <FloatingDot style={{ right: '22%', bottom: '13%', animationDelay: '1.7s' }} />
        <div className="disabled-slice-hero">
          <div className="disabled-slice-pill">Archive mode</div>
          <h1 className="disabled-slice-title">Disabled slices are parked here, not connected anywhere.</h1>
          <p className="disabled-slice-copy">
            These features are kept only as a clean visual reminder of what existed. Opening this page will not fetch CRM data,
            will not call old backend controllers, and will not touch Supabase. Future humans may inspect it without burning network load.
          </p>
        </div>

        <div className="disabled-slice-grid">
          {disabledSlices.map((slice, index) => (
            <article
              key={slice.title}
              className="disabled-slice-card"
              style={{ '--slice-accent': slice.accent, animationDelay: `${index * 0.12}s` }}
            >
              <div className="disabled-slice-tag">{slice.tag}</div>
              <h3>{slice.title}</h3>
              <p>{slice.body}</p>
              <ul>
                {slice.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </article>
          ))}
        </div>

        <div className="disabled-slice-footer">
          <span className="disabled-slice-safe-chip">Backend controllers not mounted</span>
          <span className="disabled-slice-safe-chip">Supabase calls blocked</span>
          <span className="disabled-slice-safe-chip">Future reference only</span>
        </div>
      </div>
    </Layout>
  );
}
