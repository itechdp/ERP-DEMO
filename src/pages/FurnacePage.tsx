import { useState } from 'react';
import { Clock, Flame, Pencil, Plus, Power, Timer, Trash2 } from 'lucide-react';
import { Write } from '../auth/access';
import { Empty, Field, JobLink, Modal, PageHeader } from '../components/ui';
import { fmtNum } from '../components/format';
import { AssignModal, TimerModal, type WaitingBatch } from '../furnaces/AssignModal';
import { deleteFurnace, fmtLeft, fmtTime, releaseFurnaceLoad, saveFurnace, useFurnaces, type Furnace, type FurnaceLoad } from '../furnaces/service';
import { usePlan } from '../planning/usePlan';
import { clampPriority, jobPriority, priorityChip, priorityName } from '../planning/priority';
import { getJob, getProduct } from '../store/engine';
import { useStore } from '../store/StoreContext';

const DAY = 24 * 3600 * 1000;
const midnight = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();

/** big timer ring: how much of the set time has gone, with the time left in the middle */
function Ring({ pct, big, small, tone }: { pct: number; big: string; small: string; tone: 'run' | 'free' | 'off' }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className={`fring fring-${tone}`}>
      <svg viewBox="0 0 110 110" aria-hidden>
        <circle cx="55" cy="55" r={r} className="fring-track" />
        <circle cx="55" cy="55" r={r} className="fring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))} transform="rotate(-90 55 55)" />
      </svg>
      <div className="fring-text">
        <b>{big}</b>
        <span>{small}</span>
      </div>
    </div>
  );
}

/** today's 24 hours with the AM / PM split; the bar is the time this furnace is busy */
function DayStrip({ load, now }: { load: FurnaceLoad | null; now: number }) {
  const start = midnight(now);
  const clip = (t: number) => Math.min(DAY, Math.max(0, t - start)) / DAY;
  const a = load ? clip(Date.parse(load.startedAt)) : 0;
  const b = load ? clip(Date.parse(load.endsAt)) : 0;
  return (
    <div className="fday" title="Today, 12 am to 12 am">
      <div className="fday-track">
        <span className="fday-pm" />
        {load && b > a && <span className="fday-busy" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} />}
        <span className="fday-now" style={{ left: `${clip(now) * 100}%` }} />
      </div>
      <div className="fday-scale">
        <span>12a</span>
        <span>AM</span>
        <span>12p</span>
        <span>PM</span>
        <span>12a</span>
      </div>
    </div>
  );
}

/**
 * Workflow → Furnace Management: a card per furnace (timer ring, the batch inside, today's strip, actions) and the queue of batches
 * waiting for a furnace, ranked as Heat Treatment Planning approved them. A furnace holds one batch at a time.
 */
export function FurnacePage() {
  const { state, toast } = useStore();
  const fu = useFurnaces();
  const plan = usePlan();
  const [renaming, setRenaming] = useState<Furnace | 'new' | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState<{ furnaceId?: number; jobNo?: string } | null>(null);
  const [timerFor, setTimerFor] = useState<{ load: FurnaceLoad; furnace: Furnace } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await fu.refresh();
      toast({ kind: 'success', title: ok });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: 'Could not update the furnaces', message: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // batches whose pieces are waiting at Heat Treatment and that are not in a furnace yet — by priority (1 Urgent first), then due date
  const queue = state.heatTreatment
    .filter((r) => r.status !== 'Completed' && !r.params.auto && !r.params.skipped && !fu.loadOfJob(r.jobNo))
    .map((r) => ({ r, job: getJob(state, r.jobNo), ap: plan.find(r.jobNo, 'heatTreatment') }))
    .map((x) => ({ ...x, level: x.ap ? clampPriority(x.ap.rank) : jobPriority(x.job) }))
    .sort((a, b) => a.level - b.level || (a.job.dueDate || '9').localeCompare(b.job.dueDate || '9'));
  const waiting: WaitingBatch[] = queue.map((x) => ({ jobNo: x.r.jobNo, label: `${x.r.jobNo} · ${getProduct(state, x.job.productId).name} · ${fmtNum(x.r.input)} PCS` }));

  const running = fu.active.filter((f) => fu.runningIn(f.id)).length;
  const off = fu.furnaces.length - fu.active.length;
  const nextFree = fu.nextFreeAt();

  const openRename = (f: Furnace | 'new') => {
    setRenaming(f);
    setName(f === 'new' ? '' : f.name);
  };
  const saveName = async () => {
    const f = renaming === 'new' ? null : renaming;
    if (await act(() => saveFurnace(f?.id ?? null, name, f?.active ?? true), f ? 'Furnace updated' : 'Furnace added')) setRenaming(null);
  };

  const add = (
    <Write res="furnaces">
      <button className="btn btn-primary" onClick={() => openRename('new')}>
        <Plus size={15} /> Add Furnace
      </button>
    </Write>
  );

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Furnace Management" actions={fu.furnaces.length > 0 ? add : undefined} />
      {fu.furnaces.length === 0 ? (
        <div className="card">
          <Empty icon={Flame} title="No furnaces yet" text="Add the plant's furnaces here. Heat Treatment then waits for a free furnace before a batch can start." action={add} />
        </div>
      ) : (
        <>
          <div className="fstats">
            <div className="fstat">
              <span>Furnaces</span>
              <b>{fu.active.length}</b>
              {off > 0 && <small>{off} switched off</small>}
            </div>
            <div className="fstat fstat-run">
              <span>Running</span>
              <b>{running}</b>
            </div>
            <div className="fstat fstat-free">
              <span>Free now</span>
              <b>{fu.free.length}</b>
            </div>
            <div className={`fstat ${queue.length && !fu.free.length ? 'fstat-hold' : ''}`}>
              <span>Batches waiting</span>
              <b>{queue.length}</b>
              {queue.length > 0 && !fu.free.length && nextFree && <small>next furnace free at {fmtTime(nextFree)}</small>}
            </div>
          </div>

          <div className="fgrid">
            <div className="fcards">
              {fu.furnaces.map((f) => {
                const run = f.active ? fu.runningIn(f.id) : null;
                const job = run ? getJob(state, run.jobNo) : null;
                const rec = run ? state.heatTreatment.find((r) => r.jobNo === run.jobNo && r.status !== 'Completed') : undefined;
                const total = run ? Date.parse(run.endsAt) - Date.parse(run.startedAt) : 0;
                const pct = run && total > 0 ? (fu.now - Date.parse(run.startedAt)) / total : 0;
                const left = run ? Math.max(0, Math.round((Date.parse(run.endsAt) - fu.now) / 60000)) : 0;
                const tone = !f.active ? 'off' : run ? 'run' : 'free';
                return (
                  <div key={f.id} className={`fcard fcard-${tone}`}>
                    <div className="fcard-head">
                      <div>
                        <div className="fcard-name">{f.name}</div>
                        <span className={`chip ${tone === 'run' ? 'chip-run' : tone === 'free' ? 'chip-up' : 'chip-subtle'}`}>{tone === 'run' ? 'Running' : tone === 'free' ? 'Free' : 'Switched off'}</span>
                        {run?.shift && <span className="chip chip-subtle" style={{ marginLeft: 6 }}>{run.shift} shift</span>}
                      </div>
                      <Write res="furnaces">
                        <div className="icon-actions">
                          <button className="icon-btn" title="Rename" aria-label={`Rename ${f.name}`} onClick={() => openRename(f)}>
                            <Pencil size={15} />
                          </button>
                          <button className="icon-btn" title={f.active ? 'Switch off' : 'Switch on'} aria-label={`Switch ${f.name}`} disabled={busy || !!run} onClick={() => void act(() => saveFurnace(f.id, f.name, !f.active), f.active ? 'Furnace switched off' : 'Furnace switched on')}>
                            <Power size={15} />
                          </button>
                          <button className="icon-btn danger" title="Delete (only if never used)" aria-label={`Delete ${f.name}`} disabled={busy || !!run} onClick={() => void act(() => deleteFurnace(f.id), 'Furnace deleted')}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </Write>
                    </div>

                    <div className="fcard-body">
                      <Ring
                        tone={tone}
                        pct={run ? pct : tone === 'free' ? 0 : 0}
                        big={run ? (left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}m`) : tone === 'free' ? 'FREE' : 'OFF'}
                        small={run ? 'time left' : tone === 'free' ? 'ready to load' : 'not in use'}
                      />
                      <div className="fcard-info">
                        {run && job ? (
                          <>
                            <div className="fcard-job">
                              <JobLink jobNo={run.jobNo} />
                            </div>
                            <div className="sub">
                              {getProduct(state, job.productId).name}
                              {rec ? ` · ${fmtNum(rec.input)} PCS` : ''}
                              {run.cycleNo ? ` · cycle ${run.cycleNo}` : ''}
                            </div>
                            <div className="fcard-times">
                              <Clock size={13} /> {fmtTime(run.startedAt)} → <b>{fmtTime(run.endsAt)}</b>
                            </div>
                            <div className="fcard-left">{fmtLeft(run.endsAt, fu.now)}</div>
                            {run.loadedBy && <div className="fcard-by">Loaded by {run.loadedBy}</div>}
                          </>
                        ) : tone === 'free' ? (
                          <div className="sub">{queue.length ? `${queue.length} batch${queue.length === 1 ? '' : 'es'} waiting for a furnace.` : 'No batch is waiting at Heat Treatment.'}</div>
                        ) : (
                          <div className="sub">Switched off — it is not offered for any batch.</div>
                        )}
                      </div>
                    </div>

                    <DayStrip load={run} now={fu.now} />

                    <Write res="furnaces">
                      <div className="fcard-actions">
                        {run ? (
                          <>
                            <button className="btn btn-subtle" disabled={busy} onClick={() => setTimerFor({ load: run, furnace: f })}>
                              <Timer size={14} /> Edit timer
                            </button>
                            <button className="btn btn-subtle" disabled={busy} onClick={() => void act(() => releaseFurnaceLoad(run.id), 'Furnace released')}>
                              Release
                            </button>
                          </>
                        ) : (
                          tone === 'free' && (
                            <button className="btn btn-primary" disabled={busy || queue.length === 0} title={queue.length ? undefined : 'No batch is waiting at Heat Treatment'} onClick={() => setLoading({ furnaceId: f.id })}>
                              <Flame size={14} /> Load batch
                            </button>
                          )
                        )}
                      </div>
                    </Write>
                  </div>
                );
              })}
            </div>

            <div className="card fqueue">
              <div className="card-head">
                <div>
                  <h3>Waiting for a furnace</h3>
                  <div className="sub">Most urgent first</div>
                </div>
              </div>
              {queue.length === 0 ? (
                <div className="fqueue-empty">Nothing waiting. Batches appear here once their pieces reach Heat Treatment.</div>
              ) : (
                <ol className="fqueue-list">
                  {queue.map((x, i) => (
                    <li key={x.r.jobNo}>
                      <span className="fq-rank">{i + 1}</span>
                      <div className="fq-main">
                        <div>
                          <JobLink jobNo={x.r.jobNo} /> <span className="sub">· {fmtNum(x.r.input)} PCS</span>
                        </div>
                        <div className="sub">
                          {getProduct(state, x.job.productId).name}
                          {x.job.dueDate ? ` · due ${x.job.dueDate.slice(8, 10)}-${x.job.dueDate.slice(5, 7)}` : ''}
                        </div>
                        <div>
                          <span className={priorityChip(x.level)}>{priorityName(x.level)}</span>{' '}
                          {x.ap ? <span className="chip chip-up">Approved</span> : plan.enforce ? <span className="chip chip-wait">Needs approval</span> : null}
                          {!fu.free.length && <span className="chip chip-wait" style={{ marginLeft: 6 }}>On hold</span>}
                        </div>
                      </div>
                      <Write res="furnaces">
                        <button className="btn btn-subtle" disabled={busy || fu.free.length === 0} title={fu.free.length ? undefined : 'No furnace is free'} onClick={() => setLoading({ jobNo: x.r.jobNo })}>
                          Load
                        </button>
                      </Write>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}

      {loading && <AssignModal jobNo={loading.jobNo} furnaceId={loading.furnaceId} batches={waiting} fu={fu} onClose={() => setLoading(null)} onDone={async () => { setLoading(null); await fu.refresh(); }} />}
      {timerFor && <TimerModal load={timerFor.load} furnaceName={timerFor.furnace.name} onClose={() => setTimerFor(null)} onDone={async () => { setTimerFor(null); await fu.refresh(); }} />}
      {renaming && (
        <Modal
          dialog
          open
          onClose={() => setRenaming(null)}
          title={renaming === 'new' ? 'Add Furnace' : `Rename ${renaming.name}`}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void saveName()}>
                Save
              </button>
            </>
          }
        >
          <Field label="Furnace name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Furnace F-01 (Box)" autoFocus />
          </Field>
        </Modal>
      )}
    </>
  );
}
