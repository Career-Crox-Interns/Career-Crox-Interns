import {useEffect} from 'react';
import {useAuth} from '../lib/auth';
import {api} from '../lib/api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from '../lib/tabLeader';
import {retryCandidateSubmits} from '../lib/candidateSubmitOutbox';
// Does not require recruiters to remain on the candidate screen after a timeout.
// If the browser is fully closed, attempts resume when that employee signs in again.
export default function CandidateSubmitOutboxWorker(){
  const {user}=useAuth();
  const actor=String(user?.user_id||'').trim();
  useEffect(()=>{
    if(!actor)return undefined;
    let active=true,running=false;
    const retry=async()=>{if(!active||running||document.hidden||!getPollingLeaderSnapshot().isLeader)return;running=true;try{await retryCandidateSubmits(actor,api);}finally{running=false;}};
    const unlead=subscribePollingLeader(()=>{void retry();});
    void retry();
    const handleOnline=()=>{void retry();};
    window.addEventListener('online',handleOnline);
    const id=window.setInterval(retry,30000);
    return ()=>{active=false;unlead();window.clearInterval(id);window.removeEventListener('online',handleOnline)};
  },[actor]);
  return null;
}
