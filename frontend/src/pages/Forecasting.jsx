import { useState, useEffect } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { models as modelsApi, forecasting } from "../api/client.js";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "10px 14px", fontSize: 12,
    }}>
      <p style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || "var(--text-primary)" }}>
          {p.name}: <strong>{p.value != null ? p.value.toFixed(4) : "—"}</strong>
        </p>
      ))}
    </div>
  );
};

export default function Forecasting() {
  const [models, setModels]   = useState([]);
  const [model, setModel]     = useState("");
  const [horizon, setHorizon] = useState(20);
  const [dateCol, setDateCol] = useState("");
  const [valCol, setValCol]   = useState("");
  const [result, setResult]   = useState(null);
  const [loading, setLoad]    = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => {
    modelsApi.list().then(ms => setModels(ms)).catch(() => {});
  }, []);

  const run = async () => {
    if (!model) { setErr("Select a model."); return; }
    setErr(""); setLoad(true); setResult(null);
    try {
      const res = await forecasting.run({
        model_name: model,
        horizon,
        date_col:  dateCol || undefined,
        value_col: valCol  || undefined,
      });
      setResult(res);
    } catch (e) { setErr(e.message); }
    finally { setLoad(false); }
  };

  // Build combined chart data
  const chartData = result ? [
    ...result.history.map(h => ({
      t: h.t, val: h.val, type: "hist",
    })),
    // Bridge point
    result.history.length
      ? { t: result.history[result.history.length - 1].t, bridge: result.history[result.history.length - 1].val, type: "bridge" }
      : null,
    ...result.forecast.map(f => ({
      t: f.t, mean: f.mean, lo: f.lo, hi: f.hi, type: "fc",
    })),
  ].filter(Boolean) : [];

  const splitT = result?.history?.length
    ? result.history[result.history.length - 1].t
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Forecasting</h1>
        <p className="page-sub">Time-series forecasting with Prophet / ETS / linear extrapolation</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px 1fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
          <div className="field">
            <label className="label">Model</label>
            <select className="input select" value={model} onChange={e => setModel(e.target.value)}>
              <option value="">— select —</option>
              {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Horizon (steps)</label>
            <input className="input" type="number" min={1} max={365}
              value={horizon} onChange={e => setHorizon(+e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Date Col</label>
            <input className="input" placeholder="auto" value={dateCol} onChange={e => setDateCol(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Value Col</label>
            <input className="input" placeholder="auto" value={valCol} onChange={e => setValCol(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? <><RefreshCw size={13} className="spin" /> Forecasting…</> : <><TrendingUp size={13} /> Forecast</>}
          </button>
        </div>
        {err && <p style={{ color: "var(--error)", fontSize: 12, marginTop: 8 }}>{err}</p>}
      </div>

      {result && (
        <div className="card">
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Forecast — {result.model_name}</h2>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-tertiary)" }}>
              <span>{result.history.length} historical points</span>
              <span>{result.forecast.length} forecast steps</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)", paddingTop: 12 }}
              />

              {/* Confidence band */}
              <Area
                dataKey="hi"
                fill="rgba(99,102,241,0.08)"
                stroke="none"
                name="Upper bound"
                connectNulls
                legendType="none"
              />
              <Area
                dataKey="lo"
                fill="var(--bg-base)"
                stroke="none"
                name="Lower bound"
                connectNulls
                legendType="none"
              />

              {/* Historical */}
              <Line
                dataKey="val"
                stroke="var(--text-secondary)"
                strokeWidth={1.5}
                dot={false}
                name="Historical"
                connectNulls
              />

              {/* Forecast mean */}
              <Line
                dataKey="mean"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="6 3"
                name="Forecast"
                connectNulls
              />

              {/* Split line */}
              {splitT && (
                <ReferenceLine
                  x={splitT}
                  stroke="var(--border-strong)"
                  strokeDasharray="4 2"
                  label={{ value: "Now", fill: "var(--text-tertiary)", fontSize: 11 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Forecast table */}
          <div style={{ marginTop: 24 }}>
            <p className="section-title">Forecast Values</p>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr><th>Step</th><th>Forecast</th><th>Lower</th><th>Upper</th></tr>
                </thead>
                <tbody>
                  {result.forecast.map((f, i) => (
                    <tr key={i}>
                      <td className="td-mono">{f.t}</td>
                      <td style={{ fontWeight: 600, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{f.mean.toFixed(4)}</td>
                      <td className="td-mono">{f.lo.toFixed(4)}</td>
                      <td className="td-mono">{f.hi.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="empty-state">
          <TrendingUp size={40} />
          <p>Select a model and click Forecast to generate predictions.</p>
        </div>
      )}
    </div>
  );
}
