from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("APEX_DATA_DIR", "./data")))
    max_upload_bytes: int = int(os.environ.get("APEX_MAX_UPLOAD_BYTES", 10 * 1024 * 1024))
    cors_origins: tuple[str, ...] = tuple(
        o.strip() for o in os.environ.get("APEX_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",") if o.strip()
    )
    # Slice 2 only: identify the caller by a header. Slice 3 replaces this with Supabase token verification.
    dev_auth: bool = os.environ.get("APEX_DEV_AUTH", "1") == "1"
