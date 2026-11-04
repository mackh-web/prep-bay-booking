import { useEffect, useMemo, useState, useCallback } from "react";

import { api, formatErr } from "./apiClient";
import { useAuth } from "./AuthContext";

import { CaretLeft, CaretRight, CalendarBlank, Plus, X, Wrench, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

// Format API ISO dates without timezone conversion (UK day/month/year).
const ukDate = (value) => {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PREP_BAYS = [
  "Prep Bay 0", "Prep Bay 1", "Prep Bay 2", "Prep Bay 3",
  "Prep Bay 4 (Small GS)", "Prep Bay 5 (Small GS)",
  "Prep Bay 6", "Prep Bay 7", "Prep Bay 8", "Prep Bay 9",
  "Prep Bay 10 (Large GS)", "Prep Bay 11", "The Bridge",
];

const BAY_DEPARTMENTS = ["Lighting", "Video", "Rigging", "Automation"];

// Stable fallback avoids recreating empty arrays on each render.
// Cache only monthly calendar reads. Mutations invalidate the cache immediately.
const MONTH_CACHE_TTL_MS = 20_000;
const monthCache = new Map();
const monthInFlight = new Map();
const monthKey = (year, month) => `${year}-${month}`;

async function getMonth(year, month, force = false) {
  const key = monthKey(year, month);
  if (force) monthCache.delete(key);
  const cached = monthCache.get(key);
  if (cached && Date.now() - cached.time < MONTH_CACHE_TTL_MS) return cached.data;
  if (monthInFlight.has(key)) return monthInFlight.get(key);
  const pending = api.get('/prep-bays/bookings', { params: { year, month } })
    .then(response => {
      monthCache.set(key, { time: Date.now(), data: response.data });
      // Bound memory on long-running sessions.
      if (monthCache.size > 12) monthCache.delete(monthCache.keys().next().value);
      return response.data;
    }).finally(() => monthInFlight.delete(key));
  monthInFlight.set(key, pending);
  return pending;
}
export function invalidateCalendarCache() { monthCache.clear(); }
function invalidateMonths() { invalidateCalendarCache(); }
const EMPTY_ARRAY = [];

// Colour by department, not by individual job — every bay booked for the
// same department shows the same colour, so patterns are visible at a glance.
const DEPT_COLOURS = {
  "Lighting": { bg: "hsl(38 90% 50% / 0.85)", border: "hsl(38 90% 32%)" },
  "Video": { bg: "hsl(212 85% 55% / 0.85)", border: "hsl(212 85% 35%)" },
  "Rigging": { bg: "hsl(265 70% 58% / 0.85)", border: "hsl(265 70% 38%)" },
  "Automation": { bg: "hsl(160 70% 42% / 0.85)", border: "hsl(160 70% 27%)" },
};
const NO_DEPT_COLOUR = { bg: "hsl(0 0% 55% / 0.75)", border: "hsl(0 0% 35%)" };

function deptColour(department) {
  return DEPT_COLOURS[department] || NO_DEPT_COLOUR;
}

function daysInMonth(year, monthIndex /* 0-based */) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function isoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function PrepBayCalendar({onOpenJob = (id) => { window.location.hash = `#/jobs/${id}`; }, onOpenApprovals = () => { window.location.hash = '#/approvals'; }}) {
  const { user } = useAuth();
  const canBookBays = ["project_manager", "operations_manager", "admin"].includes(user?.role);
  const canManageDirect = ["operations_manager", "admin"].includes(user?.role);
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth()); // 0-based
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showBooking, setShowBooking] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [editJob, setEditJob] = useState(null);
  const [showRequests, setShowRequests] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const refreshNotifications = async () => { try { const r = await api.get("/prep-bays/notifications"); setNotifications(r.data); } catch {} };
  useEffect(() => { if (canBookBays) refreshNotifications(); }, [canBookBays]);

  const daysCount = daysInMonth(year, monthIndex);
  const days = Array.from({ length: daysCount }, (_, i) => i + 1);

  const load = async () => {
    invalidateMonths();
    setErr("");
    try {
      const result = await getMonth(year, monthIndex + 1, true);
      setData(result);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setErr("");
    // Display a recently visited month instantly, while preserving short TTL.
    const cached = monthCache.get(monthKey(year, monthIndex + 1));
    if (cached && Date.now() - cached.time < MONTH_CACHE_TTL_MS) setData(cached.data);
    else setData(null);
    getMonth(year, monthIndex + 1)
      .then(result => { if (!cancelled) setData(result); })
      .catch(e => { if (!cancelled) setErr(formatErr(e?.response?.data?.detail) || e.message); });
    return () => { cancelled = true; };
  }, [year, monthIndex]);

  const prev = () => {
    if (monthIndex === 0) { setYear(year - 1); setMonthIndex(11); }
    else setMonthIndex(monthIndex - 1);
  };
  const next = () => {
    if (monthIndex === 11) { setYear(year + 1); setMonthIndex(0); }
    else setMonthIndex(monthIndex + 1);
  };
  const jumpToday = () => {
    setYear(today.getFullYear()); setMonthIndex(today.getMonth());
  };

  const bays = data?.bays ?? EMPTY_ARRAY;
  const bookings = data?.bookings ?? EMPTY_ARRAY;
  const manualBookings = data?.manual_bookings ?? EMPTY_ARRAY;

  const clipToMonth = useCallback((startStr, endStr) => {
    const start = new Date(startStr + "T00:00:00Z");
    const end = new Date(endStr + "T00:00:00Z");
    const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
    const lastOfMonth = new Date(Date.UTC(year, monthIndex, daysCount));
    const clipStart = start < firstOfMonth ? firstOfMonth : start;
    const clipEnd = end > lastOfMonth ? lastOfMonth : end;
    if (clipStart > clipEnd) return null;
    return {
      startDay: clipStart.getUTCDate(), endDay: clipEnd.getUTCDate(),
      extendsLeft: start < firstOfMonth, extendsRight: end > lastOfMonth,
    };
  }, [year, monthIndex, daysCount]);

  // Build a map: bay -> array of bar descriptors (job or manual), each with department-based colour
  const barsByBay = useMemo(() => {
    const map = {};
    for (const bay of bays) map[bay] = [];
    for (const b of bookings) {
      for (const bay of b.prep_bays) {
        if (!(bay in map)) continue;
        const clip = clipToMonth(b.prep_date, b.ship_date);
        if (!clip) continue;
        const department = b.bay_departments?.[bay];
        map[bay].push({
          kind: "job", key: `job-${b.job_id}-${bay}`, ...clip,
          colour: deptColour(department), department,
          label: b.job_name, jobId: b.job_id,
          title: `${b.job_name} · ${ukDate(b.prep_date)} → ${ukDate(b.ship_date)}${department ? ` · ${department}` : ""}`,
        });
      }
    }
    for (const m of manualBookings) {
      if (!(m.bay in map)) continue;
      const clip = clipToMonth(m.start_date, m.end_date);
      if (!clip) continue;
      map[m.bay].push({
        kind: "manual", key: `manual-${m.id}`, ...clip,
        colour: deptColour(m.department), department: m.department,
        label: m.label, id: m.id, bay: m.bay, start_date: m.start_date, end_date: m.end_date,
        title: `${m.label} (manual) · ${ukDate(m.start_date)} → ${ukDate(m.end_date)}${m.department ? ` · ${m.department}` : ""}${m.created_by_name ? ` · by ${m.created_by_name}` : ""}`,
      });
    }
    return map;
  }, [bays, bookings, manualBookings, clipToMonth]);

  const todayIso = today.toISOString().slice(0, 10);

  const deleteManualBooking = async (id) => {
    if (!canBookBays) return;
    if (!window.confirm("Remove this manual booking?")) return;
    try {
      await api.delete(`/prep-bays/manual-booking/${id}`);
      toast.success("Manual booking removed");
      load();
    } catch (e) { toast.error(formatErr(e?.response?.data?.detail)); }
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0" data-testid="prep-bay-calendar-page">
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">Prep bays</div>
          <h1 className="font-display font-black text-xl leading-tight sm:text-3xl">Bay booking calendar</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">Live view of every job that occupies a prep bay this month. Colour reflects department.</p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          {canBookBays && (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full">
              <button onClick={() => setShowBooking(true)} data-testid="book-bays-btn"
                className="min-h-11 px-3 rounded-btn justify-center col-span-2 sm:col-span-1 bg-prg-red text-white text-xs font-bold uppercase tracking-widest inline-flex items-center gap-2">
                {canManageDirect ? "Book Bays" : "Request Bays"} <Plus size={14} />
              </button>
              {canManageDirect && <button onClick={() => setShowManual(true)} data-testid="manual-booking-btn"
                className="min-h-11 px-3 rounded-btn justify-center bg-secondary border border-border hover:border-prg-red text-xs font-bold uppercase tracking-widest inline-flex items-center gap-2">
                <Wrench size={14} /> Manual Booking
              </button>}
              {!canManageDirect && <button onClick={() => setShowRequests(true)} className="min-h-11 px-3 rounded-btn border border-border bg-secondary text-xs font-bold uppercase tracking-widest col-span-2 sm:col-span-1">My Requests</button>}
            </div>
          )}
          <div className="flex items-center justify-between sm:justify-start gap-2 w-full">
            <button onClick={prev} data-testid="calendar-prev" className="w-11 h-11 rounded-btn border border-border bg-secondary hover:border-prg-red flex items-center justify-center transition-colors shrink-0" aria-label="Previous month">
              <CaretLeft size={16} weight="bold" />
            </button>
            <div className="flex-1 sm:flex-none min-w-0 sm:min-w-[180px] text-center">
              <div className="font-display font-black text-base sm:text-xl" data-testid="calendar-month-label">{MONTHS[monthIndex]} {year}</div>
              <button onClick={jumpToday} data-testid="calendar-today" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-prg-red">Jump to today</button>
            </div>
            <button onClick={next} data-testid="calendar-next" className="w-11 h-11 rounded-btn border border-border bg-secondary hover:border-prg-red flex items-center justify-center transition-colors shrink-0" aria-label="Next month">
              <CaretRight size={16} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {err && <div className="text-sm text-red-400 border border-red-800 bg-red-500/10 rounded-input p-3">{err}</div>}
      {!data && !err && <div className="text-muted-foreground text-sm">Loading calendar…</div>}

      {data && <p className="text-xs text-muted-foreground sm:hidden" role="note">Swipe left or right across the calendar to view more dates.</p>}
      {data && (
        <div className="bg-card border border-border rounded-card overflow-hidden min-w-0">
          <div className="overflow-x-auto overscroll-x-contain scrollbar-slim touch-pan-x" role="region" aria-label="Prep bay calendar, scroll horizontally to view dates" tabIndex={0}>
            <div className="min-w-[1120px]">
              {/* Header row: day numbers */}
              <div className="grid" style={{ gridTemplateColumns: `160px repeat(${daysCount}, minmax(31px, 1fr))` }}>
                <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary border-b border-border sticky left-0 z-20">Bay</div>
                {days.map((d) => {
                  const iso = isoDate(year, monthIndex, d);
                  const isToday = iso === todayIso;
                  const weekday = new Date(Date.UTC(year, monthIndex, d)).getUTCDay(); // 0=Sun
                  const isWeekend = weekday === 0 || weekday === 6;
                  return (
                    <div key={d} className={`text-center py-2 text-[10px] font-semibold border-b border-l border-border ${isToday ? "bg-prg-red text-white" : isWeekend ? "bg-secondary/70 text-muted-foreground" : "bg-secondary text-foreground"}`}>
                      {d}
                    </div>
                  );
                })}
              </div>
              {/* Rows: one per bay */}
              {bays.map((bay, rowIdx) => (
                <div key={bay} className="grid relative" style={{ gridTemplateColumns: `160px repeat(${daysCount}, minmax(31px, 1fr))` }} data-testid={`calendar-row-${bay.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
                  <div className={`px-3 py-3 text-xs font-semibold border-b border-border sticky left-0 z-10 ${rowIdx % 2 === 0 ? "bg-card" : "bg-secondary"} truncate`}>{bay}</div>
                  {days.map((d) => {
                    const iso = isoDate(year, monthIndex, d);
                    const isToday = iso === todayIso;
                    const weekday = new Date(Date.UTC(year, monthIndex, d)).getUTCDay();
                    const isWeekend = weekday === 0 || weekday === 6;
                    return (
                      <div key={d} className={`h-10 border-b border-l border-border ${isToday ? "bg-prg-red/10" : isWeekend ? "bg-secondary" : ""}`} />
                    );
                  })}
                  {/* Absolute-positioned booking bars */}
                  {(barsByBay[bay] || []).map((b) => {
                    const totalDayCells = daysCount;
                    const startCol = b.startDay - 1;
                    const spanCols = b.endDay - b.startDay + 1;
                    const leftCalc = `calc(160px + (100% - 160px) * ${startCol} / ${totalDayCells})`;
                    const widthCalc = `calc((100% - 160px) * ${spanCols} / ${totalDayCells})`;
                    const style = {
                      left: leftCalc, width: widthCalc,
                      background: b.colour.bg,
                      border: b.kind === "manual" ? `1.5px dashed ${b.colour.border}` : `1px solid ${b.colour.border}`,
                      borderTopLeftRadius: b.extendsLeft ? 0 : 6,
                      borderBottomLeftRadius: b.extendsLeft ? 0 : 6,
                      borderTopRightRadius: b.extendsRight ? 0 : 6,
                      borderBottomRightRadius: b.extendsRight ? 0 : 6,
                    };
                    const className = "absolute top-1.5 h-7 rounded-md px-2 flex items-center text-[11px] font-semibold text-white overflow-hidden shadow-sm hover:brightness-110 transition-[filter]";
                    return b.kind === "job" ? (
                      <button type="button" key={b.key} data-testid={`calendar-bar-${b.key}`} className={`${className} text-left cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white`} style={style} title={`${b.title} · Open job details`} onClick={() => onOpenJob(b.jobId)} aria-label={`Open job details for ${b.label}`}>
                        <span className="truncate">{b.label}</span>
                      </button>
                    ) : (
                      <div key={b.key} data-testid={`calendar-bar-${b.key}`} className={className} style={style} title={b.title}>
                        <span className="truncate flex-1">{b.label}</span>
                        {canBookBays && (
                          <span className="flex items-center gap-1 shrink-0 ml-1">
                            <button
                              data-testid={`calendar-bar-edit-${b.id}`}
                              aria-label="Edit manual booking"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingBooking(b); }}
                              className="p-0.5 rounded hover:bg-black/20"
                            >
                              <PencilSimple size={11} weight="bold" />
                            </button>
                            <button
                              data-testid={`calendar-bar-delete-${b.id}`}
                              aria-label="Delete manual booking"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteManualBooking(b.id); }}
                              className="p-0.5 rounded hover:bg-black/20"
                            >
                              <Trash size={11} weight="bold" />
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {data && bookings.length === 0 && manualBookings.length === 0 && (
        <div className="bg-card border border-border rounded-card p-8 text-center text-muted-foreground text-sm inline-flex items-center gap-2">
          <CalendarBlank size={18} /> No prep bay bookings for {MONTHS[monthIndex]} {year}.
        </div>
      )}

      {data && (bookings.length > 0 || manualBookings.length > 0) && (
        <div className="bg-card border border-border rounded-card p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Department colours</div>
            <div className="flex flex-wrap gap-2">
              {BAY_DEPARTMENTS.map((d) => (
                <span key={d} className="inline-flex items-center gap-2 text-xs bg-secondary border border-border rounded-btn px-2.5 h-8">
                  <span className="w-3 h-3 rounded-sm" style={{ background: deptColour(d).bg, border: `1px solid ${deptColour(d).border}` }} />
                  {d}
                </span>
              ))}
              <span className="inline-flex items-center gap-2 text-xs bg-secondary border border-border rounded-btn px-2.5 h-8">
                <span className="w-3 h-3 rounded-sm" style={{ background: NO_DEPT_COLOUR.bg, border: `1px solid ${NO_DEPT_COLOUR.border}` }} />
                No department
              </span>
              <span className="inline-flex items-center gap-2 text-xs bg-secondary border border-border rounded-btn px-2.5 h-8">
                <span className="w-3 h-3 rounded-sm border-2 border-dashed" style={{ borderColor: NO_DEPT_COLOUR.border }} />
                Manual booking (dashed border)
              </span>
            </div>
          </div>
          {bookings.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Jobs this month</div>
              <div className="flex flex-wrap gap-2">
                {Array.from(bookings.reduce((groups, b) => {
                  // WinHits is the shared job reference; keep unnumbered records separate.
                  const number = String(b.winhits_number || '').trim().toLowerCase();
                  const key = number ? `winhits:${number}` : `booking:${b.job_id}`;
                  const current = groups.get(key);
                  if (!current) groups.set(key, { ...b, firstPrep: b.group_first_prep || b.prep_date, lastShip: b.group_last_ship || b.ship_date });
                  else {
                    if ((b.group_first_prep || b.prep_date) < current.firstPrep) current.firstPrep = b.group_first_prep || b.prep_date;
                    if ((b.group_last_ship || b.ship_date) > current.lastShip) current.lastShip = b.group_last_ship || b.ship_date;
                  }
                  return groups;
                }, new Map()).values())
                  .sort((a, b) => a.firstPrep.localeCompare(b.firstPrep))
                  .map((b) => (
                    <button type="button" key={b.winhits_number?.trim().toLowerCase() || b.job_id}
                      data-testid={`calendar-legend-${b.job_id}`}
                      className="inline-flex flex-wrap items-center gap-2 text-left text-xs bg-secondary border border-border rounded-btn px-3 py-2 min-h-9 hover:border-prg-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D11047] transition-colors"
                      onClick={() => onOpenJob(b.job_id)} aria-label={`Open ${b.job_name} job details`}>
                      <span className="font-semibold">{b.job_name}</span>
                      <span className="text-muted-foreground font-mono text-[11px]">{ukDate(b.firstPrep)} → {ukDate(b.lastShip)}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showBooking && (
        <BookBaysModal
          editing={editJob}
          onClose={() => { setShowBooking(false); setEditJob(null); }}
          onSaved={() => { setShowBooking(false); setEditJob(null); load(); refreshNotifications(); }}
        />
      )}

      {showRequests && !canManageDirect && <RequestsPanel onClose={() => setShowRequests(false)} onRefresh={() => { load(); refreshNotifications(); }} onEdit={(r) => { setEditJob(r); setShowRequests(false); setShowBooking(true); }} />}
      {/* Notifications are shown in the header bell; avoid a duplicate floating overlay on mobile. */}
      {showManual && (
        <ManualBookingModal
          onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); load(); }}
        />
      )}

      {editingBooking && (
        <ManualBookingModal
          editing={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSaved={() => { setEditingBooking(null); load(); }}
        />
      )}
    </div>
  );
}

/* Job details and bay selection are entered together. */
function BookBaysModal({onClose,onSaved,editing}) {
  const {user}=useAuth();
  const pm=user?.role==='project_manager';
  const [name,setName]=useState(editing?.name||'');
  const [winhits,setWinhits]=useState(editing?.winhits_number||'');
  const [prep,setPrep]=useState(editing?.prep_date||'');
  const [ship,setShip]=useState(editing?.ship_date||'');
  const [notes,setNotes]=useState(editing?.notes||'');
  const [selection,setSelection]=useState(()=>{
    const s={}; const entries=editing?.bays||[];
    if(entries.length) entries.forEach(b=>s[b.bay]=b.department||'');
    else (editing?.prep_bays||[]).forEach(b=>s[b]=editing?.bay_departments?.[b]||'');
    return s;
  });
  const [availability,setAvailability]=useState([]);
  const [availabilityLoading,setAvailabilityLoading]=useState(false);
  const [availabilityError,setAvailabilityError]=useState('');
  const [error,setError]=useState('');const [saving,setSaving]=useState(false);
  const datesValid=Boolean(prep && ship && ship >= prep);
  const excludedJobId=editing?.job_id || (editing?.request_id ? undefined : editing?.id);
  useEffect(()=>{
    let live=true;
    setAvailability([]);
    setAvailabilityError('');
    setAvailabilityLoading(datesValid);
    if(!datesValid){setSelection({});return()=>{live=false};}
    api.get('/prep-bays/availability',{params:{prep_date:prep,ship_date:ship,exclude_job_id:excludedJobId||undefined}})
      .then(r=>{if(live){setAvailability(r.data);setAvailabilityLoading(false);}})
      .catch(()=>{if(live){setAvailabilityError('Unable to check availability. Please try changing the dates or reopening this form.');setAvailabilityLoading(false);}});
    return()=>{live=false};
  },[prep,ship,excludedJobId]);
  const availabilityReady=datesValid && !availabilityLoading && !availabilityError && availability.length===PREP_BAYS.length;
  const unavailableBays=availability.filter(b=>!b.available).map(b=>b.bay);
  useEffect(()=>{
    if(availabilityReady) setSelection(previous=>Object.fromEntries(Object.entries(previous).filter(([bay])=>!unavailableBays.includes(bay))));
  },[availabilityReady,availability]);
  async function save(e){
    e.preventDefault();setError('');
    if(!datesValid){setError('Enter a valid Prep Date and Ship Date before selecting bays.');return;}
    if(!availabilityReady){setError('Please wait for bay availability to finish loading.');return;}
    if(!Object.keys(selection).length){setError('Select at least one available bay');return;}
    if(Object.keys(selection).some(bay=>unavailableBays.includes(bay))){setError('One or more selected bays are already booked.');return;}
    setSaving(true);
    const payload={name,winhits_number:winhits,prep_date:prep,ship_date:ship,notes,bays:Object.entries(selection).map(([bay,department])=>({bay,department:department||null}))};
    try {
      if(pm){if(editing?.request_id||editing?.requester_id)await api.put(`/prep-bays/requests/${editing.request_id||editing.id}`,payload);
        else await api.post('/prep-bays/requests',payload);
        toast.success('Request sent for approval');}
      else if(editing?.id) {await api.patch(`/prep-bays/booking/${editing.id}`,payload);toast.success('Booking updated');}
      else {await api.post('/prep-bays/booking',payload);toast.success('Booking confirmed');}
      onSaved();
    }catch(err){setError(formatErr(err?.response?.data?.detail)||err.message)}finally{setSaving(false)}
  }
  return <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-4"><form onSubmit={save} className="w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[92vh] overflow-y-auto bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4">
    <div className="flex justify-between items-center"><h2 className="text-xl font-black">{editing?'Edit':'New'} {pm?'bay request':'bay booking'}</h2><button type="button" onClick={onClose}><X size={18}/></button></div>
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-sm">Job name<input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} className="block w-full mt-1 p-2 bg-secondary border border-border rounded"/></label>
      <label className="text-sm">WinHits number<input required maxLength={100} value={winhits} onChange={e=>setWinhits(e.target.value)} className="block w-full mt-1 p-2 bg-secondary border border-border rounded"/></label>
      <label className="text-sm">Prep date<input required type="date" lang="en-GB" value={prep} onChange={e=>setPrep(e.target.value)} className="block w-full mt-1 p-2 bg-secondary border border-border rounded"/></label>
      <label className="text-sm">Ship date<input required type="date" lang="en-GB" min={prep} value={ship} onChange={e=>setShip(e.target.value)} className="block w-full mt-1 p-2 bg-secondary border border-border rounded"/></label>
    </div>
    <label className="block text-sm">Notes / bay justification (optional)<textarea maxLength={3000} rows={3} value={notes} onChange={e=>setNotes(e.target.value)} className="block w-full mt-1 p-2 bg-secondary border border-border rounded" placeholder="Why are these particular bays required?"/></label>
    <div className="font-semibold text-sm">Select prep bays</div>
    {!datesValid ? <p className="text-sm text-muted-foreground">Enter both Prep Date and Ship Date first to see available bays.</p>
    : availabilityLoading ? <p className="text-sm text-muted-foreground">Checking bay availability…</p>
    : availabilityError ? <p className="text-sm text-red-400" role="alert">{availabilityError}</p>
    : <div className="grid sm:grid-cols-2 gap-2">{PREP_BAYS.map(bay=>{
      const selected=Object.hasOwn(selection,bay);
      const conflict=availability.find(x=>x.bay===bay)?.conflicts?.[0];
      const disabled=!availabilityReady || Boolean(conflict);
      return <div key={bay} className={`border border-border rounded p-2 ${disabled?'opacity-60':''}`}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected && !disabled} disabled={disabled} onChange={e=>setSelection(current=>{const next={...current};if(e.target.checked)next[bay]='';else delete next[bay];return next;})}/>{bay}</label>
        {conflict&&<div className="text-xs text-amber-400">Unavailable — booked by {conflict.job_name}</div>}
        {selected&&!disabled&&<select aria-label={`Department for ${bay}`} className="w-full mt-2 bg-secondary border border-border p-1 text-xs" value={selection[bay]} onChange={e=>setSelection(current=>({...current,[bay]:e.target.value}))}><option value="">No department</option>{BAY_DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}</select>}
      </div>})}</div>}
    {pm&&<p className="text-xs text-muted-foreground">Requests do not reserve bays. Existing approved bookings remain unchanged until your revision is approved.</p>}
    {error&&<p className="text-red-400 text-sm" role="alert">{error}</p>}
    <div className="flex gap-3"><button disabled={saving || !availabilityReady || !Object.keys(selection).length} className="bg-prg-red text-white px-4 py-2 rounded disabled:opacity-50">{saving?'Saving…':pm?'Submit for approval':'Confirm booking'}</button><button type="button" onClick={onClose} className="border border-border rounded px-4 py-2">Cancel</button></div>
  </form></div>
}

function RequestsPanel({onClose,onRefresh,onEdit}){
  const {user}=useAuth();const ops=['operations_manager','admin'].includes(user?.role);
  const [requests,setRequests]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{try{const r=await api.get('/prep-bays/requests');setRequests(r.data)}catch(e){setError(formatErr(e?.response?.data?.detail)||e.message)}};
  useEffect(()=>{load()},[]);
  async function decide(r,decision){let rejection_reason=null;if(decision==='rejected'){rejection_reason=window.prompt('Reason for rejection (required):');if(!rejection_reason?.trim())return;}
    setBusy(true);setError('');try{await api.post(`/prep-bays/requests/${r.id}/decision`,{decision,rejection_reason});toast.success(`Request ${decision}`);await load();onRefresh()}catch(e){setError(formatErr(e?.response?.data?.detail)||e.message)}finally{setBusy(false)}}
  return <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto p-4"><div className="max-w-3xl mx-auto bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4"><div className="flex justify-between"><h2 className="text-xl font-black">{ops?'Approval queue and requests':'My bay requests'}</h2><button onClick={onClose}><X size={18}/></button></div>
    {error&&<p className="text-red-400 text-sm">{error}</p>}{!requests.length&&<p className="text-sm text-muted-foreground">No requests yet.</p>}
    {requests.map(r=><div key={r.id} className="border border-border rounded p-4 space-y-2"><div className="flex justify-between gap-2"><div className="font-bold">{r.name} · {r.winhits_number}</div><span className="text-sm capitalize">{r.status}</span></div><div className="text-xs text-muted-foreground">{ukDate(r.prep_date)} → {ukDate(r.ship_date)} · {r.bays.map(b=>b.bay).join(', ')}</div>
      {r.notes&&<div className="text-sm">Notes: {r.notes}</div>}{r.rejection_reason&&<div className="text-sm text-red-400">Rejection reason: {r.rejection_reason}</div>}
      <div className="flex flex-wrap gap-2">{ops&&r.status==='pending'&&<><button disabled={busy} onClick={()=>decide(r,'approved')} className="bg-prg-red text-white rounded px-3 py-2 text-sm">Approve</button><button disabled={busy} onClick={()=>decide(r,'rejected')} className="border border-border rounded px-3 py-2 text-sm">Reject</button></>}{!ops&&r.status!=='approved'&&<button className="border border-border rounded px-3 py-2 text-sm" onClick={()=>onEdit({...r,request_id:r.id})}>Edit / Resubmit</button>}</div>
    </div>)}<button className="border border-border rounded px-3 py-2" onClick={onClose}>Close</button></div></div>
}

/* ---------------- Manual Booking modal (Admin / Ops Manager only) ----------------
   Books a bay for a date range without linking it to a job — for maintenance,
   equipment testing, or other operational blocks. */
function ManualBookingModal({ onClose, onSaved, editing }) {
  const [label, setLabel] = useState(editing?.label || "");
  const [department, setDepartment] = useState(editing?.department || "");
  const [startDate, setStartDate] = useState(editing?.start_date || "");
  const [endDate, setEndDate] = useState(editing?.end_date || "");
  const [selectedBays, setSelectedBays] = useState(editing ? [editing.bay] : []);
  const [availability, setAvailability] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!startDate || !endDate) { setAvailability([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = { prep_date: startDate, ship_date: endDate };
        if (editing) params.exclude_manual_id = editing.id;
        const { data } = await api.get("/prep-bays/availability", { params });
        if (!cancelled) setAvailability(data);
      } catch { if (!cancelled) setAvailability([]); }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate, editing]);

  const toggleBay = (bay) => {
    if (editing) { setSelectedBays([bay]); return; } // editing operates on a single bay
    setSelectedBays((bs) => (bs.includes(bay) ? bs.filter((b) => b !== bay) : [...bs, bay]));
  };

  const availabilityFor = (bay) => availability.find((a) => a.bay === bay);

  const save = async () => {
    if (!label.trim()) { setError("Label is required"); return; }
    if (!startDate || !endDate) { setError("Start and end dates are required"); return; }
    if (selectedBays.length === 0) { setError("Select at least one bay"); return; }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.patch(`/prep-bays/manual-booking/${editing.id}`, {
          bay: selectedBays[0], label: label.trim(), department: department || null,
          start_date: startDate, end_date: endDate,
        });
        toast.success("Manual booking updated");
      } else {
        await api.post("/prep-bays/manual-booking", {
          bays: selectedBays, label: label.trim(), department: department || null,
          start_date: startDate, end_date: endDate,
        });
        toast.success("Manual booking created");
      }
      onSaved();
    } catch (e) {
      setError(formatErr(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" data-testid="manual-booking-modal">
      <div className="w-full max-w-2xl bg-card border border-border rounded-modal p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto scrollbar-slim">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">Prep bays</div>
            <h3 className="font-display font-black text-xl">{editing ? "Edit Manual Booking" : "Manual Booking"}</h3>
            <p className="text-xs text-muted-foreground mt-1">{editing ? "Update this booking's details." : "Block a bay for maintenance, testing, or other operational purposes — not tied to a job."}</p>
          </div>
          <button onClick={onClose} data-testid="manual-booking-close" className="p-2 rounded-btn hover:bg-secondary"><X size={16} /></button>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Label (required)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Maintenance, Equipment Testing"
            data-testid="manual-booking-label" className="mt-1 w-full h-10 px-3 rounded-input bg-background border border-border text-sm focus:outline-none focus:border-prg-red" />
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Start date</span>
            <input type="date" lang="en-GB" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="manual-booking-start"
              className="mt-1 w-full h-9 px-2 rounded-btn bg-background border border-border text-sm" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">End date</span>
            <input type="date" lang="en-GB" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="manual-booking-end"
              className="mt-1 w-full h-9 px-2 rounded-btn bg-background border border-border text-sm" />
          </label>
          <label className="block col-span-2 sm:col-span-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Department (optional)</span>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="manual-booking-department"
              className="mt-1 w-full h-9 px-2 rounded-btn bg-background border border-border text-sm">
              <option value="">None</option>
              {BAY_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Bays</div>
          {!startDate || !endDate ? (
            <div className="text-sm text-muted-foreground">Set both dates to see bay availability.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {PREP_BAYS.map((bay) => {
                const selected = selectedBays.includes(bay);
                const avail = availabilityFor(bay);
                const conflict = avail?.conflicts?.[0];
                const disabled = !selected && avail && !avail.available;
                return (
                  <button
                    key={bay}
                    type="button"
                    onClick={() => !disabled && toggleBay(bay)}
                    disabled={disabled}
                    data-testid={`manual-booking-bay-${bay.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                    title={conflict ? `Booked by ${conflict.job_name} (${ukDate(conflict.prep_date)} → ${ukDate(conflict.ship_date)})` : bay}
                    className={`text-left px-3 py-2 rounded-btn border text-sm font-semibold transition-colors ${
                      selected ? "bg-prg-red text-white border-prg-red"
                        : disabled ? "border-border bg-background/50 text-muted-foreground/50 line-through cursor-not-allowed"
                        : "border-border bg-background hover:border-prg-red"
                    }`}
                  >
                    {bay}
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-1">Strikethrough = already booked (by a job or another manual booking) during this window.</div>
        </div>

        {error && <div className="text-sm text-red-400 border border-red-800 bg-red-500/10 rounded-input p-3">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={saving} data-testid="manual-booking-save"
            className="h-9 px-4 rounded-btn bg-prg-red text-white text-xs font-bold uppercase tracking-widest disabled:opacity-60">
            {saving ? "Saving…" : editing ? "Save changes" : "Create booking"}
          </button>
          <button onClick={onClose} className="h-9 px-4 rounded-btn border border-border text-xs font-bold uppercase tracking-widest">Cancel</button>
        </div>
      </div>
    </div>
  );
}