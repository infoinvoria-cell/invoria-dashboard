"""FastAPI backend for Invoria Trading Dashboard."""

import os
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend.routes.globe import router as globe_router
from backend.routes.track_record import router as track_record_router

app = FastAPI(
    title="Invoria Trading Dashboard API",
    description="REST API for the React trading dashboard frontend.",
    version="2.0.0",
)

FRONTEND_BASE_URL = str(os.getenv("IVQ_FRONTEND_URL", "http://127.0.0.1:3000")).rstrip("/")
ALLOW_ALL_ORIGINS = str(os.getenv("IVQ_ALLOW_ALL_ORIGINS", "false")).lower() in ["1", "true", "yes"]

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]

if ALLOW_ALL_ORIGINS:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Models
class HealthResponse(BaseModel):
    status: str
    version: str


class DashboardConfig(BaseModel):
    name: str
    description: str
    features: List[str]


@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="healthy",
        version="2.0.0",
    )


@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url=f"{FRONTEND_BASE_URL}/dashboard", status_code=307)


@app.get("/dashboard", include_in_schema=False)
async def dashboard_redirect():
    return RedirectResponse(url=f"{FRONTEND_BASE_URL}/dashboard", status_code=307)


@app.get("/config", response_model=DashboardConfig)
async def get_config():
    return DashboardConfig(
        name="Invoria Trading Dashboard",
        description="Professional trading analysis platform (React + FastAPI)",
        features=[
            "CrossPairs",
            "Globe",
            "WorldMap",
            "DollarIndex",
            "Valuation10",
            "Valuation20",
            "News",
            "USDNews",
            "Seasonality",
            "Heatmap",
            "WeatherSignal",
            "MacroOverlay",
            "OverlayControls",
            "DataSourceSelector",
            "GlobeMotionControls",
        ],
    )


@app.get("/api/engine/status")
async def engine_status():
    """Get engine status"""
    return {
        "status": "ready",
        "modules": ["strategy", "optimizer", "backtest"],
        "last_update": None
    }


@app.get("/api/optimizer/status")
async def optimizer_status():
    """Get optimizer status"""
    return {
        "status": "ready",
        "tasks": 0,
        "last_result": None
    }


@app.get("/api/screener/status")
async def screener_status():
    """Get screener status"""
    return {
        "status": "ready",
        "universes": [],
        "last_scan": None
    }


@app.get("/api/quantlab/status")
async def quantlab_status():
    """Get quantlab status"""
    return {
        "status": "ready",
        "experiments": 0,
        "last_result": None
    }


@app.get("/api/backtest/status")
async def backtest_status():
    """Get backtest status"""
    return {
        "status": "ready",
        "results": 0,
        "last_run": None
    }


app.include_router(globe_router)
app.include_router(track_record_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
