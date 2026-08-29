"""Time-series forecasting API."""
from __future__ import annotations

import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Dataset, Model
from app.schemas import ForecastRequest, ForecastResponse
from app.services import storage as store
from app.services.forecasting import forecast_from_df

router = APIRouter(prefix="/forecasting", tags=["Forecasting"])
_cfg   = get_settings()


@router.post("", response_model=ForecastResponse)
async def run_forecast(body: ForecastRequest, db: AsyncSession = Depends(get_db)):
    # Find a model with this name (prefers complete ones)
    result = await db.execute(
        select(Model)
        .where(Model.name == body.model_name)
        .order_by(Model.created_at.desc())
    )
    model = result.scalars().first()
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{body.model_name}' not found")

    # Find the associated dataset
    if not model.dataset_id:
        raise HTTPException(status_code=422, detail="Model is not linked to a dataset")

    ds = await db.get(Dataset, model.dataset_id)
    if not ds or not ds.storage_key:
        raise HTTPException(status_code=404, detail="Dataset not found or has no file")

    raw = store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, ds.storage_key)
    buf = io.BytesIO(raw)

    if ds.fmt == "parquet":
        df = pd.read_parquet(buf)
    elif ds.fmt == "excel":
        df = pd.read_excel(buf)
    else:
        df = pd.read_csv(buf)

    # Auto-detect date/value columns if not specified
    date_col  = body.date_col
    value_col = body.value_col or model.target_col

    if not date_col:
        for c in df.columns:
            if any(kw in c.lower() for kw in ("date", "time", "ts", "timestamp", "dt")):
                date_col = c
                break
    if not date_col:
        date_col = df.columns[0]

    if not value_col or value_col not in df.columns:
        num_cols  = df.select_dtypes(include="number").columns.tolist()
        value_col = num_cols[0] if num_cols else df.columns[-1]

    try:
        result_data = forecast_from_df(df, date_col, value_col, body.horizon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return ForecastResponse(
        model_name = body.model_name,
        history    = result_data["history"],
        forecast   = result_data["forecast"],
    )
