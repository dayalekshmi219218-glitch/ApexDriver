"""Local storage for slice 2: SQLite for rows, the filesystem for uploaded files.

Everything is scoped by user_id. Slice 3 swaps this for Supabase (Postgres + Storage) behind the same methods.
Deleting a vehicle cascades to its scans and files, like the planned foreign keys.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, model_year INTEGER,
  created_at TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL,
  file_name TEXT NOT NULL, file_path TEXT, error TEXT, created_at TEXT NOT NULL, result_json TEXT
);
CREATE INDEX IF NOT EXISTS scans_user ON scans(user_id);
CREATE INDEX IF NOT EXISTS scans_vehicle ON scans(vehicle_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.upload_dir = self.data_dir / "uploads"
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "apexdriver.db"
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        c = sqlite3.connect(self.db_path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    # ---- vehicles ----
    @staticmethod
    def _vehicle(r: sqlite3.Row) -> dict[str, Any]:
        return {"id": r["id"], "name": r["name"], "modelYear": r["model_year"], "createdAt": r["created_at"],
                "synthetic": bool(r["synthetic"])}

    def list_vehicles(self, user_id: str) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM vehicles WHERE user_id=? ORDER BY created_at DESC", (user_id,)).fetchall()
        return [self._vehicle(r) for r in rows]

    def get_vehicle(self, user_id: str, vid: str) -> Optional[dict]:
        with self._conn() as c:
            r = c.execute("SELECT * FROM vehicles WHERE id=? AND user_id=?", (vid, user_id)).fetchone()
        return self._vehicle(r) if r else None

    def create_vehicle(self, user_id: str, name: str, model_year: Optional[int], synthetic: bool = False,
                       vid: Optional[str] = None) -> dict:
        vid = vid or new_id("veh")
        with self._conn() as c:
            c.execute("INSERT INTO vehicles VALUES (?,?,?,?,?,?)", (vid, user_id, name, model_year, now_iso(), int(synthetic)))
        return self.get_vehicle(user_id, vid)  # type: ignore[return-value]

    def update_vehicle(self, user_id: str, vid: str, name: str, model_year: Optional[int]) -> Optional[dict]:
        with self._conn() as c:
            n = c.execute("UPDATE vehicles SET name=?, model_year=? WHERE id=? AND user_id=?", (name, model_year, vid, user_id)).rowcount
        return self.get_vehicle(user_id, vid) if n else None

    def delete_vehicle(self, user_id: str, vid: str) -> bool:
        if not self.get_vehicle(user_id, vid):
            return False
        with self._conn() as c:
            paths = [r["file_path"] for r in c.execute("SELECT file_path FROM scans WHERE vehicle_id=? AND user_id=?", (vid, user_id))]
            c.execute("DELETE FROM scans WHERE vehicle_id=? AND user_id=?", (vid, user_id))
            c.execute("DELETE FROM vehicles WHERE id=? AND user_id=?", (vid, user_id))
        self._remove_files(paths)
        return True

    # ---- scans ----
    def create_scan(self, user_id: str, vehicle_id: str, file_name: str, data: Optional[bytes]) -> str:
        sid = new_id("scn")
        path = None
        if data is not None:
            p = self.upload_dir / f"{sid}.csv"
            p.write_bytes(data)
            path = str(p)
        with self._conn() as c:
            c.execute("INSERT INTO scans (id, vehicle_id, user_id, status, file_name, file_path, created_at) VALUES (?,?,?,?,?,?,?)",
                      (sid, vehicle_id, user_id, "processing" if data is not None else "ready", file_name, path, now_iso()))
        return sid

    def read_file(self, scan_id: str) -> Optional[bytes]:
        with self._conn() as c:
            r = c.execute("SELECT file_path FROM scans WHERE id=?", (scan_id,)).fetchone()
        return Path(r["file_path"]).read_bytes() if r and r["file_path"] and Path(r["file_path"]).exists() else None

    def set_ready(self, scan_id: str, result: dict) -> None:
        with self._conn() as c:
            c.execute("UPDATE scans SET status='ready', error=NULL, result_json=? WHERE id=?", (json.dumps(result), scan_id))

    def set_failed(self, scan_id: str, message: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE scans SET status='failed', error=? WHERE id=?", (message, scan_id))

    def get_scan_row(self, user_id: str, sid: str) -> Optional[sqlite3.Row]:
        with self._conn() as c:
            return c.execute("SELECT * FROM scans WHERE id=? AND user_id=?", (sid, user_id)).fetchone()

    def list_scan_rows(self, user_id: str, vehicle_id: Optional[str] = None) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM scans WHERE user_id=?", [user_id]
        if vehicle_id:
            q += " AND vehicle_id=?"
            args.append(vehicle_id)
        with self._conn() as c:
            return c.execute(q + " ORDER BY created_at", args).fetchall()

    def delete_scan(self, user_id: str, sid: str) -> bool:
        r = self.get_scan_row(user_id, sid)
        if not r:
            return False
        with self._conn() as c:
            c.execute("DELETE FROM scans WHERE id=? AND user_id=?", (sid, user_id))
        self._remove_files([r["file_path"]])
        return True

    def delete_all(self, user_id: str) -> None:
        with self._conn() as c:
            paths = [r["file_path"] for r in c.execute("SELECT file_path FROM scans WHERE user_id=?", (user_id,))]
            c.execute("DELETE FROM scans WHERE user_id=?", (user_id,))
            c.execute("DELETE FROM vehicles WHERE user_id=?", (user_id,))
        self._remove_files(paths)

    @staticmethod
    def _remove_files(paths: list[Optional[str]]) -> None:
        for p in paths:
            if p:
                Path(p).unlink(missing_ok=True)
