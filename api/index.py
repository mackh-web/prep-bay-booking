"""Dedicated calendar API. No Job Portal profile or role is required."""
import os
import asyncio
import json
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

# A small pool is reused by requests handled by the same warm Vercel instance.
# min_size=0 avoids opening idle database connections on cold starts.
_pool = None
_pool_lock = asyncio.Lock()

class _LeasedConnection:
    def __init__(self, pool, connection):
        self._pool = pool
        self._connection = connection
        self._released = False

    def __getattr__(self, name):
        return getattr(self._connection, name)

    async def close(self):
        if not self._released:
            self._released = True
            await self._pool.release(self._connection)

async def db():
    global _pool
    if _pool is None or _pool.is_closing():
        async with _pool_lock:
            if _pool is None or _pool.is_closing():
                url, _, _ = settings()
                _pool = await asyncpg.create_pool(
                    dsn=url, min_size=0, max_size=3,
                    timeout=10, command_timeout=15,
                    statement_cache_size=0,
                    max_inactive_connection_lifetime=60,
                )
    conn = await _pool.acquire(timeout=10)
    return _LeasedConnection(_pool, conn)

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
    if user['role'] not in ('operations_manager', 'admin'): raise HTTPException(403, 'Operations Manager access required')
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


# Group identity is stable even when a WinHits number is corrected.
# Existing records are linked by the data-preserving migration.
async def attach_job_group(conn, job_id:UUID, winhits:str):
    match=await conn.fetchrow("""select group_id from public.calendar_jobs
        where id<>$1 and lower(btrim(winhits_number))=lower(btrim($2))
        and nullif(btrim(winhits_number),'') is not null and group_id is not null
        order by created_at,id limit 1""",job_id,winhits)
    await conn.execute('update public.calendar_jobs set group_id=$2 where id=$1',job_id,match['group_id'] if match else job_id)

async def update_group_metadata(conn, job_id:UUID, name:str, winhits:str):
    row=await conn.fetchrow('select group_id from public.calendar_jobs where id=$1',job_id)
    if not row: raise HTTPException(404,'Job not found')
    # Never silently merge two unrelated groups by editing the reference.
    collision=await conn.fetchval("""select exists(select 1 from public.calendar_jobs
        where lower(btrim(winhits_number))=lower(btrim($2))
        and group_id is distinct from $1)""",row['group_id'],winhits)
    if collision: raise HTTPException(409,'WinHits number belongs to another job group. Edit that group instead.')
    await conn.execute('update public.calendar_jobs set name=$2,winhits_number=$3,updated_at=now() where group_id=$1',row['group_id'],name,winhits)
    # Keep pending proposals in sync with corrected shared identifiers.
    await conn.execute("""update public.calendar_booking_requests r set name=$2,winhits_number=$3,updated_at=now()
        where r.status='pending' and r.job_id in (select id from public.calendar_jobs where group_id=$1)""",row['group_id'],name,winhits)

async def group_member(conn, job_id:UUID):
    row=await conn.fetchrow('select id,group_id,created_by from public.calendar_jobs where id=$1',job_id)
    if not row: raise HTTPException(404,'Job not found')
    return row

async def pm_owns_group(conn, group_id:UUID, user_id:UUID):
    return await conn.fetchval("""select exists(
      select 1 from public.calendar_jobs j where j.group_id=$1 and j.created_by=$2
      union all
      select 1 from public.calendar_booking_requests r join public.calendar_jobs j on j.id=r.job_id
      where j.group_id=$1 and r.requester_id=$2 and r.status='approved'
    )""",group_id,user_id)

@app.get('/api/jobs/{job_id}/details')
async def job_details(job_id:UUID,user=Depends(calendar_user)):
    conn=await db()
    try:
        member=await group_member(conn,job_id)
        rows=await conn.fetch("""select j.id,j.group_id,j.name,j.winhits_number,j.prep_date,j.ship_date,j.status,
          j.prep_bays,j.notes,j.created_by,j.created_at,
          coalesce((select jsonb_object_agg(a.bay,a.department)
          from public.calendar_job_bay_assignments a where a.job_id=j.id),'{}'::jsonb) as bay_departments
          from public.calendar_jobs j where j.group_id=$1 order by j.prep_date,j.id""",member['group_id'])
        reqs=await conn.fetch("""select id,job_id,status,requester_id,prep_date,ship_date,bays,notes,
            rejection_reason,created_at,updated_at from public.calendar_booking_requests
            where job_id=any($1::uuid[]) order by created_at desc limit 100""",[r['id'] for r in rows])
        can_pm_edit=(user['role']=='project_manager' and await pm_owns_group(conn,member['group_id'],user['id']))
        def serial(row):
            d=dict(row)
            for k,v in list(d.items()):
                if isinstance(v,(UUID,date,datetime)):d[k]=str(v) if isinstance(v,UUID) else v.isoformat()
                elif isinstance(v,str) and k in ('bays','bay_departments'):
                    try:d[k]=json.loads(v)
                    except ValueError:pass
            return d
        return {'group_id':str(member['group_id']),'bookings':[serial(r) for r in rows],
            'requests':[serial(r) for r in reqs if user['role'] in ('admin','operations_manager') or r['requester_id']==user['id']],
            'can_pm_edit':can_pm_edit}
    finally: await conn.close()

class Bay(BaseModel):
    bay:str
    department:Optional[str]=None
class JobBooking(BaseModel):
    name: str = Field(min_length=1,max_length=200)
    winhits_number: str = Field(min_length=1,max_length=100)
    prep_date: date
    ship_date: date
    bays: list[Bay] = Field(min_length=1)
    notes: Optional[str] = Field(default=None,max_length=3000)

def validate_booking(p:JobBooking):
    names=[b.bay for b in p.bays]
    if p.ship_date < p.prep_date: raise HTTPException(422,'Ship date must not precede prep date')
    if not p.name.strip() or not p.winhits_number.strip(): raise HTTPException(422,'Job name and WinHits number are required')
    if len(names)!=len(set(names)) or any(n not in BAYS for n in names): raise HTTPException(422,'Select valid, distinct bays')
    if any(b.department and b.department not in DEPTS for b in p.bays): raise HTTPException(422,'Invalid department')
    return names


class JobMetadata(BaseModel):
    name:str=Field(min_length=1,max_length=200)
    winhits_number:str=Field(min_length=1,max_length=100)
    notes:Optional[str]=Field(default=None,max_length=3000)

@app.patch('/api/jobs/{job_id}/details')
async def change_job_metadata(job_id:UUID,p:JobMetadata,user=Depends(calendar_user)):
    if user['role'] not in ('project_manager','operations_manager','admin'):
        raise HTTPException(403,'Job editing access required')
    if not p.name.strip() or not p.winhits_number.strip():raise HTTPException(422,'Name and WinHits are required')
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            member=await group_member(conn,job_id)
            if user['role']=='project_manager' and not await pm_owns_group(conn,member['group_id'],user['id']):
                raise HTTPException(403,'You may edit only your own jobs')
            await update_group_metadata(conn,job_id,p.name.strip(),p.winhits_number.strip())
            await conn.execute('update public.calendar_jobs set notes=$2,updated_at=now() where id=$1',job_id,p.notes)
    finally:await conn.close()
    return {'ok':True}

@app.post('/api/jobs/{job_id}/change-request',status_code=201)
async def request_job_bay_changes(job_id:UUID,p:JobBooking,user=Depends(calendar_user)):
    if user['role']!='project_manager':raise HTTPException(403,'Project Manager access required')
    names=validate_booking(p)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            member=await group_member(conn,job_id)
            if not await pm_owns_group(conn,member['group_id'],user['id']):
                raise HTTPException(403,'You may request changes only to your own jobs')
            current=await conn.fetchrow('select name,winhits_number from public.calendar_jobs where id=$1',job_id)
            # Dates/bays only: shared job metadata is updated through the immediate-edit endpoint.
            if any((await conflicts(p.prep_date,p.ship_date,names,exclude_job=job_id,conn=conn)).values()):
                raise HTTPException(409,'One or more selected bays are already booked')
            pending=await conn.fetchval("""select exists(select 1 from public.calendar_booking_requests
                where job_id=$1 and status='pending')""",job_id)
            if pending:raise HTTPException(409,'This allocation already has a pending change request')
            r=await conn.fetchrow("""insert into public.calendar_booking_requests
                (requester_id,job_id,name,winhits_number,prep_date,ship_date,bays,notes,status)
                values($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning id""",
                user['id'],job_id,current['name'],current['winhits_number'],p.prep_date,p.ship_date,
                json.dumps([b.model_dump() for b in p.bays]),p.notes)
            await notify_ops(conn,'request_submitted',f'Bay/date change requested: {current["name"]}',r['id'])
            return {'ok':True,'id':str(r['id'])}
    finally:await conn.close()

@app.get('/api/jobs')
async def jobs(user=Depends(calendar_user)):
    rows = await query('select id,name,winhits_number,prep_date,ship_date,prep_bays,created_by,notes from public.calendar_jobs order by prep_date desc nulls last limit 2000')
    ids=[r['id'] for r in rows]
    depts=await query('select job_id,bay,department from public.calendar_job_bay_assignments where job_id=any($1::uuid[])',ids) if ids else []
    mapping={}
    for d in depts: mapping.setdefault(d['job_id'],{})[d['bay']]=d['department']
    return [{**dict(r),'created_by':str(r['created_by']) if r['created_by'] else None,'id':str(r['id']),'prep_date':r['prep_date'].isoformat() if r['prep_date'] else None,'ship_date':r['ship_date'].isoformat() if r['ship_date'] else None,'bay_departments':mapping.get(r['id'],{})} for r in rows]


@app.get('/api/prep-bays/bookings')
async def bookings(year:int,month:int,user=Depends(calendar_user)):
    if not 2000 <= year <= 2100 or not 1 <= month <= 12: raise HTTPException(400,'Invalid month')
    start=date(year,month,1)
    end=date(year+1,1,1) if month==12 else date(year,month+1,1)
    rows=await query("""
        select j.id,j.name,j.winhits_number,j.prep_date,j.ship_date,j.status,j.prep_bays,
               (select min(x.prep_date) from public.calendar_jobs x where x.group_id=j.group_id or (j.group_id is null and x.id=j.id)) as group_first_prep,
               (select max(x.ship_date) from public.calendar_jobs x where x.group_id=j.group_id or (j.group_id is null and x.id=j.id)) as group_last_ship,
               coalesce((select jsonb_object_agg(a.bay,a.department)
                         from public.calendar_job_bay_assignments a
                         where a.job_id=j.id), '{}'::jsonb) as bay_departments
        from public.calendar_jobs j
        where j.prep_bays != '{}' and j.prep_date < $2 and j.ship_date >= $1
    """,start,end)
    manual=await query('select id,bay,label,department,start_date,end_date,created_by_name from public.calendar_manual_bookings where start_date < $2 and end_date >= $1',start,end)
    return {'bays':BAYS,'month_start':start.isoformat(),'month_end_next':end.isoformat(), 'bookings':[{'job_id':str(r['id']),'job_name':r['name'],'winhits_number':r['winhits_number'],'prep_date':r['prep_date'].isoformat(),'ship_date':r['ship_date'].isoformat(),'group_first_prep':(r['group_first_prep'] or r['prep_date']).isoformat(),'group_last_ship':(r['group_last_ship'] or r['ship_date']).isoformat(),'status':r['status'],'prep_bays':r['prep_bays'] or [],'bay_departments':json.loads(r['bay_departments']) if isinstance(r['bay_departments'],str) else r['bay_departments']} for r in rows], 'manual_bookings':[{**dict(m),'id':str(m['id']),'start_date':m['start_date'].isoformat(),'end_date':m['end_date'].isoformat()} for m in manual]}

async def conflicts(start:date,end:date,bays:list[str],exclude_job:Optional[UUID]=None,exclude_manual:Optional[UUID]=None,conn=None):
    jobs=await (conn.fetch if conn else query)("select id,name,prep_bays from public.calendar_jobs where prep_date <= $2 and ship_date >= $1 and ($3::uuid is null or id<>$3) and prep_bays && $4::text[]",start,end,exclude_job,bays)
    manual=await (conn.fetch if conn else query)('select id,label,bay from public.calendar_manual_bookings where start_date <= $2 and end_date >= $1 and ($3::uuid is null or id<>$3) and bay=any($4::text[])',start,end,exclude_manual,bays)
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

async def store_assignments(conn,job_id,bays):
    await conn.execute('delete from public.calendar_job_bay_assignments where job_id=$1',job_id)
    for b in bays:
        if b.department:
            await conn.execute('insert into public.calendar_job_bay_assignments(job_id,bay,department) values($1,$2,$3)',job_id,b.bay,b.department)

async def notify(conn, recipient, kind, message, request_id):
    await conn.execute('insert into public.calendar_notifications(user_id,kind,message,request_id) values($1,$2,$3,$4)',recipient,kind,message,request_id)

async def notify_ops(conn,kind,message,request_id):
    users=await conn.fetch("select user_id from public.calendar_users where enabled=true and role in ('operations_manager','admin')")
    for u in users: await notify(conn,u['user_id'],kind,message,request_id)

@app.post('/api/prep-bays/booking',status_code=201)
async def direct_booking(p:JobBooking,user=Depends(editor)):
    names=validate_booking(p)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            if any((await conflicts(p.prep_date,p.ship_date,names,conn=conn)).values()):
                raise HTTPException(409,'One or more prep bays have already been booked')
            job=await conn.fetchrow("""insert into public.calendar_jobs(name,winhits_number,prep_date,ship_date,prep_bays,created_by,notes)
                values($1,$2,$3,$4,$5,$6,$7) returning id""",p.name.strip(),p.winhits_number.strip(),p.prep_date,p.ship_date,names,user['id'],p.notes)
            await attach_job_group(conn, job['id'], p.winhits_number)
            await update_group_metadata(conn, job['id'], p.name.strip(), p.winhits_number.strip())
            await store_assignments(conn,job['id'],p.bays)
            return {'ok':True,'job_id':str(job['id'])}
    finally: await conn.close()

@app.patch('/api/prep-bays/booking/{job_id}')
async def edit_direct_booking(job_id:UUID,p:JobBooking,user=Depends(editor)):
    names=validate_booking(p)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            job=await conn.fetchrow('select id from public.calendar_jobs where id=$1 for update',job_id)
            if not job: raise HTTPException(404,'Booking not found')
            if any((await conflicts(p.prep_date,p.ship_date,names,exclude_job=job_id,conn=conn)).values()):
                raise HTTPException(409,'One or more prep bays have already been booked')
            await conn.execute("""update public.calendar_jobs set name=$2,winhits_number=$3,prep_date=$4,ship_date=$5,prep_bays=$6,notes=$7,updated_at=now() where id=$1""",job_id,p.name.strip(),p.winhits_number.strip(),p.prep_date,p.ship_date,names,p.notes)
            await update_group_metadata(conn, job_id, p.name.strip(), p.winhits_number.strip())
            await store_assignments(conn,job_id,p.bays)
    finally: await conn.close()
    return {'ok':True}

@app.get('/api/prep-bays/requests')
async def list_requests(user=Depends(calendar_user)):
    if user['role'] not in ('project_manager','operations_manager','admin'): raise HTTPException(403,'Request access required')
    if user['role']=='project_manager':
        rows=await query('select * from public.calendar_booking_requests where requester_id=$1 order by updated_at desc limit 500',user['id'])
    else:
        rows=await query("select * from public.calendar_booking_requests order by (status='pending') desc,updated_at desc limit 500")
    result=[]
    for r in rows:
        d=dict(r)
        if isinstance(d.get('bays'),str): d['bays']=json.loads(d['bays'])
        for k in ('id','requester_id','job_id','reviewer_id','archived_by'):
            if d.get(k): d[k]=str(d[k])
        for k in ('prep_date','ship_date','created_at','updated_at','reviewed_at','archived_at'):
            if d.get(k): d[k]=d[k].isoformat()
        result.append(d)
    return result

@app.post('/api/prep-bays/requests/{request_id}/archive')
async def archive_approved_request(request_id: UUID, user=Depends(editor)):
    """Hide a completed approval from the active queue without deleting its audit history."""
    conn = await db()
    try:
        async with conn.transaction():
            row = await conn.fetchrow('select status, archived_at from public.calendar_booking_requests where id=$1 for update', request_id)
            if not row:
                raise HTTPException(404, 'Request not found')
            if row['status'] != 'approved':
                raise HTTPException(409, 'Only approved requests may be archived')
            if row['archived_at'] is not None:
                return {'ok': True, 'already_archived': True}
            await conn.execute('update public.calendar_booking_requests set archived_at=now(), archived_by=$2 where id=$1', request_id, user['id'])
    finally:
        await conn.close()
    return {'ok': True}

@app.post('/api/prep-bays/requests/{request_id}/restore')
async def restore_archived_request(request_id: UUID, user=Depends(editor)):
    """Restore an archived approval to the approved request history."""
    conn = await db()
    try:
        async with conn.transaction():
            row = await conn.fetchrow('select status, archived_at from public.calendar_booking_requests where id=$1 for update', request_id)
            if not row:
                raise HTTPException(404, 'Request not found')
            if row['status'] != 'approved' or row['archived_at'] is None:
                raise HTTPException(409, 'Request is not an archived approval')
            await conn.execute('update public.calendar_booking_requests set archived_at=null, archived_by=null where id=$1', request_id)
    finally:
        await conn.close()
    return {'ok': True}

@app.post('/api/prep-bays/requests',status_code=201)
async def submit_request(p:JobBooking,user=Depends(calendar_user)):
    if user['role']!='project_manager': raise HTTPException(403,'Project Manager access required')
    names=validate_booking(p)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            if any((await conflicts(p.prep_date,p.ship_date,names,conn=conn)).values()):
                raise HTTPException(409,'One or more selected bays are already booked for these dates')
            r=await conn.fetchrow("""insert into public.calendar_booking_requests(requester_id,name,winhits_number,prep_date,ship_date,bays,notes,status)
                values($1,$2,$3,$4,$5,$6,$7,'pending') returning id""",user['id'],p.name.strip(),p.winhits_number.strip(),p.prep_date,p.ship_date,json.dumps([b.model_dump() for b in p.bays]),p.notes)
            await notify_ops(conn,'request_submitted',f'New bay request: {p.name.strip()}',r['id'])
            return {'ok':True,'id':str(r['id'])}
    finally: await conn.close()

@app.put('/api/prep-bays/requests/{request_id}')
async def revise_request(request_id:UUID,p:JobBooking,user=Depends(calendar_user)):
    if user['role']!='project_manager': raise HTTPException(403,'Project Manager access required')
    names=validate_booking(p)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            r=await conn.fetchrow('select * from public.calendar_booking_requests where id=$1 for update',request_id)
            if not r: raise HTTPException(404,'Request not found')
            if r['requester_id']!=user['id']: raise HTTPException(403,'You can only edit your own requests')
            if r['status']=='approved': raise HTTPException(409,'Approved requests are historical records. Request a new bay change from the job details page.')
            if any((await conflicts(p.prep_date,p.ship_date,names,exclude_job=r['job_id'],conn=conn)).values()):
                raise HTTPException(409,'One or more selected bays are already booked for these dates')
            await conn.execute("""update public.calendar_booking_requests set name=$2,winhits_number=$3,prep_date=$4,ship_date=$5,bays=$6,notes=$7,
                status='pending',rejection_reason=null,reviewer_id=null,reviewed_at=null,updated_at=now() where id=$1""",request_id,p.name.strip(),p.winhits_number.strip(),p.prep_date,p.ship_date,json.dumps([b.model_dump() for b in p.bays]),p.notes)
            await notify_ops(conn,'request_resubmitted',f'Request updated: {p.name.strip()}',request_id)
    finally: await conn.close()
    return {'ok':True}

class Decision(BaseModel):
    decision: str
    rejection_reason: Optional[str] = Field(default=None,max_length=2000)

@app.post('/api/prep-bays/requests/{request_id}/decision')
async def decide_request(request_id:UUID,p:Decision,user=Depends(editor)):
    if p.decision not in ('approved','rejected'): raise HTTPException(422,'Invalid decision')
    if p.decision=='rejected' and not (p.rejection_reason or '').strip(): raise HTTPException(422,'Rejection reason is required')
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            r=await conn.fetchrow('select * from public.calendar_booking_requests where id=$1 for update',request_id)
            if not r: raise HTTPException(404,'Request not found')
            if r['status']!='pending': raise HTTPException(409,'Request is no longer pending')
            if p.decision=='approved':
                bays=[Bay(**b) for b in (json.loads(r['bays']) if isinstance(r['bays'],str) else r['bays'])]
                names=[b.bay for b in bays]
                if any((await conflicts(r['prep_date'],r['ship_date'],names,exclude_job=r['job_id'],conn=conn)).values()):
                    raise HTTPException(409,'Bays are no longer available; reject or ask the PM to revise')
                if r['job_id']:
                    await conn.execute("""update public.calendar_jobs set name=$2,winhits_number=$3,prep_date=$4,ship_date=$5,prep_bays=$6,notes=$7,updated_at=now() where id=$1""",r['job_id'],r['name'],r['winhits_number'],r['prep_date'],r['ship_date'],names,r['notes'])
                    job_id=r['job_id']
                else:
                    j=await conn.fetchrow("""insert into public.calendar_jobs(name,winhits_number,prep_date,ship_date,prep_bays,created_by,notes)
                        values($1,$2,$3,$4,$5,$6,$7) returning id""",r['name'],r['winhits_number'],r['prep_date'],r['ship_date'],names,r['requester_id'],r['notes'])
                    job_id=j['id']
                if not r['job_id']:
                    await attach_job_group(conn, job_id, r['winhits_number'])
                    await update_group_metadata(conn, job_id, r['name'], r['winhits_number'])
                else:
                    await update_group_metadata(conn, job_id, r['name'], r['winhits_number'])
                await store_assignments(conn,job_id,bays)
                await conn.execute('update public.calendar_booking_requests set job_id=$2 where id=$1',request_id,job_id)
            await conn.execute("""update public.calendar_booking_requests set status=$2,rejection_reason=$3,reviewer_id=$4,reviewed_at=now(),updated_at=now() where id=$1""",request_id,p.decision,(p.rejection_reason or '').strip() if p.decision=='rejected' else None,user['id'])
            await notify(conn,r['requester_id'],'request_'+p.decision,f'{r["name"]}: {p.decision}'+(f' — {p.rejection_reason.strip()}' if p.decision=='rejected' else ''),request_id)
    finally: await conn.close()
    return {'ok':True}

@app.get('/api/prep-bays/notifications')
async def notifications(user=Depends(calendar_user)):
    rows=await query('select id,kind,message,request_id,created_at from public.calendar_notifications where user_id=$1 and read_at is null order by created_at desc limit 100',user['id'])
    return [{'id':str(r['id']),'kind':r['kind'],'message':r['message'],'request_id':str(r['request_id']) if r['request_id'] else None,'created_at':r['created_at'].isoformat()} for r in rows]

@app.post('/api/prep-bays/notifications/{notification_id}/read')
async def read_notification(notification_id:UUID,user=Depends(calendar_user)):
    await query('update public.calendar_notifications set read_at=now() where id=$1 and user_id=$2',notification_id,user['id'],execute=True)
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
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            if any((await conflicts(p.start_date,p.end_date,p.bays,conn=conn)).values()): raise HTTPException(409,'One or more prep bays are already booked')
            ids=[]
            for bay in p.bays:
                r=await conn.fetchrow('insert into public.calendar_manual_bookings(bay,label,department,start_date,end_date,created_by_name) values($1,$2,$3,$4,$5,$6) returning id',bay,p.label.strip(),p.department,p.start_date,p.end_date,user['email'])
                ids.append(str(r['id']))
            return {'ok':True,'ids':ids}
    finally: await conn.close()

@app.patch('/api/prep-bays/manual-booking/{booking_id}')
async def manual_edit(booking_id:UUID,p:ManualEdit,user=Depends(editor)):
    validate_manual([p.bay],p.label,p.department,p.start_date,p.end_date)
    conn=await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            if any((await conflicts(p.start_date,p.end_date,[p.bay],exclude_manual=booking_id,conn=conn)).values()): raise HTTPException(409,'Prep bay already booked')
            r=await conn.fetchrow('update public.calendar_manual_bookings set bay=$2,label=$3,department=$4,start_date=$5,end_date=$6 where id=$1 returning id',booking_id,p.bay,p.label.strip(),p.department,p.start_date,p.end_date)
            if not r: raise HTTPException(404,'Booking not found')
    finally: await conn.close()
    return {'ok':True}

@app.delete('/api/prep-bays/manual-booking/{booking_id}')
async def manual_delete(booking_id:UUID,user=Depends(editor)):
    await query('delete from public.calendar_manual_bookings where id=$1',booking_id,execute=True)
    return {'ok':True}


# Calendar-only account management. Never expose the Supabase secret to the browser.
class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    role: str = 'viewer'

class UserUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str
    enabled: bool = True

async def admin(user=Depends(calendar_user)):
    if user['role'] != 'admin':
        raise HTTPException(403, 'Administrator access required')
    return user

def check_role(role):
    if role not in ('viewer', 'editor', 'project_manager', 'operations_manager', 'admin'):
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
    rows = await query("""select c.user_id,c.name,c.role,c.enabled,u.email,u.created_at
                          from public.calendar_users c join auth.users u on u.id=c.user_id
                          order by lower(u.email)""")
    return [{'id': str(r['user_id']), 'email':r['email'], 'name':r['name'], 'role':r['role'],
             'enabled':r['enabled'], 'created_at':r['created_at'].isoformat()} for r in rows]

@app.post('/api/admin/users', status_code=201)
async def create_calendar_user(body:UserCreate, user=Depends(admin)):
    check_role(body.role)
    email=body.email.strip().lower()
    if '@' not in email or not email.split('@')[-1].count('.'):
        raise HTTPException(422, 'Invalid email address')
    name = body.name.strip()
    if not name: raise HTTPException(422, 'Name is required')
    # The temporary password is set only on the server and must be changed at first login.
    created = await supabase_admin('POST', 'users', {'email':email, 'password':'PrepBays1', 'email_confirm':True, 'user_metadata':{'name':name}})
    uid = UUID(created['id'])
    try:
        await query('insert into public.calendar_users(user_id,name,role,enabled,must_change_password) values($1,$2,$3,true,true)',uid,name,body.role,execute=True)
    except Exception:
        await supabase_admin('DELETE',f'users/{uid}')
        raise HTTPException(500,'Unable to save calendar permissions; user creation rolled back')
    return {'id':str(uid),'name':name,'email':email,'role':body.role,'enabled':True}

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
    name = body.name.strip()
    if not name: raise HTTPException(422, 'Name is required')
    await query('update public.calendar_users set name=$2,role=$3,enabled=$4 where user_id=$1',target,name,body.role,body.enabled,execute=True)
    return {'ok':True}

@app.delete('/api/admin/users/{target}')
async def delete_calendar_user(target:UUID,user=Depends(admin)):
    if target == user['id']:
        raise HTTPException(409,'You cannot delete your own account')
    await ensure_other_admin(target,new_role=None)
    # Delete the Supabase Auth identity. The FK cascade deletes calendar_users.
    await supabase_admin('DELETE',f'users/{target}')
    return {'ok':True}


@app.delete('/api/admin/jobs/{job_id}')
async def delete_calendar_job(job_id: UUID, user=Depends(admin)):
    """Permanently remove a job and free its bays; retain approval history."""
    conn = await db()
    try:
        async with conn.transaction():
            # Share the booking mutation lock to serialize deletion with approvals.
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            job = await conn.fetchrow(
                'select id, name, winhits_number from public.calendar_jobs where id=$1 for update',
                job_id,
            )
            if not job:
                raise HTTPException(404, 'Job not found')
            # The existing FK sets request.job_id to NULL, retaining request history.
            # Bay assignments cascade on job deletion.
            await conn.execute('delete from public.calendar_jobs where id=$1', job_id)
    finally:
        await conn.close()
    return {'ok': True, 'deleted_job_id': str(job_id)}


@app.delete('/api/admin/jobs/{job_id}/group')
async def delete_calendar_job_group(job_id: UUID, user=Depends(admin)):
    """Delete every booking in the linked job group, preserving request history."""
    conn = await db()
    try:
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(4172314)')
            job = await conn.fetchrow('select id, group_id from public.calendar_jobs where id=$1 for update', job_id)
            if not job:
                raise HTTPException(404, 'Job not found')
            group_id = job['group_id'] or job['id']
            rows = await conn.fetch('select id from public.calendar_jobs where group_id=$1 or (group_id is null and id=$2) for update', group_id, job_id)
            ids = [r['id'] for r in rows]
            # Approval history is retained, with its deleted booking reference cleared.
            await conn.execute('update public.calendar_booking_requests set job_id=null where job_id=any($1::uuid[])', ids)
            await conn.execute('delete from public.calendar_jobs where id=any($1::uuid[])', ids)
    finally:
        await conn.close()
    return {'ok': True, 'deleted_bookings': len(ids)}