import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {api, formatErr} from './apiClient';
import {useAuth} from './AuthContext';
import {invalidateCalendarCache} from './PrepBayCalendar';
import {toast} from 'sonner';

const ukDate = value => {const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'—';};
const errorText = e => formatErr(e?.response?.data?.detail) || e?.message || 'Request failed';
const label = value => String(value||'').replaceAll('_',' ');

// The database purges approved archived requests daily at 03:00 UTC,
// on the first scheduled run after the 30-day retention period expires.
const DAY_MS = 24 * 60 * 60 * 1000;
function archiveDeletionInfo(archivedAt, nowMs) {
  if (!archivedAt) return null;
  const archivedMs = Date.parse(archivedAt);
  if (!Number.isFinite(archivedMs)) return null;
  const eligibleMs = archivedMs + 30 * DAY_MS;
  const run = new Date(eligibleMs);
  run.setUTCHours(3, 0, 0, 0);
  if (run.getTime() < eligibleMs) run.setUTCDate(run.getUTCDate() + 1);
  const days = Math.max(0, Math.ceil((run.getTime() - nowMs) / DAY_MS));
  const deletionDate = new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC'}).format(run);
  return {days, deletionDate, due:run.getTime() <= nowMs};
}


export default function ApprovalsPage({onBack}) {
  const {user}=useAuth();
  const authorised=['operations_manager','admin'].includes(user?.role);
  const [requests,setRequests]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState('');
  const [filter,setFilter]=useState('pending');
  const [nowMs,setNowMs]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNowMs(Date.now()),60000);return ()=>clearInterval(timer);},[]);
  const load=useCallback(async()=>{
    setError('');
    try {const response=await api.get('/prep-bays/requests');setRequests(Array.isArray(response.data)?response.data:[]);}
    catch(e){setError(errorText(e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{if(authorised)load();else setLoading(false);},[authorised,load]);
  const counts=useMemo(()=>({pending:requests.filter(r=>r.status==='pending').length,approved:requests.filter(r=>r.status==='approved'&&!r.archived_at).length,archived:requests.filter(r=>!!r.archived_at).length,rejected:requests.filter(r=>r.status==='rejected').length}),[requests]);
  const visible=useMemo(()=>requests.filter(r=>filter==='archived'?!!r.archived_at:!r.archived_at&&(filter==='all'||r.status===filter)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))),[requests,filter]);
  async function decide(request,decision){
    if(busyId)return;
    let rejection_reason=null;
    if(decision==='rejected'){
      rejection_reason=window.prompt(`Reason for rejecting ${request.name || request.winhits_number} (required):`);
      if(rejection_reason===null)return;
      rejection_reason=rejection_reason.trim();
      if(!rejection_reason){setError('A rejection reason is required.');return;}
    }else if(!window.confirm(`Approve prep bay request for ${request.name || request.winhits_number}?`))return;
    setBusyId(request.id);setError('');
    try{
      await api.post(`/prep-bays/requests/${request.id}/decision`,{decision,rejection_reason});
      invalidateCalendarCache();
      toast.success(decision==='approved'?'Request approved':'Request rejected');
      await load();
    }catch(e){setError(errorText(e));}
    finally{setBusyId(null);}
  }
  async function setArchive(request, archive){
    if(busyId)return;
    if(archive&&!window.confirm(`Archive approved request for ${request.name || request.winhits_number}? This keeps the booking and approval history.`))return;
    setBusyId(request.id);setError('');
    try{
      await api.post(`/prep-bays/requests/${request.id}/${archive?'archive':'restore'}`);
      toast.success(archive?'Request archived':'Request restored');
      await load();
    }catch(e){setError(errorText(e));}
    finally{setBusyId(null);}
  }
  if(!authorised)return <main className="max-w-5xl mx-auto space-y-4"><button onClick={onBack} className="border border-border rounded px-4 py-2">← Back to calendar</button><p role="alert">You do not have permission to review approvals.</p></main>;
  return <main className="max-w-5xl mx-auto min-w-0 space-y-5">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><div className="text-[10px] uppercase tracking-[.3em] text-muted-foreground mb-1">Operations</div><h1 className="text-2xl sm:text-3xl font-black">Approvals & Requests</h1><p className="text-sm text-muted-foreground mt-1">Review and decide prep bay requests. Pending requests do not reserve bays.</p></div>
      <div className="flex gap-2"><button type="button" onClick={load} disabled={!!busyId||loading} className="border border-border rounded px-4 py-2 text-sm disabled:opacity-50">Refresh</button><button type="button" onClick={onBack} className="border border-border rounded px-4 py-2 text-sm">Back to calendar</button></div>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter requests">
      {[['pending',`Pending (${counts.pending})`],['approved',`Approved (${counts.approved})`],['rejected',`Rejected (${counts.rejected})`],['archived',`Archived (${counts.archived})`],['all',`All (${requests.length})`]].map(([key,text])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)} className={`rounded px-4 py-2 text-sm border ${filter===key?'bg-[#D11047] text-white border-[#D11047]':'bg-secondary border-border'}`}>{text}</button>)}
    </div>
    {error&&<div role="alert" className="border border-red-700 bg-red-950/30 rounded p-3 text-sm text-red-300">{error}</div>}
    {loading?<p className="text-muted-foreground">Loading requests…</p>:visible.length===0?<div className="border border-border rounded-xl p-6 text-sm text-muted-foreground">No {filter==='all'?'':filter} requests to display.</div>:<div className="space-y-3">{visible.map(r=><article key={r.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-2"><div className="min-w-0"><h2 className="font-bold text-lg break-words">{r.name||'Unnamed job'}</h2><p className="text-sm text-muted-foreground">WinHits: {r.winhits_number||'—'}</p></div><span className="capitalize border border-border rounded px-3 py-1 text-xs">{label(r.status)}</span></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-muted-foreground">Requested dates</div><div>{ukDate(r.prep_date)} → {ukDate(r.ship_date)}</div></div><div><div className="text-xs text-muted-foreground">Requested bays / departments</div><div>{Array.isArray(r.bays)&&r.bays.length?r.bays.map(b=>typeof b==='string'?b:`${b.bay}${b.department?' ('+b.department+')':''}`).join(', '):'—'}</div></div></div>
      {r.archived_at&&(()=>{const info=archiveDeletionInfo(r.archived_at,nowMs);return <div className="rounded-lg border border-border bg-secondary p-3 text-sm" role="status">{info?<><div className="font-semibold">{info.due?'Scheduled for deletion':`${info.days} ${info.days===1?'day':'days'} until automatic deletion`}</div><div className="text-xs text-muted-foreground mt-1">Scheduled cleanup: {info.deletionDate} at 03:00 UTC · Approved request history only; the calendar booking remains.</div></>:<div className="text-muted-foreground">Deletion countdown unavailable: missing archive date.</div>}</div>;})()}
      {r.notes&&<div className="rounded bg-secondary p-3 text-sm whitespace-pre-wrap"><span className="text-muted-foreground">Project Manager notes: </span>{r.notes}</div>}
      {r.rejection_reason&&<div className="rounded border border-red-800/60 p-3 text-sm text-red-300 whitespace-pre-wrap">Rejection reason: {r.rejection_reason}</div>}
      {r.status==='approved'&&<div className="flex flex-wrap gap-2 pt-1"><button type="button" disabled={!!busyId} onClick={()=>setArchive(r,!r.archived_at)} className="border border-border rounded px-4 py-2 text-sm disabled:opacity-50">{busyId===r.id?'Processing…':r.archived_at?'Restore request':'Archive request'}</button></div>}
      {r.status==='pending'&&<div className="flex flex-wrap gap-2 pt-1"><button type="button" disabled={!!busyId} onClick={()=>decide(r,'approved')} className="bg-[#D11047] text-white rounded px-4 py-2 text-sm font-semibold disabled:opacity-50">{busyId===r.id?'Processing…':'Approve'}</button><button type="button" disabled={!!busyId} onClick={()=>decide(r,'rejected')} className="border border-border rounded px-4 py-2 text-sm disabled:opacity-50">Reject</button></div>}
    </article>)}</div>}
  </main>;
}