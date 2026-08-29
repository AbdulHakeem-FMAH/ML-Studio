"""Health and dashboard API."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.orm import Activity, Dataset, Deployment, DriftReport, Model, TrainingRun
from app.schemas import ActivityOut, DashboardStats, HealthResponse

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", response_model=HealthResponse)
async def health_check():
    from app.services.health import run_health_check
    result = run_health_check()
    return HealthResponse(**result)


@router.get("/stats", response_model=DashboardStats)
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    from datetime import datetime, timedelta, timezone
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    total_ds     = (await db.execute(select(func.count()).select_from(Dataset))).scalar() or 0
    complete_mdl = (await db.execute(select(func.count()).select_from(Model).where(Model.status == "Complete"))).scalar() or 0
    drift_alerts = (await db.execute(select(func.count()).select_from(DriftReport).where(DriftReport.detected == True))).scalar() or 0
    active_dep   = (await db.execute(select(func.count()).select_from(Deployment).where(Deployment.ready == True))).scalar() or 0
    recent_runs  = (await db.execute(
        select(func.count()).select_from(TrainingRun).where(TrainingRun.created_at >= week_ago)
    )).scalar() or 0

    return DashboardStats(
        total_datasets           = total_ds,
        complete_models          = complete_mdl,
        drift_alerts             = drift_alerts,
        active_deployments       = active_dep,
        training_runs_this_week  = recent_runs,
    )


@router.get("/activity", response_model=list[ActivityOut])
async def recent_activity(limit: int = 20, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Activity).order_by(Activity.created_at.desc()).limit(limit)
    )
    return result.scalars().all()
