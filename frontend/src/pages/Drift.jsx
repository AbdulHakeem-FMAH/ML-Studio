import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle, Database,
  FileUp, LoaderCircle, Play, RefreshCw, RotateCcw,
  Trash2, Upload
} from "lucide-react";
import { datasets as dsApi, drift, models as modelsApi } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

function DriftBar({ score }) {
  const color = score > 0.4 ? "var(--error)" : score > 0.3 ? "var(--warning)" : "var(--success)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(score * 100, 100)}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color, fontWeight: 700, minWidth: 46 }}>
        {Number(score).toFixed(4)}
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
          <tr><th>Feature</th><th>Statistical Test</th><th>Drift Score</th><th>Drift Detected?</th></tr>
        </thead>
        <tbody>
          {features.map((f, i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{f.feat}</td>
              <td><span className="badge badge-neutral">{f.dist}</span></td>
              <td style={{ minWidth: 140 }}><DriftBar score={f.score} /></td>
              <td>
                {f.detected
                  ? <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> Yes</span>
                  : <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle size={11} /> No</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportRow({ r, onRetrain, onDelete, retrainingId }) {
  const [open, setOpen] = useState(false);
  const isRetraining = retrainingId === r.id;

  return (
    <>
      <tr>
        <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
          #{r.id.slice(0, 8)}
        </td>
        <td>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{r.model_name || "Model"}</strong>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>v{r.model_version || "1.0.0"}</span>
          </div>
        </td>
        <td>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.ref_dataset_name || "—"}</span>
        </td>
        <td>
          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>{r.curr_dataset_name || "—"}</span>
        </td>
        <td style={{ minWidth: 140 }}><DriftBar score={r.score} /></td>
        <td>
          {r.detected
            ? <span className="badge badge-error" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> Drifted</span>
            : <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle size={11} /> Clean</span>}
        </td>
        <td>
          {r.retrained ? (
            <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <CheckCircle size={11} /> Retrained
            </span>
          ) : r.detected ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onRetrain(r)}
              disabled={isRetraining}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", fontSize: 11 }}
            >
              {isRetraining ? <><LoaderCircle size={12} className="spin" /> Retraining…</> : <><RotateCcw size={12} /> Retrain (Patch)</>}
            </button>
          ) : (
            <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>Model Up to Date</span>
          )}
        </td>
        <td style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
          {new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
        </td>
        <td>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                HTML
              </a>
            )}
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--error)", padding: "4px 8px" }}
              onClick={() => onDelete(r)}
              title="Delete drift report"
              aria-label={`Delete report ${r.id}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ padding: 0 }}>
            <div style={{ padding: "16px 20px", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Feature-Level Drift Diagnostics</span>
                {r.detected && !r.retrained && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onRetrain(r)}
                    disabled={isRetraining}
                  >
                    {isRetraining ? <><LoaderCircle size={13} className="spin" /> Retraining…</> : <><RotateCcw size={13} /> Retrain model on {r.curr_dataset_name}</>}
                  </button>
                )}
                {r.retrained && (
                  <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <CheckCircle size={12} /> Model Retrained on this Dataset
                  </span>
                )}
              </div>
              <FeatureTable features={r.features} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Drift() {
  const [reports, setReports]       = useState([]);
  const [models, setModels]         = useState([]);
  const [datasets, setDs]           = useState([]);
  const [loading, setLoad]          = useState(true);
  const [running, setRunning]       = useState(false);
  const [err, setErr]               = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [retrainingId, setRetrainingId] = useState(null);

  // Deletion state
  const [toDelete, setToDelete]     = useState(null);
  const [deleting, setDeleting]     = useState(false);

  // Form state
  const [modelId, setModelId]       = useState("");
  const [sourceMode, setSourceMode] = useState("upload"); // 'upload' or 'existing'
  const [currDsName, setCurrDsName] = useState("");
  const [driftType, setDriftType]   = useState("data");
  const [latestReport, setLatestReport] = useState(null);

  const fileRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const load = () => {
    setLoad(true);
    Promise.all([
      drift.list(),
      modelsApi.list().then(ms => ms.filter(m => m.status === "Complete")),
      dsApi.list(),
    ]).then(([r, m, d]) => {
      setReports(r);
      setModels(m);
      setDs(d);
      if (!modelId && m.length > 0) {
        setModelId(m[0].id);
      }
    }).catch(() => {}).finally(() => setLoad(false));
  };

  useEffect(load, []);

  const selectedModel = models.find(m => m.id === modelId);
  const referenceDataset = datasets.find(d => d.id === selectedModel?.dataset_id || d.name === selectedModel?.config?.dataset_name);

  const handleCheck = async () => {
    if (!modelId) { setErr("Please select a model."); return; }
    if (sourceMode === "upload" && !selectedFile) {
      setErr("Please upload the newer version of the dataset to check for drift.");
      return;
    }
    if (sourceMode === "existing" && !currDsName) {
      setErr("Please choose a current dataset to compare against.");
      return;
    }

    setErr("");
    setSuccessMsg("");
    setRunning(true);
    setLatestReport(null);

    try {
      const fd = new FormData();
      fd.append("model_id", modelId);
      fd.append("drift_type", driftType);
      if (referenceDataset) {
        fd.append("ref_dataset_name", referenceDataset.name);
      }

      if (sourceMode === "upload" && selectedFile) {
        fd.append("file", selectedFile);
      } else if (sourceMode === "existing" && currDsName) {
        fd.append("curr_dataset_name", currDsName);
      }

      const report = await drift.check(fd);
      setLatestReport(report);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) {
      setErr(e.message || "Failed to execute drift detection.");
    } finally {
      setRunning(false);
    }
  };

  const handleRetrain = async (rep) => {
    setRetrainingId(rep.id);
    setErr("");
    setSuccessMsg("");
    try {
      const res = await drift.retrain({
        model_id: rep.model_id,
        dataset_id: rep.dataset_id,
        report_id: rep.id,
      });
      setSuccessMsg(
        `Retraining triggered for model '${res.model_name}' as version v${res.version} on dataset '${res.dataset_name}'! Version incremented as patch.`
      );
      if (latestReport && latestReport.id === rep.id) {
        setLatestReport(prev => prev ? { ...prev, retrained: true, retrain: false } : prev);
      }
      load();
    } catch (e) {
      setErr(e.message || "Failed to initiate retraining.");
    } finally {
      setRetrainingId(null);
    }
  };

  const handleDeleteReport = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setErr("");
    try {
      await drift.delete(toDelete.id);
      setSuccessMsg(`Drift report #${toDelete.id.slice(0, 8)} successfully deleted.`);
      if (latestReport?.id === toDelete.id) setLatestReport(null);
      setToDelete(null);
      load();
    } catch (e) {
      setErr(e.message || "Failed to delete drift report.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
        <div>
          <h1 className="page-title">Drift Detection & Automated Retraining</h1>
          <p className="page-sub">
            Monitor feature distribution shifts against training baselines, with instant incremental patch retraining.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>

      {successMsg && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "14px 18px", borderRadius: "var(--r-md)", marginBottom: 20,
          background: "var(--success-dim)", border: "1px solid rgba(34,197,94,0.35)", color: "var(--success)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle size={18} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{successMsg}</span>
          </div>
          <Link to="/training" className="btn btn-primary btn-sm" style={{ whiteSpace: "nowrap" }}>
            <Play size={12} /> View Live Training <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {err && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderRadius: "var(--r-md)", marginBottom: 20,
          background: "var(--error-dim)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontSize: 13
        }}>
          <AlertTriangle size={16} />
          <span>{err}</span>
        </div>
      )}

      {/* Primary Drift Check Card */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Run Drift Check</h2>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(280px, 1.4fr)", gap: 20, alignItems: "start" }}>
          {/* 1. Model Selection & Auto-detected Reference Baseline */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label className="label">1. Select Model to Monitor</label>
              <select
                className="input select"
                value={modelId}
                onChange={e => { setModelId(e.target.value); setLatestReport(null); setErr(""); }}
              >
                <option value="">— choose a model —</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} (v{m.version}) · {m.task}
                  </option>
                ))}
              </select>
            </div>

            {/* Auto-detected Reference Dataset Information */}
            {selectedModel && (
              <div style={{
                padding: "12px 14px", borderRadius: "var(--r-md)",
                background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: 12
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, color: "var(--accent)", fontWeight: 600 }}>
                  <Database size={14} />
                  <span>Model Baseline Reference Dataset</span>
                </div>
                <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13 }}>
                  {referenceDataset?.name || selectedModel.config?.dataset_name || "Baseline Training Dataset"}
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 3 }}>
                  {referenceDataset ? `${referenceDataset.rows?.toLocaleString()} rows · ${referenceDataset.cols} cols · ${referenceDataset.dtype}` : "Auto-configured from model training metadata"}
                </div>
              </div>
            )}
          </div>

          {/* 2. Newer Dataset Source: Direct Upload or Existing */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="label" style={{ margin: 0 }}>2. Newer Dataset Version to Test</label>
              <div className="source-tabs" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={`source-tab ${sourceMode === "upload" ? "active" : ""}`}
                  onClick={() => setSourceMode("upload")}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  <Upload size={12} /> Upload New File
                </button>
                <button
                  type="button"
                  className={`source-tab ${sourceMode === "existing" ? "active" : ""}`}
                  onClick={() => setSourceMode("existing")}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  <Database size={12} /> Select Existing
                </button>
              </div>
            </div>

            {sourceMode === "upload" ? (
              <div style={{
                border: "1px dashed var(--accent-border)", borderRadius: "var(--r-md)",
                padding: "16px 18px", background: "var(--accent-dim)", display: "flex", flexDirection: "column", gap: 10
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileUp size={20} color="var(--accent)" />
                  <div>
                    <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Upload Newer Dataset Version</strong>
                    <p style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      Upload fresh observations (.csv, .parquet, .xlsx) to compare against the baseline.
                    </p>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  className="input"
                  type="file"
                  accept=".csv,.parquet,.xlsx,.xls"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  style={{ background: "var(--bg-surface)" }}
                />
                {selectedFile && (
                  <span style={{ fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 5 }}>
                    <CheckCircle size={12} /> Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>
            ) : (
              <div className="field">
                <select
                  className="input select"
                  value={currDsName}
                  onChange={e => setCurrDsName(e.target.value)}
                >
                  <option value="">— choose current dataset —</option>
                  {datasets.map(d => (
                    <option key={d.id} value={d.name}>
                      {d.name} · {d.rows?.toLocaleString()} rows ({d.dtype})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
              <div className="field" style={{ width: 140 }}>
                <label className="label">Check Type</label>
                <select className="input select" value={driftType} onChange={e => setDriftType(e.target.value)}>
                  <option value="data">Data Drift</option>
                  <option value="concept">Concept Drift</option>
                </select>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCheck}
                disabled={running || !modelId}
                style={{ flex: 1, marginTop: 20, height: 40 }}
              >
                {running ? <><LoaderCircle size={14} className="spin" /> Computing Drift (Evidently)…</> : <><Activity size={14} /> Run Drift Check</>}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Latest Drift Result / Retrain Action Prompt */}
      {latestReport && (
        <section className="card" style={{
          marginBottom: 24,
          borderColor: latestReport.retrained ? "rgba(34,197,94,0.4)" : latestReport.detected ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.4)",
          background: latestReport.retrained ? "rgba(34,197,94,0.03)" : latestReport.detected ? "rgba(239,68,68,0.04)" : "rgba(34,197,94,0.03)"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {latestReport.retrained ? (
                  <span className="badge badge-success" style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <CheckCircle size={13} /> Model Retrained on Updated Dataset
                  </span>
                ) : latestReport.detected ? (
                  <span className="badge badge-error" style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <AlertTriangle size={13} /> Significant Data Drift Detected
                  </span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <CheckCircle size={13} /> Data Distributions Stable
                  </span>
                )}
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  Overall Drift Score: <strong style={{ color: latestReport.detected && !latestReport.retrained ? "var(--error)" : "var(--success)", fontFamily: "var(--font-mono)" }}>
                    {latestReport.score.toFixed(4)}
                  </strong>
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, maxWidth: 680 }}>
                {latestReport.retrained
                  ? `This model has been retrained on '${latestReport.curr_dataset_name}' with an incremental patch version bump.`
                  : latestReport.detected
                  ? `Significant distribution drift was detected across features between reference baseline '${latestReport.ref_dataset_name}' and updated dataset '${latestReport.curr_dataset_name}'. Retrain the model on the updated dataset to prevent prediction decay.`
                  : `Features in '${latestReport.curr_dataset_name}' match the baseline distribution. Model '${latestReport.model_name}' remains optimal without retraining.`}
              </p>
            </div>

            {/* Prompt User to Retrain on Drift */}
            {latestReport.detected && !latestReport.retrained && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleRetrain(latestReport)}
                  disabled={retrainingId === latestReport.id}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "10px 18px", fontSize: 13, fontWeight: 600,
                    boxShadow: "0 0 20px rgba(99,102,241,0.3)"
                  }}
                >
                  {retrainingId === latestReport.id ? (
                    <><LoaderCircle size={15} className="spin" /> Retraining…</>
                  ) : (
                    <><RotateCcw size={15} /> Retrain Model on Updated Dataset (Patch Bump)</>
                  )}
                </button>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  Automatically bumps version as incremental patch & trains on {latestReport.curr_dataset_name}
                </span>
              </div>
            )}
          </div>

          <p className="section-title" style={{ marginTop: 18, marginBottom: 8 }}>Feature Drift Breakdown</p>
          <FeatureTable features={latestReport.features} />
        </section>
      )}

      {/* Reports History Table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <p className="section-title" style={{ margin: 0 }}>Drift Reports History</p>
          <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
            {reports.length} report{reports.length === 1 ? "" : "s"} across all model monitoring runs
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: "var(--r-md)" }} />)}
        </div>
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <Activity size={40} />
          <p>No drift reports yet. Select a model and upload a newer dataset version to check for drift.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Model</th>
                <th>Reference Dataset</th>
                <th>Current Dataset</th>
                <th>Drift Score</th>
                <th>Status</th>
                <th>Action / Status</th>
                <th>Checked At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <ReportRow
                  key={r.id}
                  r={r}
                  onRetrain={handleRetrain}
                  onDelete={setToDelete}
                  retrainingId={retrainingId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Delete Report Modal */}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete Drift Report?"
        message={`Are you sure you want to delete drift report #${toDelete?.id?.slice(0, 8)} for ${toDelete?.model_name || "this model"}? This will permanently remove the drift diagnostics and stored report artifact.`}
        confirmLabel="Delete Report"
        danger
        loading={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={handleDeleteReport}
      />
    </div>
  );
}
