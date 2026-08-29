import { useEffect, useState } from "react";
import { HeartPulse, RefreshCw, CheckCircle, XCircle, AlertCircle, Clock, Cloud, Database, HardDrive, LineChart, Server } from "lucide-react";
import { health } from "../api/client.js";

const SERVICE_ICONS = {
  PostgreSQL: Database,
  Redis:      Server,
  MinIO:      HardDrive,
  InfluxDB:   LineChart,
  KServe:     Cloud,
};

function ServiceCard({ svc }) {
  const Icon = SERVICE_ICONS[svc.name] || Server;
  const isSkipped = svc.detail?.includes("Not configured");
  const color  = isSkipped ? "var(--text-tertiary)"
               : svc.ok    ? "var(--success)"
               :              "var(--error)";
  const bg     = isSkipped ? "var(--bg-elevated)"
               : svc.ok    ? "var(--success-dim)"
               :              "var(--error-dim)";
  const border = isSkipped ? "var(--border)"
               : svc.ok    ? "rgba(34,197,94,0.25)"
               :              "rgba(239,68,68,0.25)";

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: `1px solid ${border}`,
      borderRadius: "var(--r-lg)",
      padding: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 10, color, background: bg }}>
            <Icon size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{svc.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {svc.host}
            </div>
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: "var(--r-full)",
          background: bg, fontSize: 11, fontWeight: 600,
          color,
        }}>
          {isSkipped
            ? <><AlertCircle size={11} /> Skipped</>
            : svc.ok
            ? <><CheckCircle size={11} /> Connected</>
            : <><XCircle size={11} /> Offline</>}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{svc.detail}</div>

      {svc.latency && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-tertiary)" }}>
          <Clock size={10} /> Latency: {svc.latency}
        </div>
      )}
    </div>
  );
}

export default function Health() {
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [lastCheck, setLast] = useState(null);

  const load = () => {
    setLoad(true);
    health.check()
      .then(r => { setData(r); setLast(new Date()); })
      .catch(() => {})
      .finally(() => setLoad(false));
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // auto-refresh every 30s
    return () => clearInterval(iv);
  }, []);

  const overallOk = data?.overall;

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">System Health</h1>
          <p className="page-sub">Live connectivity status for all platform services</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {lastCheck && (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Last check: {lastCheck.toLocaleTimeString()}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* Overall status banner */}
      {data && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 20px", borderRadius: "var(--r-lg)", marginBottom: 24,
          background: overallOk ? "var(--success-dim)" : "var(--error-dim)",
          border: `1px solid ${overallOk ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
        }}>
          {overallOk
            ? <CheckCircle size={20} color="var(--success)" />
            : <XCircle size={20} color="var(--error)" />}
          <div>
            <div style={{
              fontWeight: 600, fontSize: 14,
              color: overallOk ? "var(--success)" : "var(--error)",
            }}>
              {overallOk ? "All required services operational" : "One or more required services are offline"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              Required: PostgreSQL, Redis, MinIO  ·  Optional: InfluxDB, KServe
            </div>
          </div>
        </div>
      )}

      {/* Service grid */}
      {loading && !data ? (
        <div className="grid-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="skeleton" style={{ height: 130, borderRadius: "var(--r-lg)" }} />
          ))}
        </div>
      ) : data ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {data.services.map(s => <ServiceCard key={s.name} svc={s} />)}
        </div>
      ) : (
        <div className="empty-state">
          <HeartPulse size={40} />
          <p>Could not reach the API. Ensure the backend is running on port 8000.</p>
        </div>
      )}
    </div>
  );
}
