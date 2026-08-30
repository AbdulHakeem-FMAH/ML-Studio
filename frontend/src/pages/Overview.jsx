import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, BrainCircuit, Database, HeartPulse, Play, Rocket, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { health, models } from "../api/client.js";

const CARD_CONFIG = {
  total_datasets: { label: "Datasets", icon: Database, color: "#818cf8", bg: "rgba(129,140,248,.13)" },
  complete_models: { label: "Trained models", icon: BrainCircuit, color: "#4ade80", bg: "rgba(74,222,128,.12)" },
  drift_alerts: { label: "Drift alerts", icon: AlertTriangle, color: "#fbbf24", bg: "rgba(251,191,36,.12)" },
  active_deployments: { label: "Deployments", icon: Rocket, color: "#38bdf8", bg: "rgba(56,189,248,.12)" },
  training_runs_this_week: { label: "Runs this week", icon: TrendingUp, color: "#c084fc", bg: "rgba(192,132,252,.12)" },
};

function ActivityTrend({ activity }) {
  const data = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); return { key: date.toDateString(), label: date.toLocaleDateString(undefined, { weekday: "short" }), events: 0 }; });
    const index = new Map(days.map((day) => [day.key, day]));
    activity.forEach((item) => { const day = index.get(new Date(item.created_at).toDateString()); if (day) day.events += 1; });
    return days;
  }, [activity]);
  return <ResponsiveContainer width="100%" height={190}><AreaChart data={data} margin={{ top: 10, right: 4, left: -28, bottom: 0 }}><defs><linearGradient id="activityGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#818cf8" stopOpacity={.45} /><stop offset="100%" stopColor="#818cf8" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="label" tick={{ fill: "#76768e", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "#76768e", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#18181f", border: "1px solid #30303e", borderRadius: 8, fontSize: 12 }} /><Area type="monotone" dataKey="events" stroke="#818cf8" strokeWidth={2} fill="url(#activityGradient)" /></AreaChart></ResponsiveContainer>;
}

export default function Overview() {
  const [stats, setStats] = useState(null); const [activity, setActivity] = useState([]); const [serviceHealth, setServiceHealth] = useState(null); const [recentModels, setRecentModels] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([health.stats(), health.activity(), health.check(), models.list()]).then(([nextStats, nextActivity, nextHealth, nextModels]) => { setStats(nextStats); setActivity(nextActivity); setServiceHealth(nextHealth); setRecentModels(nextModels.slice(0, 4)); }).finally(() => setLoading(false));
  }, []);
  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}><div><h1 className="page-title">Control center</h1><p className="page-sub">Your AutoML workspace, performance signals, and next actions.</p></div><div style={{ display: "flex", gap: 8 }}><Link className="btn btn-secondary btn-sm" to="/datasets"><Database size={13} /> Add dataset</Link><Link className="btn btn-primary btn-sm" to="/training"><Play size={13} /> Train model</Link></div></div>
      {loading ? <div className="grid-4">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" style={{ height: 138 }} />)}</div> : <div className="grid-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>{stats && Object.entries(stats).map(([key, value]) => { const config = CARD_CONFIG[key]; const Icon = config?.icon || Activity; return <div className="stat-card" key={key}><div style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 10, color: config.color, background: config.bg }}><Icon size={18} /></div><div><div className="stat-value">{value}</div><div className="stat-label">{config.label}</div></div></div>; })}</div>}
      <div className="grid-2" style={{ marginTop: 22 }}>
        <section className="card"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><div><p className="section-title" style={{ marginBottom: 2 }}>Workspace activity</p><h2 style={{ fontSize: 16 }}>Last seven days</h2></div><Activity size={18} color="var(--accent)" /></div><ActivityTrend activity={activity} /></section>
        <section className="card"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 17 }}><div><p className="section-title" style={{ marginBottom: 2 }}>System health</p><h2 style={{ fontSize: 16 }}>{serviceHealth?.overall ? "Core services operational" : "Service attention required"}</h2></div><HeartPulse size={20} color={serviceHealth?.overall ? "var(--success)" : "var(--warning)"} /></div>{serviceHealth?.services?.map((service) => <div key={service.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px solid var(--border-subtle)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: service.ok ? "var(--success)" : service.detail?.includes("Not configured") ? "var(--text-tertiary)" : "var(--error)" }} /><span style={{ fontSize: 13, flex: 1 }}>{service.name}</span><span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{service.latency || service.detail}</span></div>)}<Link to="/health" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>View system health <ArrowRight size={13} /></Link></section>
      </div>
      <div className="grid-2" style={{ marginTop: 22 }}>
        <section className="card"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><div><p className="section-title" style={{ marginBottom: 2 }}>Recent models</p><h2 style={{ fontSize: 16 }}>Model portfolio</h2></div><Link to="/models" className="btn btn-ghost btn-sm">All models <ArrowRight size={13} /></Link></div>{recentModels.length ? recentModels.map((model) => <div key={model.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--border-subtle)" }}><div style={{ width: 31, height: 31, display: "grid", placeItems: "center", borderRadius: 8, background: "var(--accent-dim)", color: "var(--accent)" }}><BrainCircuit size={15} /></div><div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>{model.name}</strong><span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{model.task} · v{model.version}</span></div><span className={`badge ${model.status === "Complete" ? "badge-success" : model.status === "Failed" ? "badge-error" : "badge-neutral"}`}>{model.status}</span></div>) : <p style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "30px 0" }}>Train your first model to start building a portfolio.</p>}</section>
        <section className="card"><p className="section-title">Recommended workflow</p><h2 style={{ fontSize: 16, marginBottom: 14 }}>Move from data to reliable predictions</h2>{[[Database, "1. Profile your data", "Upload a file or ingest a table, then inspect quality and missing values.", "/datasets"], [BrainCircuit, "2. Train with confidence", "Choose a target from the dataset schema and watch the live training stream.", "/training"], [TrendingUp, "3. Monitor production signals", "Review model diagnostics and schedule drift checks as fresh data arrives.", "/drift"]].map(([Icon, title, description, path]) => <Link key={title} to={path} style={{ display: "flex", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--border-subtle)" }}><div style={{ marginTop: 2, color: "var(--accent)" }}><Icon size={16} /></div><div><strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{title}</strong><p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>{description}</p></div></Link>)}</section>
      </div>
    </div>
  );
}
