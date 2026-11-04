import React, {useEffect, useState} from 'react';
import {api} from './apiClient';

const decodeKey = (value) => {
  const base64 = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
};
export default function PushSettings() {
  const [status, setStatus] = useState('Checking…');
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
      if (!ok) { if (alive) setStatus('Not supported in this browser. On iPhone/iPad, install the app to your Home Screen.'); return; }
      try {
        const config = (await api.get('/push/config')).data;
        if (!config.enabled) { if (alive) setStatus('Push notifications are not configured on the server yet.'); return; }
        const reg = await navigator.serviceWorker.register('/push-sw.js', {scope:'/'});
        const sub = await reg.pushManager.getSubscription();
        if (alive) { setKey(config.publicKey); setSupported(true); setEnabled(!!sub); setStatus(sub ? 'Enabled on this device' : 'Disabled on this device'); }
      } catch (err) { if (alive) setStatus(err.response?.data?.detail || err.message || 'Unable to check push notifications'); }
    })();
    return () => {alive=false};
  }, []);
  async function toggle() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register('/push-sw.js', {scope:'/'});
      if (enabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.delete('/push/subscriptions', {data: sub.toJSON()});
          await sub.unsubscribe();
        }
        setEnabled(false); setStatus('Disabled on this device');
      } else {
        if (Notification.permission === 'denied') throw new Error('Notifications are blocked in browser settings.');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission was not granted.');
        const sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:decodeKey(key)});
        try { await api.post('/push/subscriptions', sub.toJSON()); }
        catch (err) {await sub.unsubscribe(); throw err;}
        setEnabled(true); setStatus('Enabled on this device');
      }
    } catch (err) {setStatus(err.response?.data?.detail || err.message || 'Unable to update notifications');}
    finally {setBusy(false);}
  }
  return <div className="rounded-xl border border-border bg-card p-5 space-y-3 max-w-xl">
    <h2 className="text-lg font-bold">Device push notifications</h2>
    <p className="text-sm text-muted-foreground">Receive booking request and approval alerts when the calendar is closed. Enable separately on each device.</p>
    <p role="status" className="text-sm">{status}</p>
    <button disabled={!supported || busy} onClick={toggle} className="rounded bg-[#D11047] px-4 py-2 text-white font-semibold disabled:opacity-50">{busy?'Updating…':enabled?'Disable on this device':'Enable on this device'}</button>
    <p className="text-xs text-muted-foreground">iOS/iPadOS: open the installed Home Screen app. Desktop and Android: allow notifications in your browser.</p>
  </div>;
}
