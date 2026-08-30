"""Drift detection and retraining API."""
from __future__ import annotations

import io
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse
from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Activity, Dataset, DriftReport, Model, TrainingRun
from app.schemas import DriftReportOut, DriftRetrainRequest, DriftRetrainResponse
from app.services import storage as store
from app.services.dataset_profile import detect_dataset_type, profile_dataframe, read_dataframe
from app.services.worker import train_task

router = APIRouter(prefix="/drift", tags=["Drift"])
_cfg   = get_settings()


async def _enrich_report(report: DriftReport, db: AsyncSession) -> DriftReportOut:
    """Populate model_name, model_version, ref_dataset_name, curr_dataset_name, and retrained status."""
    model = await db.get(Model, report.model_id)
    curr_ds = await db.get(Dataset, report.dataset_id) if report.dataset_id else None
    ref_ds = await db.get(Dataset, model.dataset_id) if (model and model.dataset_id) else None

    return DriftReportOut(
        id               = report.id,
        model_id         = report.model_id,
        model_name       = model.name if model else "Unknown",
        model_version    = model.version if model else "1.0.0",
        ref_dataset_name = ref_ds.name if ref_ds else (model.config.get("dataset_name") if model and model.config else "Reference"),
        curr_dataset_name= curr_ds.name if curr_ds else "Current Dataset",
        dataset_id       = report.dataset_id,
        drift_type       = report.drift_type,
        detected         = report.detected,
        score            = report.score,
        retrain          = report.retrain,
        retrained        = bool(report.retrained),
        features         = report.features or [],
        report_key       = report.report_key,
        created_at       = report.created_at,
    )


@router.get("", response_model=list[DriftReportOut])
async def list_drift_reports(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DriftReport).order_by(DriftReport.created_at.desc()).limit(100)
    )
    reports = result.scalars().all()
    return [await _enrich_report(r, db) for r in reports]


@router.get("/{model_id}", response_model=list[DriftReportOut])
async def get_model_drift(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DriftReport)
        .where(DriftReport.model_id == model_id)
        .order_by(DriftReport.created_at.desc())
    )
    reports = result.scalars().all()
    return [await _enrich_report(r, db) for r in reports]


@router.post("/check", response_model=DriftReportOut, status_code=201)
async def check_drift(
    model_id:          str = Form(...),
    ref_dataset_name:  Optional[str] = Form(None),
    curr_dataset_name: Optional[str] = Form(None),
    drift_type:        str = Form("data"),
    file:              Optional[UploadFile] = File(None),
    db:                AsyncSession = Depends(get_db),
):
    model = await db.get(Model, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Resolve Reference Dataset
    ref_ds: Optional[Dataset] = None
    if ref_dataset_name:
        res = await db.execute(
            select(Dataset).where(Dataset.name == ref_dataset_name).order_by(Dataset.created_at.desc())
        )
        ref_ds = res.scalars().first()
    elif model.dataset_id:
        ref_ds = await db.get(Dataset, model.dataset_id)

    if not ref_ds or not ref_ds.storage_key:
        raise HTTPException(
            status_code=422,
            detail="Reference dataset not found for this model. Please select or specify a reference dataset.",
        )

    # 2. Resolve Current Dataset (either via uploaded file or chosen dataset name)
    curr_ds: Optional[Dataset] = None
    if file and file.filename:
        raw = await file.read()
        if len(raw) > _cfg.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File exceeds {_cfg.MAX_UPLOAD_SIZE_MB} MB limit")

        fn = file.filename.lower()
        fmt = "parquet" if fn.endswith(".parquet") else "excel" if fn.endswith((".xlsx", ".xls")) else "csv"
        try:
            df = read_dataframe(raw, fmt)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Cannot parse uploaded dataset: {exc}")

        schema_def, quality = profile_dataframe(df)
        inferred_dtype = detect_dataset_type(df)

        ds_id = str(uuid.uuid4())
        clean_name = re.sub(r"[^\w\s-]", "", file.filename.rsplit(".", 1)[0]).strip().replace(" ", "_")
        if not clean_name:
            clean_name = f"{model.name}_drift_data"

        existing = await db.execute(select(Dataset).where(Dataset.name == clean_name))
        if existing.scalars().first():
            clean_name = f"{clean_name}_{str(uuid.uuid4())[:6]}"

        object_key = f"{ds_id}/{file.filename}"
        store.upload_file(
            _cfg.MINIO_BUCKET_DATASETS,
            raw,
            object_name=object_key,
            content_type=file.content_type or "text/csv",
        )

        curr_ds = Dataset(
            id          = ds_id,
            name        = clean_name,
            dtype       = inferred_dtype,
            fmt         = fmt,
            source      = "drift_upload",
            owner       = "admin",
            rows        = len(df),
            cols        = len(df.columns),
            quality     = quality,
            schema_def  = schema_def,
            storage_key = object_key,
        )
        db.add(curr_ds)
        await db.commit()
        await db.refresh(curr_ds)
    elif curr_dataset_name:
        res = await db.execute(
            select(Dataset).where(Dataset.name == curr_dataset_name).order_by(Dataset.created_at.desc())
        )
        curr_ds = res.scalars().first()

    if not curr_ds or not curr_ds.storage_key:
        raise HTTPException(
            status_code=422,
            detail="Current dataset not found. Please upload a new dataset file or select an existing dataset.",
        )

    # 3. Run Drift Check
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
        id         = str(uuid.uuid4()),
        model_id   = model_id,
        dataset_id = curr_ds.id,
        drift_type = drift_type,
        detected   = result["detected"],
        score      = result["score"],
        retrain    = result["retrain"],
        retrained  = False,
        features   = result["features"],
        report_key = result["report_key"],
    )
    db.add(report)

    status_word = "detected" if result["detected"] else "not detected"
    activity = Activity(
        event_type = "warning" if result["detected"] else "success",
        message    = f"Drift check completed for model '{model.name}': drift {status_word} (score={result['score']:.4f})",
    )
    db.add(activity)
    await db.commit()
    await db.refresh(report)

    logger.info(f"Drift check done: model={model.name} ({model_id}) score={result['score']:.4f} detected={result['detected']}")
    return await _enrich_report(report, db)


@router.post("/retrain", response_model=DriftRetrainResponse, status_code=202)
async def retrain_from_drift(body: DriftRetrainRequest, db: AsyncSession = Depends(get_db)):
    """
    Retrain an existing model on the updated dataset after drift detection.
    Automatically increments the patch version (e.g. 1.0.0 -> 1.0.1 -> 1.0.2).
    Marks the corresponding drift report(s) as retrained.
    """
    model = await db.get(Model, body.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Resolve target dataset for retraining
    curr_ds: Optional[Dataset] = None
    if body.dataset_id:
        curr_ds = await db.get(Dataset, body.dataset_id)
    elif body.dataset_name:
        res = await db.execute(
            select(Dataset).where(Dataset.name == body.dataset_name).order_by(Dataset.created_at.desc())
        )
        curr_ds = res.scalars().first()
    elif body.report_id:
        rep = await db.get(DriftReport, body.report_id)
        if rep and rep.dataset_id:
            curr_ds = await db.get(Dataset, rep.dataset_id)

    if not curr_ds or not curr_ds.storage_key:
        raise HTTPException(status_code=422, detail="Updated dataset for retraining could not be found")

    # Mark the triggering drift report (and related reports for this model + dataset) as retrained
    if body.report_id:
        target_rep = await db.get(DriftReport, body.report_id)
        if target_rep:
            target_rep.retrained = True
            target_rep.retrain = False
    else:
        # Update any reports matching this model and dataset
        res_reports = await db.execute(
            select(DriftReport).where(
                DriftReport.model_id == model.id,
                DriftReport.dataset_id == curr_ds.id
            )
        )
        for r in res_reports.scalars().all():
            r.retrained = True
            r.retrain = False

    # Determine next incremental patch version among all models with this name
    res_models = await db.execute(
        select(Model).where(Model.name == model.name).order_by(Model.created_at.desc())
    )
    family_models = res_models.scalars().all()

    highest_patch = 0
    base_major = 1
    base_minor = 0

    for m in family_models:
        parts = m.version.split(".")
        if len(parts) >= 3:
            try:
                base_major = int(parts[0])
                base_minor = int(parts[1])
                patch = int(parts[2])
                if patch > highest_patch:
                    highest_patch = patch
            except ValueError:
                pass

    new_version = f"{base_major}.{base_minor}.{highest_patch + 1}"

    new_model_id = str(uuid.uuid4())
    run_id       = str(uuid.uuid4())

    model_config = dict(model.config or {})
    model_config["dataset_name"] = curr_ds.name
    model_config["version_bump"] = "patch"
    model_config["retrained_from"] = model.id

    new_model = Model(
        id         = new_model_id,
        name       = model.name,
        version    = new_version,
        task       = model.task,
        status     = "Pending",
        target_col = model.target_col,
        config     = model_config,
        dataset_id = curr_ds.id,
    )
    db.add(new_model)

    run = TrainingRun(
        id       = run_id,
        model_id = new_model_id,
        status   = "queued",
        progress = 0,
        logs     = [
            {"t": None, "l": f"[Retrain] Automated drift retraining initiated for '{model.name}' v{new_version}"},
            {"t": None, "l": f"[Retrain] Using updated dataset '{curr_ds.name}' ({curr_ds.rows:,} rows)"},
        ],
    )
    db.add(run)

    activity = Activity(
        event_type = "info",
        message    = f"Automated drift retraining started for '{model.name}' (v{new_version}) on updated dataset '{curr_ds.name}'",
    )
    db.add(activity)

    await db.commit()
    await db.refresh(run)

    # Dispatch Celery training worker task
    train_task.apply_async(
        kwargs=dict(
            model_id    = new_model_id,
            run_id      = run_id,
            storage_key = curr_ds.storage_key,
            fmt         = curr_ds.fmt,
            target_col  = model.target_col,
            task        = model.task,
            preset      = model_config.get("preset", "medium_quality"),
            time_limit  = model_config.get("time_limit", 300),
            config      = model_config,
        ),
        task_id=run_id,
    )

    logger.info(f"Drift retraining queued: model={model.name} version={new_version} run_id={run_id}")

    return DriftRetrainResponse(
        status       = "queued",
        run_id       = run_id,
        model_id     = new_model_id,
        model_name   = model.name,
        version      = new_version,
        dataset_name = curr_ds.name,
    )


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_drift_report(report_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a drift detection record and its generated HTML report."""
    report = await db.get(DriftReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Drift report not found")

    if report.report_key:
        try:
            store.delete_object(_cfg.MINIO_BUCKET_DRIFT, report.report_key)
        except Exception as exc:
            logger.warning(f"Could not delete drift report artifact from MinIO: {exc}")

    await db.delete(report)

    activity = Activity(
        event_type = "info",
        message    = f"Drift report #{report_id[:8]} deleted",
    )
    db.add(activity)
    await db.commit()
    logger.info(f"Drift report #{report_id[:8]} deleted")


@router.get("/report/{report_id}/html", response_class=HTMLResponse)
async def proxy_drift_report(report_id: str, db: AsyncSession = Depends(get_db)):
    """Proxy drift HTML report through FastAPI — same CORS fix as EDA."""
    report = await db.get(DriftReport, report_id)
    if not report or not report.report_key:
        raise HTTPException(status_code=404, detail="Drift report not found")
    html_bytes = store.download_bytes(_cfg.MINIO_BUCKET_DRIFT, report.report_key)
    return HTMLResponse(content=html_bytes.decode("utf-8", errors="replace"))
