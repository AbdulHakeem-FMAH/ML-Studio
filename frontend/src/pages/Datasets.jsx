import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2, CloudCog, Database, Download, Eye, FileSpreadsheet,
  LoaderCircle, RefreshCw, Table2, Trash2, Upload, X,
} from "lucide-react";
import { database as databaseApi, datasets } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const EMPTY_CONNECTION = {
  db_type: "postgresql", host: "", port: 5432, username: "", password: "",
  database: "", schema_name: "", table: "", dataset_name: "", row_limit: 100000,
};

function QualityBar({ value }) {
  const color = value >= 90 ? "var(--success)" : value >= 70 ? "var(--warning)" : "var(--error)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${value || 0}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <span style={{ color, fontSize: 12, fontWeight: 700 }}>{value ?? 0}%</span>
    </div>
  );
}

function Metric({ label, value, color = "var(--text-primary)" }) {
  return (
    <div className="quality-metric">
      <strong style={{ color }}>{value}</strong>
      <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{label}</span>
    </div>
  );
}

function DatasetInspector({ dataset, onClose }) {
  const [preview, setPreview] = useState(null);
  const [quality, setQuality] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dataset) return undefined;
    let active = true;
    setPreview(null); setQuality(null); setError("");
    Promise.all([datasets.preview(dataset.id, 50), datasets.quality(dataset.id)])
      .then(([table, report]) => { if (active) { setPreview(table); setQuality(report); } })
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [dataset]);

  if (!dataset) return null;
  const columns = quality?.columns_detail || dataset.schema_def || [];
  const missing = [...columns].sort((a, b) => b.null_pct - a.null_pct).filter((column) => column.null_pct > 0).slice(0, 6);
  return (
    <div className="data-inspector" role="presentation" onMouseDown={onClose}>
      <aside className="data-inspector-panel" role="dialog" aria-modal="true" aria-label="Dataset inspector" onMouseDown={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><FileSpreadsheet size={18} color="var(--accent)" /><h2 style={{ fontSize: 19 }}>{dataset.name}</h2></div>
            <p className="page-sub">{dataset.rows?.toLocaleString()} rows · {dataset.cols} columns · auto-detected as {dataset.dtype}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /> Close</button>
        </div>
        {error && <p style={{ color: "var(--error)", marginBottom: 16 }}>{error}</p>}
        {!quality ? <div className="skeleton" style={{ height: 150 }} /> : <>
          <p className="section-title">Data quality</p>
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <Metric label="Quality score" value={`${quality.quality_score}%`} color={quality.quality_score >= 90 ? "var(--success)" : "var(--warning)"} />
            <Metric label="Missing cells" value={quality.missing_cells.toLocaleString()} />
            <Metric label="Duplicate rows" value={quality.duplicate_rows.toLocaleString()} />
            <Metric label="Column types" value={Object.keys(quality.type_breakdown).length} />
          </div>
          <div className="grid-2" style={{ marginBottom: 28 }}>
            <div className="card-sm">
              <p className="section-title">Column type distribution</p>
              {Object.entries(quality.type_breakdown).map(([type, count]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
                  <span style={{ width: 80, color: "var(--text-secondary)", fontSize: 12, textTransform: "capitalize" }}>{type}</span>
                  <div style={{ flex: 1, height: 7, borderRadius: 99, overflow: "hidden", background: "var(--bg-overlay)" }}><div style={{ width: `${(count / quality.columns) * 100}%`, height: "100%", background: "var(--accent)" }} /></div>
                  <span className="td-mono">{count}</span>
                </div>
              ))}
            </div>
            <div className="card-sm">
              <p className="section-title">Missing value hotspots</p>
              {missing.length ? missing.map((column) => (
                <div key={column.col} style={{ margin: "8px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span className="td-mono">{column.col}</span><span style={{ color: "var(--warning)" }}>{column.null_pct}%</span></div>
                  <QualityBar value={100 - column.null_pct} />
                </div>
              )) : <p style={{ color: "var(--success)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><CheckCircle2 size={15} /> No missing values detected.</p>}
            </div>
          </div>
        </>}
        <p className="section-title">Preview · first {preview?.rows?.length || 0} rows</p>
        {!preview ? <div className="skeleton" style={{ height: 260 }} /> : <div className="table-wrap" style={{ maxHeight: 440 }}>
          <table><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column} className="td-mono">{row[column] || <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>}
        <p className="section-title" style={{ marginTop: 28 }}>Column profile</p>
        <div className="table-wrap"><table><thead><tr><th>Column</th><th>Type</th><th>Examples</th><th>Missing</th><th>Cardinality</th></tr></thead><tbody>
          {columns.map((column) => <tr key={column.col}><td className="td-mono">{column.col}</td><td><span className="badge badge-neutral">{column.semantic_type || column.dtype}</span></td><td className="td-mono">{String(column.example ?? "—")}</td><td>{column.null_pct}%</td><td className="td-mono">{column.cardinality?.toLocaleString()}</td></tr>)}
        </tbody></table></div>
      </aside>
    </div>
  );
}

function DatasetCard({ dataset, onInspect, onDelete }) {
  return (
    <article className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><FileSpreadsheet size={17} color="var(--accent)" /><h2 style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis" }}>{dataset.name}</h2></div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>{dataset.source === "database" ? "Database import" : "File upload"} · v{dataset.version}</p>
        </div>
        <span className="badge badge-accent">{dataset.dtype}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
        <div><span style={{ color: "var(--text-tertiary)" }}>Rows</span><strong style={{ display: "block" }}>{dataset.rows?.toLocaleString()}</strong></div>
        <div><span style={{ color: "var(--text-tertiary)" }}>Columns</span><strong style={{ display: "block" }}>{dataset.cols}</strong></div>
      </div>
      <QualityBar value={dataset.quality} />
      <div style={{ display: "flex", gap: 6, paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
        <button className="btn btn-secondary btn-sm" onClick={() => onInspect(dataset)}><Eye size={13} /> Inspect</button>
        <a className="btn btn-ghost btn-sm" href={datasets.downloadUrl(dataset.id)}><Download size={13} /> Download</a>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto", color: "var(--error)" }} onClick={() => onDelete(dataset)} aria-label={`Delete ${dataset.name}`}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

export default function Datasets() {
  const [list, setList] = useState([]); const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("file"); const [name, setName] = useState(""); const [uploading, setUploading] = useState(false);
  const [connection, setConnection] = useState(EMPTY_CONNECTION); const [databases, setDatabases] = useState([]); const [tables, setTables] = useState([]); const [dbMessage, setDbMessage] = useState(""); const [dbLoading, setDbLoading] = useState(false);
  const [error, setError] = useState(""); const [inspected, setInspected] = useState(null); const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const fileRef = useRef(null);
  const load = () => { setLoading(true); datasets.list().then(setList).catch((err) => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const updateConnection = (key, value) => setConnection((current) => ({ ...current, [key]: value }));
  const dbPayload = () => ({ ...connection, port: Number(connection.port), schema_name: connection.schema_name || null });
  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) { setError("A dataset name and file are required."); return; }
    setError(""); setUploading(true);
    try { await datasets.upload(name.trim(), file); setName(""); fileRef.current.value = ""; load(); } catch (err) { setError(err.message); } finally { setUploading(false); }
  };
  const testConnection = async () => {
    setError(""); setDbMessage(""); setDbLoading(true);
    try { await databaseApi.testConnection(dbPayload()); const response = await databaseApi.listDatabases(dbPayload()); setDatabases(response.databases); setDbMessage("Connection verified. Choose a database to continue."); } catch (err) { setError(err.message); } finally { setDbLoading(false); }
  };
  const loadTables = async () => {
    if (!connection.database) { setError("Choose a database first."); return; }
    setError(""); setDbLoading(true);
    try { const response = await databaseApi.listTables(dbPayload()); setTables(response.tables); setDbMessage("Choose a table to create a dataset snapshot."); } catch (err) { setError(err.message); } finally { setDbLoading(false); }
  };
  const ingest = async () => {
    if (!connection.table || !connection.dataset_name.trim()) { setError("Choose a table and provide a dataset name."); return; }
    setError(""); setDbLoading(true);
    try { await databaseApi.ingest(dbPayload()); setDbMessage("Table ingested successfully."); setConnection(EMPTY_CONNECTION); setDatabases([]); setTables([]); load(); } catch (err) { setError(err.message); } finally { setDbLoading(false); }
  };
  const confirmDelete = async () => {
    if (!toDelete) return; setDeleting(true);
    try { await datasets.delete(toDelete.id); setInspected((current) => current?.id === toDelete.id ? null : current); setToDelete(null); load(); } catch (err) { setError(err.message); } finally { setDeleting(false); }
  };

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
        <div><h1 className="page-title">Datasets</h1><p className="page-sub">Bring in data, assess its quality, and prepare it for training.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>
      <section className="card" style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          <div><h2 style={{ fontSize: 15 }}>Add a data source</h2><p style={{ color: "var(--text-secondary)", fontSize: 12 }}>Dataset type is detected automatically after ingestion.</p></div>
          <div className="source-tabs"><button className={`source-tab ${source === "file" ? "active" : ""}`} onClick={() => setSource("file")}><Upload size={13} /> File upload</button><button className={`source-tab ${source === "database" ? "active" : ""}`} onClick={() => setSource("database")}><Database size={13} /> Database connection</button></div>
        </div>
        {source === "file" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(240px,1.3fr) auto", gap: 12, alignItems: "end" }}>
            <div className="field"><label className="label">Dataset name</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. customer_churn" /></div>
            <div className="field"><label className="label">CSV, Parquet, or Excel file</label><input ref={fileRef} className="input" type="file" accept=".csv,.parquet,.xlsx,.xls" onChange={(event) => !name && event.target.files?.[0] && setName(event.target.files[0].name.replace(/\.[^.]+$/, ""))} /></div>
            <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>{uploading ? <><LoaderCircle size={14} className="spin" /> Uploading</> : <><Upload size={14} /> Upload & profile</>}</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
              <div className="field"><label className="label">Database type</label><select className="input select" value={connection.db_type} onChange={(event) => updateConnection("db_type", event.target.value)}><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select></div>
              <div className="field"><label className="label">Host</label><input className="input" value={connection.host} onChange={(event) => updateConnection("host", event.target.value)} placeholder="db.example.com" /></div>
              <div className="field"><label className="label">Port</label><input className="input" type="number" value={connection.port} onChange={(event) => updateConnection("port", event.target.value)} /></div>
              <div className="field"><label className="label">Username</label><input className="input" autoComplete="username" value={connection.username} onChange={(event) => updateConnection("username", event.target.value)} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,1fr) auto", gap: 12, alignItems: "end" }}>
              <div className="field"><label className="label">Password</label><input className="input" type="password" autoComplete="current-password" value={connection.password} onChange={(event) => updateConnection("password", event.target.value)} /></div>
              <div className="field"><label className="label">Schema (optional)</label><input className="input" value={connection.schema_name} onChange={(event) => updateConnection("schema_name", event.target.value)} placeholder="public" /></div>
              <button className="btn btn-secondary" onClick={testConnection} disabled={dbLoading}>{dbLoading ? <LoaderCircle size={14} className="spin" /> : <CloudCog size={14} />} Test & list databases</button>
            </div>
            {databases.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) auto", gap: 12, alignItems: "end" }}><div className="field"><label className="label">Database</label><select className="input select" value={connection.database} onChange={(event) => { updateConnection("database", event.target.value); setTables([]); }}><option value="">— choose database —</option>{databases.map((item) => <option key={item}>{item}</option>)}</select></div><button className="btn btn-secondary" onClick={loadTables} disabled={dbLoading || !connection.database}><Table2 size={14} /> Load tables</button></div>}
            {tables.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,1fr) 150px auto", gap: 12, alignItems: "end" }}><div className="field"><label className="label">Table</label><select className="input select" value={connection.table} onChange={(event) => updateConnection("table", event.target.value)}><option value="">— choose table —</option>{tables.map((item) => <option key={item}>{item}</option>)}</select></div><div className="field"><label className="label">New dataset name</label><input className="input" value={connection.dataset_name} onChange={(event) => updateConnection("dataset_name", event.target.value)} placeholder="e.g. orders_snapshot" /></div><div className="field"><label className="label">Row limit</label><input className="input" type="number" min="1" max="100000" value={connection.row_limit} onChange={(event) => updateConnection("row_limit", event.target.value)} /></div><button className="btn btn-primary" onClick={ingest} disabled={dbLoading}>{dbLoading ? <LoaderCircle size={14} className="spin" /> : <Database size={14} />} Ingest table</button></div>}
            {dbMessage && <p style={{ color: "var(--success)", fontSize: 12 }}>{dbMessage}</p>}
          </div>
        )}
        {error && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 12 }}>{error}</p>}
      </section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}><div><p className="section-title" style={{ margin: 0 }}>Available datasets</p><span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{list.length} dataset{list.length === 1 ? "" : "s"}</span></div></div>
      {loading ? <div className="grid-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton" style={{ height: 230 }} />)}</div> : list.length ? <div className="grid-3">{list.map((dataset) => <DatasetCard key={dataset.id} dataset={dataset} onInspect={setInspected} onDelete={setToDelete} />)}</div> : <div className="empty-state"><Database size={40} /><p>No datasets yet. Upload a file or connect to a database to get started.</p></div>}
      <DatasetInspector dataset={inspected} onClose={() => setInspected(null)} />
      <ConfirmDialog open={!!toDelete} title="Delete dataset?" message={`This removes ${toDelete?.name || "this dataset"}, its stored file, and associated records. This cannot be undone.`} confirmLabel="Delete dataset" danger loading={deleting} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />
    </div>
  );
}
