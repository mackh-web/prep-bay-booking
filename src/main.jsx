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
import './index.css';
// Apply the dark theme to the root element before React renders.
// CSS theme variables are defined on :root and overridden by .dark.
document.documentElement.lang = 'en-GB';
document.documentElement.classList.add('dark');
document.documentElement.style.colorScheme = 'dark';
function Login(){const {login}=useAuth();const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');async function submit(e){e.preventDefault();setBusy(true);setError('');try{await login(email,password)}catch(err){setError(err.response?.data?.detail||'Unable to sign in')}finally{setBusy(false)}}return <main className="min-h-screen flex items-center justify-center bg-background p-4"><form onSubmit={submit} className="w-full max-w-md rounded-xl bg-card border border-border p-8 space-y-5 shadow-xl"><div className="text-xs font-bold tracking-[.3em] text-[#D11047]">PRG UK</div><h1 className="text-3xl font-black">Prep Bay Calendar</h1><p className="text-muted-foreground text-sm">Sign in with your dedicated calendar account.</p><label className="block text-sm">Email<input className="block w-full mt-2 p-3 rounded bg-secondary border border-border" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="block text-sm">Password<input className="block w-full mt-2 p-3 rounded bg-secondary border border-border" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}<button disabled={busy} className="w-full bg-[#D11047] text-white font-bold rounded p-3 disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button></form></main>}
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

function UserManager({onClose,currentEmail}){
 const [users,setUsers]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('viewer');
 async function refresh(){try{const r=await api.get('/admin/users');setUsers(r.data)}catch(e){setError(e.response?.data?.detail||'Could not load users')}}
 React.useEffect(()=>{refresh()},[]);
 async function create(e){e.preventDefault();setBusy(true);setError('');try{await api.post('/admin/users',{name,email,role});setName('');setEmail('');await refresh()}catch(e){setError(e.response?.data?.detail||'Could not add user')}finally{setBusy(false)}}
 async function change(u,patch){setBusy(true);setError('');try{await api.patch(`/admin/users/${u.id}`,{name:patch.name??u.name,role:patch.role??u.role,enabled:patch.enabled??u.enabled});await refresh()}catch(e){setError(e.response?.data?.detail||'Could not update user')}finally{setBusy(false)}}
 async function editName(u){const newName=window.prompt(`Name for ${u.email}`,u.name||'');if(newName===null)return;if(!newName.trim()){setError('Name cannot be empty');return;}await change(u,{name:newName.trim()})}
 async function remove(u){if(!window.confirm(`Permanently delete ${u.email} from Supabase Auth and the calendar?`))return;setBusy(true);setError('');try{await api.delete(`/admin/users/${u.id}`);await refresh()}catch(e){setError(e.response?.data?.detail||'Could not delete user')}finally{setBusy(false)}}
 return <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto p-4"><div className="mx-auto max-w-3xl bg-card border border-border rounded-xl p-6 space-y-5"><div className="flex justify-between items-center"><h2 className="text-xl font-bold">Manage calendar users</h2><button onClick={onClose} className="border rounded px-3 py-1">Close</button></div>{error&&<p role="alert" className="text-red-400">{error}</p>}<form onSubmit={create} className="grid md:grid-cols-4 gap-3 items-end"><label className="text-sm">Name<input type="text" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="block w-full p-2 bg-secondary border rounded"/></label><label className="text-sm">Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="block w-full p-2 bg-secondary border rounded"/></label><label className="text-sm">Role<select value={role} onChange={e=>setRole(e.target.value)} className="block w-full p-2 bg-secondary border rounded">{['viewer','project_manager','operations_manager','admin'].map(x=><option key={x} value={x}>{x}</option>)}</select></label><button disabled={busy} className="bg-[#D11047] text-white p-2 rounded disabled:opacity-50">Add user</button></form><p className="text-xs text-muted-foreground">New accounts receive the temporary password PrepBays1 and must change it at first sign-in.</p><div className="space-y-3">{users.map(u=><div key={u.id} className="flex flex-wrap items-center gap-3 border border-border rounded p-3"><div className="flex-1 min-w-48 text-sm"><div className="font-semibold">{u.name||'Name not set'} {u.email===currentEmail?'(you)':''}</div><div className="text-muted-foreground break-all">{u.email}</div></div><button disabled={busy} onClick={()=>editName(u)} className="border border-border rounded px-3 py-2 text-sm shrink-0">Edit name</button><select aria-label={`Role for ${u.email}`} disabled={busy||u.email===currentEmail} value={u.role} onChange={e=>change(u,{role:e.target.value})} className="bg-secondary border rounded p-2">{['viewer','project_manager','operations_manager','admin'].map(x=><option key={x} value={x}>{x}</option>)}</select><label className="text-sm flex gap-2 items-center"><input type="checkbox" disabled={busy||u.email===currentEmail} checked={u.enabled} onChange={e=>change(u,{enabled:e.target.checked})}/>Enabled</label><button disabled={busy||u.email===currentEmail} onClick={()=>remove(u)} className="text-red-400 border border-red-700 rounded px-3 py-2 disabled:opacity-40">Remove</button></div>)}</div><p className="text-xs text-muted-foreground">Removing a user permanently deletes their dedicated Supabase Auth account. At least one active Admin must remain.</p></div></div>
}
function App(){
 const {user,loading,logout}=useAuth();
 const [path,setPath]=useState(window.location.hash || '#/');
 const [menuOpen,setMenuOpen]=useState(false);
 const [showUsers,setShowUsers]=useState(false);
 React.useEffect(()=>{const sync=()=>{setPath(window.location.hash||'#/');setMenuOpen(false)};window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync)}},[]);
 React.useEffect(()=>{if(!menuOpen)return;const onKey=e=>{if(e.key==='Escape')setMenuOpen(false)};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[menuOpen]);
 const navigate=(url)=>{if(window.location.hash!==url)window.location.hash=url;setPath(url);setMenuOpen(false);window.scrollTo({top:0,behavior:'instant'});};
 if(loading)return <div className="p-8">Loading…</div>;
 if(!user)return <Login/>;
 if(user.must_change_password)return <InitialPasswordChange/>;
 const canReview=['operations_manager','admin'].includes(user.role);
 const navItems=[{label:'Calendar',url:'#/'},...(canReview?[{label:'Approvals / Requests',url:'#/approvals'}]:[]),{label:'Push notifications',url:'#/notifications'}];
 const navButton=(item,mobile=false)=><button key={item.url} type="button" onClick={()=>navigate(item.url)} aria-current={path===item.url?'page':undefined} className={`${mobile?'w-full text-left px-4 py-3 min-h-12':'px-3 py-2'} border border-border rounded-lg text-sm font-medium ${path===item.url?'bg-[#D11047]/15 border-[#D11047] text-foreground':'bg-secondary hover:bg-card'}`}>{item.label}</button>;
 return <>
  <header className="relative z-30 border-b border-border bg-secondary px-4 py-3 sm:px-5 sm:py-4">
   <div className="flex items-center justify-between gap-3 min-w-0">
    <button type="button" onClick={()=>navigate('#/')} className="text-left shrink-0" aria-label="Go to calendar"><div className="text-xs text-[#D11047] tracking-widest font-bold">PRG UK</div><div className="font-bold text-base sm:text-lg">Prep Bay Calendar</div></button>
    <div className="hidden md:flex items-center justify-end flex-wrap gap-2 min-w-0">
      <span className="text-xs text-muted-foreground max-w-52 truncate" title={user.email}>{user.name||user.email} · {user.role.replaceAll('_',' ')}</span>
      {navItems.map(item=>navButton(item))}
      <NotificationBell canReviewRequests={canReview} onOpenApprovals={()=>navigate('#/approvals')}/>
      {user.role==='admin'&&<button type="button" onClick={()=>setShowUsers(true)} className="border border-border rounded-lg px-3 py-2 text-sm">Manage users</button>}
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
     {user.role==='admin'&&<button type="button" onClick={()=>{setMenuOpen(false);setShowUsers(true)}} className="w-full text-left px-4 py-3 min-h-12 border border-border rounded-lg text-sm">Manage users</button>}
     <button type="button" onClick={()=>{setMenuOpen(false);logout()}} className="w-full text-left px-4 py-3 min-h-12 border border-border rounded-lg text-sm">Log out</button>
   </div>}
  </header>
  <main className="min-w-0 p-3 sm:p-4 md:p-8">
   {path==='#/notifications' ? <><button type="button" onClick={()=>navigate('#/')} className="mb-4 min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium">← Back to calendar</button><PushSettings /></>
    :path==='#/approvals'&&canReview?<ApprovalsPage onBack={()=>navigate('#/')}/>
    :/^#\/jobs\/[0-9a-f-]{36}\/?$/i.test(path)?<JobDetails jobId={path.split('/')[2]} onBack={()=>navigate('#/')}/>
    :<PrepBayCalendar onOpenJob={id=>navigate(`#/jobs/${id}`)} onOpenApprovals={()=>navigate('#/approvals')}/>}
  </main>
  {showUsers&&<UserManager onClose={()=>setShowUsers(false)} currentEmail={user.email}/>}
 </>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><App/><Toaster richColors position="top-right"/></AuthProvider>);
