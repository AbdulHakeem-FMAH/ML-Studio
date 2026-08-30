"""Time-series forecasting service."""
from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")


def _get_future_time_labels(dates: pd.Series, horizon: int) -> list[str]:
    """Generate clean future date/time strings based on the detected interval."""
    if len(dates) >= 2:
        step = dates.iloc[-1] - dates.iloc[-2]
        if pd.isna(step) or step.total_seconds() <= 0:
            step = pd.Timedelta(days=1)
    else:
        step = pd.Timedelta(days=1)

    last_date = dates.iloc[-1]
    future_labels = []
    # If step is in full days
    is_daily = step.total_seconds() % 86400 == 0
    for i in range(1, horizon + 1):
        future_dt = last_date + (step * i)
        if is_daily:
            future_labels.append(future_dt.strftime("%Y-%m-%d"))
        else:
            future_labels.append(future_dt.strftime("%Y-%m-%d %H:%M"))
    return future_labels


def forecast_from_df(
    df: pd.DataFrame,
    date_col: str,
    value_col: str,
    horizon: int = 20,
    freq: str = "D",
) -> dict[str, Any]:
    """
    Run forecasting and return history + predictions with confidence intervals.
    Tries Exponential Smoothing first, then ARIMA, then linear extrapolation.
    """
    df = df[[date_col, value_col]].dropna().copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=[date_col, value_col]).sort_values(date_col).reset_index(drop=True)

    if len(df) < 3:
        raise ValueError("Need at least 3 valid data points for time-series forecasting")

    history_dates = df[date_col]
    history = [
        {"t": str(row[date_col])[:10] if pd.api.types.is_datetime64_any_dtype(df[date_col]) else str(row[date_col]), "val": round(float(row[value_col]), 4)}
        for _, row in df.tail(60).iterrows()
    ]

    future_labels = _get_future_time_labels(history_dates, horizon)
    series = df[value_col].astype(float)
    std = float(np.std(series.values) * 1.5) if float(np.std(series.values)) > 0 else 0.5

    # 1. Try ExponentialSmoothing (Holt-Winters)
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        ets = ExponentialSmoothing(series, trend="add", seasonal=None, initialization_method="estimated").fit()
        fc = ets.forecast(horizon)
        forecast = [
            {
                "t": future_labels[i] if i < len(future_labels) else f"D+{i+1}",
                "mean": round(float(val), 4),
                "lo": round(float(val - std), 4),
                "hi": round(float(val + std), 4),
            }
            for i, val in enumerate(fc)
        ]
        return {"history": history, "forecast": forecast}
    except Exception:
        pass

    # 2. Try ARIMA
    try:
        from statsmodels.tsa.arima.model import ARIMA
        order = (1, 1, 0) if len(series) >= 4 else (1, 0, 0)
        arima = ARIMA(series, order=order).fit()
        fc = arima.forecast(horizon)
        forecast = [
            {
                "t": future_labels[i] if i < len(future_labels) else f"D+{i+1}",
                "mean": round(float(val), 4),
                "lo": round(float(val - std), 4),
                "hi": round(float(val + std), 4),
            }
            for i, val in enumerate(fc)
        ]
        return {"history": history, "forecast": forecast}
    except Exception:
        pass

    # 3. Fallback: Linear Trend Extrapolation
    vals = series.values[-60:]
    x = np.arange(len(vals))
    poly = np.polyfit(x, vals, 1)
    fc = np.polyval(poly, np.arange(len(vals), len(vals) + horizon))
    forecast = [
        {
            "t": future_labels[i] if i < len(future_labels) else f"D+{i+1}",
            "mean": round(float(v), 4),
            "lo": round(float(v - std), 4),
            "hi": round(float(v + std), 4),
        }
        for i, v in enumerate(fc)
    ]
    return {"history": history, "forecast": forecast}
