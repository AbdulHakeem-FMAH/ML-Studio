import { useEffect, useState } from "react";
import { Activity, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { drift, models as modelsApi, datasets as dsApi } from "../api/client.js";

function DriftBar({ score }) {
  const color = score > 0.4 ? "var(--error)" : score > 0.3 ? "var(--warning)" : "var(--success)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(score * 100, 100)}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color, fontWeight: 600, minWidth: 46 }}>
        {score.toFixed(4)}
      </span>
    </div>
  );
}

function FeatureTable({ features }) {
  if (!features?.length) return <p style={{ color: "var(--text-tertiary)", fontSize: 12 }}>No feature breakdown available.</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 280, overflowY: "auto" }}>
      <table>
        <thead>
          <tr><th>Feature</th><th>Test</th><th>Score</th><th>Drifted?</th></tr>
        </thead>
        <tbody>
          {features.map((f, i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{f.feat}</td>
              <td><span className="badge badge-neutral">{f.dist}</span></td>
              <td style={{ minWidth: 140 }}><DriftBar score={f.score} /></td>
              <td>
                {f.detected
                  ? <span className="badge badge-error"><AlertTriangle size={10} /> Yes</span>
                  : <span className="badge badge-success"><CheckCircle size={10} /> No</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportRow({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
          {r.id.slice(0, 8)}
        </td>
        <td><span className="badge badge-neutral">{r.drift_type}</span></td>
        <td style={{ minWidth: 160 }}><DriftBar score={r.score} /></td>
        <td>
          {r.detected
            ? <span className="badge badge-error"><AlertTriangle size={10} /> Detected</span>
            : <span className="badge badge-success"><CheckCircle size={10} /> Clean</span>}
        </td>
        <td>
          {r.retrain
            ? <span className="badge badge-warning">Retrain needed</span>
            : <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>—</span>}
        </td>
        <td style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
          {new Date(r.created_at).toLocaleString()}
        </td>
        <td>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
              {open ? "Hide" : "Details"}
            </button>
            {r.report_key && (
              <a
                href={drift.reportUrl(r.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                HTML Report
              </a>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{ padding: "16px 20px", background: "var(--bg-elevated)" }}>
              <FeatureTable features={r.features} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Drift() {
  const [reports, setReports] = useState([]);
  const [models, setModels]   = useState([]);
  const [datasets, setDs]     = useState([]);
  const [loading, setLoad]    = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr]         = useState("");

  // Form state
  const [modelId,   setModelId]   = useState("");
  const [refDs,     setRefDs]     = useState("");
  const [currDs,    setCurrDs]    = useState("");
  const [driftType, setDriftType] = useState("data");

  const load = () => {
    setLoad(true);
    Promise.all([
      drift.list(),
      modelsApi.list().then(ms => ms.filter(m => m.status === "Complete")),
      dsApi.list(),
    ]).then(([r, m, d]) => {
      setReports(r); setModels(m); setDs(d);
    }).catch(() => {}).finally(() => setLoad(false));
  };

  useEffect(load, []);

  const handleCheck = async () => {
    if (!modelId || !refDs || !currDs) { setErr("All fields are required."); return; }
    setErr(""); setRunning(true);
    try {
      await drift.check({ model_id: modelId, ref_dataset_name: refDs, curr_dataset_name: currDs, drift_type: driftType });
      load();
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Drift Detection</h1>
        <p className="page-sub">Compare reference vs current data using Evidently AI</p>
      </div>

      {/* Check form */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Run Drift Check</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 160px auto", gap: 12, alignItems: "flex-end" }}>
          <div className="field">
            <label className="label">Model</label>
            <select className="input select" value={modelId} onChange={e => setModelId(e.target.value)}>
              <option value="">— select model —</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Reference Dataset</label>
            <select className="input select" value={refDs} onChange={e => setRefDs(e.target.value)}>
              <option value="">— reference —</option>
              {datasets.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Current Dataset</label>
            <select className="input select" value={currDs} onChange={e => setCurrDs(e.target.value)}>
              <option value="">— current —</option>
              {datasets.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Type</label>
            <select className="input select" value={driftType} onChange={e => setDriftType(e.target.value)}>
              <option value="data">Data</option>
              <option value="concept">Concept</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleCheck} disabled={running}>
            {running ? <><RefreshCw size={13} className="spin" /> Running…</> : <><Activity size={13} /> Check Drift</>}
          </button>
        </div>
        {err && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 8 }}>{err}</p>}
      </div>

      {/* Reports table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p className="section-title">Drift Reports</p>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 50 }} />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <Activity size={40} />
          <p>No drift reports yet. Run a drift check above.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Report ID</th><th>Type</th><th>Score</th>
                <th>Status</th><th>Recommendation</th><th>Checked</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => <ReportRow key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
