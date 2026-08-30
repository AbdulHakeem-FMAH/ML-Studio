"""Training API router — kicks off Celery tasks, streams logs via SSE."""
from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal, get_db
from app.models.orm import Activity, Dataset, Model, TrainingRun
from app.schemas import TrainingConfig, TrainingRunOut
from app.services.worker import train_task

router = APIRouter(prefix="/training", tags=["Training"])


@router.post("/start", response_model=TrainingRunOut, status_code=202)
async def start_training(body: TrainingConfig, db: AsyncSession = Depends(get_db)):
    # Resolve dataset
    result = await db.execute(
        select(Dataset).where(Dataset.name == body.dataset_name).order_by(Dataset.created_at.desc())
    )
    ds = result.scalars().first()
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset '{body.dataset_name}' not found")
    if not ds.storage_key:
        raise HTTPException(status_code=422, detail="Dataset has no stored file")
    available_columns = {str(column.get("col")) for column in (ds.schema_def or [])}
    if body.target_col not in available_columns:
        raise HTTPException(
            status_code=422,
            detail=f"Target column '{body.target_col}' is not in the selected dataset",
        )
    if len(available_columns) < 2:
        raise HTTPException(status_code=422, detail="Training requires a target and at least one feature column")

    # Bump version if a previous model with same name exists
    result2 = await db.execute(
        select(Model).where(Model.name == body.model_name).order_by(Model.created_at.desc())
    )
    prev = result2.scalars().first()
    if prev:
        parts = prev.version.split(".")
        try:
            if body.version_bump == "major":
                version = f"{int(parts[0]) + 1}.0.0"
            elif body.version_bump == "minor":
                version = f"{parts[0]}.{int(parts[1]) + 1}.0"
            else:
                version = f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
        except (IndexError, ValueError):
            version = "1.0.0"
    else:
        version = "1.0.0"

    model_id = str(uuid.uuid4())
    run_id   = str(uuid.uuid4())

    effective_task = "timeseries" if ds.dtype == "timeseries" or body.task == "timeseries" else body.task

    model = Model(
        id         = model_id,
        name       = body.model_name,
        version    = version,
        task       = effective_task,
        status     = "Pending",
        target_col = body.target_col,
        config     = body.model_dump(),
        dataset_id = ds.id,
    )
    db.add(model)

    run = TrainingRun(
        id       = run_id,
        model_id = model_id,
        status   = "queued",
        progress = 0,
        logs     = [],
    )
    db.add(run)

    activity = Activity(
        event_type="info",
        message=f"Training started for model '{body.model_name}' on dataset '{body.dataset_name}'"
    )
    db.add(activity)
    await db.commit()
    await db.refresh(run)

    # Dispatch Celery task
    train_task.apply_async(
        kwargs=dict(
            model_id    = model_id,
            run_id      = run_id,
            storage_key = ds.storage_key,
            fmt         = ds.fmt,
            target_col  = body.target_col,
            task        = effective_task,
            preset      = body.preset,
            time_limit  = body.time_limit,
            config      = body.model_dump(),
        ),
        task_id=run_id,
    )
    logger.info(f"Training queued: model_id={model_id} run_id={run_id}")
    return run


@router.get("/runs/{run_id}", response_model=TrainingRunOut)
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/runs/{run_id}/logs/stream")
async def stream_logs(run_id: str, request: Request):
    """Server-Sent Events endpoint for live training log streaming."""

    async def _event_generator():
        sent_count = 0
        while True:
            if await request.is_disconnected():
                break
            # A streaming response lives far longer than a normal request.  Use a
            # fresh session for every poll so the SQLAlchemy identity map cannot
            # serve a stale TrainingRun/logs value.
            async with AsyncSessionLocal() as poll_db:
                run = await poll_db.get(TrainingRun, run_id)
                if run:
                    logs = list(run.logs or [])
                    run_status = run.status
            if not run:
                yield "event: error\ndata: Run not found\n\n"
                break
            # Send only new entries since last poll
            new_entries = logs[sent_count:]
            for entry in new_entries:
                payload = json.dumps(entry)
                yield f"data: {payload}\n\n"
            sent_count = len(logs)

            if run_status in ("done", "failed"):
                yield f"event: done\ndata: {run_status}\n\n"
                break

            await asyncio.sleep(1.5)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/model/{model_id}/runs", response_model=list[TrainingRunOut])
async def list_model_runs(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingRun)
        .where(TrainingRun.model_id == model_id)
        .order_by(TrainingRun.created_at.desc())
    )
    return result.scalars().all()
