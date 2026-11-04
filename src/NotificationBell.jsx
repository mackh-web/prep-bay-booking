import React, {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api} from './apiClient';

export default function NotificationBell({onOpenApprovals,canReviewRequests=false}) {
 const [items,setItems]=useState([]);
 const [open,setOpen]=useState(false);
 const [error,setError]=useState('');
 const closeRef=useRef(null);
 const refresh=useCallback(async()=>{try{const r=await api.get('/prep-bays/notifications');setItems(Array.isArray(r.data)?r.data:[]);setError('')}catch{setError('Unable to load notifications')}},[]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh)}},[refresh]);
 useEffect(()=>{if(!open)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';const onKey=e=>{if(e.key==='Escape')setOpen(false)};window.addEventListener('keydown',onKey);closeRef.current?.focus();return()=>{document.body.style.overflow=old;window.removeEventListener('keydown',onKey)}},[open]);
 async function dismiss(id){try{await api.post(`/prep-bays/notifications/${id}/read`);setItems(old=>old.filter(n=>n.id!==id))}catch{setError('Unable to dismiss notification')}}
 return <>
  <button type="button" aria-label={`Notifications, ${items.length} unread`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(true);refresh()}} className="min-h-11 min-w-11 border border-border rounded-lg px-3 py-2 text-sm whitespace-nowrap">🔔 {items.length>0&&<span className="ml-1 rounded-full bg-[#D11047] px-2 py-0.5 text-white">{items.length}</span>}</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-6" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}>
    <section role="dialog" aria-modal="true" aria-labelledby="notifications-title" className="w-full max-w-lg min-w-0 max-h-[calc(100dvh-1.5rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 shrink-0">
        <h2 id="notifications-title" className="text-lg font-bold">Notifications ({items.length})</h2>
        <button ref={closeRef} type="button" onClick={()=>setOpen(false)} className="min-h-11 px-3 border border-border rounded-lg text-sm shrink-0">Close</button>
      </div>
      <div className="overflow-y-auto overscroll-contain p-4 space-y-3 min-w-0">
        {error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}
        {items.length===0&&<p className="text-sm text-muted-foreground">No unread notifications.</p>}
        {items.map(n=><article key={n.id} className="border border-border rounded-lg p-3 space-y-3 min-w-0">
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{n.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            {canReviewRequests&&<button type="button" onClick={()=>{setOpen(false);onOpenApprovals?.()}} className="min-h-10 rounded-lg border border-border px-3 text-sm">View requests</button>}
            <button type="button" onClick={()=>dismiss(n.id)} className="min-h-10 rounded-lg border border-border px-3 text-sm text-[#D11047]">Dismiss</button>
          </div>
        </article>)}
      </div>
    </section>
  </div>,document.body)}
 </>;
}
