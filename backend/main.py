"""
VoltHaven — FastAPI Backend
EV Infrastructure Planning API with MongoDB (graceful in-memory fallback)
"""

from __future__ import annotations

import math
import copy
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("volthaven")

# ─────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────
app = FastAPI(
    title="VoltHaven API",
    description="New Haven EV Infrastructure Planning Backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────
# Seed Data
# ─────────────────────────────────────────────────────────
SEED_STATIONS = [
    {"id": "P-01", "lat": 41.2810, "lng": -72.9220, "location": "Long Wharf",        "type": "DC Fast", "type_cat": "dcfast",  "priority": "Commuter", "load": 150, "score": 94, "fast": 4, "l2": 8,  "note": "Commuter Priority",    "low_cap": False, "status": "existing"},
    {"id": "P-02", "lat": 41.3085, "lng": -72.9285, "location": "Yale Science Hill", "type": "Level-2", "type_cat": "level2",  "priority": "Resident", "load": 48,  "score": 78, "fast": 0, "l2": 12, "note": "Resident Overnight",   "low_cap": True,  "status": "proposed"},
    {"id": "P-03", "lat": 41.2985, "lng": -72.9265, "location": "Union Station",     "type": "DC Fast", "type_cat": "dcfast",  "priority": "Transit",  "load": 200, "score": 91, "fast": 6, "l2": 4,  "note": "Transit Hub Anchor",   "low_cap": False, "status": "existing"},
    {"id": "P-04", "lat": 41.3050, "lng": -72.9360, "location": "Broadway District", "type": "Level-2", "type_cat": "level2",  "priority": "Retail",   "load": 36,  "score": 65, "fast": 0, "l2": 6,  "note": "Retail District",      "low_cap": False, "status": "proposed"},
    {"id": "P-05", "lat": 41.2930, "lng": -72.9020, "location": "Fair Haven",        "type": "DC Fast", "type_cat": "dcfast",  "priority": "Delivery", "load": 180, "score": 87, "fast": 4, "l2": 6,  "note": "Delivery Fleet Depot", "low_cap": False, "status": "existing"},
    {"id": "P-06", "lat": 41.3140, "lng": -72.9230, "location": "Prospect Hill",     "type": "Level-2", "type_cat": "level2",  "priority": "Resident", "load": 42,  "score": 72, "fast": 0, "l2": 8,  "note": "Residential Cluster",  "low_cap": False, "status": "proposed"},
    {"id": "P-07", "lat": 41.2870, "lng": -72.9340, "location": "City Point",        "type": "DC Fast", "type_cat": "dcfast",  "priority": "Commuter", "load": 120, "score": 83, "fast": 3, "l2": 4,  "note": "Commuter Corridor",    "low_cap": False, "status": "proposed"},
    {"id": "P-08", "lat": 41.3010, "lng": -72.9160, "location": "Wooster Square",    "type": "Level-2", "type_cat": "level2",  "priority": "Resident", "load": 38,  "score": 68, "fast": 0, "l2": 6,  "note": "Residential Infill",   "low_cap": False, "status": "proposed"},
]

# ─────────────────────────────────────────────────────────
# Demand Profiles (24-hour kW curves at 38% baseline)
# ─────────────────────────────────────────────────────────
DEMAND_PROFILES: dict[str, dict[str, list[int]]] = {
    "peak": {
        "balanced":  [80,70,60,55,50,55,90,180,220,200,170,160,155,160,180,220,280,350,380,340,280,200,140,100],
        "commuter":  [60,50,45,40,38,50,110,240,280,230,180,150,140,150,200,260,340,420,440,380,300,210,140,90],
        "delivery":  [90,85,80,75,70,100,200,260,240,210,190,180,170,160,150,170,220,280,300,260,220,160,120,95],
    },
    "morning": {
        "balanced":  [75,65,55,50,48,60,120,250,290,240,190,170,160,155,165,200,250,310,330,290,240,180,130,90],
        "commuter":  [55,48,42,38,35,55,140,300,360,280,200,170,155,150,170,220,290,350,370,310,250,185,130,80],
        "delivery":  [85,80,75,70,68,110,220,280,260,230,200,185,175,165,155,175,230,290,310,270,230,165,125,90],
    },
    "offpeak": {
        "balanced":  [85,75,65,60,55,50,60,120,170,160,140,130,125,130,145,170,210,260,280,250,210,160,120,95],
        "commuter":  [65,55,48,42,38,40,70,160,210,180,150,130,120,125,150,190,250,320,340,300,250,180,130,85],
        "delivery":  [95,88,82,78,72,80,140,200,200,185,170,160,155,150,140,155,190,240,260,230,200,155,118,98],
    },
}

GRID_LIMIT = 300  # kW — Substation A capacity

# ─────────────────────────────────────────────────────────
# Database Layer — MongoDB with in-memory fallback
# ─────────────────────────────────────────────────────────
db_collection = None  # Will be set to MongoDB collection or None
_memory_store: list[dict] = []  # In-memory fallback


def _init_db() -> None:
    """Attempt MongoDB connection; fall back to in-memory store silently."""
    global db_collection, _memory_store

    try:
        from pymongo import MongoClient
        from pymongo.errors import ServerSelectionTimeoutError

        client = MongoClient(
            "mongodb://localhost:27017",
            serverSelectionTimeoutMS=2000,
        )
        # Force a connection check
        client.admin.command("ping")

        db = client["volthaven"]
        db_collection = db["stations"]

        # Seed if collection is empty
        if db_collection.count_documents({}) == 0:
            db_collection.insert_many(copy.deepcopy(SEED_STATIONS))
            logger.info("MongoDB connected — seeded %d stations", len(SEED_STATIONS))
        else:
            logger.info("MongoDB connected — %d stations found", db_collection.count_documents({}))

    except Exception as exc:
        db_collection = None
        _memory_store = copy.deepcopy(SEED_STATIONS)
        logger.warning("MongoDB unavailable (%s). Using in-memory fallback with %d seeded stations.", exc, len(_memory_store))


def get_all_stations() -> list[dict]:
    if db_collection is not None:
        return list(db_collection.find({}, {"_id": 0}))
    return copy.deepcopy(_memory_store)


def get_station(station_id: str) -> Optional[dict]:
    if db_collection is not None:
        return db_collection.find_one({"id": station_id}, {"_id": 0})
    return next((s for s in _memory_store if s["id"] == station_id), None)


def add_station(data: dict) -> dict:
    if db_collection is not None:
        db_collection.insert_one(copy.deepcopy(data))
    else:
        _memory_store.append(copy.deepcopy(data))
    return data


def delete_station(station_id: str) -> bool:
    if db_collection is not None:
        result = db_collection.delete_one({"id": station_id})
        return result.deleted_count > 0
    global _memory_store
    before = len(_memory_store)
    _memory_store = [s for s in _memory_store if s["id"] != station_id]
    return len(_memory_store) < before


# ─────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────
class StationCreate(BaseModel):
    id: str = Field(..., min_length=1, examples=["P-09"])
    location: str = Field(..., min_length=1, examples=["East Rock"])
    type: str = Field(..., examples=["DC Fast"])
    type_cat: str = Field(default="dcfast", examples=["dcfast", "level2"])
    priority: str = Field(..., examples=["Commuter"])
    load: int = Field(..., ge=0, examples=[150])
    lat: float = Field(..., examples=[41.3200])
    lng: float = Field(..., examples=[-72.9100])
    score: int = Field(default=50, ge=0, le=100)
    fast: int = Field(default=0, ge=0)
    l2: int = Field(default=0, ge=0)
    note: str = Field(default="")
    low_cap: bool = Field(default=False)
    status: str = Field(default="proposed", examples=["existing", "proposed"])


class SimulationRequest(BaseModel):
    adoption_rate: int = Field(..., ge=0, le=100, examples=[38])
    user_priority: str = Field(default="balanced", examples=["balanced", "commuter", "delivery"])
    time_profile: str = Field(default="peak", examples=["peak", "morning", "offpeak"])


class KPIMetrics(BaseModel):
    total_stations: int
    daily_energy_mwh: float
    avg_grid_headroom_pct: int
    co2_reduced_tons: int


class SimulationResponse(BaseModel):
    hourly_curve: list[int]
    grid_limit: int
    peak_load: int
    grid_risk: str
    kpi_metrics: KPIMetrics


# ─────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    _init_db()


# ─────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────

@app.get("/api/stations", response_model=list[dict])
def list_stations():
    """Return all stations."""
    return get_all_stations()


@app.post("/api/stations", response_model=dict, status_code=201)
def create_station(station: StationCreate):
    """Add a new station."""
    if get_station(station.id):
        raise HTTPException(status_code=409, detail=f"Station '{station.id}' already exists.")
    data = station.model_dump()
    add_station(data)
    return data


@app.delete("/api/stations/{station_id}")
def remove_station(station_id: str):
    """Delete a station by ID."""
    if not delete_station(station_id):
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' not found.")
    return {"detail": f"Station '{station_id}' deleted."}


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate(req: SimulationRequest):
    """
    Run demand simulation.
    Scales the baseline 24-hour profile by (adoption_rate / 38.0) and
    computes grid risk, KPIs, and the hourly power curve.
    """
    time_key = req.time_profile if req.time_profile in DEMAND_PROFILES else "peak"
    priority_key = req.user_priority if req.user_priority in DEMAND_PROFILES[time_key] else "balanced"
    base_curve = DEMAND_PROFILES[time_key][priority_key]

    scale = req.adoption_rate / 38.0 if req.adoption_rate > 0 else 0.01
    hourly_curve = [round(v * scale) for v in base_curve]

    peak_load = max(hourly_curve)

    if peak_load > GRID_LIMIT:
        grid_risk = "HIGH"
    elif peak_load > GRID_LIMIT * 0.8:
        grid_risk = "MODERATE"
    else:
        grid_risk = "LOW"

    kpi = KPIMetrics(
        total_stations=round(35 * max(scale, 0.4)),
        daily_energy_mwh=round(42.5 * scale, 1),
        avg_grid_headroom_pct=max(5, round(22 / scale)),
        co2_reduced_tons=round(1200 * scale),
    )

    return SimulationResponse(
        hourly_curve=hourly_curve,
        grid_limit=GRID_LIMIT,
        peak_load=peak_load,
        grid_risk=grid_risk,
        kpi_metrics=kpi,
    )


# ─────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "db": "mongodb" if db_collection is not None else "in-memory",
    }
