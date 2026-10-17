import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {SearchCandidateRow} from '../components/HeaderSearch';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';

function normalizeIndianPhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [data, setData] = useState({ candidates: [], tasks: [], jds: [], search_mode: 'general' });

  useEffect(() => {
    let active=true;setData({candidates:[],tasks:[],jds:[]});
    api.get(`/api/search?q=${encodeURIComponent(q)}`).then(d=>{if(active)setData(d)}).catch(()=>{if(active)setData({candidates:[],tasks:[],jds:[]})});return()=>{active=false};
  }, [q]);

  const trimmedQ = String(q || '').trim();
  const compactQ = trimmedQ.replace(/\s+/g, '');
  const normalizedPhone = normalizeIndianPhone(trimmedQ);
  const looksStrictCandidateSearch = useMemo(() => /^[a-z]{0,4}\d+$/i.test(compactQ) || normalizedPhone.length >= 7, [compactQ, normalizedPhone]);
  const strictMode = looksStrictCandidateSearch || data.search_mode === 'candidate_exact';
  const candidateCount = Array.isArray(data.candidates) ? data.candidates.length : 0;
  const candidateLabel = candidateCount === 1 ? '1 matching profile' : `${candidateCount} matching profiles`;
  const candidateNote = strictMode ? 'Candidate ID, phone number, name, and bucket-out profiles are all included in this result view.' : 'Top search results stay visible here, and each candidate result opens the profile directly.';

  return (
    <Layout title="Search Results" subtitle="">
      <div className="panel" style={{ marginBottom: 14, border: strictMode ? '1px solid rgba(20,170,90,0.22)' : undefined, background: strictMode ? 'linear-gradient(135deg, rgba(28,187,89,0.14), rgba(8,133,58,0.06))' : undefined }}>
        <div className="panel-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{strictMode ? 'Relevant Candidate Match' : 'Search Overview'}</span>
          <span className="mini-chip live-chip" style={strictMode ? { background: 'linear-gradient(135deg, #2ecb70, #16914c)', color: '#fff', border: 'none' } : undefined}>{strictMode ? candidateLabel : `${candidateCount} candidate results`}</span>
        </div>
        <div className="helper-text">
          {candidateNote}
        </div>
      </div>

      <div className="small-grid three top-gap">
        <div className="panel" style={strictMode ? { gridColumn: '1 / -1' } : undefined}>
          <div className="panel-title">Candidates</div>
          <div className="activity-list">
            {candidateCount ? data.candidates.map((x) => (
              <SearchCandidateRow key={x.candidate_id} row={x} rows={data.candidates||[]}/>
            )) : <div className="helper-text">No candidate found for this search.</div>}
          </div>
        </div>

        {!strictMode && Array.isArray(data.tasks) && data.tasks.length ? (
          <div className="panel">
            <div className="panel-title">Tasks</div>
            <div className="activity-list">
              {data.tasks.map((x) => (
                <div key={x.task_id} className="activity-item">
                  <div className="activity-left">
                    <div className="activity-name">{x.title}</div>
                    <div className="activity-sub">{x.assigned_to_name} • {x.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!strictMode && Array.isArray(data.jds) && data.jds.length ? (
          <div className="panel">
            <div className="panel-title">JDs</div>
            <div className="activity-list">
              {data.jds.map((x) => (
                <div key={x.jd_id} className="activity-item">
                  <div className="activity-left">
                    <div className="activity-name">{x.job_title}</div>
                    <div className="activity-sub">{x.company} • {x.location}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
