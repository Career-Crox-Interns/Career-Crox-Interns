import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";

export default function PerformancePage(){
  const [frameHeight, setFrameHeight] = useState(1680);

  useEffect(() => {
    function onMessage(event) {
      const payload = event?.data;
      if (!payload || payload.type !== 'career-crox-performance-height') return;
      const nextHeight = Number(payload.height || 0);
      if (nextHeight > 500) setFrameHeight(Math.min(Math.max(nextHeight, 900), 3200));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <Layout title="Performance Centre" subtitle="Recruiter performance, live activity, filters, leaderboard, and export in one place.">
      <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="helper-text">The performance dashboard is embedded inside the CRM for a faster and more consistent experience.</div>
        <iframe
          title="Performance Centre Dashboard"
          src="/generated/performance-centre-v2.html?v=27"
          style={{ width: '100%', height: frameHeight, border: '1px solid rgba(214,226,243,.95)', borderRadius: 24, background: 'rgba(255,255,255,.85)', boxShadow: '0 18px 40px rgba(16,24,40,.08)' }}
        />
      </div>
    </Layout>
  );
}
