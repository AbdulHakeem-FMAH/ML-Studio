"""Models API router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.orm import Dataset, Model
from app.schemas import ModelFeatureSchemaOut, ModelOut
from app.services import storage as store
from app.core.config import get_settings

router = APIRouter(prefix="/models", tags=["Models"])
_cfg   = get_settings()


@router.get("", response_model=list[ModelOut])
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Model).order_by(Model.created_at.desc()))
    return result.scalars().all()


@router.get("/{model_id}/schema", response_model=ModelFeatureSchemaOut)
async def get_model_schema(model_id: str, db: AsyncSession = Depends(get_db)):
    """Expose the input contract captured from the model's training dataset."""
    model = await db.get(Model, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    dataset = await db.get(Dataset, model.dataset_id) if model.dataset_id else None
    if not dataset:
        raise HTTPException(status_code=404, detail="The training dataset for this model is unavailable")
    features = []
    for column in dataset.schema_def or []:
        if column.get("col") == model.target_col:
            continue
        features.append({
            **column,
            "name": column.get("col"),
            "required": float(column.get("null_pct", 0) or 0) == 0,
        })
    return {
        "model_id": model.id,
        "model_name": model.name,
        "task": model.task,
        "target_column": model.target_col,
        "features": features,
    }


@router.get("/{model_id}", response_model=ModelOut)
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    m = await db.get(Model, model_id)
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    return m


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, db: AsyncSession = Depends(get_db)):
    m = await db.get(Model, model_id)
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    if m.storage_key:
        store.delete_object(_cfg.MINIO_BUCKET_MODELS, m.storage_key)
    await db.delete(m)


@router.get("/{model_id}/download-artifact")
async def download_artifact(model_id: str, db: AsyncSession = Depends(get_db)):
    m = await db.get(Model, model_id)
    if not m or not m.storage_key:
        raise HTTPException(status_code=404, detail="Model artifact not found")
    url = store.presigned_url(_cfg.MINIO_BUCKET_MODELS, m.storage_key, expires_seconds=600)
    return {"url": url, "storage_key": m.storage_key}
