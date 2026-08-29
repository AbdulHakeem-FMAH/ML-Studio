import { useEffect, useRef, useState } from "react";
import { CheckCircle, ChevronLeft, ChevronRight, CircleAlert, Play, RefreshCw, TerminalSquare, XCircle } from "lucide-react";
import { datasets as datasetsApi, training } from "../api/client.js";

const PRESETS = [
  { value: "fast", label: "Fast", desc: "Quick baseline" },
  { value: "medium_quality", label: "Balanced", desc: "Recommended" },
  { value: "high_quality", label: "High quality", desc: "More tuning" },
  { value: "best_quality", label: "Best quality", desc: "Longest run" },
];
const TASKS = [
  { value: "automatic", label: "Auto-detect" },
  { value: "classification", label: "Classification" },
  { value: "regression", label: "Regression" },
  { value: "timeseries", label: "Time series" },
];
const DEFAULT_CFG = {
  model_name: "", dataset_name: "", target_col: "", task: "automatic", preset: "medium_quality",
  time_limit: 600, version_bump: "patch", numeric_imputation: true, categorical_imputation: true,
  normalize: false, remove_outliers: false,
};

function StepOne({ cfg, setCfg, datasets, columns, selectedDataset }) {
  const selectDataset = (name) => setCfg((current) => ({ ...current, dataset_name: name, target_col: "" }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="grid-2">
        <div className="field"><label className="label">Model name *</label><input className="input" value={cfg.model_name} onChange={(event) => setCfg((current) => ({ ...current, model_name: event.target.value }))} placeholder="e.g. iris_classifier" /></div>
        <div className="field"><label className="label">Dataset *</label><select className="input select" value={cfg.dataset_name} onChange={(event) => selectDataset(event.target.value)}><option value="">— choose a dataset —</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.name}>{dataset.name} · {dataset.rows?.toLocaleString()} rows</option>)}</select></div>
      </div>
      {selectedDataset && <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", border: "1px solid var(--accent-border)", background: "var(--accent-dim)", borderRadius: "var(--r-md)", color: "var(--text-secondary)", fontSize: 12 }}><CheckCircle size={15} color="var(--accent)" /> Dataset type detected as <strong style={{ color: "var(--text-primary)", textTransform: "capitalize" }}>{selectedDataset.dtype}</strong>. Auto-detect will use this signal where applicable.</div>}
      <div className="grid-2">
        <div className="field"><label className="label">Target column *</label><select className="input select" value={cfg.target_col} onChange={(event) => setCfg((current) => ({ ...current, target_col: event.target.value }))} disabled={!cfg.dataset_name}><option value="">— choose target column —</option>{columns.map((column) => <option key={column.col} value={column.col}>{column.col} ({column.semantic_type || column.dtype})</option>)}</select><p style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 5 }}>Columns are read from the selected dataset—no manual typing required.</p></div>
        <div className="field"><label className="label">Task type</label><select className="input select" value={cfg.task} onChange={(event) => setCfg((current) => ({ ...current, task: event.target.value }))}>{TASKS.map((task) => <option key={task.value} value={task.value}>{task.label}</option>)}</select></div>
      </div>
    </div>
  );
}

function StepTwo({ cfg, setCfg }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div><label className="label">AutoGluon training profile</label><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginTop: 6 }}>{PRESETS.map((preset) => <button type="button" key={preset.value} onClick={() => setCfg((current) => ({ ...current, preset: preset.value }))} style={{ border: `1px solid ${cfg.preset === preset.value ? "var(--accent)" : "var(--border)"}`, background: cfg.preset === preset.value ? "var(--accent-dim)" : "var(--bg-elevated)", color: "var(--text-primary)", borderRadius: 10, padding: "13px", cursor: "pointer", textAlign: "left" }}><strong style={{ display: "block", color: cfg.preset === preset.value ? "var(--accent)" : "inherit", fontSize: 13 }}>{preset.label}</strong><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{preset.desc}</span></button>)}</div></div>
      <div className="grid-2"><div className="field"><label className="label">Time limit (seconds)</label><input className="input" type="number" min="60" max="86400" value={cfg.time_limit} onChange={(event) => setCfg((current) => ({ ...current, time_limit: Number(event.target.value) }))} /><p style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 5 }}>Use at least 300 seconds for meaningful comparisons.</p></div><div className="field"><label className="label">Version increment</label><select className="input select" value={cfg.version_bump} onChange={(event) => setCfg((current) => ({ ...current, version_bump: event.target.value }))}><option value="patch">Patch (x.x.+1)</option><option value="minor">Minor (x.+1.0)</option><option value="major">Major (+1.0.0)</option></select></div></div>
      <div><label className="label">Preprocessing</label><div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>{[["numeric_imputation", "Numeric imputation"], ["categorical_imputation", "Categorical imputation"], ["normalize", "Normalize features"], ["remove_outliers", "Remove numeric outliers"]].map(([key, label]) => <label key={key} style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-secondary)", fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={Boolean(cfg[key])} onChange={(event) => setCfg((current) => ({ ...current, [key]: event.target.checked }))} style={{ accentColor: "var(--accent)" }} />{label}</label>)}</div></div>
    </div>
  );
}

function LogTerminal({ run, logs, progress }) {
  const terminalRef = useRef(null);
  useEffect(() => { if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight; }, [logs]);
  const status = run?.status || "queued";
  const color = { queued: "var(--text-secondary)", running: "var(--info)", done: "var(--success)", failed: "var(--error)" }[status] || "var(--text-secondary)";
  const label = { queued: "Queued — waiting for a worker", running: "Training in progress", done: "Training complete", failed: "Training failed" }[status] || "Initialising";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div style={{ display: "flex", alignItems: "center", gap: 8, color, fontWeight: 600 }}>{status === "done" ? <CheckCircle size={17} /> : status === "failed" ? <XCircle size={17} /> : <RefreshCw size={17} className={status === "running" ? "spin" : ""} />}{label}</div><span className="td-mono">{progress}%</span></div>
      <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${progress}%` }} /></div>
      <div ref={terminalRef} className="terminal" aria-live="polite">{logs.length === 0 ? <span style={{ color: "var(--text-tertiary)" }}>Waiting for worker output…</span> : logs.map((entry, index) => { const message = typeof entry === "string" ? entry : entry?.l || JSON.stringify(entry); const lower = message.toLowerCase(); const level = /failed|error|exception/.test(lower) ? "error" : /warning|skipped/.test(lower) ? "warn" : "info"; const time = entry?.t ? new Date(entry.t).toLocaleTimeString() : "—"; return <div className={`log-line ${level}`} key={`${entry?.t || "log"}-${index}`}><span className="log-time">{time}</span><span>{message}</span></div>; })}</div>
    </div>
  );
}

export default function Training() {
  const [step, setStep] = useState(1); const [cfg, setCfg] = useState(DEFAULT_CFG); const [datasetList, setDatasetList] = useState([]); const [columns, setColumns] = useState([]);
  const [run, setRun] = useState(null); const [logs, setLogs] = useState([]); const [progress, setProgress] = useState(0); const [error, setError] = useState(""); const [starting, setStarting] = useState(false);
  const eventSourceRef = useRef(null); const pollingRef = useRef(null);
  useEffect(() => { datasetsApi.list().then(setDatasetList).catch((err) => setError(err.message)); }, []);
  useEffect(() => {
    const selected = datasetList.find((dataset) => dataset.name === cfg.dataset_name);
    if (!selected) { setColumns([]); return undefined; }
    let active = true;
    datasetsApi.columns(selected.id).then((response) => active && setColumns(response.columns || selected.schema_def || [])).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [cfg.dataset_name, datasetList]);
  useEffect(() => () => { eventSourceRef.current?.close(); if (pollingRef.current) clearInterval(pollingRef.current); }, []);
  const selectedDataset = datasetList.find((dataset) => dataset.name === cfg.dataset_name);
  const validate = () => {
    if (!cfg.model_name.trim()) { setError("Model name is required."); return false; }
    if (!cfg.dataset_name) { setError("Choose a dataset."); return false; }
    if (!cfg.target_col) { setError("Choose a target column."); return false; }
    setError(""); return true;
  };
  const refreshRun = (runId) => training.getRun(runId).then((response) => { setRun(response); setProgress(response.progress || 0); setLogs(response.logs || []); if (["done", "failed"].includes(response.status) && pollingRef.current) clearInterval(pollingRef.current); }).catch(() => {});
  const startTraining = async () => {
    setStarting(true); setError(""); setLogs([]); setProgress(0);
    try {
      const runData = await training.start(cfg);
      setRun(runData); setLogs(runData.logs || []); setStep(3);
      const source = training.streamLogs(runData.id); eventSourceRef.current = source;
      source.onmessage = (event) => { try { const entry = JSON.parse(event.data); setLogs((current) => [...current, entry]); } catch { setLogs((current) => [...current, event.data]); } };
      source.addEventListener("done", () => { source.close(); refreshRun(runData.id); });
      pollingRef.current = setInterval(() => refreshRun(runData.id), 2000);
      refreshRun(runData.id);
    } catch (err) { setError(err.message); } finally { setStarting(false); }
  };
  const reset = () => { eventSourceRef.current?.close(); if (pollingRef.current) clearInterval(pollingRef.current); setStep(1); setRun(null); setLogs([]); setProgress(0); setError(""); };
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Train a model</h1><p className="page-sub">Select a profiled dataset, configure AutoML, and follow the live training output.</p></div>
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 30, overflowX: "auto" }}>{[{ n: 1, label: "Data & target" }, { n: 2, label: "Training profile" }, { n: 3, label: "Live run" }].map((item, index) => <div key={item.n} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}><div style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: "50%", color: step >= item.n ? "#fff" : "var(--text-tertiary)", background: step >= item.n ? "var(--accent)" : "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 700 }}>{item.n}</div><span style={{ marginLeft: 8, color: step === item.n ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: step === item.n ? 600 : 400, fontSize: 13 }}>{item.label}</span>{index < 2 && <div style={{ width: 54, height: 1, margin: "0 14px", background: "var(--border)" }} />}</div>)}</div>
      <section className="card" style={{ marginBottom: 16 }}>{step === 1 && <StepOne cfg={cfg} setCfg={setCfg} datasets={datasetList} columns={columns} selectedDataset={selectedDataset} />}{step === 2 && <StepTwo cfg={cfg} setCfg={setCfg} />}{step === 3 && <LogTerminal run={run} logs={logs} progress={progress} />}</section>
      {error && <p style={{ color: "var(--error)", display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 12 }}><CircleAlert size={14} />{error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div>{step === 2 && <button className="btn btn-secondary" onClick={() => setStep(1)}><ChevronLeft size={14} /> Back</button>}{step === 3 && <button className="btn btn-secondary" onClick={reset}><TerminalSquare size={14} /> Start another run</button>}</div><div>{step === 1 && <button className="btn btn-primary" onClick={() => validate() && setStep(2)}>Next <ChevronRight size={14} /></button>}{step === 2 && <button className="btn btn-primary" onClick={startTraining} disabled={starting}>{starting ? <><RefreshCw size={14} className="spin" /> Creating run</> : <><Play size={14} /> Start training</>}</button>}</div></div>
    </div>
  );
}
