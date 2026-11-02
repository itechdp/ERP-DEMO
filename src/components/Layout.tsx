import { ROUTE_RESOURCE, WRITABLE_PAGES, searchable, useAccess } from '../auth/access';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  BellRing,
  Briefcase,
  Building2,
  FileBarChart,
  Gauge,
  Landmark,
  Handshake,
  Receipt,
  ReceiptText,
  Ruler,
  ChevronDown,
  ClipboardList,
  Layers,
  LogOut,
  Scissors,
  Hammer,
  FileClock,
  FileSpreadsheet,
  FileText,
  Cog,
  LayoutGrid,
  Moon,
  Package,
  PanelLeft,
  ScrollText,
  Search,
  Send,
  ShoppingBag,
  Sun,
  Waypoints,
  Wallet,
  Workflow,
  KeyRound,
  Settings,
  Eye,
  Users,
} from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { jobSummary, STAGE_LABEL } from '../store/engine';
import { Badge, FLOW_STEPS, go, type Icon } from './ui';
import { pendingSteps } from './workflow';
import { SALES_PAGES } from '../pages/SalesPages';
import { useFollowups } from '../followups/useFollowups';
import { NotificationBell } from '../tasks/NotificationBell';
import { useResponsiveTables } from './responsiveTables';
import { dueText } from '../followups/types';

export interface NavItem {
  route: string;
  label: string;
  icon: Icon;
}

const WORKFLOW_NAV: NavItem[] = FLOW_STEPS.map((s) => ({
  route: s.route,
  label: s.key === 'forging' ? 'Forging / Manufacturing' : s.label,
  icon: s.icon,
})).concat([{ route: 'job-work', label: 'Job Work', icon: Handshake }]);
const SALES_NAV: NavItem[] = SALES_PAGES.map((p) => ({ route: p.route, label: p.label, icon: p.icon }));
const PURCHASE_NAV: NavItem[] = [
  { route: 'purchase-dashboard', label: 'Purchase Dashboard', icon: LayoutGrid },
  { route: 'purchase-requisitions', label: 'Purchase Requisitions', icon: FileText },
  { route: 'rfqs', label: 'Requests for Quotation', icon: Send },
  { route: 'supplier-quotations', label: 'Supplier Quotations', icon: FileSpreadsheet },
  { route: 'purchase-orders', label: 'Purchase Orders', icon: ReceiptText },
  { route: 'purchase-invoices', label: 'Purchase Invoices', icon: Receipt },
  { route: 'purchase-payments', label: 'Payments', icon: Wallet },
  { route: 'supplier-payables', label: 'Supplier Payables', icon: Landmark },
  { route: 'suppliers', label: 'Supplier Master', icon: Building2 },
  { route: 'supplier-performance', label: 'Supplier Performance', icon: Gauge },
  { route: 'purchase-reports', label: 'Purchase Reports', icon: FileBarChart },
];
const REPORT_NAV: NavItem[] = [
  { route: 'traceability', label: 'Job Traceability', icon: Waypoints },
  { route: 'ledger', label: 'Quantity Ledger', icon: ScrollText },
  { route: 'products', label: 'Product Master', icon: Package },
];
const DIE_NAV: NavItem[] = [
  { route: 'die-master', label: 'Die Master', icon: Layers },
  { route: 'forging-die-master', label: 'Forging Die Master', icon: Hammer },
  { route: 'trimming-die-master', label: 'Trimming Die Master', icon: Scissors },
  { route: 'die-details', label: 'Die Details / History', icon: FileClock },
];
export const ALL_NAV: NavItem[] = [{ route: 'dashboard', label: 'Dashboard', icon: LayoutGrid }, ...WORKFLOW_NAV, ...REPORT_NAV];

const SECTIONS: { id: string; title: string; icon: Icon; items: NavItem[] }[] = [
  { id: 'main', title: 'Main Menu', icon: LayoutGrid, items: [ALL_NAV[0], { route: 'work-hub', label: 'Work Hub', icon: ClipboardList }, ...WORKFLOW_NAV.filter((n) => n.route === 'raw-inventory'), { route: 'follow-ups', label: 'Follow-ups', icon: BellRing }] },
  { id: 'sales', title: 'Sales & Orders', icon: Briefcase, items: SALES_NAV },
  { id: 'purchase', title: 'Purchase & Procurement', icon: ShoppingBag, items: PURCHASE_NAV },
  { id: 'flow', title: 'Workflow', icon: Workflow, items: WORKFLOW_NAV.filter((n) => n.route !== 'raw-inventory') },
  { id: 'dies', title: 'Die Management', icon: Cog, items: DIE_NAV },
  { id: 'reports', title: 'Reports & Masters', icon: BarChart3, items: REPORT_NAV },
];

const SETTINGS_SECTION = { id: 'settings', title: 'Settings', icon: Settings, items: [{ route: 'settings', label: 'Access Control', icon: KeyRound }, { route: 'users', label: 'Users', icon: Users }, { route: 'units', label: 'Units', icon: Ruler }] as NavItem[] };

const readLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode — preference just isn't remembered */
  }
};

/** Closes a popover when clicking anywhere outside `ref`. */
function useOutside(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, open, close]);
}

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const { state } = useStore();
  const { canRead, level, canManageAccess } = useAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  useResponsiveTables();
  const [mini, setMini] = useState(() => readLS('forgeflow.sidebar') === 'mini');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeLS('forgeflow.theme', theme);
  }, [theme]);

  // Jobs waiting at each stage (sidebar badges)
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of state.jobs) {
      const st = FLOW_STEPS.find((f) => f.key === j.currentStage);
      if (st && j.currentStage !== 'dispatched') c[st.route] = (c[st.route] ?? 0) + 1;
    }
    c['dispatch'] = state.dispatches.filter((d) => d.status === 'Ready for Dispatch').length;
    return c;
  }, [state]);

  const toggleSidebar = () => {
    if (window.innerWidth <= 960) return setMobileOpen(true);
    setMini((m) => {
      writeLS('forgeflow.sidebar', m ? 'full' : 'mini');
      return !m;
    });
  };

  return (
    <div className={`app ${mini ? 'mini' : ''}`}>
      <div className={`scrim ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <img
            src={mini ? "/everest-icon.png" : "/everest-logo.png"}
            alt="Everest Auto Forge"
            className="brand-logo-img"
          />
        </div>
        <nav className="nav">
          {[
            // pages that are Hidden for this role are not in the menu at all
            ...SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((n) => canRead(ROUTE_RESOURCE[n.route])) })).filter((sec) => sec.items.length > 0),
            ...(canManageAccess ? [SETTINGS_SECTION] : []),
          ].map((sec) => {
            const isClosed = !mini && closed[sec.id];
            return (
              <div className="nav-sec" key={sec.id}>
                <button
                  className={`nav-head ${isClosed ? 'closed' : ''}`}
                  onClick={() => setClosed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
                  title={sec.title}
                  aria-expanded={!isClosed}
                >
                  <span className="gi">
                    <sec.icon size={18} />
                  </span>
                  <span className="t">{sec.title}</span>
                  <ChevronDown size={16} className="chev" />
                </button>
                {!isClosed && (
                  <div className="nav-children">
                    {sec.items.map((n) => (
                      <button
                        key={n.route}
                        className={`nav-item ${route === n.route ? 'active' : ''}`}
                        title={n.label}
                        onClick={() => {
                          go(n.route);
                          setMobileOpen(false);
                        }}
                      >
                        <n.icon size={18} />
                        <span className="lbl">{n.label}</span>
                        {counts[n.route] ? <span className="nav-count">{counts[n.route]}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={toggleSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
            <PanelLeft size={21} />
          </button>
          <JobSearch />
          <div className="top-right">
            <NotificationBell />
            <ActionBell />
            <button
              className="round-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {WRITABLE_PAGES.has(ROUTE_RESOURCE[route]) && level(ROUTE_RESOURCE[route]) === 'read' && (
              <span className="view-only" title="You can look at this page but not change anything on it">
                <Eye size={14} /> View only
              </span>
            )}
            <UserCard />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

    </div>
  );
}

/** Bell with every job that is waiting for an operator — one click opens the right form. */
function ActionBell() {
  const { state, openAction } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const steps = useMemo(() => pendingSteps(state), [state]);
  const { due } = useFollowups();
  const total = steps.length + due.length;

  return (
    <div className="rel" ref={ref}>
      <button className="round-btn" onClick={() => setOpen((o) => !o)} aria-label="Pending actions" title="Pending actions">
        <Bell size={18} />
        {total > 0 && <span className="ping">{total}</span>}
      </button>
      {open && (
        <div className="pop">
          <div className="pop-head">
            <b>Pending actions</b>
            <div>{total ? [steps.length ? `${steps.length === 1 ? '1 job is' : `${steps.length} jobs are`} waiting for the next step` : '', due.length ? `${due.length} follow-up${due.length === 1 ? '' : 's'} due` : ''].filter(Boolean).join(' · ') : 'All jobs are up to date'}</div>
          </div>
          <div className="pop-list">
            {due.slice(0, 6).map((f) => (
              <button key={f.key} className="pop-item" onClick={() => { setOpen(false); go(f.route); }}>
                <span className="ic"><BellRing size={17} /></span>
                <span>
                  <span className="tt"><span className="mono">{f.ref}</span> · {f.what}</span>
                  <div className="ss">{f.party ? `${f.party} · ` : ''}{dueText(f.due)}</div>
                </span>
                <span className="go">Open →</span>
              </button>
            ))}
            {due.length > 0 && (
              <button className="pop-item" onClick={() => { setOpen(false); go('follow-ups'); }}>
                <span className="ic"><ClipboardList size={17} /></span>
                <span><span className="tt">See all follow-ups</span></span>
                <span className="go">Open →</span>
              </button>
            )}
            {steps.map((n) => {
              const I = FLOW_STEPS.find((f) => f.key === n.stageKey)?.icon ?? ClipboardList;
              return (
                <button
                  key={n.jobNo}
                  className="pop-item"
                  onClick={() => {
                    setOpen(false);
                    if (n.action) openAction(n.action);
                    else if (n.route) go(n.route);
                  }}
                >
                  <span className="ic">
                    <I size={17} />
                  </span>
                  <span>
                    <span className="tt">
                      <span className="mono">{n.jobNo}</span> · {n.label}
                    </span>
                    <div className="ss">{n.detail}</div>
                  </span>
                  <span className="go">Open →</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function JobSearch() {
  const { state, openTrace } = useStore();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return state.jobs.slice(-6).reverse();
    return state.jobs
      .filter((j) => {
        const p = state.products.find((x) => x.id === j.productId);
        return [j.jobNo, p?.name, searchable(j.customer)].some((f) => f?.toLowerCase().includes(n));
      })
      .slice(0, 8);
  }, [q, state]);

  const pick = (jobNo: string) => {
    openTrace(jobNo);
    setQ('');
    setFocus(false);
    ref.current?.blur();
  };

  return (
    <div className="top-search">
      <Search size={17} />
      <input
        ref={ref}
        placeholder="Search or trace a job — e.g. JOB-2026-0001"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHl(0);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1));
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter' && results[hl]) pick(results[hl].jobNo);
        }}
      />
      {focus && (
        <div className="search-pop">
          {results.length === 0 && <div className="muted" style={{ padding: 10 }}>No matching jobs</div>}
          {results.map((j, i) => {
            const s = jobSummary(state, j.jobNo);
            return (
              <button key={j.jobNo} className={i === hl ? 'hl' : ''} onMouseDown={() => pick(j.jobNo)}>
                <ClipboardList size={15} className="muted" />
                <span>
                  <span className="mono strong">{j.jobNo}</span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.product.name} · {STAGE_LABEL[j.currentStage]}
                  </div>
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <Badge status={s.status} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The signed-in user (from the login) and the way out. */
function UserCard() {
  const { user, logout } = useAccess();
  if (!user) return null;
  const words = user.name.split(/[s/]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : user.name.slice(0, 2)).toUpperCase();
  return (
    <>
      <div className="user" title={user.email}>
        <div className="avatar">{initials}</div>
        <div className="meta">
          <div className="name">{user.name}</div>
          <div className="role">{user.email}</div>
        </div>
      </div>
      <button className="round-btn" onClick={logout} title="Sign out" aria-label="Sign out">
        <LogOut size={17} />
      </button>
    </>
  );
}
