import React, {useCallback, useEffect, useState} from 'react';
import {api} from './apiClient';

export default function NotificationBell({onOpenApprovals,canReviewRequests=false}) {
  const [items,setItems]=useState([]);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    try { const result=await api.get('/prep-bays/notifications'); setItems(result.data||[]);setError(''); }
    catch(e){setError('Unable to load notifications');}
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[refresh]);
  const dismiss=async id=>{try{await api.post(`/prep-bays/notifications/${id}/read`);setItems(v=>v.filter(n=>n.id!==id));}catch(e){setError('Unable to dismiss notification');}};
  return <div className="relative shrink-0">
    <button type="button" aria-label={`Notifications, ${items.length} unread`} aria-expanded={open} onClick={()=>{setOpen(v=>!v);refresh();}} className="border border-border rounded px-3 py-2 text-sm">🔔 {items.length>0&&<span className="ml-1 rounded-full bg-[#D11047] px-2 text-white">{items.length}</span>}</button>
    {open&&<div className="absolute right-0 top-full mt-2 z-50 w-[min(90vw,370px)] max-h-96 overflow-auto rounded-xl border border-border bg-card shadow-xl p-3 space-y-2">
      <div className="flex justify-between items-center"><strong>Notifications</strong><button onClick={()=>setOpen(false)} className="text-sm underline">Close</button></div>
      {error&&<p role="alert" className="text-red-400 text-xs">{error}</p>}
      {items.length===0&&<p className="text-sm text-muted-foreground">No unread notifications.</p>}
      {items.map(n=><div key={n.id} className="border border-border rounded p-2 text-sm space-y-2"><p>{n.message}</p><div className="flex justify-between gap-2">{canReviewRequests&&<button onClick={()=>{setOpen(false);onOpenApprovals?.();}} className="text-[#D11047] underline">View requests</button>}<button onClick={()=>dismiss(n.id)} className="underline">Dismiss</button></div></div>)}
    </div>}
  </div>;
}
