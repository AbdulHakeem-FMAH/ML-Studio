"""Aggregate all v1 routers into a single APIRouter."""
from fastapi import APIRouter

from app.api.v1.datasets    import router as datasets_router
from app.api.v1.database    import router as database_router
from app.api.v1.deployments import router as deployments_router
from app.api.v1.drift       import router as drift_router
from app.api.v1.eda         import router as eda_router
from app.api.v1.forecasting import router as forecasting_router
from app.api.v1.health      import router as health_router
from app.api.v1.models      import router as models_router
from app.api.v1.predictions import router as predictions_router
from app.api.v1.training    import router as training_router

v1_router = APIRouter(prefix="/api/v1")

for _r in (
    datasets_router,
    database_router,
    training_router,
    models_router,
    predictions_router,
    eda_router,
    drift_router,
    forecasting_router,
    deployments_router,
    health_router,
):
    v1_router.include_router(_r)
