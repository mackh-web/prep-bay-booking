import React, {useState} from 'react';
import {api} from './apiClient';
import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import {AuthProvider,useAuth} from './AuthContext';
import PrepBayCalendar from './PrepBayCalendar';
import ApprovalsPage from './ApprovalsPage';
import PushSettings from './PushSettings';
import NotificationBell from './NotificationBell';
import JobDetails from './JobDetails';
import UserManager from './UserManager';
import './index.css';
// Apply the dark theme to the root element before React renders.
// CSS theme variables are defined on :root and overridden by .dark.
document.documentElement.lang = 'en-GB';
document.documentElement.classList.add('dark');
document.documentElement.style.colorScheme = 'dark';

function ForgotPassword({onBack}){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState('');
 async function submit(e){
  e.preventDefault();setBusy(true);setError('');
  try{await api.post('/auth/password-reset/request',{email});setSent(true)}
  catch(err){setError(err.response?.data?.detail||'Unable to send reset email. Please try again.')}
  finally{setBusy(false)}
 }
 return <main className="min-h-screen flex items-center justify-center bg-background p-4"><div className="w-full max-w-md rounded-xl bg-card border border-border p-6 sm:p-8 space-y-5">
  <div className="text-xs font-bold tracking-[.3em] text-[#D11047]">PRG UK</div>
  <h1 className="text-2xl font-black">Reset your password</h1>
  {sent?<p role="status" className="text-sm">If this email belongs to an active calendar account, a password reset link has been sent. Check your inbox and spam folder.</p>
  :<form onSubmit={submit} className="space-y-4">
   <p className="text-sm text-muted-foreground">Enter the email address for your Prep Bay Calendar account.</p>
   <label className="block text-sm">Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} className="block w-full mt-2 p-3 rounded bg-secondary border border-border"/></label>
   {error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}
   <button disabled={busy} className="w-full bg-[#D11047] text-white font-bold rounded p-3 disabled:opacity-50">{busy?'Sending…':'Send reset link'}</button>
  </form>}
  <button type="button" onClick={onBack} className="text-sm underline">Back to sign in</button>
 </div></main>;
}
function ResetPassword({onDone}){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
 // Supabase recovery links return a short-lived access token in the URL fragment.
 const tokenRef=React.useRef(null);
 React.useEffect(()=>{
  const fragment=new URLSearchParams(window.location.hash.replace(/^#/,''));
  if(fragment.get('type')==='recovery'&&fragment.get('access_token'))tokenRef.current=fragment.get('access_token');
  // Remove sensitive tokens from browser history as soon as captured.
  window.history.replaceState(null,'',window.location.pathname+'?reset=1');
 },[]);
 async function submit(e){
  e.preventDefault();setError('');
  if(password.length<12){setError('Use at least 12 characters.');return}
  if(password!==confirm){setError('Passwords do not match.');return}
  if(!tokenRef.current){setError('This reset link is invalid or expired. Request a new link.');return}
  setBusy(true);
  try{
   await api.post('/auth/password-reset/complete',{access_token:tokenRef.current,new_password:password});
   tokenRef.current=null;setPassword('');setConfirm('');setSuccess(true);
  }catch(err){setError(err.response?.data?.detail||'Unable to reset password. Request a new link.')}
  finally{setBusy(false)}
 }
 return <main className="min-h-screen flex items-center justify-center bg-background p-4"><div className="w-full max-w-md rounded-xl bg-card border border-border p-6 sm:p-8 space-y-5">
  <div className="text-xs font-bold tracking-[.3em] text-[#D11047]">PRG UK</div><h1 className="text-2xl font-black">Choose a new password</h1>
  {success?<p role="status">Your password has been updated. You can now sign in with your new password.</p>:<form onSubmit={submit} className="space-y-4">
   <label className="block text-sm">New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} className="block w-full mt-2 p-3 rounded bg-secondary border border-border"/></label>
   <label className="block text-sm">Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)} className="block w-full mt-2 p-3 rounded bg-secondary border border-border"/></label>
   {error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}
   <button disabled={busy} className="w-full bg-[#D11047] text-white font-bold rounded p-3 disabled:opacity-50">{busy?'Updating…':'Set new password'}</button>
  </form>}
  <button type="button" onClick={onDone} className="text-sm underline">Return to sign in</button>
 </div></main>;
}

function Login(){const {login}=useAuth();const [forgot,setForgot]=useState(false);const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');async function submit(e){e.preventDefault();setBusy(true);setError('');try{await login(email,password)}catch(err){setError(err.response?.data?.detail||'Unable to sign in')}finally{setBusy(false)}}if(forgot)return <ForgotPassword onBack={()=>setForgot(false)}/>;return <main className="min-h-screen flex items-center justify-center bg-background p-4"><form onSubmit={submit} className="w-full max-w-md rounded-xl bg-card border border-border p-8 space-y-5 shadow-xl"><div className="text-xs font-bold tracking-[.3em] text-[#D11047]">PRG UK</div><h1 className="text-3xl font-black">Prep Bay Calendar</h1><p className="text-muted-foreground text-sm">Sign in with your dedicated calendar account.</p><label className="block text-sm">Email<input className="block w-full mt-2 p-3 rounded bg-secondary border border-border" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="block text-sm">Password<input className="block w-full mt-2 p-3 rounded bg-secondary border border-border" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}<button disabled={busy} className="w-full bg-[#D11047] text-white font-bold rounded p-3 disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button><button type="button" onClick={()=>setForgot(true)} className="block mx-auto text-sm underline">Forgot password?</button></form></main>}
function InitialPasswordChange(){
 const {resetSession}=useAuth();
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 async function submit(e){
  e.preventDefault();setError('');
  if(password.length<12){setError('Use at least 12 characters.');return;}
  if(password!==confirm){setError('Passwords do not match.');return;}
  setBusy(true);
  try{await api.post('/auth/change-initial-password',{new_password:password});setDone(true);setPassword('');setConfirm('');}
  catch(err){setError(err.response?.data?.detail||'Unable to update password');}
  finally{setBusy(false);}
 }
 return <main className="min-h-screen flex items-center justify-center bg-background p-4"><div className="w-full max-w-md rounded-xl bg-card border border-border p-8 space-y-5 shadow-xl"><div className="text-xs font-bold tracking-[.3em] text-[#D11047]">PRG UK</div><h1 className="text-2xl font-black">Choose your own password</h1>{done?<><p>Your password has been changed. Sign in again using your new password.</p><button className="w-full bg-[#D11047] text-white font-bold rounded p-3" onClick={resetSession}>Return to sign in</button></>:<form onSubmit={submit} className="space-y-4"><p className="text-muted-foreground text-sm">Before accessing the calendar, replace your temporary password with a unique password of at least 12 characters.</p><label className="block text-sm">New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} className="block w-full mt-2 p-3 rounded bg-secondary border border-border"/></label><label className="block text-sm">Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)} className="block w-full mt-2 p-3 rounded bg-secondary border border-border"/></label>{error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}<button disabled={busy} className="w-full bg-[#D11047] text-white font-bold rounded p-3 disabled:opacity-50">{busy?'Updating…':'Set new password'}</button></form>}</div></main>
}

function App(){
 const {user,loading,logout}=useAuth();
 const [resetMode,setResetMode]=useState(new URLSearchParams(window.location.search).get('reset')==='1');
 const [path,setPath]=useState(window.location.hash || '#/');
 const [menuOpen,setMenuOpen]=useState(false);
 React.useEffect(()=>{const sync=()=>{setPath(window.location.hash||'#/');setMenuOpen(false)};window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync)}},[]);
 React.useEffect(()=>{if(!menuOpen)return;const onKey=e=>{if(e.key==='Escape')setMenuOpen(false)};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[menuOpen]);
 const navigate=(url)=>{if(window.location.hash!==url)window.location.hash=url;setPath(url);setMenuOpen(false);window.scrollTo({top:0,behavior:'instant'});};
 if(resetMode)return <ResetPassword onDone={()=>{window.history.replaceState(null,'',window.location.pathname);setResetMode(false)}}/>;
 if(loading)return <div className="p-8">Loading…</div>;
 if(!user)return <Login/>;
 if(user.must_change_password)return <InitialPasswordChange/>;
 const canReview=['operations_manager','admin'].includes(user.role);
 const navItems=[{label:'Calendar',url:'#/'},...(canReview?[{label:'Approvals / Requests',url:'#/approvals'}]:[]),...(user.role==='admin'?[{label:'Manage users',url:'#/users'}]:[]),{label:'Push notifications',url:'#/notifications'}];
 const navButton=(item,mobile=false)=><button key={item.url} type="button" onClick={()=>navigate(item.url)} aria-current={path===item.url?'page':undefined} className={`${mobile?'w-full text-left px-4 py-3 min-h-12':'px-3 py-2'} border border-border rounded-lg text-sm font-medium ${path===item.url?'bg-[#D11047]/15 border-[#D11047] text-foreground':'bg-secondary hover:bg-card'}`}>{item.label}</button>;
 return <>
  <header className="relative z-30 border-b border-border bg-secondary px-4 py-3 sm:px-5 sm:py-4">
   <div className="flex items-center justify-between gap-3 min-w-0">
    <button type="button" onClick={()=>navigate('#/')} className="text-left shrink-0" aria-label="Go to calendar"><div className="text-xs text-[#D11047] tracking-widest font-bold">PRG UK</div><div className="font-bold text-base sm:text-lg">Prep Bay Calendar</div></button>
    <div className="hidden md:flex items-center justify-end flex-wrap gap-2 min-w-0">
      <span className="text-xs text-muted-foreground max-w-52 truncate" title={user.email}>{user.name||user.email} · {user.role.replaceAll('_',' ')}</span>
      {navItems.map(item=>navButton(item))}
      <NotificationBell canReviewRequests={canReview} onOpenApprovals={()=>navigate('#/approvals')}/>
      <button type="button" onClick={logout} className="border border-border rounded-lg px-3 py-2 text-sm">Log out</button>
    </div>
    <div className="flex md:hidden items-center gap-2 shrink-0">
      <NotificationBell canReviewRequests={canReview} onOpenApprovals={()=>navigate('#/approvals')}/>
      <button type="button" aria-label={menuOpen?'Close navigation menu':'Open navigation menu'} aria-expanded={menuOpen} aria-controls="mobile-app-menu" onClick={()=>setMenuOpen(v=>!v)} className="w-11 h-11 border border-border rounded-lg flex flex-col justify-center items-center gap-[5px]" >
        <span className="w-5 h-0.5 bg-foreground"/><span className="w-5 h-0.5 bg-foreground"/><span className="w-5 h-0.5 bg-foreground"/>
      </button>
    </div>
   </div>
   <div className="md:hidden mt-2 text-xs text-muted-foreground truncate" title={user.email}>{user.name||user.email} · {user.role.replaceAll('_',' ')}</div>
   {menuOpen&&<div id="mobile-app-menu" className="md:hidden mt-3 border-t border-border pt-3 space-y-2" role="navigation" aria-label="Mobile navigation">
     {navItems.map(item=>navButton(item,true))}
     <button type="button" onClick={()=>{setMenuOpen(false);logout()}} className="w-full text-left px-4 py-3 min-h-12 border border-border rounded-lg text-sm">Log out</button>
   </div>}
  </header>
  <main className="min-w-0 p-3 sm:p-4 md:p-8">
   {path==='#/notifications' ? <><button type="button" onClick={()=>navigate('#/')} className="mb-4 min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium">← Back to calendar</button><PushSettings /></>
    :path==='#/users'&&user.role==='admin'?<UserManager currentEmail={user.email}/>
    :path==='#/approvals'&&canReview?<ApprovalsPage onBack={()=>navigate('#/')}/>
    :/^#\/jobs\/[0-9a-f-]{36}\/?$/i.test(path)?<JobDetails jobId={path.split('/')[2]} onBack={()=>navigate('#/')}/>
    :<PrepBayCalendar onOpenJob={id=>navigate(`#/jobs/${id}`)} onOpenApprovals={()=>navigate('#/approvals')}/>}
  </main>
 </>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><App/><Toaster richColors position="top-right"/></AuthProvider>);