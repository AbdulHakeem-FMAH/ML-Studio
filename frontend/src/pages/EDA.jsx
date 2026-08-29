import { useEffect, useState } from "react";
import { BarChart2, RefreshCw, ChevronRight } from "lucide-react";
import { datasets as dsApi, eda } from "../api/client.js";

export default function EDA() {
  const [dsList, setDsList]     = useState([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus]     = useState(null); // { ready, report_url }
  const [loading, setLoading]   = useState(false);
  const [generating, setGen]    = useState(false);
  const [err, setErr]           = useState("");

  useEffect(() => {
    dsApi.list().then(ds => setDsList(ds.filter(d => d.dtype !== "image"))).catch(() => {});
  }, []);

  const checkStatus = async (name) => {
    if (!name) return;
    setLoading(true);
    try {
      const s = await eda.status(name);
      setStatus(s);
    } catch { setStatus(null); }
    finally { setLoading(false); }
  };

  const handleSelect = (name) => {
    setSelected(name); setStatus(null); setErr("");
    checkStatus(name);
  };

  const handleGenerate = async () => {
    if (!selected) { setErr("Select a dataset first."); return; }
    setGen(true); setErr(""); setStatus(null);
    try {
      const res = await eda.generate(selected);
      setStatus({ ready: false, report_url: res.report_url });
      // Poll until ready
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const s = await eda.status(selected).catch(() => null);
        if (s?.ready) { setStatus(s); setGen(false); clearInterval(poll); }
        if (attempts > 60) { setGen(false); clearInterval(poll); setErr("Generation timed out. Try refreshing."); }
      }, 3000);
    } catch (e) {
      setErr(e.message); setGen(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">EDA</h1>
        <p className="page-sub">Automated exploratory data analysis via ydata-profiling</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Select Dataset</label>
            <select className="input select" value={selected} onChange={e => handleSelect(e.target.value)}>
              <option value="">— choose a dataset —</option>
              {dsList.map(d => <option key={d.id} value={d.name}>{d.name} ({d.rows?.toLocaleString()} rows)</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={!selected || generating}>
            {generating
              ? <><RefreshCw size={13} className="spin" /> Generating…</>
              : <><BarChart2 size={13} /> Generate Report</>}
          </button>
          {selected && (
            <button className="btn btn-secondary" onClick={() => checkStatus(selected)}>
              <RefreshCw size={13} /> Check Status
            </button>
          )}
        </div>
        {err && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 8 }}>{err}</p>}
      </div>

      {/* Status / viewer */}
      {loading && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)", fontSize: 13 }}>
          <RefreshCw size={14} className="spin" /> Checking report status…
        </div>
      )}

      {!loading && status && !status.ready && !generating && (
        <div className="card" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          No report found for <strong style={{ color: "var(--text-primary)" }}>{selected}</strong>.
          Click <strong>Generate Report</strong> to create one.
        </div>
      )}

      {generating && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--info)", fontSize: 13 }}>
            <RefreshCw size={14} className="spin" />
            Generating EDA report — this may take 1–3 minutes for large datasets…
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: "100%", animation: "shimmer 1.5s infinite", background: "linear-gradient(90deg, var(--accent), var(--accent-hover), var(--accent))", backgroundSize: "200% 100%" }} />
          </div>
        </div>
      )}

      {status?.ready && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            padding: "12px 20px", background: "var(--bg-elevated)",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>EDA Report — {selected}</span>
            </div>
            <a
              href={`/api/v1/eda/report/${encodeURIComponent(selected)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}
            >
              Open in new tab <ChevronRight size={12} />
            </a>
          </div>
          <iframe
            src={`/api/v1/eda/report/${encodeURIComponent(selected)}`}
            title="EDA Report"
            style={{
              width: "100%",
              height: "75vh",
              border: "none",
              display: "block",
              background: "var(--bg-base)",
            }}
          />
        </div>
      )}

      {!loading && !status && !generating && !selected && (
        <div className="empty-state">
          <BarChart2 size={40} />
          <p>Select a dataset above and click Generate Report to view your automated EDA.</p>
        </div>
      )}
    </div>
  );
}
