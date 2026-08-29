"""EDA report generation — ydata-profiling with simple fallback."""
from __future__ import annotations

import io

import pandas as pd
from loguru import logger

from app.core.config import get_settings
from app.services import storage as store

_cfg = get_settings()


def generate_report(storage_key: str, fmt: str, dataset_name: str) -> str:
    """
    Generate an HTML EDA report, upload to MinIO, return the object key.
    Uses ydata-profiling; falls back to a hand-crafted pandas summary on error.
    """
    raw = store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, storage_key)
    buf = io.BytesIO(raw)

    if fmt == "parquet":
        df = pd.read_parquet(buf)
    elif fmt == "excel":
        df = pd.read_excel(buf)
    else:
        df = pd.read_csv(buf)

    logger.info(f"Generating EDA for '{dataset_name}' — {df.shape[0]} rows × {df.shape[1]} cols")

    try:
        from ydata_profiling import ProfileReport

        profile = ProfileReport(
            df,
            title=f"EDA — {dataset_name}",
            explorative=True,
            minimal=False,
            correlations={"auto": {"calculate": True}},
            progress_bar=False,
        )
        html = profile.to_html()
        logger.info(f"ydata-profiling report generated for '{dataset_name}'")
    except Exception as exc:
        logger.warning(f"ydata-profiling failed ({exc}), generating simple report")
        html = _simple_report(df, dataset_name)

    obj_key = f"{dataset_name}_eda.html"
    store.upload_file(
        _cfg.MINIO_BUCKET_EDA,
        html.encode("utf-8"),
        object_name=obj_key,
        content_type="text/html",
    )
    logger.info(f"EDA report uploaded → eda/{obj_key}")
    return obj_key


def _simple_report(df: pd.DataFrame, name: str) -> str:
    """Minimal standalone HTML summary when ydata-profiling is unavailable."""
    desc    = df.describe(include="all").to_html(classes="tbl", border=0)
    missing = df.isnull().mean().mul(100).round(2).to_frame("Missing %").to_html(classes="tbl", border=0)
    dtypes  = df.dtypes.rename("dtype").to_frame().to_html(classes="tbl", border=0)

    col_details = ""
    for col in df.columns[:50]:
        uniq   = df[col].nunique()
        null_p = round(df[col].isnull().mean() * 100, 1)
        dtype  = str(df[col].dtype)
        sample = ", ".join(str(v) for v in df[col].dropna().unique()[:5])
        col_details += (
            f"<tr><td>{col}</td><td>{dtype}</td>"
            f"<td>{null_p}%</td><td>{uniq}</td><td style='color:#888'>{sample}</td></tr>"
        )

    return f"""<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<title>EDA — {name}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d14;color:#c8c8d4;padding:32px}}
  h1{{font-size:22px;color:#e8e8f8;margin-bottom:4px}}
  h2{{font-size:14px;color:#7c7c9c;font-weight:500;margin:28px 0 10px}}
  .chip{{display:inline-block;background:#1a1a28;border:1px solid #2a2a3a;
          border-radius:6px;padding:4px 12px;font-size:12px;margin:0 6px 6px 0}}
  .tbl{{width:100%;border-collapse:collapse;font-size:12px;max-width:1100px}}
  .tbl th{{background:#1a1a28;color:#888;padding:8px 12px;text-align:left;
             border:1px solid #2a2a3a;font-weight:500;font-size:11px;letter-spacing:.04em;text-transform:uppercase}}
  .tbl td{{border:1px solid #22223a;padding:7px 12px;vertical-align:top}}
  .tbl tr:hover td{{background:#1a1a28}}
  .section{{margin-bottom:32px}}
</style></head><body>
<h1>EDA Report — {name}</h1>
<div style="margin:12px 0">
  <span class="chip">📊 {df.shape[0]:,} rows</span>
  <span class="chip">🗂 {df.shape[1]} columns</span>
  <span class="chip">🔴 {df.isnull().any(axis=1).sum():,} rows with nulls</span>
  <span class="chip">🔁 {df.duplicated().sum():,} duplicate rows</span>
</div>

<div class="section">
<h2>Column Overview</h2>
<table class="tbl">
<tr><th>Column</th><th>Dtype</th><th>Missing</th><th>Unique</th><th>Sample values</th></tr>
{col_details}
</table>
</div>

<div class="section">
<h2>Descriptive Statistics</h2>
{desc}
</div>

<div class="section">
<h2>Missing Values</h2>
{missing}
</div>

<div class="section">
<h2>Data Types</h2>
{dtypes}
</div>
</body></html>"""
