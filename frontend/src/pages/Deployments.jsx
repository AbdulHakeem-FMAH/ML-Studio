import { useEffect, useState } from "react";
import { Rocket, RefreshCw, Trash2, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { deployments, models as modelsApi } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

function EndpointTester({ deployId }) {
  const [payload, setPayload] = useState("{}");
  const [result, setResult]   = useState(null);
  const [loading, setLoad]    = useState(false);
  const [err, setErr]         = useState("");

  const test = async () => {
    setErr(""); setResult(null); setLoad(true);
    try {
      const parsed = JSON.parse(payload);
      const res    = await deployments.test(deployId, parsed);
      setResult(res);
    } catch (e) { setErr(e.message); }
    finally { setLoad(false); }
  };

  return (
    <div style={{ padding: "16px 20px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border)" }}>
      <p className="section-title" style={{ marginBottom: 10 }}>Live Endpoint Test</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "flex-end" }}>
        <div className="field">
          <label className="label">Request Payload (JSON)</label>
          <textarea
            className="input"
            rows={4}
            value={payload}
            onChange={e => setPayload(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
          />
        </div>
        <button className="btn btn-primary" onClick={test} disabled={loading}>
          {loading ? <><RefreshCw size={13} className="spin" /> Sending…</> : <><Zap size={13} /> Send</>}
        </button>
      </div>
      {err && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 8 }}>{err}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: "var(--text-secondary)" }}>
              Status: <strong style={{ color: result.status_code < 400 ? "var(--success)" : "var(--error)" }}>
                {result.status_code}
              </strong>
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              Latency: <strong style={{ color: "var(--text-primary)" }}>{result.latency_ms}ms</strong>
            </span>
          </div>
          <pre style={{
            background: "#080810", border: "1px solid var(--border)",
            borderRadius: 8, padding: 12, fontSize: 11,
            fontFamily: "var(--font-mono)", color: "#a0f0a0",
            overflow: "auto", maxHeight: 200,
          }}>
            {JSON.stringify(result.response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function DeployRow({ d, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: d.ready ? "var(--success)" : "var(--warning)",
            }} />
            <span style={{ fontWeight: 500 }}>{d.name}</span>
          </div>
        </td>
        <td><span className={`badge ${d.ready ? "badge-success" : "badge-warning"}`}>{d.ready ? "Ready" : "Pending"}</span></td>
        <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.endpoint || "—"}
        </td>
        <td className="td-mono">{d.cpu}</td>
        <td className="td-mono">{d.memory}</td>
        <td className="td-mono">{d.replicas}</td>
        <td className="td-mono">{d.p50_ms != null ? `${d.p50_ms}ms` : "—"}</td>
        <td>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(d.id)}>
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding: 0 }}>
            <EndpointTester deployId={d.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Deployments() {
  const [list, setList]     = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoad]  = useState(true);
  const [creating, setCreate] = useState(false);
  const [err, setErr]       = useState("");
  const [showForm, setForm] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Form
  const [modelId,   setModelId]   = useState("");
  const [dName,     setDName]     = useState("");
  const [namespace, setNamespace] = useState("kubeflow");
  const [cpu,       setCpu]       = useState("1");
  const [memory,    setMemory]    = useState("2Gi");
  const [replicas,  setReplicas]  = useState(1);

  const load = () => {
    setLoad(true);
    Promise.all([
      deployments.list(),
      modelsApi.list().then(ms => ms.filter(m => m.status === "Complete")),
    ]).then(([d, m]) => { setList(d); setModels(m); })
    .catch(() => {}).finally(() => setLoad(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    if (!modelId || !dName.trim()) { setErr("Model and deployment name are required."); return; }
    setErr(""); setCreate(true);
    try {
      await deployments.create({ model_id: modelId, name: dName.trim(), namespace, cpu, memory, replicas });
      setForm(false); setDName(""); setModelId("");
      load();
    } catch (e) { setErr(e.message); }
    finally { setCreate(false); }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deployments.delete(toDelete.id);
      setToDelete(null);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Deployments</h1>
          <p className="page-sub">Deploy models via KServe or local inference endpoint</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setForm(f => !f)}>
            <Rocket size={13} /> New Deployment
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Configure Deployment</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px 100px 80px", gap: 12, alignItems: "flex-end" }}>
            <div className="field">
              <label className="label">Model *</label>
              <select className="input select" value={modelId} onChange={e => setModelId(e.target.value)}>
                <option value="">— select —</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Deployment Name *</label>
              <input className="input" placeholder="e.g. churn-v1" value={dName} onChange={e => setDName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Namespace</label>
              <input className="input" value={namespace} onChange={e => setNamespace(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">CPU</label>
              <input className="input" value={cpu} onChange={e => setCpu(e.target.value)} placeholder="1" />
            </div>
            <div className="field">
              <label className="label">Memory</label>
              <input className="input" value={memory} onChange={e => setMemory(e.target.value)} placeholder="2Gi" />
            </div>
            <div className="field">
              <label className="label">Replicas</label>
              <input className="input" type="number" min={1} value={replicas} onChange={e => setReplicas(+e.target.value)} />
            </div>
          </div>
          {err && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 8 }}>{err}</p>}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? <><RefreshCw size={13} className="spin" /> Deploying…</> : <><Rocket size={13} /> Deploy</>}
            </button>
            <button className="btn btn-secondary" onClick={() => setForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1,2].map(i => <div key={i} className="skeleton" style={{ height: 50 }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Rocket size={40} />
          <p>No deployments yet. Deploy a trained model above.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Endpoint</th>
                <th>CPU</th><th>Memory</th><th>Replicas</th><th>P50</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(d => <DeployRow key={d.id} d={d} onDelete={() => setToDelete(d)} />)}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete deployment?"
        message={`This removes ${toDelete?.name || "this deployment"} and stops its endpoint.`}
        confirmLabel="Delete deployment"
        danger
        loading={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
