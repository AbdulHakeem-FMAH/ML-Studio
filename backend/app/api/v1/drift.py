"""Drift detection API."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Activity, Dataset, DriftReport, Model
from app.schemas import DriftReportOut
from app.services import storage as store

router = APIRouter(prefix="/drift", tags=["Drift"])
_cfg   = get_settings()


@router.get("", response_model=list[DriftReportOut])
async def list_drift_reports(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DriftReport).order_by(DriftReport.created_at.desc()).limit(100)
    )
    return result.scalars().all()


@router.get("/{model_id}", response_model=list[DriftReportOut])
async def get_model_drift(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DriftReport)
        .where(DriftReport.model_id == model_id)
        .order_by(DriftReport.created_at.desc())
    )
    return result.scalars().all()


@router.post("/check", response_model=DriftReportOut, status_code=201)
async def check_drift(
    model_id:        str,
    ref_dataset_name: str,
    curr_dataset_name: str,
    drift_type:      str = "data",
    db:              AsyncSession = Depends(get_db),
):
    model = await db.get(Model, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    async def _get_ds(name: str) -> Dataset:
        res = await db.execute(
            select(Dataset).where(Dataset.name == name).order_by(Dataset.created_at.desc())
        )
        ds = res.scalars().first()
        if not ds or not ds.storage_key:
            raise HTTPException(status_code=404, detail=f"Dataset '{name}' not found or has no file")
        return ds

    ref_ds  = await _get_ds(ref_dataset_name)
    curr_ds = await _get_ds(curr_dataset_name)

    from app.services.drift import run_drift_check
    result = run_drift_check(
        ref_storage_key  = ref_ds.storage_key,
        curr_storage_key = curr_ds.storage_key,
        ref_fmt          = ref_ds.fmt,
        curr_fmt         = curr_ds.fmt,
        model_id         = model_id,
        drift_type       = drift_type,
    )

    report = DriftReport(
        model_id   = model_id,
        dataset_id = curr_ds.id,
        drift_type = drift_type,
        detected   = result["detected"],
        score      = result["score"],
        retrain    = result["retrain"],
        features   = result["features"],
        report_key = result["report_key"],
    )
    db.add(report)

    status_word = "detected" if result["detected"] else "not detected"
    activity = Activity(
        event_type = "warning" if result["detected"] else "success",
        message    = f"Drift {status_word} for model '{model.name}' (score={result['score']:.4f})"
    )
    db.add(activity)
    await db.commit()
    await db.refresh(report)
    logger.info(f"Drift check done: model={model_id} score={result['score']:.4f} detected={result['detected']}")
    return report


@router.get("/report/{report_id}/html", response_class=HTMLResponse)
async def proxy_drift_report(report_id: str, db: AsyncSession = Depends(get_db)):
    """Proxy drift HTML report through FastAPI — same CORS fix as EDA."""
    report = await db.get(DriftReport, report_id)
    if not report or not report.report_key:
        raise HTTPException(status_code=404, detail="Drift report not found")
    html_bytes = store.download_bytes(_cfg.MINIO_BUCKET_DRIFT, report.report_key)
    return HTMLResponse(content=html_bytes.decode("utf-8", errors="replace"))
