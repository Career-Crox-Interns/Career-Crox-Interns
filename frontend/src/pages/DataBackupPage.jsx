import React from 'react';
import Layout from '../components/Layout';
import FullExcelBackupPanel from '../components/FullExcelBackupPanel';
import {useAuth} from '../lib/auth';
export default function DataBackupPage(){
 const {user}=useAuth();
 if(!['manager','admin'].includes(String(user?.role||'').toLowerCase()))return <Layout title="CRM 2 · Transfer"><div className="table-panel">Manager access is required.</div></Layout>;
 return <Layout title="CRM 2 · Transfer"><FullExcelBackupPanel/></Layout>;
}
