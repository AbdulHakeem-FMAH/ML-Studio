"""MinIO / S3-compatible object storage service."""
from __future__ import annotations

import io
import uuid
from datetime import timedelta
from typing import BinaryIO, Optional

from loguru import logger
from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings

_cfg = get_settings()


def _client() -> Minio:
    return Minio(
        _cfg.MINIO_ENDPOINT,
        access_key=_cfg.MINIO_ACCESS_KEY,
        secret_key=_cfg.MINIO_SECRET_KEY,
        secure=_cfg.MINIO_SECURE,
    )


def ensure_buckets() -> None:
    """Create required buckets if they don't exist. Called at startup."""
    c = _client()
    for bucket in [
        _cfg.MINIO_BUCKET_DATASETS,
        _cfg.MINIO_BUCKET_MODELS,
        _cfg.MINIO_BUCKET_EDA,
        _cfg.MINIO_BUCKET_DRIFT,
    ]:
        try:
            if not c.bucket_exists(bucket):
                c.make_bucket(bucket)
                logger.info(f"Created MinIO bucket: {bucket}")
        except S3Error as exc:
            logger.warning(f"Could not ensure bucket '{bucket}': {exc}")


def upload_file(
    bucket: str,
    data: bytes | BinaryIO,
    object_name: Optional[str] = None,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes/file-like to MinIO. Returns the object key."""
    c = _client()
    key = object_name or str(uuid.uuid4())
    if isinstance(data, (bytes, bytearray)):
        c.put_object(bucket, key, io.BytesIO(data), len(data), content_type=content_type)
    else:
        data.seek(0, 2)
        size = data.tell()
        data.seek(0)
        c.put_object(bucket, key, data, size, content_type=content_type)
    logger.debug(f"Uploaded {key} → {bucket} ({content_type})")
    return key


def download_bytes(bucket: str, key: str) -> bytes:
    """Download object and return raw bytes."""
    c = _client()
    resp = c.get_object(bucket, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def download_stream(bucket: str, key: str):
    """Return the raw response stream (caller must .close() it)."""
    return _client().get_object(bucket, key)


def presigned_url(bucket: str, key: str, expires_seconds: int = 3600) -> str:
    c = _client()
    return c.presigned_get_object(bucket, key, expires=timedelta(seconds=expires_seconds))


def delete_object(bucket: str, key: str) -> None:
    c = _client()
    try:
        c.remove_object(bucket, key)
        logger.debug(f"Deleted {key} from {bucket}")
    except S3Error as exc:
        logger.warning(f"Delete failed for {key}: {exc}")


def object_exists(bucket: str, key: str) -> bool:
    """Return True if the object exists in MinIO."""
    try:
        _client().stat_object(bucket, key)
        return True
    except S3Error:
        return False
