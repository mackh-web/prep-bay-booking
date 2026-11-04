-- Run on a NEW, dedicated Supabase project for complete separation from the Job Portal.
-- Auth accounts and all calendar data are exclusive to this project.
create extension if not exists pgcrypto;
create table if not exists public.calendar_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.calendar_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  winhits_number text,
  prep_date date not null,
  ship_date date not null,
  status text not null default 'Order',
  prep_bays text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_job_dates check (ship_date >= prep_date)
);
create index if not exists idx_calendar_jobs_dates on public.calendar_jobs(prep_date,ship_date);
create table if not exists public.calendar_job_bay_assignments (
  job_id uuid not null references public.calendar_jobs(id) on delete cascade,
  bay text not null,
  department text,
  primary key(job_id,bay)
);
create table if not exists public.calendar_manual_bookings (
  id uuid primary key default gen_random_uuid(),
  bay text not null,
  label text not null,
  department text,
  start_date date not null,
  end_date date not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint calendar_manual_dates check (end_date >= start_date)
);
create index if not exists idx_calendar_manual_dates on public.calendar_manual_bookings(start_date,end_date);
-- No direct browser access to tables: all reads/writes pass through the authenticated API.
alter table public.calendar_users enable row level security;
alter table public.calendar_jobs enable row level security;
alter table public.calendar_job_bay_assignments enable row level security;
alter table public.calendar_manual_bookings enable row level security;
revoke all on public.calendar_users,public.calendar_jobs,public.calendar_job_bay_assignments,public.calendar_manual_bookings from anon,authenticated;
-- Create a user in Authentication > Users, then grant access:
-- insert into public.calendar_users(user_id,role)
-- select id,'editor' from auth.users where lower(email)=lower('you@example.com');
