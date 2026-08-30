"""System health check service — all external services, graceful on unconfigured ones."""
from __future__ import annotations

import time
from typing import Any

from loguru import logger

from app.core.config import get_settings

_cfg = get_settings()


def _check_postgres() -> dict:
    t0 = time.perf_counter()
    try:
        import psycopg2
        # Use standard postgresql:// URI for psycopg2
        dsn = _cfg.DATABASE_URL_SYNC.replace("postgresql+psycopg2://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")
        conn = psycopg2.connect(dsn, connect_timeout=3)
        conn.close()
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": "PostgreSQL", "host": _cfg.DATABASE_URL_SYNC.split("@")[-1], "ok": True, "latency": f"{ms}ms", "detail": "Connected"}
    except Exception as exc:
        return {"name": "PostgreSQL", "host": _cfg.DATABASE_URL_SYNC.split("@")[-1], "ok": False, "latency": None, "detail": str(exc)[:120]}


def _check_redis() -> dict:
    t0 = time.perf_counter()
    try:
        import redis as redis_lib
        r = redis_lib.from_url(_cfg.REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
        r.ping()
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": "Redis", "host": _cfg.REDIS_URL, "ok": True, "latency": f"{ms}ms", "detail": "Connected"}
    except Exception as exc:
        return {"name": "Redis", "host": _cfg.REDIS_URL, "ok": False, "latency": None, "detail": str(exc)[:120]}


def _check_minio() -> dict:
    t0 = time.perf_counter()
    try:
        from minio import Minio
        c = Minio(
            _cfg.MINIO_ENDPOINT,
            access_key=_cfg.MINIO_ACCESS_KEY,
            secret_key=_cfg.MINIO_SECRET_KEY,
            secure=_cfg.MINIO_SECURE,
        )
        list(c.list_buckets())
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": "MinIO", "host": _cfg.MINIO_ENDPOINT, "ok": True, "latency": f"{ms}ms", "detail": "Connected"}
    except Exception as exc:
        return {"name": "MinIO", "host": _cfg.MINIO_ENDPOINT, "ok": False, "latency": None, "detail": str(exc)[:120]}


def _check_influx() -> dict:
    """InfluxDB is optional — skip check entirely if token is not configured."""
    if not _cfg.INFLUX_TOKEN:
        return {"name": "InfluxDB", "host": _cfg.INFLUX_URL, "ok": True, "latency": None, "detail": "Not configured (skipped)"}
    t0 = time.perf_counter()
    try:
        from influxdb_client import InfluxDBClient
        client = InfluxDBClient(url=_cfg.INFLUX_URL, token=_cfg.INFLUX_TOKEN, org=_cfg.INFLUX_ORG, timeout=3_000)
        health = client.health()
        client.close()
        ok = health.status == "pass"
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": "InfluxDB", "host": _cfg.INFLUX_URL, "ok": ok, "latency": f"{ms}ms", "detail": health.status}
    except Exception as exc:
        return {"name": "InfluxDB", "host": _cfg.INFLUX_URL, "ok": False, "latency": None, "detail": str(exc)[:120]}


def _check_kserve() -> dict:
    """KServe is optional — skip if gateway not configured."""
    if not _cfg.KSERVE_GATEWAY:
        return {"name": "KServe", "host": "Not configured", "ok": True, "latency": None, "detail": "Not configured (skipped)"}
    t0 = time.perf_counter()
    try:
        import httpx
        r = httpx.get(f"{_cfg.KSERVE_GATEWAY}/healthz", timeout=3)
        ms = round((time.perf_counter() - t0) * 1000, 1)
        ok = r.status_code < 400
        return {"name": "KServe", "host": _cfg.KSERVE_GATEWAY, "ok": ok, "latency": f"{ms}ms", "detail": f"HTTP {r.status_code}"}
    except Exception as exc:
        return {"name": "KServe", "host": _cfg.KSERVE_GATEWAY, "ok": False, "latency": None, "detail": str(exc)[:120]}


def run_health_check() -> dict:
    results = [
        _check_postgres(),
        _check_redis(),
        _check_minio(),
        _check_influx(),
        _check_kserve(),
    ]
    # Overall = all required services ok (Postgres, Redis, MinIO)
    required = {r["name"]: r["ok"] for r in results if r["name"] in ("PostgreSQL", "Redis", "MinIO")}
    overall  = all(required.values())
    return {"services": results, "overall": overall}
