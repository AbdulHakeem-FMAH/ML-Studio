"""Pydantic schemas for request/response validation."""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, field_validator


# ── Dataset ───────────────────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    name: str
    dtype: str = "tabular"
    fmt: str = "csv"
    source: str = "file"
    owner: str = "admin"


class DatasetOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    version: int
    dtype: str
    fmt: str
    source: str
    owner: str
    rows: int
    cols: int
    quality: float
    schema_def: List[Any]
    storage_key: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DatasetColumnsOut(BaseModel):
    dataset_id: str
    dtype: str
    columns: List[Any]


class DatasetQualityOut(BaseModel):
    quality_score: float
    dataset_type: str
    rows: int
    columns: int
    missing_cells: int
    total_cells: int
    duplicate_rows: int
    type_breakdown: dict[str, int]
    columns_detail: List[Any]


class DatabaseConnection(BaseModel):
    db_type: Literal["postgresql", "mysql"] = "postgresql"
    host: str
    port: Optional[int] = None
    username: str
    password: str
    database: Optional[str] = None


class DatabaseTableRequest(DatabaseConnection):
    schema_name: Optional[str] = None


class DatabaseIngestRequest(DatabaseTableRequest):
    table: str
    dataset_name: str
    row_limit: int = 100_000


class DatabaseConnectionResult(BaseModel):
    connected: bool
    message: str


class DatabaseListOut(BaseModel):
    databases: List[str]


class DatabaseTablesOut(BaseModel):
    tables: List[str]


# ── Model ─────────────────────────────────────────────────────────────────────

class ModelOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    version: str
    task: str
    status: str
    algo: Optional[str] = None
    target_col: Optional[str] = None
    features: int
    accuracy: Optional[float] = None
    f1: Optional[float] = None
    auc: Optional[float] = None
    rmse: Optional[float] = None
    mae: Optional[float] = None
    r2: Optional[float] = None
    leaderboard: List[Any]
    importance: List[Any]
    confmat: Optional[Any] = None
    labels: Optional[Any] = None
    eval_metric: Optional[str] = None
    storage_key: Optional[str] = None
    config: Any
    dataset_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ModelFeatureSchemaOut(BaseModel):
    model_id: str
    model_name: str
    task: str
    target_column: Optional[str] = None
    features: List[Any]


# ── Training ──────────────────────────────────────────────────────────────────

class TrainingConfig(BaseModel):
    dataset_name: str
    target_col: str
    model_name: str = "my_model"
    task: str = "automatic"             # automatic | classification | regression | timeseries
    preset: str = "medium_quality"       # best_quality | high_quality | medium_quality | fast
    time_limit: int = 600               # seconds
    version_bump: str = "patch"         # major | minor | patch
    # Preprocessing flags
    numeric_imputation: bool = True
    categorical_imputation: bool = True
    normalize: bool = False
    remove_outliers: bool = False


class TrainingRunOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    model_id: str
    status: str
    progress: int
    logs: List[Any]
    task_id: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime


# ── Predictions ───────────────────────────────────────────────────────────────

class ProbEntry(BaseModel):
    label: str
    probability: float


class PredictSingleRequest(BaseModel):
    model_name: str
    features: dict[str, Any]


class PredictSingleResponse(BaseModel):
    prediction: Any
    class_label: Optional[str] = None
    class_idx: Optional[int] = None
    probabilities: Optional[List[ProbEntry]] = None
    latency_ms: float
    model_name: str
    model_version: str


class BatchResultRow(BaseModel):
    row: int
    prediction: Any
    probability: Optional[float] = None
    features: dict[str, Any]


class BatchResponse(BaseModel):
    model_name: str
    rows_scored: int
    processing_ms: float
    results: List[BatchResultRow]


# ── EDA ───────────────────────────────────────────────────────────────────────

class EDARequest(BaseModel):
    dataset_name: str


class EDAResponse(BaseModel):
    dataset_name: str
    report_key: str
    report_url: str


# ── Drift ─────────────────────────────────────────────────────────────────────

class DriftCheckRequest(BaseModel):
    model_id: str
    drift_type: str = "data"


class DriftFeature(BaseModel):
    feat: str
    score: float
    dist: str
    detected: bool


class DriftReportOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    model_id: str
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    ref_dataset_name: Optional[str] = None
    curr_dataset_name: Optional[str] = None
    dataset_id: Optional[str] = None
    drift_type: str
    detected: bool
    score: float
    retrain: bool
    retrained: bool = False
    features: List[Any]
    report_key: Optional[str] = None
    created_at: datetime


class DriftRetrainRequest(BaseModel):
    model_id: str
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None
    report_id: Optional[str] = None


class DriftRetrainResponse(BaseModel):
    status: str
    run_id: str
    model_id: str
    model_name: str
    version: str
    dataset_name: str


# ── Forecasting ───────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    model_name: str
    horizon: int = 20
    date_col: Optional[str] = None
    value_col: Optional[str] = None


class HistPoint(BaseModel):
    t: str
    val: float


class ForecastPoint(BaseModel):
    t: str
    mean: float
    lo: float
    hi: float


class ForecastResponse(BaseModel):
    model_name: str
    target_col: Optional[str] = None
    date_col: Optional[str] = None
    history: List[HistPoint]
    forecast: List[ForecastPoint]


# ── Deploy ────────────────────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    model_id: str
    name: str
    namespace: str = "kubeflow"
    cpu: str = "1"
    memory: str = "2Gi"
    replicas: int = 1


class DeploymentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    model_id: str
    namespace: str
    ready: bool
    cpu: str
    memory: str
    replicas: int
    p50_ms: Optional[float] = None
    p99_ms: Optional[float] = None
    rps: float
    endpoint: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ── Health ────────────────────────────────────────────────────────────────────

class ServiceHealth(BaseModel):
    name: str
    host: str
    ok: bool
    latency: Optional[str] = None
    detail: str


class HealthResponse(BaseModel):
    services: List[ServiceHealth]
    overall: bool


class DashboardStats(BaseModel):
    total_datasets: int
    complete_models: int
    drift_alerts: int
    active_deployments: int
    training_runs_this_week: int


class ActivityOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    event_type: str
    message: str
    created_at: datetime
