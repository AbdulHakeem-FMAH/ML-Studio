import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, BrainCircuit, Download, Medal, RefreshCw, Target, Trash2, TrendingUp } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { models } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const STATUS = { Complete: "badge-success", "In Progress": "badge-info", Pending: "badge-neutral", Failed: "badge-error" };
const metricValue = (name, value) => {
  if (value == null) return null;
  return ["accuracy", "f1", "auc"].includes(name) ? `${(value * 100).toFixed(1)}%` : Number(value).toFixed(4);
};

function Metric({ label, value, accent = "var(--accent)" }) {
  if (value == null) return null;
  return <div className="quality-metric"><strong style={{ color: accent }}>{value}</strong><span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{label}</span></div>;
}

function FeatureImportance({ importance }) {
  const data = [...(importance || [])].sort((a, b) => b.v - a.v).slice(0, 15);
  if (!data.length) return <EmptyVisual text="Feature importance was not available for this run." />;
  return <ResponsiveContainer width="100%" height={Math.max(220, data.length * 30)}><BarChart data={data} layout="vertical" margin={{ left: 106, right: 20 }}><XAxis type="number" tick={{ fill: "#76768e", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="f" width={100} tick={{ fill: "#b0b0c2", fontSize: 10, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#18181f", border: "1px solid #30303e", borderRadius: 8, fontSize: 12 }} formatter={(value) => [Number(value).toFixed(4), "Importance"]} /><Bar dataKey="v" radius={[0, 5, 5, 0]} maxBarSize={18}>{data.map((item, index) => <Cell key={item.f} fill={index === 0 ? "#818cf8" : `rgba(129,140,248,${0.85 - index * 0.035})`} />)}</Bar></BarChart></ResponsiveContainer>;
}

function ConfusionMatrix({ matrix, labels }) {
  if (!matrix?.length || !labels?.length) return <EmptyVisual text="A confusion matrix is available for classification models." />;
  const maximum = Math.max(...matrix.flat(), 1);
  return <div style={{ overflowX: "auto" }}><table style={{ width: "auto", minWidth: "100%", fontSize: 12 }}><thead><tr><th>Actual \ Pred.</th>{labels.map((label) => <th key={label} style={{ textAlign: "center" }}>{label}</th>)}</tr></thead><tbody>{matrix.map((row, rowIndex) => <tr key={labels[rowIndex]}><td className="td-mono">{labels[rowIndex]}</td>{row.map((value, columnIndex) => { const strength = value / maximum; return <td key={columnIndex} style={{ background: rowIndex === columnIndex ? `rgba(99,102,241,${0.18 + strength * 0.72})` : `rgba(239,68,68,${strength * 0.42})`, textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 700, border: "1px solid var(--bg-base)" }}>{value}</td>; })}</tr>)}</tbody></table><p style={{ color: "var(--text-tertiary)", fontSize: 10, marginTop: 8 }}>Rows are actual classes; columns are predictions.</p></div>;
}

function EmptyVisual({ text }) {
  return <div style={{ minHeight: 150, display: "grid", placeItems: "center", color: "var(--text-tertiary)", fontSize: 12, textAlign: "center", padding: 20 }}>{text}</div>;
}

function Leaderboard({ rows }) {
  if (!rows?.length) return <EmptyVisual text="The AutoGluon leaderboard is not available yet." />;
  const columns = Object.keys(rows[0]).filter((key) => key !== "m").slice(0, 4);
  const medalColor = ["#fbbf24", "#cbd5e1", "#d97706"];
  return <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Model</th>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={`${row.m}-${index}`}><td>{index < 3 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: medalColor[index], fontWeight: 700 }}><Medal size={14} /> {index + 1}</span> : <span className="td-mono">{index + 1}</span>}</td><td className="td-mono" style={{ color: index === 0 ? "var(--accent)" : "var(--text-primary)", fontWeight: index === 0 ? 700 : 400 }}>{row.m}</td>{columns.map((column) => <td key={column} className="td-mono">{typeof row[column] === "number" ? row[column].toFixed(4) : row[column] ?? "—"}</td>)}</tr>)}</tbody></table></div>;
}

function ModelAnalysis({ model }) {
  const metrics = [["Accuracy", "accuracy"], ["F1 score", "f1"], ["AUC", "auc"], ["RMSE", "rmse"], ["MAE", "mae"], ["R²", "r2"]];
  return <section className="card" style={{ marginTop: 22, borderColor: "var(--accent-border)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20 }}><div><p className="section-title" style={{ marginBottom: 2 }}>Model analysis</p><h2 style={{ fontSize: 17 }}>{model.name} <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>v{model.version}</span></h2></div><span className={`badge ${STATUS[model.status] || "badge-neutral"}`}>{model.status}</span></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>{metrics.map(([label, key]) => <Metric key={key} label={label} value={metricValue(key, model[key])} accent={key === "rmse" || key === "mae" ? "var(--warning)" : "var(--accent)"} />)}</div>
    <div className="grid-2" style={{ alignItems: "stretch", marginBottom: 24 }}><div className="card-sm"><div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 8 }}><BarChart3 size={15} color="var(--accent)" /><p className="section-title" style={{ margin: 0 }}>Feature importance</p></div><FeatureImportance importance={model.importance} /></div><div className="card-sm"><div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 8 }}><Target size={15} color="var(--accent)" /><p className="section-title" style={{ margin: 0 }}>Confusion matrix</p></div><ConfusionMatrix matrix={model.confmat} labels={model.labels} /></div></div>
    <div><div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 8 }}><Medal size={15} color="var(--accent)" /><p className="section-title" style={{ margin: 0 }}>AutoGluon leaderboard</p></div><Leaderboard rows={model.leaderboard} /></div>
  </section>;
}

export default function Models() {
  const [list, setList] = useState([]); const [loading, setLoading] = useState(true); const [selectedId, setSelectedId] = useState(null); const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false); const [error, setError] = useState("");
  const load = () => { setLoading(true); models.list().then((response) => { setList(response); setSelectedId((current) => current && response.some((model) => model.id === current) ? current : response[0]?.id || null); }).catch((err) => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const selected = list.find((model) => model.id === selectedId);
  const deleteModel = async () => { if (!toDelete) return; setDeleting(true); try { await models.delete(toDelete.id); setToDelete(null); load(); } catch (err) { setError(err.message); } finally { setDeleting(false); } };
  const download = async (id) => { try { const artifact = await models.downloadArtifact(id); window.open(artifact.url, "_blank", "noopener,noreferrer"); } catch (err) { setError(err.message); } };
  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 20 }}><div><h1 className="page-title">Models</h1><p className="page-sub">Compare model quality, understand feature impact, and inspect every training run.</p></div><button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button></div>
      {error && <p style={{ color: "var(--error)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading ? <div className="grid-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton" style={{ height: 220 }} />)}</div> : list.length ? <>
        <div className="grid-3">{list.map((model) => <article className="card" key={model.id} style={{ padding: 20, borderColor: selectedId === model.id ? "var(--accent-border)" : undefined, display: "flex", flexDirection: "column", gap: 16 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div style={{ minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><BrainCircuit size={17} color="var(--accent)" /><h2 style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis" }}>{model.name}</h2></div><p style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 3 }}>v{model.version} · {model.task} · {model.algo || "Waiting for training"}</p></div><span className={`badge ${STATUS[model.status] || "badge-neutral"}`}>{model.status}</span></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{model.accuracy != null ? <Metric label="Accuracy" value={metricValue("accuracy", model.accuracy)} /> : <Metric label="RMSE" value={metricValue("rmse", model.rmse)} accent="var(--warning)" />}<Metric label="Features" value={model.features} /></div><div style={{ display: "flex", gap: 6, borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}><button className="btn btn-secondary btn-sm" onClick={() => setSelectedId(model.id)}><BarChart3 size={13} /> Analyze</button>{model.task === "timeseries" && <Link to={`/forecasting?model=${encodeURIComponent(model.name)}`} className="btn btn-primary btn-sm"><TrendingUp size={13} /> Forecast</Link>}{model.storage_key && <button className="btn btn-ghost btn-sm" onClick={() => download(model.id)}><Download size={13} /></button>}<button className="btn btn-ghost btn-sm" style={{ color: "var(--error)", marginLeft: "auto" }} onClick={() => setToDelete(model)} aria-label={`Delete ${model.name}`}><Trash2 size={14} /></button></div></article>)}</div>
        {selected && <ModelAnalysis model={selected} />}
      </> : <div className="empty-state"><BrainCircuit size={40} /><p>No models yet. Train a model from a profiled dataset to see performance insights here.</p></div>}
      <ConfirmDialog open={!!toDelete} title="Delete model?" message={`This removes ${toDelete?.name || "this model"}, its stored artifact, run history, and deployment links. This cannot be undone.`} confirmLabel="Delete model" danger loading={deleting} onCancel={() => setToDelete(null)} onConfirm={deleteModel} />
    </div>
  );
}
