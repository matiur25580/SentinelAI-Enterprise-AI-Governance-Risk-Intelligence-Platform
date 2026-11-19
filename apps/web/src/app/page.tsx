const metrics = [
  { label: "AI assets", value: "—", note: "Connect your first model", tone: "blue" },
  { label: "Open risk findings", value: "—", note: "Risk assessments pending", tone: "amber" },
  { label: "Evaluations this month", value: "—", note: "No evaluation runs yet", tone: "violet" },
  { label: "Governance score", value: "—", note: "Awaiting control evidence", tone: "green" },
];

const modules = [
  { number: "01", title: "AI Asset Registry", description: "Inventory models, LLM apps, agents, owners, versions, and lifecycle status.", status: "Planned" },
  { number: "02", title: "Risk Intelligence", description: "Assess privacy, security, reliability, and operational risks with traceable evidence.", status: "Planned" },
  { number: "03", title: "Evaluation Lab", description: "Benchmark quality, groundedness, relevance, and model changes against datasets.", status: "Planned" },
  { number: "04", title: "Security Center", description: "Run authorized prompt-injection and data-exposure tests in controlled scopes.", status: "Planned" },
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark">S</span><span>sentinel<span className="brand-light">ai</span><small>GOVERNANCE PLATFORM</small></span></a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav">
          <a className="nav-item active" href="#"><span>◫</span> Overview</a>
          <a className="nav-item" href="#modules"><span>◈</span> AI asset registry</a>
          <a className="nav-item" href="#modules"><span>⌁</span> Risk intelligence</a>
          <a className="nav-item" href="#modules"><span>◎</span> Evaluation lab</a>
          <a className="nav-item" href="#modules"><span>⛨</span> Security center</a>
          <a className="nav-item" href="#modules"><span>▤</span> Compliance</a>
          <a className="nav-item" href="#modules"><span>⌘</span> Observability</a>
        </nav>
        <div className="sidebar-bottom"><div className="avatar">SA</div><div><strong>Workspace Admin</strong><small>Local preview</small></div><span className="online-dot" /></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><div className="top-actions"><span className="environment"><i /> DEVELOPMENT</span><button className="icon-button" aria-label="Notifications">♧</button><div className="avatar small">SA</div></div></header>
        <div className="content">
          <div className="welcome-row"><div><div className="eyebrow">COMMAND CENTER <span>•</span> NOVEMBER 2026</div><h1>AI Governance Overview</h1><p className="subheading">A clear view of your AI estate, risk posture, and operational health.</p></div><button className="primary-button" disabled title="Available when the registry module is implemented">＋ Register AI asset</button></div>

          <div className="notice"><span className="notice-icon">✦</span><div><strong>Your governance workspace is taking shape</strong><p>This is the initial product shell. Metrics are intentionally shown as unavailable until real data sources are connected.</p></div><span className="notice-tag">FOUNDATION</span></div>

          <div className="section-heading"><div><h2>Platform snapshot</h2><p>Live metrics will appear after backend integration.</p></div><span className="muted-label">DATA NOT CONNECTED</span></div>
          <div className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><span className={`metric-dot ${metric.tone}`} /></div><div className="metric-value">{metric.value}</div><div className="metric-note">{metric.note}</div></article>)}</div>

          <div className="section-heading modules-heading" id="modules"><div><h2>Governance modules</h2><p>Core capabilities in the SentinelAI roadmap.</p></div><a className="text-link" href="https://github.com/matiur25580/SentinelAI-Enterprise-AI-Governance-Risk-Intelligence-Platform">Repository ↗</a></div>
          <div className="module-grid">{modules.map((module) => <article className="module-card" key={module.number}><div className="module-top"><span className="module-number">{module.number}</span><span className="planned">{module.status}</span></div><h3>{module.title}</h3><p>{module.description}</p><div className="module-footer"><span>IN ROADMAP</span><span>↗</span></div></article>)}</div>
          <footer className="footer"><span>SentinelAI <span className="footer-sep">/</span> Enterprise AI Governance</span><span>Foundation build · v0.1.0</span></footer>
        </div>
      </section>
    </main>
  );
}
