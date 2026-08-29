"""EDA API — generate report and proxy HTML through FastAPI to avoid CORS."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Dataset
from app.schemas import EDAResponse
from app.services import storage as store

router = APIRouter(prefix="/eda", tags=["EDA"])
_cfg   = get_settings()


def _generate(storage_key: str, fmt: str, dataset_name: str) -> None:
    """Background task — runs synchronously in the thread pool."""
    from app.services.eda import generate_report
    generate_report(storage_key, fmt, dataset_name)


@router.post("/generate", response_model=EDAResponse)
async def generate_eda(
    dataset_name: str,
    background:   BackgroundTasks,
    db:           AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Dataset).where(Dataset.name == dataset_name).order_by(Dataset.created_at.desc())
    )
    ds = result.scalars().first()
    if not ds or not ds.storage_key:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")

    report_key = f"{dataset_name}_eda.html"
    report_url = f"/api/v1/eda/report/{dataset_name}"

    # If report doesn't exist in MinIO yet, generate now (sync in background)
    if not store.object_exists(_cfg.MINIO_BUCKET_EDA, report_key):
        background.add_task(_generate, ds.storage_key, ds.fmt, dataset_name)
        logger.info(f"EDA generation queued for '{dataset_name}'")
    else:
        logger.info(f"EDA report already exists for '{dataset_name}'")

    return EDAResponse(
        dataset_name=dataset_name,
        report_key=report_key,
        report_url=report_url,
    )


@router.get("/report/{dataset_name}", response_class=HTMLResponse)
async def proxy_eda_report(dataset_name: str, db: AsyncSession = Depends(get_db)):
    """
    Proxy the EDA HTML from MinIO through FastAPI.
    This eliminates all CORS and mixed-content issues — the frontend just
    loads this endpoint in an <iframe> from the same origin as the API.
    """
    report_key = f"{dataset_name}_eda.html"

    if not store.object_exists(_cfg.MINIO_BUCKET_EDA, report_key):
        # Try to generate on-demand
        result = await db.execute(
            select(Dataset).where(Dataset.name == dataset_name).order_by(Dataset.created_at.desc())
        )
        ds = result.scalars().first()
        if not ds or not ds.storage_key:
            raise HTTPException(status_code=404, detail="Dataset not found")
        from app.services.eda import generate_report
        report_key = generate_report(ds.storage_key, ds.fmt, dataset_name)

    html_bytes = store.download_bytes(_cfg.MINIO_BUCKET_EDA, report_key)
    return HTMLResponse(content=html_bytes.decode("utf-8", errors="replace"))


@router.get("/status/{dataset_name}")
async def eda_status(dataset_name: str):
    """Check whether an EDA report is ready without triggering generation."""
    key  = f"{dataset_name}_eda.html"
    ready = store.object_exists(_cfg.MINIO_BUCKET_EDA, key)
    return {"dataset_name": dataset_name, "ready": ready, "report_url": f"/api/v1/eda/report/{dataset_name}"}
