import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
export default function DisabledSlicesPage(){return <Layout title="Workspace Tools"><div className="cc787-tools-hub">{[['Data Extractor','/data-extractor','Preview files or text, edit rows, then import selected drafts.'],['Quality Analyst','/quality-analyst','Review audited calls, talk time, ring time and quality flags.'],['HR Head','/hr-head','Manage the employee directory and generate HR documents.']].map(([title,path,copy])=><section className="panel" key={path}><h2 className="panel-title">{title}</h2><p>{copy}</p><Link className="add-profile-btn" to={path}>Open {title}</Link></section>)}</div></Layout>;}
