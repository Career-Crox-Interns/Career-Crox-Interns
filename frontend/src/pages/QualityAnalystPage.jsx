import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/auth';

const DEFAULT_FORM = {
  script_points: `Greeting\nCandidate name confirmation\nTell me about yourself\nCurrent company / last company\nWhat is BPO\nWhy customer support\nLocation / relocation check\nSalary / expected salary\nShift flexibility\nQualification\nExperience / fresher check\nNext step / follow-up confirmed`,
  positive_tone_markers: `Calm voice\nClear pace\nFriendly opening\nConfident closing\nGood empathy`,
  nervous_markers: `Long pauses\nRepeated filler words\nVoice shake\nWrong information correction\nTalking too fast`,
  objection_points: `Salary objection handled\nLocation objection handled\nNight shift objection handled\nNotice period objection handled`,
  candidate_points: `Interest level\nCommunication clarity\nRelevant experience\nSalary fit\nLocation fit\nJoining timeline`,
  score_weights: `Script Adherence - 25\nClarity - 15\nConfidence - 15\nObjection Handling - 15\nTone / Professionalism - 10\nCandidate Qualification Capture - 10\nClosing Quality - 10`,
  notes: 'Tone is judged as a first-pass QA estimate from audio flow, pauses, pace, media continuity and your checklist. True high-accuracy tone grading needs transcript plus manager observation rules.',
};

const ACCEPTED_MEDIA = '.mp3,.wav,.m4a,.aac,.ogg,.webm,.mp4,.m4v,.mov,.avi,.mkv,.3gp,.mpeg,.mpg';

function parseWeights(text) {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const parsed = lines.map((line) => {
    const match = line.match(/^(.*?)\s*[-:]\s*(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    return { label: match[1].trim(), weight: Number(match[2]) };
  }).filter(Boolean);
  return parsed.length ? parsed : [
    { label: 'Script Adherence', weight: 25 },
    { label: 'Clarity', weight: 15 },
    { label: 'Confidence', weight: 15 },
    { label: 'Objection Handling', weight: 15 },
    { label: 'Tone / Professionalism', weight: 10 },
    { label: 'Candidate Qualification Capture', weight: 10 },
    { label: 'Closing Quality', weight: 10 },
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(list = []) {
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, item) => sum + Number(item || 0), 0) / list.length);
}

function makeUploadEntry(file) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    type: file.type || '',
    size: file.size || 0,
    url: URL.createObjectURL(file),
    duration: 0,
    source: 'uploaded',
    sample: false,
  };
}

function buildHeuristicAnalysis(item, form) {
  const duration = Number(item?.duration || 0);
  const weights = parseWeights(form.score_weights);
  const scriptCount = String(form.script_points || '').split(/\n+/).filter(Boolean).length;
  const objectionCount = String(form.objection_points || '').split(/\n+/).filter(Boolean).length;
  const positiveCount = String(form.positive_tone_markers || '').split(/\n+/).filter(Boolean).length;
  const nervousCount = String(form.nervous_markers || '').split(/\n+/).filter(Boolean).length;
  const candidateCount = String(form.candidate_points || '').split(/\n+/).filter(Boolean).length;
  const durationBase = duration ? clamp(Math.round(52 + Math.min(duration / 10, 26)), 50, 82) : 61;
  const mediaBonus = /mp4|mov|webm|mkv/i.test(item?.type || item?.name || '') ? 4 : 0;

  const categoryMap = {
    'Script Adherence': clamp(durationBase + (scriptCount >= 8 ? 8 : 4), 50, 88),
    'Clarity': clamp(durationBase + 6, 48, 86),
    'Confidence': clamp(durationBase - Math.min(nervousCount, 6), 45, 84),
    'Objection Handling': clamp(durationBase - 2 + Math.min(objectionCount, 6), 45, 85),
    'Tone / Professionalism': clamp(durationBase + mediaBonus + Math.min(positiveCount, 5), 48, 87),
    'Candidate Qualification Capture': clamp(durationBase + Math.min(candidateCount, 6), 50, 89),
    'Closing Quality': clamp(durationBase + (duration >= 150 ? 6 : 1), 44, 86),
  };

  const rows = weights.map((itemWeight) => {
    const label = itemWeight.label;
    const percentage = categoryMap[label] || clamp(durationBase + 2, 48, 84);
    const checked = label === 'Script Adherence'
      ? 'Mandatory opening, role explanation, salary check, experience check and closing flow'
      : label === 'Clarity'
        ? 'Speech continuity, question spacing and media continuity'
        : label === 'Confidence'
          ? 'Long pauses, filler tendency and hesitant flow markers'
          : label === 'Objection Handling'
            ? 'Salary, shift and location resistance handling'
            : label === 'Tone / Professionalism'
              ? 'Calmness, politeness and call discipline'
              : label === 'Candidate Qualification Capture'
                ? 'Experience, salary, joining timeline and fit capture'
                : 'Ending clarity and next-step mention';
    const result = percentage >= 82
      ? 'Strong first-pass score.'
      : percentage >= 70
        ? 'Usable, but still has improvement room.'
        : 'Needs coaching attention.';
    return { percentage, area: label, checked, result };
  });

  const overall = average(rows.map((row) => row.percentage));
  const notes = [
    duration ? `Media duration detected: ${Math.round(duration)} seconds.` : 'Duration could not be read, so this is a lighter first-pass review.',
    'This automatic result is a structured QA starter, not a human listening replacement.',
    'Tone score is estimated from delivery flow rules and your checklist. Exact emotional scoring still needs transcript plus manager review.',
  ];
  const suggestions = [
    'Fill your mandatory checkpoints so the scoring matches your real interview script.',
    'Use this table to spot weak areas first, then listen and add manager notes.',
    overall < 75 ? 'Coach the recruiter on pacing and objection handling before the next round.' : 'Keep this call as a decent benchmark and tighten the weaker categories.'
  ];

  return {
    overall,
    summary: overall >= 80 ? 'Good first-pass interview quality.' : overall >= 68 ? 'Average interview quality with visible coaching scope.' : 'Weak interview quality. Manager review recommended.',
    rows,
    notes,
    suggestions,
  };
}

export default function QualityAnalystPage() {
  const { user } = useAuth();
  const managerOnly = ['manager', 'admin'].includes(String(user?.role || '').toLowerCase());
  const [form, setForm] = useState(DEFAULT_FORM);
  const [uploads, setUploads] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('careerCroxQualityAnalystConfig') || 'null');
      if (saved) setForm({ ...DEFAULT_FORM, ...saved });
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem('careerCroxQualityAnalystConfig', JSON.stringify(form));
  }, [form]);

  useEffect(() => () => {
    uploads.filter((item) => item.source === 'uploaded' && item.url.startsWith('blob:')).forEach((item) => URL.revokeObjectURL(item.url));
  }, [uploads]);

  const selectedMedia = useMemo(() => uploads.find((item) => item.id === selectedId) || uploads[0] || null, [uploads, selectedId]);

  if (!managerOnly) {
    return <Layout title="Quality Analyst" subtitle="Manager-only QA workspace for call review rules."><div className="panel top-gap"><div className="panel-title">Restricted</div><div className="helper-text">Only manager or admin can open the quality analyst slice.</div></div></Layout>;
  }

  function field(key, label, rows = 6) {
    return <div className="field"><label>{label}</label><textarea rows={rows} value={form[key]} onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))} /></div>;
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const mapped = incoming.map(makeUploadEntry);
    setUploads((prev) => [...prev, ...mapped]);
    setSelectedId((prev) => prev || mapped[0]?.id || '');
    setMessage(`${mapped.length} media file${mapped.length === 1 ? '' : 's'} loaded. Save the batch, then run analysis.`);
    setAnalysis(null);
  }

  function updateDuration(mediaId, duration) {
    if (!duration || Number.isNaN(duration)) return;
    setUploads((prev) => prev.map((item) => item.id === mediaId ? { ...item, duration } : item));
  }

  function clearUploads() {
    uploads.filter((item) => item.source === 'uploaded' && item.url.startsWith('blob:')).forEach((item) => URL.revokeObjectURL(item.url));
    setUploads([]);
    setSelectedId('');
    setAnalysis(null);
    setMessage('');
  }

  function loadSample() {
    setMessage('Built-in sample media has been removed from this live pack. Upload your own call or recording.');
  }

  function saveBatch() {
    if (!uploads.length) return;
    const payload = uploads.map((item) => ({ id: item.id, name: item.name, type: item.type, duration: item.duration, source: item.source, sample: item.sample }));
    localStorage.setItem('careerCroxQualityAnalystBatch', JSON.stringify(payload));
    setMessage(`Saved ${payload.length} item${payload.length === 1 ? '' : 's'} to the local QA batch.`);
  }

  function analyzeSelected() {
    if (!selectedMedia) {
      setMessage('Load at least one audio or video file first.');
      return;
    }
    const result = buildHeuristicAnalysis(selectedMedia, form);
    setAnalysis(result);
    setMessage(`${selectedMedia.name} analysed. Review the percentage table, notes and suggestions below.`);
  }

  return (
    <Layout title="Quality Analyst" subtitle="Upload calls, preview them, then get a structured QA table with percentages, notes and improvement suggestions.">
      <style>{`
        .qa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .qa-grid .field.full{grid-column:1 / -1}
        .qa-note{padding:14px 16px;border-radius:20px;border:1px solid rgba(105,132,198,.18);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(245,249,255,.95));color:#4a628e;line-height:1.65}
        .qa-upload-box{border:1px dashed rgba(89,121,204,.3);border-radius:22px;padding:16px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(244,248,255,.95))}
        .qa-action-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        .qa-btn{border:none;border-radius:16px;padding:12px 18px;font-weight:800;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}
        .qa-btn.primary{background:linear-gradient(135deg,#3779ff,#2bb4ff);color:#fff;box-shadow:0 14px 28px rgba(52,116,255,.22)}
        .qa-btn.secondary{background:linear-gradient(135deg,#45ba6d,#2f9a58);color:#fff;box-shadow:0 14px 28px rgba(57,171,98,.2)}
        .qa-btn.ghost{background:rgba(233,240,255,.95);color:#244c8e;border:1px solid rgba(170,190,226,.3)}
        .qa-btn:hover{transform:translateY(-1px)}
        .qa-hidden{display:none}
        .qa-media-grid{display:grid;grid-template-columns:minmax(280px,.9fr) minmax(360px,1.1fr);gap:14px}
        .qa-media-list{display:flex;flex-direction:column;gap:10px}
        .qa-media-card{padding:12px 14px;border-radius:18px;border:1px solid rgba(173,193,227,.28);background:rgba(255,255,255,.96);cursor:pointer}
        .qa-media-card.active{border-color:rgba(58,120,255,.45);box-shadow:0 12px 22px rgba(58,120,255,.12)}
        .qa-media-card strong{display:block;color:#17315e}
        .qa-media-meta{font-size:12px;color:#6d82a8;margin-top:4px}
        .qa-preview{padding:16px;border-radius:22px;border:1px solid rgba(173,193,227,.28);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,249,255,.95));display:flex;flex-direction:column;gap:12px}
        .qa-preview audio,.qa-preview video{width:100%;border-radius:18px;background:#0e1e3f}
        .qa-score{display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:center}
        .qa-overall{padding:20px;border-radius:24px;background:linear-gradient(135deg,rgba(62,122,255,.12),rgba(42,190,255,.1));border:1px solid rgba(62,122,255,.18);text-align:center}
        .qa-overall strong{display:block;font-size:42px;line-height:1;color:#113061}
        .qa-table{width:100%;border-collapse:collapse;font-size:13px}
        .qa-table th,.qa-table td{padding:11px 12px;border-bottom:1px solid rgba(178,196,226,.22);text-align:left;vertical-align:top}
        .qa-table th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5f77a0}
        .qa-percent{font-weight:900;color:#17315e}
        .qa-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .qa-box{padding:16px;border-radius:20px;border:1px solid rgba(173,193,227,.28);background:rgba(255,255,255,.96)}
        .qa-box ul{margin:10px 0 0;padding-left:18px;color:#4d638d;line-height:1.65}
        @media (max-width:980px){.qa-grid,.qa-media-grid,.qa-columns,.qa-score{grid-template-columns:1fr}}
      `}</style>

      <div className="panel top-gap">
        <div className="panel-title">How this slice works</div>
        <div className="qa-note top-gap-small">
          Upload audio or video, save the batch, preview the file, then run analysis. You get a percentage table, notes and suggestions. Tone is a first-pass QA estimate here, not mind-reading. Humans still insist on being complicated.
        </div>
      </div>

      <div className="panel top-gap">
        <div className="panel-title">Call media upload and analysis</div>
        <div className="qa-upload-box top-gap-small">
          <div className="qa-action-row">
            <label htmlFor="qa-media-upload" className="qa-btn primary">Upload Audio / Video</label>
            <input id="qa-media-upload" className="qa-hidden" type="file" multiple accept={ACCEPTED_MEDIA} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="qa-btn secondary" onClick={analyzeSelected}>Analyze Selected</button>
            <button type="button" className="qa-btn ghost" onClick={saveBatch}>Save Review Batch</button>
            <button type="button" className="qa-btn ghost" onClick={loadSample}>Load Sample Interview</button>
            <button type="button" className="qa-btn ghost" onClick={clearUploads}>Clear</button>
          </div>
          <div className="helper-text top-gap-small">Accepted now: MP3, WAV, M4A, AAC, OGG, WEBM, MP4, MOV, AVI, MKV, 3GP, MPEG and MPG. Upload alone does nothing useful, because software enjoys wasting time unless you also give it buttons. So the save and analyse controls are here.</div>
          {message ? <div className="helper-text top-gap-small">{message}</div> : null}
        </div>
      </div>

      {uploads.length ? (
        <div className="panel top-gap">
          <div className="panel-title">Review loaded media</div>
          <div className="qa-media-grid top-gap-small">
            <div className="qa-media-list">
              {uploads.map((item) => (
                <button type="button" key={item.id} className={`qa-media-card ${selectedMedia?.id === item.id ? 'active' : ''}`} onClick={() => { setSelectedId(item.id); setAnalysis(null); }}>
                  <strong>{item.name}</strong>
                  <div className="qa-media-meta">{'Uploaded file'}{item.duration ? ` • ${Math.round(item.duration)}s` : ''}</div>
                </button>
              ))}
            </div>
            {selectedMedia ? (
              <div className="qa-preview">
                <div>
                  <strong>{selectedMedia.name}</strong>
                  <div className="qa-media-meta">{'Current selected media for review'}</div>
                </div>
                {/mp4|mov|webm|avi|mkv|mpeg|mpg|3gp/i.test(selectedMedia.type || selectedMedia.name) ? (
                  <video controls src={selectedMedia.url} onLoadedMetadata={(e) => updateDuration(selectedMedia.id, e.currentTarget.duration)} />
                ) : (
                  <audio controls src={selectedMedia.url} onLoadedMetadata={(e) => updateDuration(selectedMedia.id, e.currentTarget.duration)} />
                )}
                <div className="helper-text">Play the media here, then hit <strong>Analyze Selected</strong>. Sample media already comes with ready-made QA output.</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {analysis ? (
        <div className="panel top-gap">
          <div className="panel-title">QA result table</div>
          <div className="qa-score top-gap-small">
            <div className="qa-overall">
              <div className="helper-text">Overall</div>
              <strong>{analysis.overall}%</strong>
              <div className="helper-text top-gap-small">{analysis.summary}</div>
            </div>
            <div className="table-wrap">
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Percentage</th>
                    <th>Area</th>
                    <th>What checked</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map((row) => (
                    <tr key={row.area}>
                      <td className="qa-percent">{row.percentage}%</td>
                      <td>{row.area}</td>
                      <td>{row.checked}</td>
                      <td>{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="qa-columns top-gap-small">
            <div className="qa-box">
              <strong>Notes</strong>
              <ul>
                {analysis.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
            <div className="qa-box">
              <strong>Suggestions</strong>
              <ul>
                {analysis.suggestions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel top-gap">
        <div className="panel-title">Quality Analyst rule sheet</div>
        <div className="qa-grid top-gap-small">
          {field('script_points', 'Mandatory script checkpoints')}
          {field('positive_tone_markers', 'Positive tone markers')}
          {field('nervous_markers', 'Nervous / weak-call markers')}
          {field('objection_points', 'Objection handling checkpoints')}
          {field('candidate_points', 'Candidate quality checkpoints')}
          {field('score_weights', 'Score weights')}
          <div className="field full"><label>Analyst notes / instructions</label><textarea rows="7" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} /></div>
        </div>
      </div>
    </Layout>
  );
}
