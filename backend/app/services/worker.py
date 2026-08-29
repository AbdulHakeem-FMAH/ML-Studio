"""Celery application and training task."""
from __future__ import annotations

from datetime import datetime, timezone

from celery import Celery
from loguru import logger
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

_cfg = get_settings()

celery_app = Celery(
    "automl",
    broker=_cfg.REDIS_URL,
    backend=_cfg.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,   # one task per worker process (AutoGluon is greedy)
    task_acks_late=True,
    worker_max_tasks_per_child=1,   # restart worker after each training to free memory
)


def _sync_session():
    engine = create_engine(_cfg.DATABASE_URL_SYNC, pool_pre_ping=True)
    return sessionmaker(bind=engine)()


@celery_app.task(bind=True, name="automl.train", max_retries=0)
def train_task(
    self,
    model_id:   str,
    run_id:     str,
    storage_key: str,
    fmt:        str,
    target_col: str,
    task:       str,
    preset:     str,
    time_limit: int,
    config:     dict,
):
    from app.models.orm import Model, TrainingRun
    from app.services.training import run_training

    db = _sync_session()
    logs_acc: list[dict] = []

    def log_cb(msg: str) -> None:
        ts    = int(datetime.now(timezone.utc).timestamp() * 1000)
        entry = {"t": ts, "l": msg}
        logs_acc.append(entry)
        try:
            db.execute(
                update(TrainingRun)
                .where(TrainingRun.id == run_id)
                .values(logs=logs_acc, status="running")
            )
            db.commit()
        except Exception as exc:
            logger.warning(f"log_cb DB write failed: {exc}")

    def prog_cb(pct: int) -> None:
        try:
            db.execute(
                update(TrainingRun)
                .where(TrainingRun.id == run_id)
                .values(progress=pct)
            )
            db.commit()
            self.update_state(state="PROGRESS", meta={"progress": pct})
        except Exception as exc:
            logger.warning(f"prog_cb DB write failed: {exc}")

    try:
        db.execute(
            update(TrainingRun)
            .where(TrainingRun.id == run_id)
            .values(status="running", started_at=datetime.now(timezone.utc), task_id=self.request.id)
        )
        db.execute(
            update(Model).where(Model.id == model_id).values(status="In Progress")
        )
        db.commit()
        log_cb("[AutoML] Worker acquired the training job")

        result  = run_training(
            model_id=model_id,
            run_id=run_id,
            storage_key=storage_key,
            fmt=fmt,
            target_col=target_col,
            task=task,
            preset=preset,
            time_limit=time_limit,
            config=config,
            log_cb=log_cb,
            prog_cb=prog_cb,
        )

        metrics = result.pop("metrics", {})
        db.execute(
            update(Model)
            .where(Model.id == model_id)
            .values(
                status="Complete",
                algo=result["algo"],
                task=result["task"],
                eval_metric=result.get("eval_metric"),
                features=result["features"],
                accuracy=metrics.get("accuracy"),
                f1=metrics.get("f1"),
                auc=metrics.get("auc"),
                rmse=metrics.get("rmse"),
                mae=metrics.get("mae"),
                r2=metrics.get("r2"),
                leaderboard=result["leaderboard"],
                importance=result["importance"],
                confmat=result.get("confmat"),
                labels=result.get("labels"),
                storage_key=result["storage_key"],
            )
        )
        db.execute(
            update(TrainingRun)
            .where(TrainingRun.id == run_id)
            .values(status="done", progress=100, finished_at=datetime.now(timezone.utc))
        )
        db.commit()
        logger.info(f"Training task done: model_id={model_id}")
        return {"status": "done", "model_id": model_id}

    except Exception as exc:
        logger.exception(f"Training task FAILED: model_id={model_id}  error={exc}")
        try:
            failure_entry = {
                "t": int(datetime.now(timezone.utc).timestamp() * 1000),
                "l": f"[AutoML] Training failed: {type(exc).__name__}: {exc}",
            }
            logs_acc.append(failure_entry)
            db.execute(
                update(TrainingRun).where(TrainingRun.id == run_id)
                .values(logs=logs_acc, status="failed", finished_at=datetime.now(timezone.utc))
            )
            db.execute(
                update(Model).where(Model.id == model_id).values(status="Failed")
            )
            db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()
