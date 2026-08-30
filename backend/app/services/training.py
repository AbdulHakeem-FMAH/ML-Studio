"""AutoML training service — powered by AutoGluon 1.6.1."""
from __future__ import annotations

import io
import os
import shutil
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from loguru import logger

from app.core.config import get_settings
from app.services import storage as store

_cfg = get_settings()

# AutoGluon preset mapping
PRESET_MAP = {
    "fast":           "medium_quality",
    "medium_quality": "medium_quality",
    "high_quality":   "high_quality",
    "best_quality":   "best_quality",
}


# ── Dataset loading ───────────────────────────────────────────────────────────

def _load_dataframe(storage_key: str, fmt: str) -> pd.DataFrame:
    raw = store.download_bytes(_cfg.MINIO_BUCKET_DATASETS, storage_key)
    buf = io.BytesIO(raw)
    if fmt == "parquet":
        return pd.read_parquet(buf)
    if fmt == "excel":
        return pd.read_excel(buf)
    return pd.read_csv(buf)


def _infer_task(y: pd.Series) -> str:
    n_unique = y.nunique()
    if y.dtype == object or n_unique <= 20:
        return "classification"
    return "regression"


# ── Core AutoGluon training ───────────────────────────────────────────────────

def run_training(
    model_id: str,
    run_id: str,
    storage_key: str,
    fmt: str,
    target_col: str,
    task: str,
    preset: str,
    time_limit: int,
    config: dict,
    log_cb: Callable[[str], None],
    prog_cb: Callable[[int], None],
) -> dict:
    """
    Execute AutoGluon training. Returns result dict with metrics, leaderboard,
    feature importance, confusion matrix, and MinIO artifact key.

    This runs synchronously inside a Celery worker process.
    """
    t0 = time.time()
    log_cb(f"[AutoML] Initialising — model_id={model_id}  run_id={run_id}")

    # 1. Load dataset
    log_cb(f"[AutoML] Loading dataset from MinIO ({storage_key})…")
    df = _load_dataframe(storage_key, fmt)
    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found. Available: {list(df.columns)}")
    log_cb(f"[AutoML] Loaded {len(df):,} rows × {len(df.columns)} columns")
    prog_cb(5)

    # 2. Task detection
    if task in ("automatic", "auto"):
        task = _infer_task(df[target_col])
        log_cb(f"[AutoML] Auto-detected task type: {task}")
    else:
        task = task.lower()
    log_cb(f"[AutoML] Task: {task}  |  Preset: {preset}  |  Time limit: {time_limit}s")

    # 3. Resolve AutoGluon preset
    ag_preset = PRESET_MAP.get(preset, "medium_quality")

    # 4. Build AutoGluon predictor in a temp directory
    scratch_dir = Path(tempfile.mkdtemp(prefix=f"ag_{model_id}_"))
    model_path  = scratch_dir / "predictor"

    try:
        prog_cb(10)

        if task == "timeseries":
            result = _train_timeseries(
                df, target_col, model_path, ag_preset, time_limit, log_cb, prog_cb,
            )
        else:
            result = _train_tabular(
                df, target_col, task, model_path, ag_preset, time_limit,
                config, log_cb, prog_cb,
            )

        prog_cb(88)

        # 5. Zip the entire AutoGluon predictor directory and upload to MinIO
        log_cb("[AutoML] Packaging model artifacts for MinIO…")
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in model_path.rglob("*"):
                if file.is_file():
                    zf.write(file, file.relative_to(model_path))
        zip_bytes   = zip_buf.getvalue()
        artifact_key = f"{model_id}/predictor.zip"
        store.upload_file(
            _cfg.MINIO_BUCKET_MODELS, zip_bytes,
            object_name=artifact_key, content_type="application/zip",
        )
        log_cb(f"[AutoML] Artifact uploaded → models/{artifact_key} ({len(zip_bytes)//1024:,} KB)")
        result["storage_key"] = artifact_key

        elapsed = round(time.time() - t0)
        log_cb(f"[AutoML] Training complete in {elapsed}s. Best model: {result.get('algo', '—')}")
        prog_cb(100)

        return result

    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)


def _train_tabular(
    df: pd.DataFrame,
    target_col: str,
    task: str,
    model_path: Path,
    preset: str,
    time_limit: int,
    config: dict,
    log_cb: Callable,
    prog_cb: Callable,
) -> dict:
    from autogluon.tabular import TabularPredictor

    problem_type = {
        "classification": "binary" if df[target_col].nunique() == 2 else "multiclass",
        "regression":     "regression",
    }.get(task, task)

    log_cb(f"[AutoGluon] Starting TabularPredictor — problem_type={problem_type}  preset={preset}")

    # Optional preprocessing
    train_df = df.copy()
    if config.get("remove_outliers") and train_df[target_col].dtype.kind in "if":
        from scipy import stats as scipy_stats
        num_cols = train_df.select_dtypes(include="number").columns.tolist()
        z = np.abs(scipy_stats.zscore(train_df[num_cols].fillna(0)))
        mask = (z < 3).all(axis=1)
        before = len(train_df)
        train_df = train_df[mask]
        log_cb(f"[AutoML] Outlier removal: {before - len(train_df):,} rows removed")

    predictor = TabularPredictor(
        label=target_col,
        problem_type=problem_type,
        path=str(model_path),
        verbosity=2,
    )

    prog_cb(15)
    log_cb(f"[AutoGluon] Fitting models (this may take up to {time_limit}s)…")

    predictor.fit(
        train_data=train_df,
        presets=preset,
        time_limit=time_limit,
    )
    log_cb("[AutoGluon] Fit complete.")
    prog_cb(70)

    # ── Leaderboard ──────────────────────────────────────────────────────────
    lb_df = predictor.leaderboard(silent=True)
    leaderboard = []
    for _, row in lb_df.iterrows():
        entry: dict[str, Any] = {"m": row["model"]}
        for col in lb_df.columns:
            if col != "model":
                val = row[col]
                entry[col.lower().replace(" ", "_")] = (
                    round(float(val), 4) if isinstance(val, (int, float)) and not np.isnan(val) else None
                )
        leaderboard.append(entry)

    best_model_name = str(lb_df.iloc[0]["model"]) if len(lb_df) else "AutoGluon"
    log_cb(f"[AutoGluon] Best model: {best_model_name}")
    prog_cb(75)

    # ── Test evaluation ───────────────────────────────────────────────────────
    eval_result = predictor.evaluate(train_df, silent=True)
    eval_metric = predictor.eval_metric.name if hasattr(predictor.eval_metric, "name") else str(predictor.eval_metric)
    log_cb(f"[AutoGluon] Evaluation metric: {eval_metric}")

    metrics: dict[str, Any] = {}
    confmat = None
    labels  = None
    proba_df = None

    if problem_type in ("binary", "multiclass"):
        preds    = predictor.predict(train_df, as_pandas=False)
        y_true   = train_df[target_col].values

        try:
            from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
            metrics["accuracy"] = round(float(accuracy_score(y_true, preds)), 4)
            metrics["f1"]       = round(float(f1_score(y_true, preds, average="weighted", zero_division=0)), 4)
        except Exception as exc:
            log_cb(f"[AutoML] Metric computation warning: {exc}")

        try:
            proba_df = predictor.predict_proba(train_df)
            y_prob   = proba_df.values
            classes  = proba_df.columns.tolist()
            auc = roc_auc_score(
                y_true, y_prob if len(classes) > 2 else y_prob[:, 1],
                multi_class="ovr", average="weighted",
            )
            metrics["auc"] = round(float(auc), 4)
        except Exception as exc:
            log_cb(f"[AutoML] AUC computation skipped: {exc}")

        try:
            from sklearn.metrics import confusion_matrix
            label_vals = sorted(set(y_true))
            cm = confusion_matrix(y_true, preds, labels=label_vals).tolist()
            confmat = cm
            labels  = [str(l) for l in label_vals]
        except Exception:
            pass

    else:  # regression
        preds  = predictor.predict(train_df, as_pandas=False)
        y_true = train_df[target_col].values
        try:
            from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
            metrics["rmse"] = round(float(np.sqrt(mean_squared_error(y_true, preds))), 4)
            metrics["mae"]  = round(float(mean_absolute_error(y_true, preds)), 4)
            metrics["r2"]   = round(float(r2_score(y_true, preds)), 4)
        except Exception as exc:
            log_cb(f"[AutoML] Regression metrics warning: {exc}")

    prog_cb(82)

    # ── Feature importance ────────────────────────────────────────────────────
    importance: list[dict] = []
    try:
        imp_df = predictor.feature_importance(train_df, silent=True)
        for feat, row in imp_df.iterrows():
            importance.append({
                "f": str(feat),
                "v": round(float(row["importance"]), 4),
            })
        importance = importance[:20]
    except Exception as exc:
        log_cb(f"[AutoML] Feature importance skipped: {exc}")

    return {
        "algo":        best_model_name,
        "task":        task,
        "eval_metric": eval_metric,
        "features":    len([c for c in df.columns if c != target_col]),
        "leaderboard": leaderboard,
        "importance":  importance,
        "confmat":     confmat,
        "labels":      labels,
        "metrics":     metrics,
    }


def _train_timeseries(
    df: pd.DataFrame,
    target_col: str,
    model_path: Path,
    preset: str,
    time_limit: int,
    log_cb: Callable,
    prog_cb: Callable,
) -> dict:
    log_cb("[Time-Series] Preparing time series dataset for training…")

    # Detect datetime and item_id columns
    date_cols = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])
                 or any(kw in c.lower() for kw in ("date", "time", "ts", "timestamp", "dt", "day", "month", "year"))]
    id_cols   = [c for c in df.columns if any(kw in c.lower() for kw in ("id", "item", "series", "group")) and c != target_col]

    timestamp_col = date_cols[0] if date_cols else df.columns[0]
    item_id_col   = id_cols[0] if id_cols else None

    df[timestamp_col] = pd.to_datetime(df[timestamp_col], errors="coerce")
    df = df.dropna(subset=[timestamp_col, target_col]).sort_values(timestamp_col).reset_index(drop=True)
    df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
    df = df.dropna(subset=[target_col])

    log_cb(f"[Time-Series] Using timestamp='{timestamp_col}', target='{target_col}' ({len(df)} observations)")
    prog_cb(20)

    model_path.mkdir(parents=True, exist_ok=True)
    ag_succeeded = False
    best_model_name = "AutoGluon-TS"
    leaderboard = []
    metrics = {}

    # Attempt AutoGluon TimeSeriesPredictor if dataset length is >= 8
    if len(df) >= 8:
        try:
            from autogluon.timeseries import TimeSeriesDataFrame, TimeSeriesPredictor
            ag_ts_preset = "medium_quality" if preset in ("fast", "medium_quality") else ("high_quality" if preset == "high_quality" else "best_quality")
            pred_len = max(1, min(20, len(df) // 3))

            if item_id_col:
                ts_df = TimeSeriesDataFrame.from_data_frame(
                    df, id_column=item_id_col, timestamp_column=timestamp_col,
                )
            else:
                work_df = df[[timestamp_col, target_col]].copy()
                work_df.insert(0, "item_id", "series_0")
                ts_df = TimeSeriesDataFrame.from_data_frame(
                    work_df, id_column="item_id", timestamp_column=timestamp_col,
                )

            log_cb(f"[AutoGluon-TS] Fitting TimeSeriesPredictor (prediction_length={pred_len}, preset={ag_ts_preset})…")
            predictor = TimeSeriesPredictor(
                target=target_col,
                prediction_length=pred_len,
                path=str(model_path),
                verbosity=2,
            )
            predictor.fit(ts_df, presets=ag_ts_preset, time_limit=time_limit)
            lb_df = predictor.leaderboard(ts_df, silent=True)
            for _, row in lb_df.iterrows():
                entry: dict[str, Any] = {"m": str(row["model"])}
                for col in lb_df.columns:
                    if col != "model":
                        val = row[col]
                        entry[col.lower().replace(" ", "_")] = (
                            round(float(val), 4) if isinstance(val, (int, float)) and not np.isnan(val) else None
                        )
                leaderboard.append(entry)
            best_model_name = str(lb_df.iloc[0]["model"]) if len(lb_df) else "AutoGluon-TS"
            ag_succeeded = True
            log_cb(f"[AutoGluon-TS] Fit complete. Best model: {best_model_name}")
        except Exception as exc:
            log_cb(f"[AutoGluon-TS] AutoGluon TS training skipped/fallback: {exc}")

    # Statistical Time-Series fallback / ensemble (Holt-Winters ETS, ARIMA, Linear Trend)
    if not ag_succeeded:
        log_cb("[Time-Series] Training statistical forecasting models (ETS, ARIMA, Trend)…")
        series = df[target_col].astype(float).values
        n = len(series)
        models_tested = []

        # 1. Exponential Smoothing (Holt-Winters)
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
            ets = ExponentialSmoothing(series, trend="add", seasonal=None, initialization_method="estimated").fit()
            fitted = ets.fittedvalues
            mae = float(np.mean(np.abs(series - fitted)))
            rmse = float(np.sqrt(np.mean((series - fitted) ** 2)))
            r2 = float(1 - (np.sum((series - fitted)**2) / (np.sum((series - np.mean(series))**2) + 1e-8)))
            models_tested.append({
                "m": "ExponentialSmoothing (Holt-Winters)",
                "mae": round(mae, 4),
                "rmse": round(rmse, 4),
                "r2": round(r2, 4),
                "score_val": round(-mae, 4),
            })
        except Exception as e:
            log_cb(f"[Time-Series] ETS model notice: {e}")

        # 2. ARIMA
        try:
            from statsmodels.tsa.arima.model import ARIMA
            order = (1, 1, 0) if n >= 4 else (1, 0, 0)
            arima = ARIMA(series, order=order).fit()
            fitted = arima.fittedvalues
            mae = float(np.mean(np.abs(series[1:] - fitted[1:]))) if n > 1 else 0.0
            rmse = float(np.sqrt(np.mean((series[1:] - fitted[1:]) ** 2))) if n > 1 else 0.0
            models_tested.append({
                "m": f"ARIMA {order}",
                "mae": round(mae, 4),
                "rmse": round(rmse, 4),
                "score_val": round(-mae, 4),
            })
        except Exception as e:
            log_cb(f"[Time-Series] ARIMA model notice: {e}")

        # 3. Linear Trend Extrapolation
        try:
            x = np.arange(n)
            poly = np.polyfit(x, series, 1)
            fitted = np.polyval(poly, x)
            mae = float(np.mean(np.abs(series - fitted)))
            rmse = float(np.sqrt(np.mean((series - fitted) ** 2)))
            r2 = float(1 - (np.sum((series - fitted)**2) / (np.sum((series - np.mean(series))**2) + 1e-8)))
            models_tested.append({
                "m": "Linear Trend Model",
                "mae": round(mae, 4),
                "rmse": round(rmse, 4),
                "r2": round(r2, 4),
                "score_val": round(-mae, 4),
            })
        except Exception as e:
            log_cb(f"[Time-Series] Linear Trend notice: {e}")

        models_tested.sort(key=lambda x: x.get("mae", 999999))
        leaderboard = models_tested
        best_model_name = models_tested[0]["m"] if models_tested else "ExponentialSmoothing"
        best = models_tested[0] if models_tested else {}
        metrics = {
            "mae": best.get("mae"),
            "rmse": best.get("rmse"),
            "r2": best.get("r2"),
        }
        # Save a metadata file in model_path
        import json
        with open(model_path / "ts_metadata.json", "w") as f:
            json.dump({
                "target_col": target_col,
                "timestamp_col": timestamp_col,
                "best_algo": best_model_name,
                "observations": n,
            }, f)
        log_cb(f"[Time-Series] Evaluated {len(models_tested)} models. Best model: {best_model_name} (MAE={best.get('mae')})")

    prog_cb(80)
    return {
        "algo":        best_model_name,
        "task":        "timeseries",
        "eval_metric": "MAE" if not ag_succeeded else "WQL",
        "features":    len([c for c in df.columns if c != target_col]),
        "leaderboard": leaderboard,
        "importance":  [],
        "confmat":     None,
        "labels":      None,
        "metrics":     metrics,
    }


# ── Inference ─────────────────────────────────────────────────────────────────

_predictor_cache: dict[str, Any] = {}


def _load_predictor(storage_key: str, task: str) -> Any:
    """Download and unzip AutoGluon predictor from MinIO, cache in process."""
    if storage_key in _predictor_cache:
        return _predictor_cache[storage_key]

    raw  = store.download_bytes(_cfg.MINIO_BUCKET_MODELS, storage_key)
    dest = Path(tempfile.mkdtemp(prefix="ag_infer_"))

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        zf.extractall(dest)

    if task == "timeseries":
        from autogluon.timeseries import TimeSeriesPredictor
        predictor = TimeSeriesPredictor.load(str(dest))
    else:
        from autogluon.tabular import TabularPredictor
        predictor = TabularPredictor.load(str(dest))

    _predictor_cache[storage_key] = predictor
    return predictor


def predict_single(storage_key: str, task: str, features: dict) -> dict:
    t0 = time.perf_counter()
    predictor = _load_predictor(storage_key, task)
    df        = pd.DataFrame([features])

    pred  = predictor.predict(df)
    value = pred.iloc[0] if hasattr(pred, "iloc") else pred[0]
    ms    = round((time.perf_counter() - t0) * 1000, 2)

    result: dict[str, Any] = {
        "prediction":    value.item() if hasattr(value, "item") else value,
        "latency_ms":    ms,
        "probabilities": None,
        "class_label":   None,
        "class_idx":     None,
    }

    if task != "timeseries" and hasattr(predictor, "predict_proba"):
        try:
            proba   = predictor.predict_proba(df)
            classes = list(proba.columns)
            probs   = proba.iloc[0].tolist()
            result["probabilities"] = [
                {"label": str(c), "probability": round(float(p), 4)}
                for c, p in zip(classes, probs)
            ]
            best_idx            = int(np.argmax(probs))
            result["class_idx"]  = best_idx
            result["class_label"] = str(classes[best_idx])
        except Exception:
            pass

    return result


def predict_batch(storage_key: str, task: str, csv_bytes: bytes) -> list[dict]:
    predictor = _load_predictor(storage_key, task)
    df        = pd.read_csv(io.BytesIO(csv_bytes))
    preds     = predictor.predict(df)

    rows = []
    for i, pred in enumerate(preds):
        row: dict[str, Any] = {
            "row":        i + 1,
            "prediction": pred.item() if hasattr(pred, "item") else pred,
            "probability": None,
            "features":   df.iloc[i].to_dict(),
        }
        if task != "timeseries" and hasattr(predictor, "predict_proba"):
            try:
                prob = predictor.predict_proba(df.iloc[[i]])
                row["probability"] = round(float(prob.max(axis=1).iloc[0]), 4)
            except Exception:
                pass
        rows.append(row)

    return rows
