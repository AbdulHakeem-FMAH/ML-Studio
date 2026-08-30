import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { TrendingUp, RefreshCw, BrainCircuit, Target, Calendar, AlertCircle } from "lucide-react";
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
          {p.name}: <strong>{p.value != null ? Number(p.value).toFixed(4) : "—"}</strong>
        </p>
      ))}
    </div>
  );
};

export default function Forecasting() {
  const [searchParams] = useSearchParams();
  const [modelList, setModelList] = useState([]);
  const [modelName, setModelName] = useState("");
  const [horizon, setHorizon]     = useState(14);
  const [result, setResult]       = useState(null);
  const [loading, setLoad]        = useState(false);
  const [err, setErr]             = useState("");

  useEffect(() => {
    modelsApi.list().then((ms) => {
      // Prioritize time-series models
      const sorted = [...ms].sort((a, b) => (a.task === "timeseries" ? -1 : 1));
      setModelList(sorted);
      const queryModel = searchParams.get("model");
      if (queryModel && sorted.some((m) => m.name === queryModel)) {
        setModelName(queryModel);
      } else if (sorted.length > 0) {
        const firstTs = sorted.find((m) => m.task === "timeseries");
        if (firstTs) setModelName(firstTs.name);
      }
    }).catch(() => {});
  }, [searchParams]);

  const selectedModel = modelList.find((m) => m.name === modelName);

  const run = async () => {
    if (!modelName) { setErr("Please select a time-series model."); return; }
    setErr(""); setLoad(true); setResult(null);
    try {
      const res = await forecasting.run({
        model_name: modelName,
        horizon: Number(horizon) || 14,
      });
      setResult(res);
    } catch (e) {
      setErr(e.message || "Failed to generate forecast.");
    } finally {
      setLoad(false);
    }
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
        <p className="page-sub">Time-series forecasting with auto-configured targets, date projection, and confidence intervals</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1.5fr) 160px auto", gap: 16, alignItems: "flex-end" }}>
          <div className="field">
            <label className="label">Model to Forecast</label>
            <select className="input select" value={modelName} onChange={e => { setModelName(e.target.value); setResult(null); setErr(""); }}>
              <option value="">— select a model —</option>
              {modelList.map(m => (
                <option key={m.id} value={m.name}>
                  {m.name} {m.task === "timeseries" ? "(Time-Series)" : `(${m.task})`} · Target: {m.target_col || "auto"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Forecast Horizon (steps)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={horizon}
              onChange={e => setHorizon(Math.max(1, Math.min(365, Number(e.target.value))))}
            />
          </div>
          <button className="btn btn-primary" onClick={run} disabled={loading || !modelName} style={{ height: 40 }}>
            {loading ? <><RefreshCw size={14} className="spin" /> Generating forecast…</> : <><TrendingUp size={14} /> Forecast</>}
          </button>
        </div>

        {/* Selected model details banner */}
        {selectedModel && (
          <div style={{
            marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)",
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, fontSize: 12, color: "var(--text-secondary)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Target size={14} color="var(--accent)" />
              <span>Target to forecast:</span>
              <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                {selectedModel.target_col || "Auto-detected"}
              </strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BrainCircuit size={14} color="var(--accent)" />
              <span>Algorithm:</span>
              <span style={{ color: "var(--text-primary)" }}>{selectedModel.algo || "AutoML TS"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={14} color="var(--accent)" />
              <span>Task:</span>
              <span className="badge badge-accent" style={{ textTransform: "capitalize" }}>{selectedModel.task}</span>
            </div>
          </div>
        )}

        {err && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--error)", fontSize: 12 }}>
            <AlertCircle size={14} />
            <span>{err}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="card">
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Forecast — {result.model_name}</h2>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                Target forecasted: <strong style={{ color: "var(--accent)" }}>{result.target_col || selectedModel?.target_col || "Target"}</strong>
              </p>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-tertiary)" }}>
              <span>{result.history.length} historical points</span>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{result.forecast.length} forecast steps</span>
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
                fill="rgba(99,102,241,0.12)"
                stroke="none"
                name="Upper bound (90% CI)"
                connectNulls
                legendType="none"
              />
              <Area
                dataKey="lo"
                fill="var(--bg-base)"
                stroke="none"
                name="Lower bound (90% CI)"
                connectNulls
                legendType="none"
              />

              {/* Historical */}
              <Line
                dataKey="val"
                stroke="var(--text-secondary)"
                strokeWidth={1.75}
                dot={{ r: 3, fill: "var(--text-secondary)" }}
                name="Historical"
                connectNulls
              />

              {/* Forecast mean */}
              <Line
                dataKey="mean"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--accent)" }}
                strokeDasharray="6 3"
                name="Forecast Mean"
                connectNulls
              />

              {/* Split line */}
              {splitT && (
                <ReferenceLine
                  x={splitT}
                  stroke="var(--accent)"
                  strokeDasharray="4 2"
                  label={{ value: "Forecast Start", fill: "var(--text-secondary)", fontSize: 11 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Forecast table */}
          <div style={{ marginTop: 28 }}>
            <p className="section-title">Forecast Values & Confidence Bounds</p>
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Date / Step</th>
                    <th>Forecast ({result.target_col || selectedModel?.target_col || "Value"})</th>
                    <th>Lower Bound (90%)</th>
                    <th>Upper Bound (90%)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.forecast.map((f, i) => (
                    <tr key={i}>
                      <td className="td-mono">{f.t}</td>
                      <td style={{ fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                        {Number(f.mean).toFixed(4)}
                      </td>
                      <td className="td-mono">{Number(f.lo).toFixed(4)}</td>
                      <td className="td-mono">{Number(f.hi).toFixed(4)}</td>
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
          <p>Select a time-series model and click Forecast to generate future predictions.</p>
        </div>
      )}
    </div>
  );
}
