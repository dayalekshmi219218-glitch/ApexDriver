from __future__ import annotations

import json
import re
from datetime import date
from typing import Annotated, Any, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .adapters import FileTooLarge, ParseError, check_upload
from .service import SERIES_KEYS, import_canonical, process_scan
from .settings import Settings
from .store import Store

VERSION = "0.2.0"
_USER_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
MAX_YEAR = date.today().year + 1


class VehicleIn(BaseModel):
    name: str
    modelYear: Optional[int] = None
    synthetic: bool = False          # display flag only: lets the UI label demo vehicles

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Give the vehicle a name.")
        if len(v) > 40:
            raise ValueError("Keep the name under 40 characters.")
        return v

    @field_validator("modelYear")
    @classmethod
    def _year(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1980 <= v <= MAX_YEAR):
            raise ValueError(f"Model year must be between 1980 and {MAX_YEAR}, or left empty.")
        return v

class CanonicalImport(BaseModel):
    vehicleId: str
    series: dict[str, list[Optional[float]]]
    startedAt: Optional[str] = None
    durationMin: Optional[int] = Field(default=None, ge=1, le=24 * 60)
    source: str = "Canonical import"
    fileName: str = "canonical-import.json"
    simulated: bool = False

    @field_validator("series")
    @classmethod
    def _series(cls, v: dict[str, list[Optional[float]]]) -> dict[str, list[Optional[float]]]:
        if not v:
            raise ValueError("series must contain at least one signal.")
        unknown = sorted(set(v) - set(SERIES_KEYS))
        if unknown:
            raise ValueError(f"Unknown signals: {', '.join(unknown)}.")
        lengths = {len(x) for x in v.values()}
        if len(lengths) != 1 or not (1 <= next(iter(lengths)) <= 200_000):
            raise ValueError("All signals must have the same length, between 1 and 200000 samples.")
        return v

def current_user(request: Request, x_dev_user: Annotated[Optional[str], Header()] = None) -> str:
    """DEV ONLY (slice 2): the caller names itself in X-Dev-User. Slice 3 replaces this with Supabase token verification."""
    if not request.app.state.settings.dev_auth:
        raise HTTPException(501, "Authentication is not configured.")
    uid = x_dev_user or "dev-user"
    if not _USER_RE.match(uid):
        raise HTTPException(400, "Invalid X-Dev-User header.")
    return uid

User = Annotated[str, Depends(current_user)]

def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    store = Store(settings.data_dir, database_url=settings.supabase_db_url or None)
    app = FastAPI(title="ApexDriver API", version=VERSION)
    app.state.store, app.state.settings = store, settings
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])

    def vehicle_or_404(user: str, vid: str) -> dict:
        v = store.get_vehicle(user, vid)
        if not v:
            raise HTTPException(404, "Vehicle not found.")
        return v

    def scan_json(row: Any) -> dict:
        if row["status"] == "ready" and row["result_json"]:
            return {**json.loads(row["result_json"]), "status": "ready"}
        return {"id": row["id"], "vehicleId": row["vehicle_id"], "fileName": row["file_name"], "status": row["status"],"error": row["error"]}            
    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": VERSION}

    # ---- vehicles (move to Supabase + row-level security in slice 3) ----
    @app.get("/vehicles")
    def list_vehicles(user: User) -> list[dict]:
        return store.list_vehicles(user)

    @app.post("/vehicles", status_code=201)
    def create_vehicle(body: VehicleIn, user: User) -> dict:
        return store.create_vehicle(user, body.name, body.modelYear, body.synthetic)

    @app.patch("/vehicles/{vid}")
    def update_vehicle(vid: str, body: VehicleIn, user: User) -> dict:
        v = store.update_vehicle(user, vid, body.name, body.modelYear)
        if not v:
            raise HTTPException(404, "Vehicle not found.")
        return v

    @app.delete("/vehicles/{vid}", status_code=204)
    def delete_vehicle(vid: str, user: User) -> Response:
        if not store.delete_vehicle(user, vid):       # cascades to scans and their files
            raise HTTPException(404, "Vehicle not found.")
        return Response(status_code=204)

    # ---- scans ----
    @app.post("/scans", status_code=202)
    async def upload_scan(background: BackgroundTasks, user: User, vehicle_id: Annotated[str, Form()],
                          file: Annotated[UploadFile, File()]) -> dict:
        vehicle_or_404(user, vehicle_id)
        data = await file.read(settings.max_upload_bytes + 1)
        name = file.filename or "upload.csv"
        try:
            check_upload(data, name, settings.max_upload_bytes)
        except FileTooLarge as e:
            raise HTTPException(413, str(e)) from e
        except ParseError as e:
            raise HTTPException(422, str(e)) from e
        sid = store.create_scan(user, vehicle_id, name, data)
        background.add_task(process_scan, store, user, sid)
        return {"id": sid, "vehicleId": vehicle_id, "status": "processing"}

    @app.post("/scans/import", status_code=201)
    def import_scan(body: CanonicalImport, user: User) -> dict:
        vehicle_or_404(user, body.vehicleId)
        return {**import_canonical(store, user, body.vehicleId, body.series, started_at=body.startedAt,
                                   duration_min=body.durationMin, source=body.source, file_name=body.fileName,
                                   simulated=body.simulated), "status": "ready"}

    @app.get("/scans")
    def list_scans(user: User, vehicle_id: Optional[str] = None) -> list[dict]:
        return [scan_json(r) for r in store.list_scan_rows(user, vehicle_id) if r["status"] == "ready"]

    @app.get("/scans/{sid}")
    def get_scan(sid: str, user: User) -> dict:
        row = store.get_scan_row(user, sid)
        if not row:
            raise HTTPException(404, "Scan not found.")
        return scan_json(row)

    @app.delete("/scans/{sid}", status_code=204)
    def delete_scan(sid: str, user: User) -> Response:
        if not store.delete_scan(user, sid):
            raise HTTPException(404, "Scan not found.")
        return Response(status_code=204)

    # ---- the signed-in user's own data ----
    @app.get("/me/export")
    def export_me(user: User) -> dict:
        return {"vehicles": store.list_vehicles(user), "scans": [scan_json(r) for r in store.list_scan_rows(user)]}

    @app.delete("/me/data", status_code=204)
    def delete_me(user: User) -> Response:
        store.delete_all(user)
        return Response(status_code=204)

    return app

