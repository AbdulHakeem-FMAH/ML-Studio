"""Application settings — loaded from environment variables via pydantic-settings."""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "changeme-use-openssl-rand-hex-32-in-production"
    APP_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4173"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.APP_CORS_ORIGINS.split(",") if o.strip()]

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://automl:automl@localhost:5432/automl"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://automl:automl@localhost:5432/automl"

    # ── Redis ────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── MinIO ────────────────────────────────────────────────────────────────
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_SECURE: bool = False
    MINIO_BUCKET_DATASETS: str = "datasets"
    MINIO_BUCKET_MODELS: str = "models"
    MINIO_BUCKET_EDA: str = "eda"
    MINIO_BUCKET_DRIFT: str = "drift"

    # ── InfluxDB (optional — gracefully skipped if unconfigured) ─────────────
    INFLUX_URL: str = "http://localhost:8086"
    INFLUX_TOKEN: str = ""          # empty = not configured, skip check
    INFLUX_ORG: str = "production"
    INFLUX_BUCKET: str = "sensor-data"

    # ── KServe / Kubernetes (optional) ───────────────────────────────────────
    KSERVE_GATEWAY: str = ""        # empty = not configured
    KSERVE_NAMESPACE: str = "kubeflow"

    # ── Auth ─────────────────────────────────────────────────────────────────
    AUTH_ENABLED: bool = False
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # ── ML defaults ──────────────────────────────────────────────────────────
    DEFAULT_TRAINING_TIMEOUT: int = 3600
    MAX_UPLOAD_SIZE_MB: int = 500

    # ── AutoGluon ────────────────────────────────────────────────────────────
    AG_MODELS_DIR: str = "/tmp/autogluon_models"   # local scratch; real artifacts → MinIO


@lru_cache
def get_settings() -> Settings:
    return Settings()
