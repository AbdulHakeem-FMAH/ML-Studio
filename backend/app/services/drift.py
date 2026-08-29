"""Drift detection service — Evidently 0.7.x API with KS-test fallback."""
from __future__ import annotations

import io

import numpy as np
import pandas as pd
from loguru import logger

from app.core.config import get_settings
from app.services import storage as store

_cfg = get_settings()


def _load_df(storage_key: str, fmt: str) -> pd.DataFrame:
    raw = store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, storage_key)
    buf = io.BytesIO(raw)
    if fmt == "parquet":
        return pd.read_parquet(buf)
    if fmt == "excel":
        return pd.read_excel(buf)
    return pd.read_csv(buf)


def run_drift_check(
    ref_storage_key: str,
    curr_storage_key: str,
    ref_fmt: str,
    curr_fmt: str,
    model_id: str,
    drift_type: str = "data",
) -> dict:
    """
    Compare reference vs current dataset using Evidently 0.7.x.
    Returns score, detected, retrain, features list, and HTML report key.
    """
    ref  = _load_df(ref_storage_key, ref_fmt)
    curr = _load_df(curr_storage_key, curr_fmt)

    # Cap at 5 000 rows for speed
    n    = min(len(ref), len(curr), 5_000)
    ref  = ref.sample(n, random_state=42).reset_index(drop=True)
    curr = curr.sample(n, random_state=42).reset_index(drop=True)

    # Keep only numeric columns shared by both DataFrames
    num_cols = list(
        set(ref.select_dtypes(include="number").columns)
        & set(curr.select_dtypes(include="number").columns)
    )
    ref  = ref[num_cols]
    curr = curr[num_cols]

    try:
        html, feature_scores, overall_score = _evidently_report(ref, curr, model_id)
        logger.info(f"Evidently drift check complete: overall={overall_score:.4f}")
    except Exception as exc:
        logger.warning(f"Evidently failed ({exc}), falling back to KS-test")
        html, feature_scores, overall_score = _fallback_ks(ref, curr, model_id)

    detected = overall_score > 0.30
    retrain  = overall_score > 0.40

    html_key = f"drift_{model_id}_{drift_type}.html"
    store.upload_file(
        _cfg.MINIO_BUCKET_DRIFT,
        html.encode("utf-8"),
        object_name=html_key,
        content_type="text/html",
    )

    return {
        "score":      round(overall_score, 4),
        "detected":   detected,
        "retrain":    retrain,
        "features":   feature_scores,
        "report_key": html_key,
    }


def _evidently_report(ref: pd.DataFrame, curr: pd.DataFrame, model_id: str):
    """Use Evidently 0.7.x Report API."""
    from evidently.presets import DataDriftPreset
    from evidently import Report

    if ref.empty or curr.empty:
        raise ValueError("No comparable numeric columns were found for drift detection")

    # Evidently 0.7 uses DataFrame inputs directly; column_mapping was removed.
    report = Report(metrics=[DataDriftPreset()])
    snapshot = report.run(reference_data=ref, current_data=curr)

    # In Evidently 0.7 Report.run returns a Snapshot. Rendering and metric
    # results live on that snapshot, not on Report as they did in 0.4.x.
    html = snapshot.get_html_str(as_iframe=False)

    # Extract results from the Snapshot's portable representation.
    result_dict   = snapshot.dict()
    metrics_list  = result_dict.get("metrics", [])

    feature_scores: list[dict] = []
    overall_score              = 0.0

    for m in metrics_list:
        metric_name = str(m.get("metric_name", ""))
        result = m.get("result", m.get("value", {}))

        # DataDriftPreset emits a DriftedColumnsCount metric in 0.7.
        if metric_name.startswith("DriftedColumnsCount") and isinstance(result, dict):
            overall_score = float(result.get("share", 0.0))

        # The preset then emits one ValueDrift metric per feature. Its value is
        # a p-value for the chosen statistical test; retain an intuitive
        # 0..1 score (1 - p-value) and expose the detection threshold result.
        if metric_name.startswith("ValueDrift"):
            info = m.get("config", {})
            col = str(info.get("column", "unknown"))
            p_value = float(result) if result is not None else 1.0
            feature_scores.append({
                "feat":     col,
                "score":    round(max(0.0, min(1.0, 1.0 - p_value)), 4),
                "dist":     str(info.get("method", "Statistical test")),
                "detected": p_value < float(info.get("threshold", 0.05)),
            })

    return html, feature_scores, overall_score


def _fallback_ks(ref: pd.DataFrame, curr: pd.DataFrame, model_id: str):
    """Pure-scipy KS-test fallback when Evidently is unavailable."""
    from scipy import stats

    feature_scores: list[dict] = []
    scores: list[float]        = []

    for col in ref.columns[:30]:
        try:
            stat, _ = stats.ks_2samp(ref[col].dropna(), curr[col].dropna())
            detected = stat > 0.30
            scores.append(stat)
            feature_scores.append({
                "feat":     col,
                "score":    round(float(stat), 4),
                "dist":     "KS",
                "detected": detected,
            })
        except Exception:
            pass

    overall = float(np.mean(scores)) if scores else 0.0

    rows = "".join(
        f"<tr><td>{f['feat']}</td><td>{f['score']}</td>"
        f"<td>{'Yes' if f['detected'] else 'No'}</td></tr>"
        for f in feature_scores
    )
    html = f"""<!DOCTYPE html><html><head>
<style>
  body{{font-family:system-ui;padding:24px;background:#0e0e14;color:#c8c8d4}}
  h1{{font-size:18px;color:#e2e2ea}}
  table{{border-collapse:collapse;font-size:13px;width:100%;max-width:700px}}
  td,th{{border:1px solid #2a2a3a;padding:8px 14px}}
  th{{background:#1a1a24;color:#888;text-align:left}}
</style></head><body>
<h1>Drift Report — {model_id}</h1>
<p>Overall drift score: <strong style="color:{'#ff5c5c' if overall>0.3 else '#4ade80'}">{overall:.4f}</strong>
   {'— Drift detected' if overall>0.3 else '— No significant drift'}</p>
<table><tr><th>Feature</th><th>KS score</th><th>Drifted?</th></tr>{rows}</table>
</body></html>"""

    return html, feature_scores, overall
