"""Bring external PostgreSQL/MySQL tables into the platform as versioned datasets."""
from __future__ import annotations

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.orm import Activity, Dataset
from app.schemas import (
    DatabaseConnection,
    DatabaseConnectionResult,
    DatabaseIngestRequest,
    DatabaseListOut,
    DatabaseTableRequest,
    DatabaseTablesOut,
    DatasetOut,
)
from app.services import storage as store
from app.services.dataset_profile import detect_dataset_type, profile_dataframe

router = APIRouter(prefix="/database", tags=["Database ingestion"])
_cfg = get_settings()


def _url(payload: DatabaseConnection, include_database: bool = True) -> URL:
    drivername = "postgresql+psycopg2" if payload.db_type == "postgresql" else "mysql+pymysql"
    default_db = "postgres" if payload.db_type == "postgresql" else None
    return URL.create(
        drivername=drivername,
        username=payload.username,
        password=payload.password,
        host=payload.host,
        port=payload.port or (5432 if payload.db_type == "postgresql" else 3306),
        database=(payload.database or default_db) if include_database else None,
    )


def _engine(payload: DatabaseConnection):
    return create_engine(_url(payload), pool_pre_ping=True, connect_args={"connect_timeout": 10})


def _failure(exc: Exception) -> HTTPException:
    # Credentials never reach the client response or application logs.
    return HTTPException(status_code=422, detail=f"Could not connect to the database: {type(exc).__name__}: {exc}")


@router.post("/test-connection", response_model=DatabaseConnectionResult)
async def test_connection(payload: DatabaseConnection):
    engine = None
    try:
        engine = _engine(payload)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"connected": True, "message": "Connection succeeded"}
    except (SQLAlchemyError, OSError, ImportError) as exc:
        raise _failure(exc) from exc
    finally:
        if engine is not None:
            engine.dispose()


@router.post("/databases", response_model=DatabaseListOut)
async def list_databases(payload: DatabaseConnection):
    engine = None
    try:
        engine = _engine(payload)
        with engine.connect() as conn:
            if payload.db_type == "postgresql":
                rows = conn.execute(text("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"))
            else:
                rows = conn.execute(text("SHOW DATABASES"))
            return {"databases": [str(row[0]) for row in rows]}
    except (SQLAlchemyError, OSError, ImportError) as exc:
        raise _failure(exc) from exc
    finally:
        if engine is not None:
            engine.dispose()


@router.post("/tables", response_model=DatabaseTablesOut)
async def list_tables(payload: DatabaseTableRequest):
    if not payload.database:
        raise HTTPException(status_code=422, detail="Choose a database first")
    engine = None
    try:
        engine = _engine(payload)
        inspector = inspect(engine)
        return {"tables": inspector.get_table_names(schema=payload.schema_name)}
    except (SQLAlchemyError, OSError, ImportError) as exc:
        raise _failure(exc) from exc
    finally:
        if engine is not None:
            engine.dispose()


@router.post("/ingest", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
async def ingest_table(payload: DatabaseIngestRequest, db: AsyncSession = Depends(get_db)):
    if not payload.database:
        raise HTTPException(status_code=422, detail="Choose a database before ingesting a table")
    engine = None
    try:
        engine = _engine(payload)
        inspector = inspect(engine)
        available_tables = inspector.get_table_names(schema=payload.schema_name)
        if payload.table not in available_tables:
            raise HTTPException(status_code=404, detail="The selected table is no longer available")
        quote = engine.dialect.identifier_preparer.quote
        qualified = quote(payload.table)
        if payload.schema_name:
            qualified = f"{quote(payload.schema_name)}.{qualified}"
        # The table was selected from introspection above; only the limit remains a bound parameter.
        import pandas as pd
        df = pd.read_sql_query(text(f"SELECT * FROM {qualified} LIMIT :limit"), engine, params={"limit": payload.row_limit})
    except HTTPException:
        raise
    except (SQLAlchemyError, OSError, ImportError) as exc:
        raise _failure(exc) from exc
    finally:
        if engine is not None:
            engine.dispose()

    if df.empty:
        raise HTTPException(status_code=422, detail="The selected table has no rows")
    raw = df.to_csv(index=False).encode("utf-8")
    schema_def, quality = profile_dataframe(df)
    dataset_id = str(uuid.uuid4())
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in payload.table)
    storage_key = f"{dataset_id}/{safe_name}.csv"
    store.upload_file(_cfg.MINIO_BUCKET_DATASETS, raw, object_name=storage_key, content_type="text/csv")
    dataset = Dataset(
        id=dataset_id,
        name=payload.dataset_name.strip(),
        dtype=detect_dataset_type(df),
        fmt="csv",
        source="database",
        rows=len(df),
        cols=len(df.columns),
        quality=quality,
        schema_def=schema_def,
        storage_key=storage_key,
    )
    db.add(dataset)
    db.add(Activity(event_type="success", message=f"Dataset '{dataset.name}' ingested from {payload.db_type} table '{payload.table}'"))
    await db.commit()
    await db.refresh(dataset)
    return dataset
