"""Predictions API — single inference and batch CSV scoring."""
from __future__ import annotations

import io
import time

import pandas as pd

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.orm import Dataset, Model
from app.schemas import BatchResponse, PredictSingleRequest, PredictSingleResponse

router = APIRouter(prefix="/predictions", tags=["Predictions"])


async def _resolve_model(model_name: str, db: AsyncSession) -> Model:
    result = await db.execute(
        select(Model)
        .where(Model.name == model_name, Model.status == "Complete")
        .order_by(Model.created_at.desc())
    )
    m = result.scalars().first()
    if not m:
        raise HTTPException(status_code=404, detail=f"No complete model named '{model_name}'")
    if not m.storage_key:
        raise HTTPException(status_code=422, detail="Model has no stored artifact")
    return m


def _coerce_features(features: dict, schema: list[dict]) -> dict:
    expected = {str(item.get("col")): item for item in schema}
    unknown = sorted(set(features) - set(expected))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown feature fields: {', '.join(unknown)}")
    missing = [name for name, item in expected.items() if item.get("null_pct", 0) == 0 and features.get(name) in (None, "")]
    if missing:
        raise HTTPException(status_code=422, detail=f"Required feature fields are missing: {', '.join(missing)}")
    cleaned: dict = {}
    for name, item in expected.items():
        value = features.get(name)
        if value in (None, ""):
            cleaned[name] = None
            continue
        semantic = item.get("semantic_type")
        dtype = str(item.get("dtype", ""))
        try:
            if semantic == "number":
                number = float(value)
                if not pd.notna(number):
                    raise ValueError
                cleaned[name] = int(number) if dtype.startswith(("int", "uint")) else number
            elif semantic == "boolean":
                if isinstance(value, str):
                    if value.lower() not in ("true", "false", "1", "0", "yes", "no"):
                        raise ValueError
                    cleaned[name] = value.lower() in ("true", "1", "yes")
                else:
                    cleaned[name] = bool(value)
            else:
                cleaned[name] = str(value)
        except (TypeError, ValueError):
            label = "a numeric" if semantic == "number" else "a valid boolean"
            raise HTTPException(status_code=422, detail=f"'{name}' must be {label} value") from None
    return cleaned


@router.post("/predict", response_model=PredictSingleResponse)
async def predict_single(body: PredictSingleRequest, db: AsyncSession = Depends(get_db)):
    from app.services.training import predict_single as _infer
    m      = await _resolve_model(body.model_name, db)
    if m.task == "timeseries":
        raise HTTPException(status_code=422, detail="Use the Forecasting page for time-series models")
    dataset = await db.get(Dataset, m.dataset_id) if m.dataset_id else None
    if not dataset:
        raise HTTPException(status_code=422, detail="The training schema for this model is unavailable")
    schema = [c for c in (dataset.schema_def or []) if c.get("col") != m.target_col]
    result = _infer(m.storage_key, m.task, _coerce_features(body.features, schema))
    return PredictSingleResponse(
        prediction    = result["prediction"],
        class_label   = result.get("class_label"),
        class_idx     = result.get("class_idx"),
        probabilities = result.get("probabilities"),
        latency_ms    = result["latency_ms"],
        model_name    = m.name,
        model_version = m.version,
    )


@router.post("/batch", response_model=BatchResponse)
async def predict_batch(
    model_name: str        = Form(...),
    file:       UploadFile = File(...),
    db:         AsyncSession = Depends(get_db),
):
    from app.services.training import predict_batch as _batch
    m    = await _resolve_model(model_name, db)
    t0   = time.perf_counter()
    raw  = await file.read()
    if m.task == "timeseries":
        raise HTTPException(status_code=422, detail="Use the Forecasting page for time-series models")
    dataset = await db.get(Dataset, m.dataset_id) if m.dataset_id else None
    expected = {c.get("col") for c in (dataset.schema_def or []) if c.get("col") != m.target_col} if dataset else set()
    supplied = set(pd.read_csv(io.BytesIO(raw), nrows=1).columns)
    missing = sorted(expected - supplied)
    if missing:
        raise HTTPException(status_code=422, detail=f"Batch file is missing required columns: {', '.join(missing)}")
    rows = _batch(m.storage_key, m.task, raw)
    ms   = round((time.perf_counter() - t0) * 1000, 2)
    logger.info(f"Batch prediction: {len(rows)} rows, {ms}ms")
    return BatchResponse(
        model_name     = m.name,
        rows_scored    = len(rows),
        processing_ms  = ms,
        results        = rows,
    )
