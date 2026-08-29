"""AutoML Platform — FastAPI application."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api.v1 import v1_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.session import Base, engine

_cfg = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    setup_logging("DEBUG" if _cfg.APP_ENV == "development" else "INFO")
    logger.info(f"Starting AutoML Platform  env={_cfg.APP_ENV}")

    # Create DB tables (idempotent — won't touch existing tables)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables verified / created")

    # Ensure MinIO buckets exist
    try:
        from app.services.storage import ensure_buckets
        ensure_buckets()
        logger.info("MinIO buckets verified")
    except Exception as exc:
        logger.warning(f"MinIO bucket setup failed (will retry on first use): {exc}")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    await engine.dispose()
    logger.info("AutoML Platform shut down")


app = FastAPI(
    title        = "AutoML Platform",
    version      = "2.0.0",
    description  = "Production-grade AutoML: AutoGluon · EDA · Drift · Forecasting · KServe",
    lifespan     = lifespan,
    docs_url     = "/docs",
    redoc_url    = "/redoc",
    openapi_url  = "/openapi.json",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins     = _cfg.cors_origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(v1_router)


@app.get("/", tags=["Root"])
async def root():
    return {"service": "AutoML Platform", "version": "2.0.0", "docs": "/docs"}


@app.get("/ping", tags=["Root"])
async def ping():
    return {"pong": True}
