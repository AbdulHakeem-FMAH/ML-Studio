"""SQLAlchemy ORM models for AutoML Platform."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Dataset ───────────────────────────────────────────────────────────────────

class Dataset(Base):
    __tablename__ = "datasets"

    id:           Mapped[str]       = mapped_column(String(36), primary_key=True, default=_uuid)
    name:         Mapped[str]       = mapped_column(String(120), nullable=False, index=True)
    version:      Mapped[int]       = mapped_column(Integer, default=1)
    dtype:        Mapped[str]       = mapped_column(String(40), default="tabular")
    fmt:          Mapped[str]       = mapped_column(String(20), default="csv")
    source:       Mapped[str]       = mapped_column(String(40), default="file")
    owner:        Mapped[str]       = mapped_column(String(80), default="admin")
    rows:         Mapped[int]       = mapped_column(Integer, default=0)
    cols:         Mapped[int]       = mapped_column(Integer, default=0)
    quality:      Mapped[float]     = mapped_column(Float, default=0.0)
    schema_def:   Mapped[Any]       = mapped_column(JSON, default=list)
    storage_key:  Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    models:        Mapped[list[Model]]       = relationship("Model", back_populates="dataset", cascade="all, delete-orphan")
    drift_reports: Mapped[list[DriftReport]] = relationship("DriftReport", back_populates="dataset", cascade="all, delete-orphan")


# ── Model ─────────────────────────────────────────────────────────────────────

class Model(Base):
    __tablename__ = "models"

    id:           Mapped[str]         = mapped_column(String(36), primary_key=True, default=_uuid)
    name:         Mapped[str]         = mapped_column(String(120), nullable=False, index=True)
    version:      Mapped[str]         = mapped_column(String(20), default="1.0.0")
    task:         Mapped[str]         = mapped_column(String(40))
    status:       Mapped[str]         = mapped_column(String(30), default="Pending")
    algo:         Mapped[str | None]  = mapped_column(String(60), nullable=True)
    target_col:   Mapped[str | None]  = mapped_column(String(60), nullable=True)
    features:     Mapped[int]         = mapped_column(Integer, default=0)
    # Metrics
    accuracy:     Mapped[float | None] = mapped_column(Float, nullable=True)
    f1:           Mapped[float | None] = mapped_column(Float, nullable=True)
    auc:          Mapped[float | None] = mapped_column(Float, nullable=True)
    rmse:         Mapped[float | None] = mapped_column(Float, nullable=True)
    mae:          Mapped[float | None] = mapped_column(Float, nullable=True)
    r2:           Mapped[float | None] = mapped_column(Float, nullable=True)
    # AutoGluon outputs
    leaderboard:  Mapped[Any]         = mapped_column(JSON, default=list)
    importance:   Mapped[Any]         = mapped_column(JSON, default=list)
    confmat:      Mapped[Any]         = mapped_column(JSON, nullable=True)
    labels:       Mapped[Any]         = mapped_column(JSON, nullable=True)
    eval_metric:  Mapped[str | None]  = mapped_column(String(40), nullable=True)
    # Storage
    storage_key:  Mapped[str | None]  = mapped_column(String(512), nullable=True)
    config:       Mapped[Any]         = mapped_column(JSON, default=dict)
    dataset_id:   Mapped[str | None]  = mapped_column(String(36), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    created_at:   Mapped[datetime]    = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:   Mapped[datetime]    = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    dataset:  Mapped[Dataset | None]      = relationship("Dataset", back_populates="models")
    runs:     Mapped[list[TrainingRun]]   = relationship("TrainingRun", back_populates="model", cascade="all, delete-orphan")
    deploys:  Mapped[list[Deployment]]    = relationship("Deployment", back_populates="model", cascade="all, delete-orphan")
    drifts:   Mapped[list[DriftReport]]  = relationship("DriftReport", back_populates="model", cascade="all, delete-orphan")


# ── Training Run ──────────────────────────────────────────────────────────────

class TrainingRun(Base):
    __tablename__ = "training_runs"

    id:          Mapped[str]       = mapped_column(String(36), primary_key=True, default=_uuid)
    model_id:    Mapped[str]       = mapped_column(String(36), ForeignKey("models.id", ondelete="CASCADE"))
    status:      Mapped[str]       = mapped_column(String(30), default="queued")
    progress:    Mapped[int]       = mapped_column(Integer, default=0)
    logs:        Mapped[Any]       = mapped_column(JSON, default=list)
    task_id:     Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

    model: Mapped[Model] = relationship("Model", back_populates="runs")


# ── Deployment ────────────────────────────────────────────────────────────────

class Deployment(Base):
    __tablename__ = "deployments"

    id:         Mapped[str]      = mapped_column(String(36), primary_key=True, default=_uuid)
    name:       Mapped[str]      = mapped_column(String(120), nullable=False, unique=True, index=True)
    model_id:   Mapped[str]      = mapped_column(String(36), ForeignKey("models.id", ondelete="CASCADE"))
    namespace:  Mapped[str]      = mapped_column(String(60), default="kubeflow")
    ready:      Mapped[bool]     = mapped_column(Boolean, default=False)
    cpu:        Mapped[str]      = mapped_column(String(10), default="1")
    memory:     Mapped[str]      = mapped_column(String(10), default="2Gi")
    replicas:   Mapped[int]      = mapped_column(Integer, default=1)
    p50_ms:     Mapped[float | None] = mapped_column(Float, nullable=True)
    p99_ms:     Mapped[float | None] = mapped_column(Float, nullable=True)
    rps:        Mapped[float]    = mapped_column(Float, default=0.0)
    endpoint:   Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    model: Mapped[Model] = relationship("Model", back_populates="deploys")


# ── Drift Report ──────────────────────────────────────────────────────────────

class DriftReport(Base):
    __tablename__ = "drift_reports"

    id:          Mapped[str]      = mapped_column(String(36), primary_key=True, default=_uuid)
    model_id:    Mapped[str]      = mapped_column(String(36), ForeignKey("models.id", ondelete="CASCADE"))
    dataset_id:  Mapped[str | None] = mapped_column(String(36), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    drift_type:  Mapped[str]      = mapped_column(String(20), default="data")
    detected:    Mapped[bool]     = mapped_column(Boolean, default=False)
    score:       Mapped[float]    = mapped_column(Float, default=0.0)
    retrain:     Mapped[bool]     = mapped_column(Boolean, default=False)
    features:    Mapped[Any]      = mapped_column(JSON, default=list)
    report_key:  Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    model:   Mapped[Model]          = relationship("Model", back_populates="drifts")
    dataset: Mapped[Dataset | None] = relationship("Dataset", back_populates="drift_reports")


# ── Activity ──────────────────────────────────────────────────────────────────

class Activity(Base):
    __tablename__ = "activities"

    id:         Mapped[str]      = mapped_column(String(36), primary_key=True, default=_uuid)
    event_type: Mapped[str]      = mapped_column(String(20), default="info")
    message:    Mapped[str]      = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
