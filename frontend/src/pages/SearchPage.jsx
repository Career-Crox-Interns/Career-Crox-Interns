import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [data, setData] = useState({ candidates: [], tasks: [], jds: [] });
  useEffect(() => { api.get(`/api/search?q=${encodeURIComponent(q)}`).then(setData); }, [q]);
  return (
    <Layout title="Search Results" subtitle="Global search across candidate, task, and JD data.">
      <div className="small-grid three top-gap"><div className="panel"><div className="panel-title">Candidates</div><div className="activity-list">{data.candidates.map((x) => <Link key={x.candidate_id} className="activity-item" to={`/candidate/${x.candidate_id}`}><div className="activity-left"><div className="activity-name">{x.full_name}</div><div className="activity-sub">{x.phone} • {x.process}</div></div></Link>)}</div></div><div className="panel"><div className="panel-title">Tasks</div><div className="activity-list">{data.tasks.map((x) => <div key={x.task_id} className="activity-item"><div className="activity-left"><div className="activity-name">{x.title}</div><div className="activity-sub">{x.assigned_to_name} • {x.status}</div></div></div>)}</div></div><div className="panel"><div className="panel-title">JDs</div><div className="activity-list">{data.jds.map((x) => <div key={x.jd_id} className="activity-item"><div className="activity-left"><div className="activity-name">{x.job_title}</div><div className="activity-sub">{x.company} • {x.location}</div></div></div>)}</div></div></div>
    </Layout>
  );
}
