"use client";

import { useMemo, useState, type ReactNode } from "react";

export type DashboardState = {
  health_score: number;
  auto_corrections_applied: number;
  tokens_spent_today: number;
  recent_verdicts: Array<{ commit_sha: string; risk_level: string; verdict: string; timestamp: string }>;
};

export type DashboardIncident = {
  id: string;
  createdAt: string;
  reason: string;
  diff: string;
  job: { repoId: string; sha: string; ref: string };
  verdict?: { verdict: string; human_summary: string; technical_summary: string };
  status?: "open" | "resolved";
  resolvedAt?: string;
  notification?: { channel: "discord"; status: "sent" | "skipped" | "failed"; attemptedAt: string; error?: string };
};

type View = "Overview" | "Activity" | "Repositories" | "Incidents";
type IconName = "activity" | "alert" | "arrow" | "bolt" | "check" | "chevron" | "github" | "grid" | "menu" | "repo" | "search" | "settings" | "spark" | "trend" | "x";

const demoEvents = [
  { sha: "d17a8e2", file: "lib/auth/token.ts", status: "Blocked", summary: "Credential-shaped string detected", time: "2m", tone: "danger" },
  { sha: "b6d3445", file: "backend/src/worker.ts", status: "Allowed", summary: "Logic change reviewed by reasoning tier", time: "18m", tone: "success" },
  { sha: "a40fd81", file: "backend/src/state.ts", status: "Corrected", summary: "Formatting normalized automatically", time: "1h", tone: "neutral" },
  { sha: "38dbe26", file: "backend/src/index.ts", status: "Allowed", summary: "Explain endpoint passed policy checks", time: "3h", tone: "success" }
];

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    activity: <path d="M3 12h3l2-7 4 14 2-7h7" />,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 16h.01" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    github: <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 19.2 3 5.4 5.4 0 0 0 19 0s-1.2-.4-4 1.5a13.7 13.7 0 0 0-7 0C5.2-.4 4 0 4 0a5.4 5.4 0 0 0-.2 3A5.8 5.8 0 0 0 2.2 7c0 5.8 3.5 7 6.8 7.4A4.8 4.8 0 0 0 8 18v4" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    repo: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    spark: <><path d="m12 3 1.1 3.9L17 8l-3.9 1.1L12 13l-1.1-3.9L7 8l3.9-1.1L12 3Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-9" /><path d="M15 6h6v6" /></>,
    x: <path d="m6 6 12 12M18 6 6 18" />
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Metric({ label, value, detail, change, tone }: { label: string; value: string; detail: string; change?: string; tone?: string }) {
  return <article className="metric-card"><div className="metric-label">{label}<button className="quiet-button" aria-label={`More about ${label}`}>···</button></div><div className={`metric-value ${tone ?? ""}`}>{value}</div><div className="metric-detail">{change && <span className="metric-change"><Icon name="trend" size={13} />{change}</span>}{detail}</div></article>;
}

export default function Dashboard({ initialState, incidents, apiUrl, installUrl }: { initialState: DashboardState | null; incidents: DashboardIncident[]; apiUrl: string; installUrl: string }) {
  const [view, setView] = useState<View>("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [incidentRows, setIncidentRows] = useState(incidents);
  const [resolving, setResolving] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const health = initialState?.health_score ?? 92;
  const corrections = initialState?.auto_corrections_applied ?? 24;
  const tokenSpend = initialState ? `${(initialState.tokens_spent_today / 1000).toFixed(1)}k` : "18.4k";
  const events = useMemo(() => initialState?.recent_verdicts.length ? initialState.recent_verdicts.slice(-4).reverse().map((item, index) => ({ sha: item.commit_sha.slice(0, 7), file: "Repository change", status: item.verdict === "block" ? "Blocked" : item.verdict === "allow_with_flag" ? "Flagged" : "Allowed", summary: `${item.risk_level.replace("_", " ")} risk · structured verdict`, time: index ? `${index + 1}h` : "now", tone: item.verdict === "block" ? "danger" : item.verdict === "allow" ? "success" : "neutral" })) : demoEvents, [initialState]);
  const incidentCount = incidentRows.filter(incident => incident.status !== "resolved").length;
  async function resolveIncident(incident: DashboardIncident) {
    setResolving(incident.job.sha);
    setStatusMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/repositories/${encodeURIComponent(incident.job.repoId)}/incidents/${encodeURIComponent(incident.job.sha)}`, { method: "POST" });
      if (!response.ok) throw new Error("Resolution request failed");
      const resolved = await response.json() as DashboardIncident;
      setIncidentRows(current => current.map(item => item.id === resolved.id ? resolved : item));
      setStatusMessage(`Incident ${incident.job.sha.slice(0, 7)} resolved.`);
    } catch {
      setStatusMessage("Unable to resolve the incident. Try again.");
    } finally {
      setResolving(null);
    }
  }
  const nav: Array<{ name: View; icon: IconName; count?: number }> = [{ name: "Overview", icon: "grid" }, { name: "Activity", icon: "activity" }, { name: "Repositories", icon: "repo" }, { name: "Incidents", icon: "alert", count: incidentCount }];

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className={sidebarOpen ? "sidebar open" : "sidebar"} aria-label="Primary navigation">
      <div className="brand-row"><div className="brand-mark"><Icon name="bolt" size={15} /></div><strong>AgentGuard</strong><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><Icon name="x" /></button></div>
      <button className="workspace-switch"><span className="avatar">AG</span><span>AgentGuard</span><Icon name="chevron" size={14} /></button>
      <nav>{nav.map(item => <button key={item.name} className={view === item.name ? "nav-item active" : "nav-item"} onClick={() => { setView(item.name); setSidebarOpen(false); }}><Icon name={item.icon} /><span>{item.name}</span>{item.count && <em>{item.count}</em>}</button>)}</nav>
      <div className="sidebar-label">Workspace</div><nav><button className="nav-item"><Icon name="spark" /><span>Automations</span></button><button className="nav-item"><Icon name="settings" /><span>Settings</span></button></nav><div className="sidebar-spacer" />
      <div className="protection-card"><div><Icon name="check" size={14} />Protection active</div><p>All pushes to <strong>main</strong> are monitored.</p></div>
      <button className="profile"><span className="avatar purple">GG</span><span><strong>Garv Gupta</strong><small>Workspace admin</small></span><b>···</b></button>
    </aside>
    {sidebarOpen && <button className="backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
    <main id="main-content" className="main">
      <header className="topbar"><button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={12} /><strong>{view}</strong></div><div className="top-actions"><button className="search-button" onClick={() => setSearchOpen(true)}><Icon name="search" /><span>Search</span><kbd>⌘ K</kbd></button><a className="icon-button" href="https://github.com/GarvGupta25/RakshakAI" target="_blank" rel="noreferrer" aria-label="Open GitHub"><Icon name="github" /></a><a className="primary-button" href={installUrl}><span>+</span> Install repository</a></div></header>
      <div className="page"><div className="sr-only" aria-live="polite">{statusMessage}</div><section className="page-heading"><div><p className="eyebrow">Security operations</p><h1>{view}</h1><p>{view === "Overview" ? "One view of repository health, decisions, and agent activity." : `Review ${view.toLowerCase()} across your protected repositories.`}</p></div><div className="live-status"><span />Live</div></section>
        <section className="repo-strip"><div className="repo-symbol"><Icon name="repo" /></div><div className="repo-copy"><strong>GarvGupta25 / RakshakAI</strong><span><i /> Monitoring <b>main</b><span className="separator">·</span>Last scan 2 min ago</span></div><div className="repo-health"><span>Health</span><strong>{health}<small>/100</small></strong></div><a href="https://github.com/GarvGupta25/RakshakAI" target="_blank" rel="noreferrer">View repository <Icon name="arrow" size={14} /></a></section>
        {view === "Overview" ? <Overview health={health} corrections={corrections} tokenSpend={tokenSpend} incidentCount={incidentCount} events={events} onNavigate={setView} /> : <CollectionView view={view} events={events} health={health} incidents={incidentRows} apiUrl={apiUrl} installUrl={installUrl} resolving={resolving} onResolve={resolveIncident} />}
      </div>
    </main>
    {searchOpen && <div className="dialog-layer" role="presentation" onMouseDown={() => setSearchOpen(false)}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search AgentGuard" onMouseDown={event => event.stopPropagation()}><div className="search-input"><Icon name="search" /><input autoFocus aria-label="Search" placeholder="Search repositories, commits, incidents…"/><button onClick={() => setSearchOpen(false)} aria-label="Close search"><kbd>Esc</kbd></button></div><div className="search-hint"><span>Quick access</span><button onClick={() => { setView("Incidents"); setSearchOpen(false); }}><Icon name="alert" />View open incidents<kbd>↵</kbd></button><button onClick={() => { setView("Activity"); setSearchOpen(false); }}><Icon name="activity" />Review recent activity<kbd>↵</kbd></button></div></section></div>}
  </div>;
}

type EventItem = typeof demoEvents[number];

function Overview({ health, corrections, tokenSpend, incidentCount, events, onNavigate }: { health: number; corrections: number; tokenSpend: string; incidentCount: number; events: EventItem[]; onNavigate: (view: View) => void }) {
  return <><section className="metrics-grid" aria-label="Key metrics"><Metric label="Repository health" value={String(health)} detail="Healthy posture" change="+3.2%" tone="health-value" /><Metric label="Incidents caught" value={String(incidentCount).padStart(2, "0")} detail={incidentCount ? `${incidentCount} require attention` : "No open incidents"} /><Metric label="Tokens used today" value={tokenSpend} detail="Total model usage" change="−12.4%" /><Metric label="Auto-corrections" value={String(corrections)} detail="Manual fixes avoided" change="+8 this week" /></section>
    <div className="dashboard-grid"><section className="panel activity-panel"><PanelHead title="Live activity" subtitle="Every diff and its final decision"><button onClick={() => onNavigate("Activity")}>View all <Icon name="arrow" size={14} /></button></PanelHead><EventList events={events.slice(0, 3)} /></section><section className="panel posture-panel"><PanelHead title="Safety posture" subtitle="Last 30 days"><div className="score-badge"><span>Score</span><strong>{health}</strong></div></PanelHead><div className="posture-chart" aria-label="84 percent safe, 13 percent flagged, 3 percent blocked"><div className="chart-segment safe" style={{ width: "84%" }} /><div className="chart-segment flagged" style={{ width: "13%" }} /><div className="chart-segment blocked" style={{ width: "3%" }} /></div><div className="legend"><span><i className="safe" />Safe <b>84%</b></span><span><i className="flagged" />Flagged <b>13%</b></span><span><i className="blocked" />Blocked <b>3%</b></span></div><div className="savings"><div className="savings-icon"><Icon name="spark" /></div><div><span>Estimated cost avoided</span><strong>$12.46</strong><p>42 diffs skipped the reasoning tier</p></div></div></section></div>
    <section className="panel repository-panel"><PanelHead title="Repositories" subtitle="Installations and current protection"><button onClick={() => onNavigate("Repositories")}>Manage <Icon name="arrow" size={14} /></button></PanelHead><div className="repo-table" role="table"><div className="table-row table-header" role="row"><span>Repository</span><span>Health</span><span>Last activity</span><span>Status</span><span /></div><div className="table-row" role="row"><div className="repo-cell"><div className="repo-symbol small"><Icon name="repo" size={14} /></div><span><strong>RakshakAI</strong><small>GarvGupta25</small></span></div><span className="health-cell"><i />{health} Healthy</span><span>2 minutes ago</span><span><b className="status-pill"><Icon name="check" size={12} />Protected</b></span><button aria-label="Open RakshakAI"><Icon name="chevron" /></button></div></div></section>
    <section className="efficiency-banner"><div className="efficiency-icon"><Icon name="bolt" /></div><div><span>Tiered analysis efficiency</span><strong>68% of diffs resolved without the reasoning tier</strong><p>Cheap first-pass filtering keeps latency and token use low.</p></div><div className="efficiency-stat"><span>This week</span><strong>−31%</strong><small>token cost / push</small></div></section></>;
}

function PanelHead({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) { return <div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{children}</div>; }
function EventList({ events }: { events: EventItem[] }) { return <div className="event-list">{events.map(event => <article className="event-row" key={event.sha}><div className={`event-icon ${event.tone}`}>{event.tone === "danger" ? <Icon name="alert" size={14} /> : <Icon name="check" size={14} />}</div><div className="event-copy"><div><code>{event.sha}</code><span>{event.file}</span></div><p>{event.summary}</p></div><span className={`decision ${event.tone}`}>{event.status}</span><time>{event.time}</time><button aria-label={`Open commit ${event.sha}`}><Icon name="chevron" size={14} /></button></article>)}</div>; }

function CollectionView({ view, events, health, incidents, apiUrl, installUrl, resolving, onResolve }: { view: Exclude<View, "Overview">; events: EventItem[]; health: number; incidents: DashboardIncident[]; apiUrl: string; installUrl: string; resolving: string | null; onResolve: (incident: DashboardIncident) => void }) {
  if (view === "Repositories") return <section className="panel collection-panel"><PanelHead title="Protected repositories" subtitle="1 active GitHub App installation"><a className="secondary-button" href={installUrl}>+ Add repository</a></PanelHead><div className="collection-empty"><div className="repo-symbol large"><Icon name="repo" /></div><h2>RakshakAI</h2><p>GarvGupta25 · main branch</p><div className="collection-stats"><span><b>{health}</b>Health</span><span><b>24</b>Corrections</span><span><b>2m</b>Last scan</span></div></div></section>;
  if (view === "Incidents") { const openCount = incidents.filter(incident => incident.status !== "resolved").length; return <section className="panel collection-panel"><PanelHead title="Incident queue" subtitle="Issues requiring a human decision"><span className="open-count">{openCount} open</span></PanelHead>{incidents.length ? incidents.map(incident => <article className={`incident-card ${incident.status === "resolved" ? "resolved" : ""}`} key={incident.id}><div className={`event-icon ${incident.status === "resolved" ? "success" : "danger"}`}>{incident.status === "resolved" ? <Icon name="check" size={16} /> : <Icon name="alert" size={16} />}</div><div><div className="incident-title"><strong>{incident.reason}</strong><span>{incident.status === "resolved" ? "Resolved" : "High severity"}</span></div><p>AgentGuard blocked this commit after inspecting its actual patch.</p><div className="incident-meta"><code>{incident.job.sha.slice(0, 7)}</code><span>{new Date(incident.createdAt).toLocaleString()}</span><span>{incident.job.ref.replace("refs/heads/", "")}</span><span className={`notification-state ${incident.notification?.status ?? "skipped"}`}>Discord {incident.notification?.status ?? "not configured"}</span></div><details className="technical-details"><summary>Technical details</summary><strong>Structured verdict</strong><pre>{JSON.stringify(incident.verdict ?? { verdict: "block", reason: incident.reason }, null, 2)}</pre><strong>Actual diff</strong><pre>{incident.diff}</pre></details></div><div className="incident-actions"><a className="primary-button" href={`${apiUrl}/explain?repo=${encodeURIComponent(incident.job.repoId)}&sha=${encodeURIComponent(incident.job.sha)}`}>Explain</a>{incident.status !== "resolved" && <button className="secondary-button" disabled={resolving === incident.job.sha} onClick={() => onResolve(incident)}>{resolving === incident.job.sha ? "Resolving…" : "Mark resolved"}</button>}</div></article>) : <div className="incident-empty"><div className="event-icon success"><Icon name="check" /></div><h2>No incidents</h2><p>Blocked changes and detected secrets will appear here.</p></div>}</section>; }
  return <section className="panel collection-panel"><PanelHead title="All activity" subtitle="Decisions from every analysis tier"><button className="secondary-button">Filter</button></PanelHead><EventList events={events} /></section>;
}
