"""Time-series forecasting service."""
from __future__ import annotations

import warnings
from typing import Any

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")


def forecast_from_df(
    df: pd.DataFrame,
    date_col: str,
    value_col: str,
    horizon: int = 20,
    freq: str = "D",
) -> dict[str, Any]:
    """
    Run forecasting and return history + predictions with confidence intervals.
    Tries Prophet first, then ETS, then linear extrapolation.
    """
    df = df[[date_col, value_col]].dropna().copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col]).sort_values(date_col).reset_index(drop=True)

    if len(df) < 4:
        raise ValueError("Need at least 4 data points for forecasting")

    history = [
        {"t": str(row[date_col])[:10], "val": round(float(row[value_col]), 4)}
        for _, row in df.tail(60).iterrows()
    ]

    try:
        return _prophet_forecast(df, date_col, value_col, horizon, freq, history)
    except Exception:
        pass

    try:
        return _ets_forecast(df, date_col, value_col, horizon, freq, history)
    except Exception:
        pass

    return _linear_forecast(df, value_col, horizon, history)


def _prophet_forecast(df, date_col, value_col, horizon, freq, history):
    from prophet import Prophet
    pdf = df.rename(columns={date_col: "ds", value_col: "y"})[["ds", "y"]]
    m   = Prophet(interval_width=0.9, daily_seasonality="auto", weekly_seasonality="auto")
    m.fit(pdf)
    future   = m.make_future_dataframe(periods=horizon, freq=freq)
    forecast = m.predict(future).tail(horizon)
    return {
        "history": history,
        "forecast": [
            {
                "t":    str(r.ds)[:10],
                "mean": round(float(r.yhat), 4),
                "lo":   round(float(r.yhat_lower), 4),
                "hi":   round(float(r.yhat_upper), 4),
            }
            for _, r in forecast.iterrows()
        ],
    }


def _ets_forecast(df, date_col, value_col, horizon, freq, history):
    from statsmodels.tsa.exponential_smoothing.ets import ETSModel
    series = df.set_index(date_col)[value_col].asfreq(freq, method="pad")
    model  = ETSModel(series, trend="add", error="add", seasonal=None)
    fit    = model.fit(disp=False)
    fc     = fit.forecast(horizon)
    ci     = fit.get_prediction(
        start=len(series), end=len(series) + horizon - 1
    ).conf_int(alpha=0.1)

    forecast = []
    for i, (ts, val) in enumerate(fc.items()):
        lo = float(ci.iloc[i, 0]) if len(ci) > i else float(val) - float(np.std(series) * 1.5)
        hi = float(ci.iloc[i, 1]) if len(ci) > i else float(val) + float(np.std(series) * 1.5)
        forecast.append({"t": f"D+{i+1}", "mean": round(float(val), 4),
                         "lo": round(lo, 4), "hi": round(hi, 4)})
    return {"history": history, "forecast": forecast}


def _linear_forecast(df, value_col, horizon, history):
    vals  = df[value_col].values[-60:]
    trend = np.polyfit(np.arange(len(vals)), vals, 1)
    fc    = np.polyval(trend, np.arange(len(vals), len(vals) + horizon))
    std   = float(np.std(vals) * 1.5)
    forecast = [
        {"t": f"D+{i+1}", "mean": round(float(v), 4),
         "lo": round(float(v) - std, 4), "hi": round(float(v) + std, 4)}
        for i, v in enumerate(fc)
    ]
    return {"history": history, "forecast": forecast}
