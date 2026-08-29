import { useEffect, useRef, useState } from "react";
import { CircleAlert, FileUp, LoaderCircle, Sparkles, Upload, Zap } from "lucide-react";
import { models as modelsApi, predictions } from "../api/client.js";

function ProbBar({ label, prob }) {
  return <div style={{ marginBottom: 9 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}><span style={{ color: "var(--text-secondary)" }}>{label}</span><strong style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{(prob * 100).toFixed(1)}%</strong></div><div style={{ height: 7, borderRadius: 99, overflow: "hidden", background: "var(--bg-elevated)" }}><div style={{ width: `${prob * 100}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg, var(--accent), #a78bfa)" }} /></div></div>;
}

function FeatureInput({ feature, value, onChange }) {
  const id = `feature-${feature.name}`;
  const label = feature.name.replace(/_/g, " ");
  const common = { id, className: "input", value: value ?? "", onChange: (event) => onChange(event.target.value), placeholder: feature.example != null ? `e.g. ${feature.example}` : undefined };
  const type = feature.semantic_type;
  return <div className="field">
    <label className="label" htmlFor={id}>{label}{feature.required && <span style={{ color: "var(--error)" }}> *</span>}</label>
    {type === "category" && feature.options?.length ? <select {...common} className="input select"><option value="">— select —</option>{feature.options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>
      : type === "boolean" ? <select {...common} className="input select"><option value="">— select —</option><option value="true">True</option><option value="false">False</option></select>
      : type === "text" ? <textarea {...common} rows="3" style={{ resize: "vertical" }} />
      : <input {...common} type={type === "number" ? "number" : type === "datetime" ? "datetime-local" : "text"} step={type === "number" ? "any" : undefined} />}
    <span style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>{type || feature.dtype}{feature.null_pct ? ` · ${feature.null_pct}% missing in training data` : ""}</span>
  </div>;
}

export default function Predictions() {
  const [modelList, setModelList] = useState([]); const [modelId, setModelId] = useState(""); const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({}); const [result, setResult] = useState(null); const [batchResult, setBatchResult] = useState(null);
  const [tab, setTab] = useState("single"); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const fileRef = useRef(null);
  useEffect(() => { modelsApi.list().then((models) => setModelList(models.filter((model) => model.status === "Complete"))).catch((err) => setError(err.message)); }, []);
  const selectedModel = modelList.find((model) => model.id === modelId);
  const selectModel = async (id) => {
    setModelId(id); setSchema(null); setValues({}); setResult(null); setBatchResult(null); setError("");
    if (!id) return;
    setLoading(true);
    try { const response = await modelsApi.schema(id); setSchema(response); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const updateValue = (name, value) => setValues((current) => ({ ...current, [name]: value }));
  const handleSingle = async () => {
    if (!selectedModel || !schema) return;
    const missing = schema.features.filter((feature) => feature.required && !String(values[feature.name] ?? "").trim());
    if (missing.length) { setError(`Complete required field${missing.length > 1 ? "s" : ""}: ${missing.map((feature) => feature.name).join(", ")}`); return; }
    setLoading(true); setError(""); setResult(null);
    try { setResult(await predictions.single(selectedModel.name, values)); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const handleBatch = async () => {
    const file = fileRef.current?.files?.[0];
    if (!selectedModel || !file) { setError("Select a model and a CSV file."); return; }
    setLoading(true); setError(""); setBatchResult(null);
    try { setBatchResult(await predictions.batch(selectedModel.name, file)); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Predictions</h1><p className="page-sub">Use the exact input schema learned during training—no JSON required.</p></div>
      <div className="source-tabs" style={{ marginBottom: 22 }}><button className={`source-tab ${tab === "single" ? "active" : ""}`} onClick={() => setTab("single")}><Zap size={13} /> Single prediction</button><button className={`source-tab ${tab === "batch" ? "active" : ""}`} onClick={() => setTab("batch")}><FileUp size={13} /> Batch CSV</button></div>
      <section className="card">
        <div className="field" style={{ maxWidth: 620, marginBottom: 22 }}><label className="label">Trained model</label><select className="input select" value={modelId} onChange={(event) => selectModel(event.target.value)}><option value="">— choose a complete model —</option>{modelList.map((model) => <option key={model.id} value={model.id}>{model.name} v{model.version} · {model.task}</option>)}</select></div>
        {loading && !schema && <div style={{ color: "var(--text-secondary)", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><LoaderCircle size={16} className="spin" /> Loading model input schema…</div>}
        {schema?.task === "timeseries" ? <div style={{ padding: 16, borderRadius: "var(--r-md)", background: "var(--info-dim)", color: "var(--text-secondary)", fontSize: 13 }}>This is a time-series model. Use the Forecasting page to run horizon-based predictions.</div> : tab === "single" && schema && <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}><Sparkles size={16} color="var(--accent)" /><div><strong style={{ fontSize: 14 }}>Model input form</strong><p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{schema.features.length} expected feature{schema.features.length === 1 ? "" : "s"} · types and categories derived from the training data</p></div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>{schema.features.map((feature) => <FeatureInput key={feature.name} feature={feature} value={values[feature.name]} onChange={(value) => updateValue(feature.name, value)} />)}</div>
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={handleSingle} disabled={loading}>{loading ? <><LoaderCircle size={14} className="spin" /> Predicting</> : <><Zap size={14} /> Run prediction</>}</button>
        </>}
        {tab === "batch" && selectedModel && schema?.task !== "timeseries" && <><div className="field" style={{ maxWidth: 620 }}><label className="label">CSV file</label><input ref={fileRef} className="input" type="file" accept=".csv" /><p style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 5 }}>The file must include the {schema?.features.length || 0} input columns used to train this model.</p></div><button className="btn btn-primary" style={{ marginTop: 20 }} onClick={handleBatch} disabled={loading}>{loading ? <><LoaderCircle size={14} className="spin" /> Scoring</> : <><Upload size={14} /> Score batch</>}</button></>}
      </section>
      {error && <p style={{ color: "var(--error)", marginTop: 14, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><CircleAlert size={14} />{error}</p>}
      {result && <section className="card" style={{ marginTop: 20 }}><p className="section-title">Prediction result</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: result.probabilities?.length ? 22 : 0 }}><div className="quality-metric"><strong style={{ color: "var(--accent)" }}>{String(result.prediction)}</strong><span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>Prediction</span></div>{result.class_label && <MetricResult label="Predicted class" value={result.class_label} color="var(--success)" />}<MetricResult label="Latency" value={`${result.latency_ms} ms`} /></div>{result.probabilities?.length > 0 && <div style={{ maxWidth: 600 }}><p className="section-title">Class probabilities</p>{[...result.probabilities].sort((a, b) => b.probability - a.probability).map((item) => <ProbBar key={item.label} label={item.label} prob={item.probability} />)}</div>}</section>}
      {batchResult && <section className="card" style={{ marginTop: 20 }}><div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16, color: "var(--text-secondary)", fontSize: 12 }}><span>Model: <strong>{batchResult.model_name}</strong></span><span>Rows scored: <strong>{batchResult.rows_scored}</strong></span><span>Processing time: <strong>{batchResult.processing_ms}ms</strong></span></div><div className="table-wrap" style={{ maxHeight: 420 }}><table><thead><tr><th>Row</th><th>Prediction</th><th>Confidence</th>{batchResult.results?.[0] && Object.keys(batchResult.results[0].features).slice(0, 4).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{batchResult.results.slice(0, 200).map((row) => <tr key={row.row}><td className="td-mono">{row.row}</td><td style={{ color: "var(--accent)", fontWeight: 600 }}>{String(row.prediction)}</td><td className="td-mono">{row.probability != null ? `${(row.probability * 100).toFixed(1)}%` : "—"}</td>{Object.values(row.features).slice(0, 4).map((value, index) => <td key={index} className="td-mono">{String(value)}</td>)}</tr>)}</tbody></table></div></section>}
    </div>
  );
}

function MetricResult({ label, value, color = "var(--text-primary)" }) {
  return <div className="quality-metric"><strong style={{ color }}>{value}</strong><span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{label}</span></div>;
}
