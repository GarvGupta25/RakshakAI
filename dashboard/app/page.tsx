const events = [
  ["d17a8e2", "lib/auth/token.ts", "Blocked", "Credential-shaped string detected", "danger"],
  ["b6d3445", "backend/src/worker.ts", "Allowed", "Logic change reviewed by Gemini", "good"],
  ["a40fd81", "backend/src/state.ts", "Corrected", "Conventional commit normalized", "neutral"]
];

function Metric({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className="metric"><span>{label}</span><strong className={tone}>{value}</strong><small>{note}</small></article>;
}

export default function Dashboard() {
  return <main className="shell">
    <aside><div className="brand"><i>◆</i> AgentGuard</div><div className="workspace">Workspace <b>⌄</b></div><nav><a className="active">◈ Overview</a><a>⌁ Live feed</a><a>⌘ Repositories</a><a>◌ Incidents <em>1</em></a><a>◫ Automations</a></nav><div className="nav-label">WORKSPACE</div><nav><a>⌁ Activity</a><a>⚙ Settings</a></nav><div className="user"><span>PA</span><div><b>Pranav</b><small>Admin</small></div><b>···</b></div></aside>
    <section className="content"><header><div><p>Workspace / Security</p><h1>Overview</h1></div><div className="header-actions"><button>⌘ Search</button><button className="primary">+ Install repository</button></div></header>
      <div className="repo-bar"><div className="repo-icon">◈</div><div><b>GarvGupta25 / RakshakAI</b><p><span className="dot" /> Monitoring main · Last scan 2 min ago</p></div><button>View repository ↗</button></div>
      <div className="metrics"><Metric label="Repository health" value="92" note="+4 from last week" tone="green"/><Metric label="Incidents caught" value="03" note="1 requires attention"/><Metric label="Token spend" value="18.4k" note="61% filtered before reasoning"/><Metric label="Auto-corrections" value="24" note="This month"/></div>
      <div className="split"><section className="panel"><div className="panel-head"><div><h2>Live activity</h2><p>Every diff, with its final decision</p></div><button>View all →</button></div><div className="event-list">{events.map(([sha, file, status, summary, tone]) => <div className="event" key={sha}><div className={`signal ${tone}`} /><div><b>{sha} <span>{file}</span></b><p>{summary}</p></div><label className={tone}>{status}</label><time>2m</time></div>)}</div></section><section className="panel health"><div className="panel-head"><div><h2>Safety posture</h2><p>Rolling health score</p></div><b className="score">92</b></div><div className="bar"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="legend"><span><i className="legend-dot green" /> Safe 84%</span><span><i className="legend-dot yellow" /> Flagged 13%</span><span><i className="legend-dot red" /> Blocked 3%</span></div><hr/><div className="cost"><span>Estimated cost avoided</span><b>$12.46</b><small>42 diffs skipped the reasoning tier</small></div></section></div>
      <section className="panel table"><div className="panel-head"><div><h2>Repositories</h2><p>Installations and current protection</p></div><button>Manage →</button></div><div className="row heading"><span>REPOSITORY</span><span>HEALTH</span><span>LAST ACTIVITY</span><span>STATUS</span></div><div className="row"><b>◈ RakshakAI</b><span><i className="legend-dot green"/> 92 Healthy</span><span>2 minutes ago</span><span className="pill">Protected</span></div></section>
    </section>
  </main>;
}
