import React, {useEffect, useState} from 'react';
import {api, formatErr} from './apiClient';
import {useAuth} from './AuthContext';
import {invalidateCalendarCache} from './PrepBayCalendar';
import {toast} from 'sonner';
import {ArrowLeft, CalendarBlank, PencilSimple, X} from '@phosphor-icons/react';

// Format API ISO dates without timezone conversion (UK day/month/year).
const ukDate = (value) => {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
};

const BAYS=['Prep Bay 0','Prep Bay 1','Prep Bay 2','Prep Bay 3','Prep Bay 4 (Small GS)','Prep Bay 5 (Small GS)','Prep Bay 6','Prep Bay 7','Prep Bay 8','Prep Bay 9','Prep Bay 10 (Large GS)','Prep Bay 11','The Bridge'];
const DEPTS=['Lighting','Video','Rigging','Automation'];
const input='w-full rounded-lg border border-border bg-secondary p-3 text-sm min-h-11';
const primary='rounded-lg bg-[#D11047] text-white font-semibold px-4 py-3 disabled:opacity-50';
const secondary='rounded-lg border border-border bg-secondary px-4 py-3 text-sm';
const errorText=e=>formatErr(e?.response?.data?.detail)||e.message||'Unable to save changes';

export default function JobDetails({jobId,onBack}){
  const {user}=useAuth();
  const [details,setDetails]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[editing,setEditing]=useState(null);
  const direct=['operations_manager','admin'].includes(user?.role);
  async function refresh(){
    try{const {data}=await api.get(`/jobs/${jobId}/details`);setDetails(data);setError('');}
    catch(e){setError(errorText(e));}finally{setLoading(false)}
  }
  useEffect(()=>{setLoading(true);setDetails(null);refresh()},[jobId]);
  const [deleting,setDeleting]=useState(false);
  async function deleteLinkedJob(){
    if(user?.role!=='admin'||!details?.bookings?.length||deleting)return;
    const job=details.bookings[0];
    const count=details.bookings.length;
    if(!window.confirm(`Permanently delete ${job.name} (WinHits ${job.winhits_number}) and all ${count} linked bay booking${count===1?'':'s'}?\n\nAll allocated bays will be released. This cannot be undone.`))return;
    setDeleting(true);
    try{
      await api.delete(`/admin/jobs/${job.id}/group`);
      invalidateCalendarCache();
      toast.success('Job and linked bookings deleted');
      onBack();
    }catch(e){toast.error(errorText(e));setDeleting(false);}
  }
  const canEdit=direct||details?.can_pm_edit;
  const first=details?.bookings?.[0];
  return <div className="max-w-6xl mx-auto space-y-5 min-w-0">
    <button className="inline-flex items-center gap-2 text-sm border border-border bg-secondary rounded-lg px-4 py-2" onClick={onBack}><ArrowLeft size={18}/> Back to calendar</button>
    {loading&&<div className="text-muted-foreground">Loading job details…</div>}
    {error&&<div role="alert" className="border border-red-800 bg-red-900/20 rounded-lg p-4 text-red-300">{error}<button className="ml-3 underline" onClick={refresh}>Retry</button></div>}
    {details&&first&&<>
      <section className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-3">
        <div className="text-xs uppercase tracking-widest font-bold text-[#D11047]">PRG UK · Job details</div>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="font-black text-2xl sm:text-3xl break-words">{first.name}</h1><div className="text-muted-foreground mt-1">WinHits: <span className="font-mono">{first.winhits_number}</span></div></div>
        <div className="flex flex-wrap gap-2">{canEdit&&<button className={secondary} onClick={()=>setEditing({mode:'metadata',booking:first})}><PencilSimple size={16} className="inline mr-1"/>Edit job details</button>}{user?.role==='admin'&&<button type="button" disabled={deleting} onClick={deleteLinkedJob} className="rounded-lg border border-red-700 text-red-300 px-4 py-3 text-sm disabled:opacity-50">{deleting?'Deleting…':'Delete job'}</button>}</div></div>
        <div className="text-sm text-muted-foreground">All confirmed bay bookings with this WinHits number are shown below, including other departments and dates.</div>
      </section>
      <section className="space-y-3"><h2 className="font-black text-xl">Prep bay allocations <span className="text-muted-foreground text-base">({details.bookings.length})</span></h2>
        {details.bookings.map((b,i)=><article key={b.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap justify-between gap-3 items-start"><div><h3 className="font-bold">Booking {i+1}</h3><div className="text-sm text-muted-foreground mt-1">{ukDate(b.prep_date)} → {ukDate(b.ship_date)}</div></div>
          {canEdit&&<button className={secondary} onClick={()=>setEditing({mode:'allocation',booking:b})}>{direct?'Edit dates & bays':'Request date/bay changes'}</button>}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{(b.prep_bays||[]).map(bay=><div key={bay} className="rounded-lg border border-border bg-secondary p-3"><div className="font-semibold text-sm">{bay}</div><div className="text-xs text-muted-foreground mt-1">{b.bay_departments?.[bay]||'No department assigned'}</div></div>)}</div>
          {b.notes&&<div className="text-sm border-t border-border pt-3"><span className="font-semibold">Notes:</span> <span className="whitespace-pre-wrap">{b.notes}</span></div>}
        </article>)}
      </section>
      {details.requests?.length>0&&<section className="space-y-3"><h2 className="font-black text-xl">Approval history and requests</h2>{details.requests.map(r=><div key={r.id} className="bg-card border border-border rounded-xl p-4 text-sm space-y-2"><div className="flex justify-between gap-2"><span className="font-semibold capitalize">{r.status}</span><span className="text-muted-foreground">{ukDate(r.created_at)}</span></div><div>Proposed: {ukDate(r.prep_date)} → {ukDate(r.ship_date)}</div><div>{(r.bays||[]).map(b=>typeof b==='string'?b:b.bay).join(', ')}</div>{r.notes&&<div className="text-muted-foreground whitespace-pre-wrap">Notes: {r.notes}</div>}{r.rejection_reason&&<div className="text-red-300">Rejection reason: {r.rejection_reason}</div>}</div>)}</section>}
    </>}
    {editing&&<EditJobModal key={`${editing.mode}-${editing.booking.id}`} {...editing} group={details} direct={direct} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);refresh();}}/>}
  </div>;
}

function EditJobModal({mode,booking,group,direct,onClose,onSaved}){
  const [name,setName]=useState(booking.name||''),[winhits,setWinhits]=useState(booking.winhits_number||''),[notes,setNotes]=useState(booking.notes||'');
  const [prep,setPrep]=useState(booking.prep_date||''),[ship,setShip]=useState(booking.ship_date||'');
  const [selected,setSelected]=useState(()=>Object.fromEntries((booking.prep_bays||[]).map(b=>[b,booking.bay_departments?.[b]||''])));
  const [availability,setAvailability]=useState([]),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const isAllocation=mode==='allocation';
  useEffect(()=>{
    if(!isAllocation||!prep||!ship||ship<prep){setAvailability([]);return;}
    let active=true;setChecking(true);setCheckError('');
    api.get('/prep-bays/availability',{params:{prep_date:prep,ship_date:ship,exclude_job_id:booking.id}})
      .then(({data})=>{if(!active)return;setAvailability(data);setSelected(old=>Object.fromEntries(Object.entries(old).filter(([bay])=>data.find(x=>x.bay===bay)?.available)));})
      .catch(e=>{if(active){setAvailability([]);setCheckError(errorText(e));}})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false};
  },[prep,ship,booking.id,isAllocation]);
  const ready=isAllocation&&prep&&ship&&ship>=prep&&!checking&&!checkError&&availability.length===BAYS.length;
  async function submit(e){e.preventDefault();setError('');
    if(isAllocation&&(!ready||Object.keys(selected).length===0)){setError('Select valid dates and at least one available bay');return;}
    setBusy(true);
    try{
      if(mode==='metadata'){
        await api.patch(`/jobs/${booking.id}/details`,{name:name.trim(),winhits_number:winhits.trim(),notes});
        toast.success('Job details updated — no approval required');
      }else{
        const payload={name:booking.name,winhits_number:booking.winhits_number,notes,prep_date:prep,ship_date:ship,
          bays:Object.entries(selected).map(([bay,department])=>({bay,department:department||null}))};
        if(direct){await api.patch(`/prep-bays/booking/${booking.id}`,payload);toast.success('Booking updated');}
        else{await api.post(`/jobs/${booking.id}/change-request`,payload);toast.success('Change request submitted for approval. Existing booking remains confirmed.');}
      }
      invalidateCalendarCache();
      onSaved();
    }catch(err){setError(errorText(err));}finally{setBusy(false)}
  }
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={mode==='metadata'?'Edit job details':'Edit bay allocation'}>
    <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex justify-between items-center gap-3"><div><h2 className="font-black text-xl">{mode==='metadata'?'Edit job details':direct?'Edit confirmed booking':'Request bay/date changes'}</h2><p className="text-muted-foreground text-xs mt-1">{mode==='metadata'?'Updates immediately without approval. Name and WinHits apply to all linked bookings.':direct?'Changes save immediately and must not overlap another booking.':'Existing confirmed bays remain reserved until Operations approves.'}</p></div><button type="button" onClick={onClose} className="p-2" aria-label="Close"><X size={20}/></button></div>
      {mode==='metadata'?<div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Job name<input required maxLength={200} className={`${input} mt-1`} value={name} onChange={e=>setName(e.target.value)}/></label><label className="text-sm">WinHits number<input required maxLength={100} className={`${input} mt-1`} value={winhits} onChange={e=>setWinhits(e.target.value)}/></label></div>:<>
        <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Prep date<input required type="date" lang="en-GB" className={`${input} mt-1`} value={prep} onChange={e=>setPrep(e.target.value)}/></label><label className="text-sm">Ship date<input required type="date" lang="en-GB" min={prep} className={`${input} mt-1`} value={ship} onChange={e=>setShip(e.target.value)}/></label></div>
        {(!prep||!ship||ship<prep)?<p className="text-sm text-muted-foreground">Enter valid dates before selecting bays.</p>:checking?<p className="text-sm text-muted-foreground">Checking bay availability…</p>:checkError?<p role="alert" className="text-red-400 text-sm">{checkError}</p>:<div className="grid sm:grid-cols-2 gap-2">{BAYS.map(bay=>{const info=availability.find(x=>x.bay===bay);const blocked=!info?.available;return <div key={bay} className={`border border-border rounded-lg p-3 ${blocked?'opacity-50':''}`}><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={blocked||busy} checked={!!selected[bay]||Object.hasOwn(selected,bay)} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[bay]=old[bay]||'';else delete next[bay];return next})}/><span className="font-semibold">{bay}</span></label>{blocked?<p className="text-xs text-red-300 mt-1">Unavailable: {info?.conflicts?.map(c=>c.job_name).join(', ')||'Booked'}</p>:Object.hasOwn(selected,bay)&&<select aria-label={`Department for ${bay}`} className={`${input} mt-2`} value={selected[bay]} onChange={e=>setSelected(old=>({...old,[bay]:e.target.value}))}><option value="">No department</option>{DEPTS.map(d=><option key={d}>{d}</option>)}</select>}</div>})}</div>}
      </>}
      <label className="block text-sm">Notes (optional)<textarea maxLength={3000} rows={3} className={`${input} mt-1`} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      {error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy||(isAllocation&&!ready)} className={primary}>{busy?'Saving…':mode==='metadata'?'Save job details':direct?'Save booking changes':'Submit for approval'}</button><button type="button" onClick={onClose} className={secondary}>Cancel</button></div>
    </form>
  </div>;
}
