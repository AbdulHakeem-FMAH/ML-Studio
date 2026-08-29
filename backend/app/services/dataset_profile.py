"""Dataset parsing, profiling, and lightweight type inference helpers."""
from __future__ import annotations

import io
from typing import Any

import numpy as np
import pandas as pd


def read_dataframe(raw: bytes, fmt: str) -> pd.DataFrame:
    """Read one of the supported upload/storage formats into a DataFrame."""
    buffer = io.BytesIO(raw)
    if fmt == "parquet":
        return pd.read_parquet(buffer)
    if fmt == "excel":
        return pd.read_excel(buffer)
    return pd.read_csv(buffer)


def detect_dataset_type(df: pd.DataFrame) -> str:
    """Infer a useful product-level dataset type without trusting user input."""
    if df.empty or not len(df.columns):
        return "tabular"

    string_cols = df.select_dtypes(include=["object", "string"]).columns.tolist()
    text_like = 0
    datetime_like = 0
    for col in string_cols:
        values = df[col].dropna().astype(str)
        if values.empty:
            continue
        parsed = pd.to_datetime(values, errors="coerce", utc=False, format="mixed")
        if parsed.notna().mean() >= 0.9:
            datetime_like += 1
            continue
        if values.str.len().median() >= 40 and values.nunique() / max(len(values), 1) >= 0.25:
            text_like += 1

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    # A date alone is not enough: wide event/transaction data such as HousePrice
    # remains tabular. A compact date/value shape or repeating entity series is a
    # stronger indication of forecasting data.
    has_native_datetime = len(df.select_dtypes(include=["datetime", "datetimetz"]).columns) > 0
    if (datetime_like or has_native_datetime) and numeric_cols and len(numeric_cols) <= 4:
        return "timeseries"
    if text_like and text_like >= max(1, len(string_cols)) and not numeric_cols:
        return "text"
    return "tabular"


def _json_value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    return value


def column_profile(series: pd.Series) -> dict[str, Any]:
    non_null = series.dropna()
    dtype = str(series.dtype)
    cardinality = int(non_null.nunique())
    null_pct = round(float(series.isna().mean() * 100), 1)

    if pd.api.types.is_bool_dtype(series):
        kind = "boolean"
    elif pd.api.types.is_numeric_dtype(series):
        kind = "number"
    elif pd.api.types.is_datetime64_any_dtype(series):
        kind = "datetime"
    else:
        strings = non_null.astype(str) if not non_null.empty else non_null
        kind = "text" if not strings.empty and strings.str.len().median() >= 40 else "category"

    sample_values = [_json_value(v) for v in non_null.head(3).tolist()]
    result: dict[str, Any] = {
        "col": str(series.name),
        "dtype": dtype,
        "semantic_type": kind,
        "null_pct": null_pct,
        "cardinality": cardinality,
        "example": sample_values[0] if sample_values else None,
        "sample_values": sample_values,
    }
    if kind == "category" and 0 < cardinality <= 20:
        result["options"] = [_json_value(v) for v in non_null.drop_duplicates().head(20).tolist()]
    if kind == "number" and not non_null.empty:
        result["stats"] = {
            "min": _json_value(non_null.min()),
            "max": _json_value(non_null.max()),
            "mean": round(float(non_null.mean()), 4),
            "median": round(float(non_null.median()), 4),
        }
    return result


def profile_dataframe(df: pd.DataFrame) -> tuple[list[dict[str, Any]], float]:
    schema = [column_profile(df[col]) for col in df.columns]
    quality = round(float((1 - df.isnull().mean().mean()) * 100), 1) if len(df.columns) else 0.0
    return schema, quality


def quality_report(df: pd.DataFrame, dataset_type: str) -> dict[str, Any]:
    schema, score = profile_dataframe(df)
    missing_cells = int(df.isna().sum().sum())
    total_cells = int(df.shape[0] * df.shape[1])
    type_counts: dict[str, int] = {}
    for column in schema:
        kind = column["semantic_type"]
        type_counts[kind] = type_counts.get(kind, 0) + 1
    return {
        "quality_score": score,
        "dataset_type": dataset_type,
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "missing_cells": missing_cells,
        "total_cells": total_cells,
        "duplicate_rows": int(df.duplicated().sum()),
        "type_breakdown": type_counts,
        "columns_detail": schema,
    }
