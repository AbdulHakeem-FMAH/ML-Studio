"""Datasets API router."""
from __future__ import annotations

import io
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Activity, Dataset
from app.schemas import DatasetColumnsOut, DatasetOut, DatasetQualityOut
from app.services import storage as store
from app.services.dataset_profile import detect_dataset_type, profile_dataframe, quality_report, read_dataframe

router  = APIRouter(prefix="/datasets", tags=["Datasets"])
_cfg    = get_settings()

_MAX_BYTES = _cfg.MAX_UPLOAD_SIZE_MB * 1024 * 1024


@router.get("", response_model=list[DatasetOut])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    return result.scalars().all()


@router.get("/{dataset_id}", response_model=DatasetOut)
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.post("", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    name:   str        = Form(...),
    owner:  str        = Form("admin"),
    file:   UploadFile = File(...),
    db:     AsyncSession = Depends(get_db),
):
    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {_cfg.MAX_UPLOAD_SIZE_MB} MB limit")

    # Detect format from filename
    fn  = (file.filename or "data.csv").lower()
    fmt = "parquet" if fn.endswith(".parquet") else "excel" if fn.endswith((".xlsx", ".xls")) else "csv"

    # Parse & compute schema
    try:
        df = read_dataframe(raw, fmt)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot parse file: {exc}")

    schema_def, quality = profile_dataframe(df)
    dtype = detect_dataset_type(df)

    # Upload raw bytes to MinIO
    ds_id      = str(uuid.uuid4())
    object_key = f"{ds_id}/{file.filename or 'data.csv'}"
    store.upload_file(_cfg.MINIO_BUCKET_DATASETS, raw, object_name=object_key, content_type=file.content_type or "text/csv")

    ds = Dataset(
        id          = ds_id,
        name        = name,
        dtype       = dtype,
        fmt         = fmt,
        source      = "file",
        owner       = owner,
        rows        = len(df),
        cols        = len(df.columns),
        quality     = quality,
        schema_def  = schema_def,
        storage_key = object_key,
    )
    db.add(ds)

    activity = Activity(event_type="success", message=f"Dataset '{name}' uploaded ({len(df):,} rows)")
    db.add(activity)

    await db.commit()
    await db.refresh(ds)
    logger.info(f"Dataset uploaded: {name} ({len(df):,} rows, key={object_key})")
    return ds


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.storage_key:
        store.delete_object(_cfg.MINIO_BUCKET_DATASETS, ds.storage_key)
    await db.delete(ds)
    logger.info(f"Dataset deleted: {dataset_id}")


@router.get("/{dataset_id}/preview")
async def preview_dataset(
    dataset_id: str,
    rows: int   = 50,
    db: AsyncSession = Depends(get_db),
):
    ds = await db.get(Dataset, dataset_id)
    if not ds or not ds.storage_key:
        raise HTTPException(status_code=404, detail="Dataset not found")

    raw = store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, ds.storage_key)
    df = read_dataframe(raw, ds.fmt)

    preview = df.head(rows).fillna("").astype(str)
    return {
        "columns": list(preview.columns),
        "rows":    preview.to_dict(orient="records"),
        "total_rows": len(df),
    }


@router.get("/{dataset_id}/columns", response_model=DatasetColumnsOut)
async def dataset_columns(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"dataset_id": ds.id, "dtype": ds.dtype, "columns": ds.schema_def or []}


@router.get("/{dataset_id}/quality", response_model=DatasetQualityOut)
async def dataset_quality(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds or not ds.storage_key:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = read_dataframe(store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, ds.storage_key), ds.fmt)
    return quality_report(df, ds.dtype)


@router.get("/{dataset_id}/download")
async def download_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds or not ds.storage_key:
        raise HTTPException(status_code=404, detail="Dataset not found")
    filename = ds.storage_key.rsplit("/", 1)[-1]
    media_type = {"csv": "text/csv", "parquet": "application/octet-stream", "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}.get(ds.fmt, "application/octet-stream")
    return StreamingResponse(
        io.BytesIO(store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, ds.storage_key)),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
