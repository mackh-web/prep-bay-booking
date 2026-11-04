"""Dedicated calendar API. No Job Portal profile or role is required."""
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID
import asyncpg
import httpx
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field

app = FastAPI()
BAYS = ["Prep Bay 0", "Prep Bay 1", "Prep Bay 2", "Prep Bay 3", "Prep Bay 4 (Small GS)", "Prep Bay 5 (Small GS)", "Prep Bay 6", "Prep Bay 7", "Prep Bay 8", "Prep Bay 9", "Prep Bay 10 (Large GS)", "Prep Bay 11", "The Bridge"]
DEPTS = {"Lighting", "Video", "Rigging", "Automation"}

def settings():
    return os.environ["DATABASE_URL"], os.environ["SUPABASE_URL"].rstrip('/'), os.environ["SUPABASE_PUBLISHABLE_KEY"]

async def db():
    url, _, _ = settings()
    return await asyncpg.connect(url, timeout=10, statement_cache_size=0)

async def query(sql, *args, one=False, execute=False):
    conn = await db()
    try:
        if execute: return await conn.execute(sql, *args)
        if one: return await conn.fetchrow(sql, *args)
        return await conn.fetch(sql, *args)
    finally: await conn.close()

class Login(BaseModel):
    email: str
    password: str

async def auth_user(request: Request):
    _, url, key = settings()
    token = request.cookies.get('calendar_access')
    if not token: raise HTTPException(401, 'Please sign in')
    async with httpx.AsyncClient(timeout=12) as client:
        try: r = await client.get(f'{url}/auth/v1/user', headers={'apikey': key, 'Authorization': f'Bearer {token}'})
        except httpx.RequestError: raise HTTPException(503, 'Authentication service unavailable')
    if r.status_code != 200: raise HTTPException(401, 'Session expired — please sign in again')
    uid = UUID(r.json()['id'])
    row = await query('select role, must_change_password from public.calendar_users where user_id=$1 and enabled=true', uid, one=True)
    if not row: raise HTTPException(403, 'This account does not have calendar access')
    return {'id': uid, 'email': r.json().get('email'), 'role': row['role'], 'must_change_password': row['must_change_password']}

async def calendar_user(user=Depends(auth_user)):
    if user['must_change_password']:
        raise HTTPException(403, 'You must change your initial password first')
    return user

async def editor(user=Depends(calendar_user)):
    if user['must_change_password']: raise HTTPException(403, 'You must change your initial password first')
    if user['role'] not in ('editor', 'admin'): raise HTTPException(403, 'Editor access required')
    return user

@app.post('/api/auth/login')
async def login(body: Login, response: Response):
    _, url, key = settings()
    async with httpx.AsyncClient(timeout=12) as client:
        try: r = await client.post(f'{url}/auth/v1/token?grant_type=password', headers={'apikey':key}, json={'email':body.email,'password':body.password})
        except httpx.RequestError: raise HTTPException(503, 'Authentication service unavailable')
    if r.status_code != 200: raise HTTPException(401, 'Invalid email or password')
    result = r.json()
    uid = UUID(result['user']['id'])
    row = await query('select role, must_change_password from public.calendar_users where user_id=$1 and enabled=true', uid, one=True)
    if not row: raise HTTPException(403, 'This account is not authorised for the calendar')
    response.set_cookie('calendar_access', result['access_token'], httponly=True, secure=True, samesite='lax', max_age=result.get('expires_in',3600), path='/api')
    return {'email':result['user']['email'], 'role':row['role'], 'must_change_password':row['must_change_password']}

@app.get('/api/auth/me')
async def me(user=Depends(auth_user)):
    return {'email':user['email'],'role':user['role'], 'must_change_password':user['must_change_password']}

@app.post('/api/auth/logout')
async def logout(response: Response):
    response.delete_cookie('calendar_access', path='/api', secure=True, httponly=True, samesite='lax')
    return {'ok':True}

class PasswordChange(BaseModel):
    new_password: str = Field(min_length=12, max_length=128)

@app.post('/api/auth/change-initial-password')
async def change_initial_password(body: PasswordChange, request: Request, response: Response, user=Depends(auth_user)):
    # This endpoint is only for mandatory first-login password changes.
    if not user['must_change_password']:
        raise HTTPException(409, 'Initial password change is not required')
    # Cookie-authenticated mutation: reject cross-origin requests.
    origin = request.headers.get('origin')
    if not origin or origin != f"https://{request.headers.get('host', '')}":
        raise HTTPException(403, 'Invalid request origin')
    # Do not use the shared initial password or any password shorter than 12 characters.
    if body.new_password == 'PrepBays1':
        raise HTTPException(422, 'Choose a different password')
    await supabase_admin('PUT', f"users/{user['id']}", {'password':body.new_password})
    await query('update public.calendar_users set must_change_password=false where user_id=$1', user['id'], execute=True)
    response.delete_cookie('calendar_access', path='/api', secure=True, httponly=True, samesite='lax')
    return {'ok':True, 'message':'Password changed. Please sign in with your new password.'}

@app.get('/api/jobs')
async def jobs(user=Depends(calendar_user)):
    rows = await query('select id,name,winhits_number,prep_date,ship_date,prep_bays from public.calendar_jobs order by prep_date desc nulls last limit 2000')
    ids=[r['id'] for r in rows]
    depts=await query('select job_id,bay,department from public.calendar_job_bay_assignments where job_id=any($1::uuid[])',ids) if ids else []
    mapping={}
    for d in depts: mapping.setdefault(d['job_id'],{})[d['bay']]=d['department']
    return [{**dict(r),'id':str(r['id']),'prep_date':r['prep_date'].isoformat() if r['prep_date'] else None,'ship_date':r['ship_date'].isoformat() if r['ship_date'] else None,'bay_departments':mapping.get(r['id'],{})} for r in rows]


class NewJob(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    winhits_number: Optional[str] = None
    prep_date: date
    ship_date: date

@app.post('/api/jobs')
async def create_job(payload: NewJob, user=Depends(editor)):
    if payload.ship_date < payload.prep_date:
        raise HTTPException(400, 'Ship date must be on or after prep date')
    row = await query('insert into public.calendar_jobs(name,winhits_number,prep_date,ship_date) values($1,$2,$3,$4) returning id',payload.name.strip(),payload.winhits_number,payload.prep_date,payload.ship_date,one=True)
    return {'id':str(row['id']),'ok':True}

@app.delete('/api/jobs/{job_id}')
async def delete_job(job_id:UUID,user=Depends(editor)):
    result=await query('delete from public.calendar_jobs where id=$1',job_id,execute=True)
    if result == 'DELETE 0': raise HTTPException(404,'Job not found')
    return {'ok':True}

@app.get('/api/prep-bays/bookings')
async def bookings(year:int,month:int,user=Depends(calendar_user)):
    if not 2000 <= year <= 2100 or not 1 <= month <= 12: raise HTTPException(400,'Invalid month')
    start=date(year,month,1)
    end=date(year+1,1,1) if month==12 else date(year,month+1,1)
    rows=await query("select id,name,winhits_number,prep_date,ship_date,status,prep_bays from public.calendar_jobs where prep_bays != '{}' and prep_date < $2 and ship_date >= $1",start,end)
    ids=[r['id'] for r in rows]
    depts=await query('select job_id,bay,department from public.calendar_job_bay_assignments where job_id=any($1::uuid[])',ids) if ids else []
    mapping={}
    for d in depts: mapping.setdefault(d['job_id'],{})[d['bay']]=d['department']
    manual=await query('select id,bay,label,department,start_date,end_date,created_by_name from public.calendar_manual_bookings where start_date < $2 and end_date >= $1',start,end)
    return {'bays':BAYS,'month_start':start.isoformat(),'month_end_next':end.isoformat(), 'bookings':[{'job_id':str(r['id']),'job_name':r['name'],'winhits_number':r['winhits_number'],'prep_date':r['prep_date'].isoformat(),'ship_date':r['ship_date'].isoformat(),'status':r['status'],'prep_bays':r['prep_bays'] or [],'bay_departments':mapping.get(r['id'],{})} for r in rows], 'manual_bookings':[{**dict(m),'id':str(m['id']),'start_date':m['start_date'].isoformat(),'end_date':m['end_date'].isoformat()} for m in manual]}

async def conflicts(start:date,end:date,bays:list[str],exclude_job:Optional[UUID]=None,exclude_manual:Optional[UUID]=None):
    jobs=await query("select id,name,prep_bays from public.calendar_jobs where prep_date <= $2 and ship_date >= $1 and ($3::uuid is null or id<>$3) and prep_bays && $4::text[]",start,end,exclude_job,bays)
    manual=await query('select id,label,bay from public.calendar_manual_bookings where start_date <= $2 and end_date >= $1 and ($3::uuid is null or id<>$3) and bay=any($4::text[])',start,end,exclude_manual,bays)
    found={b:[] for b in bays}
    for j in jobs:
        for bay in j['prep_bays'] or []:
            if bay in found: found[bay].append({'job_name':j['name'],'job_id':str(j['id']),'manual':False})
    for m in manual: found[m['bay']].append({'job_name':m['label'],'manual':True})
    return found

@app.get('/api/prep-bays/availability')
async def availability(prep_date:date,ship_date:date,exclude_job_id:Optional[UUID]=None,exclude_manual_id:Optional[UUID]=None,user=Depends(calendar_user)):
    found=await conflicts(prep_date,ship_date,BAYS,exclude_job_id,exclude_manual_id)
    return [{'bay':b,'available':not found[b],'conflicts':found[b]} for b in BAYS]

class Bay(BaseModel):
    bay:str
    department:Optional[str]=None
class Booking(BaseModel):
    job_id:UUID
    bays:list[Bay]

@app.post('/api/prep-bays/booking')
async def book(payload:Booking,user=Depends(editor)):
    names=[b.bay for b in payload.bays]
    if len(set(names))!=len(names) or any(b not in BAYS for b in names) or any(b.department and b.department not in DEPTS for b in payload.bays): raise HTTPException(400,'Invalid bays or departments')
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            job=await conn.fetchrow('select id,prep_date,ship_date from public.calendar_jobs where id=$1 for update',payload.job_id)
            if not job: raise HTTPException(404,'Job not found')
            if not job['prep_date'] or not job['ship_date']: raise HTTPException(400,'Job needs prep and ship dates')
            found=await conflicts(job['prep_date'],job['ship_date'],names,exclude_job=payload.job_id)
            if any(found.values()): raise HTTPException(409,'One or more prep bays are already booked')
            await conn.execute('update public.calendar_jobs set prep_bays=$2,updated_at=now() where id=$1',payload.job_id,names)
            await conn.execute('delete from public.calendar_job_bay_assignments where job_id=$1',payload.job_id)
            for b in payload.bays:
                if b.department: await conn.execute('insert into public.calendar_job_bay_assignments(job_id,bay,department) values($1,$2,$3)',payload.job_id,b.bay,b.department)
    finally: await conn.close()
    return {'ok':True}

class ManualCreate(BaseModel):
    bays:list[str]
    label:str
    department:Optional[str]=None
    start_date:date
    end_date:date
class ManualEdit(BaseModel):
    bay:str
    label:str
    department:Optional[str]=None
    start_date:date
    end_date:date

def validate_manual(bays,label,dept,start,end):
    if not bays or len(set(bays))!=len(bays) or any(b not in BAYS for b in bays): raise HTTPException(400,'Invalid prep bay')
    if not label.strip() or len(label)>200: raise HTTPException(400,'Invalid label')
    if dept and dept not in DEPTS: raise HTTPException(400,'Invalid department')
    if end<start: raise HTTPException(400,'End date must not precede start date')

@app.post('/api/prep-bays/manual-booking')
async def manual_create(p:ManualCreate,user=Depends(editor)):
    validate_manual(p.bays,p.label,p.department,p.start_date,p.end_date)
    found=await conflicts(p.start_date,p.end_date,p.bays)
    if any(found.values()): raise HTTPException(409,'One or more prep bays are already booked')
    ids=[]
    for bay in p.bays:
        r=await query('insert into public.calendar_manual_bookings(bay,label,department,start_date,end_date,created_by_name) values($1,$2,$3,$4,$5,$6) returning id',bay,p.label.strip(),p.department,p.start_date,p.end_date,user['email'],one=True)
        ids.append(str(r['id']))
    return {'ok':True,'ids':ids}

@app.patch('/api/prep-bays/manual-booking/{booking_id}')
async def manual_edit(booking_id:UUID,p:ManualEdit,user=Depends(editor)):
    validate_manual([p.bay],p.label,p.department,p.start_date,p.end_date)
    found=await conflicts(p.start_date,p.end_date,[p.bay],exclude_manual=booking_id)
    if any(found.values()): raise HTTPException(409,'Prep bay already booked')
    result=await query('update public.calendar_manual_bookings set bay=$2,label=$3,department=$4,start_date=$5,end_date=$6 where id=$1 returning id',booking_id,p.bay,p.label.strip(),p.department,p.start_date,p.end_date,one=True)
    if not result: raise HTTPException(404,'Booking not found')
    return {'ok':True}

@app.delete('/api/prep-bays/manual-booking/{booking_id}')
async def manual_delete(booking_id:UUID,user=Depends(editor)):
    await query('delete from public.calendar_manual_bookings where id=$1',booking_id,execute=True)
    return {'ok':True}


# Calendar-only account management. Never expose the Supabase secret to the browser.
class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    role: str = 'viewer'

class UserUpdate(BaseModel):
    role: str
    enabled: bool = True

async def admin(user=Depends(calendar_user)):
    if user['role'] != 'admin':
        raise HTTPException(403, 'Administrator access required')
    return user

def check_role(role):
    if role not in ('viewer', 'editor', 'admin'):
        raise HTTPException(422, 'Invalid calendar role')

async def supabase_admin(method, path, payload=None):
    _, url, _ = settings()
    secret = os.environ.get('SUPABASE_SECRET_KEY')
    if not secret:
        raise HTTPException(503, 'SUPABASE_SECRET_KEY is not configured')
    headers = {'apikey': secret, 'Authorization': f'Bearer {secret}', 'Content-Type': 'application/json'}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            result = await client.request(method, f'{url}/auth/v1/admin/{path}', headers=headers, json=payload)
        except httpx.RequestError:
            raise HTTPException(503, 'Authentication service unavailable')
    if result.status_code >= 400:
        # Do not return raw Supabase errors or credentials to clients.
        if result.status_code in (400, 409, 422):
            raise HTTPException(409, 'The account could not be changed; check for an existing email or invalid details')
        raise HTTPException(502, 'Supabase user administration failed')
    return result.json() if result.content else {}

@app.get('/api/admin/users')
async def list_calendar_users(user=Depends(admin)):
    rows = await query("""select c.user_id,c.role,c.enabled,u.email,u.created_at
                          from public.calendar_users c join auth.users u on u.id=c.user_id
                          order by lower(u.email)""")
    return [{'id': str(r['user_id']), 'email':r['email'], 'role':r['role'],
             'enabled':r['enabled'], 'created_at':r['created_at'].isoformat()} for r in rows]

@app.post('/api/admin/users', status_code=201)
async def create_calendar_user(body:UserCreate, user=Depends(admin)):
    check_role(body.role)
    email=body.email.strip().lower()
    if '@' not in email or not email.split('@')[-1].count('.'):
        raise HTTPException(422, 'Invalid email address')
    # Create Auth user first, then its dedicated calendar permission row.
    created = await supabase_admin('POST', 'users', {'email':email, 'password':body.password, 'email_confirm':True})
    uid = UUID(created['id'])
    try:
        await query('insert into public.calendar_users(user_id,role,enabled,must_change_password) values($1,$2,true,true)',uid,body.role,execute=True)
    except Exception:
        await supabase_admin('DELETE',f'users/{uid}')
        raise HTTPException(500,'Unable to save calendar permissions; user creation rolled back')
    return {'id':str(uid),'email':email,'role':body.role,'enabled':True}

async def ensure_other_admin(target:UUID, new_role:Optional[str]=None, enabled:bool=True):
    row=await query('select role,enabled from public.calendar_users where user_id=$1',target,one=True)
    if not row: raise HTTPException(404,'Calendar user not found')
    if row['role']=='admin' and row['enabled'] and (new_role!='admin' or not enabled):
        count=await query("select count(*) as n from public.calendar_users where role='admin' and enabled=true",one=True)
        if count['n'] <= 1: raise HTTPException(409,'Cannot remove or disable the last active administrator')
    return row

@app.patch('/api/admin/users/{target}')
async def update_calendar_user(target:UUID, body:UserUpdate, user=Depends(admin)):
    check_role(body.role)
    if target == user['id'] and (body.role != 'admin' or not body.enabled):
        raise HTTPException(409,'You cannot remove your own administrator access')
    await ensure_other_admin(target,body.role,body.enabled)
    await query('update public.calendar_users set role=$2,enabled=$3 where user_id=$1',target,body.role,body.enabled,execute=True)
    return {'ok':True}

@app.delete('/api/admin/users/{target}')
async def delete_calendar_user(target:UUID,user=Depends(admin)):
    if target == user['id']:
        raise HTTPException(409,'You cannot delete your own account')
    await ensure_other_admin(target,new_role=None)
    # Delete the Supabase Auth identity. The FK cascade deletes calendar_users.
    await supabase_admin('DELETE',f'users/{target}')
    return {'ok':True}
