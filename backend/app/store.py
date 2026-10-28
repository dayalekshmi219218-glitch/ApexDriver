from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

import psycopg2
import psycopg2.extras

SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  model_year INTEGER,
  created_at TEXT NOT NULL,
  synthetic BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_data BYTEA,
  error TEXT,
  created_at TEXT NOT NULL,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS scans_user ON scans(user_id);
CREATE INDEX IF NOT EXISTS scans_vehicle ON scans(vehicle_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, data_dir: Path, database_url: Optional[str] = None):
        # `data_dir` is kept in the signature so main.py doesn't have to change, but
        # it is no longer used for storage. `database_url` overrides it entirely.
        self.data_dir = Path(data_dir)
        self.database_url = database_url
        if not self.database_url:
            raise RuntimeError(
                "SUPABASE_DB_URL is not set. Add it to the backend environment (Render env vars "
                "or .env) with the Session pooler connection string from Supabase."
            )
        with self._conn() as c, c.cursor() as cur:
            cur.execute(SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[psycopg2.extensions.connection]:
        conn = psycopg2.connect(self.database_url, sslmode="require")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _dictcur(c: psycopg2.extensions.connection) -> psycopg2.extras.RealDictCursor:
        return c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ---- vehicles ----
    @staticmethod
    def _vehicle(r: Any) -> dict[str, Any]:
        return {
            "id": r["id"],
            "name": r["name"],
            "modelYear": r["model_year"],
            "createdAt": r["created_at"],
            "synthetic": bool(r["synthetic"]),
        }

    def list_vehicles(self, user_id: str) -> list[dict]:
        with self._conn() as c, self._dictcur(c) as cur:
            cur.execute(
                "SELECT * FROM vehicles WHERE user_id=%s ORDER BY created_at DESC",
                (user_id,),
            )
            rows = cur.fetchall()
        return [self._vehicle(r) for r in rows]

    def get_vehicle(self, user_id: str, vid: str) -> Optional[dict]:
        with self._conn() as c, self._dictcur(c) as cur:
            cur.execute("SELECT * FROM vehicles WHERE id=%s AND user_id=%s", (vid, user_id))
            r = cur.fetchone()
        return self._vehicle(r) if r else None

    def create_vehicle(self, user_id: str, name: str, model_year: Optional[int],
                       synthetic: bool = False, vid: Optional[str] = None) -> dict:
        vid = vid or new_id("veh")
        with self._conn() as c, c.cursor() as cur:
            cur.execute(
                "INSERT INTO vehicles (id, user_id, name, model_year, created_at, synthetic) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (vid, user_id, name, model_year, now_iso(), synthetic),
            )
        return self.get_vehicle(user_id, vid)  # type: ignore[return-value]

    def update_vehicle(self, user_id: str, vid: str, name: str,
                       model_year: Optional[int]) -> Optional[dict]:
        with self._conn() as c, c.cursor() as cur:
            cur.execute(
                "UPDATE vehicles SET name=%s, model_year=%s WHERE id=%s AND user_id=%s",
                (name, model_year, vid, user_id),
            )
            changed = cur.rowcount
        return self.get_vehicle(user_id, vid) if changed else None

    def delete_vehicle(self, user_id: str, vid: str) -> bool:
        if not self.get_vehicle(user_id, vid):
            return False
        with self._conn() as c, c.cursor() as cur:
            cur.execute("DELETE FROM scans WHERE vehicle_id=%s AND user_id=%s", (vid, user_id))
            cur.execute("DELETE FROM vehicles WHERE id=%s AND user_id=%s", (vid, user_id))
        return True

    # ---- scans ----
    def create_scan(self, user_id: str, vehicle_id: str, file_name: str,
                    data: Optional[bytes]) -> str:
        sid = new_id("scn")
        with self._conn() as c, c.cursor() as cur:
            cur.execute(
                "INSERT INTO scans (id, vehicle_id, user_id, status, file_name, file_data, created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (sid, vehicle_id, user_id, "processing" if data is not None else "ready",
                 file_name, psycopg2.Binary(data) if data is not None else None, now_iso()),
            )
        return sid

    def read_file(self, scan_id: str) -> Optional[bytes]:
        with self._conn() as c, self._dictcur(c) as cur:
            cur.execute("SELECT file_data FROM scans WHERE id=%s", (scan_id,))
            r = cur.fetchone()
        if not r or r["file_data"] is None:
            return None
        return bytes(r["file_data"])

    def set_ready(self, scan_id: str, result: dict) -> None:
        with self._conn() as c, c.cursor() as cur:
            cur.execute(
                "UPDATE scans SET status='ready', error=NULL, result_json=%s WHERE id=%s",
                (json.dumps(result), scan_id),
            )

    def set_failed(self, scan_id: str, message: str) -> None:
        with self._conn() as c, c.cursor() as cur:
            cur.execute("UPDATE scans SET status='failed', error=%s WHERE id=%s", (message, scan_id))

    def get_scan_row(self, user_id: str, sid: str) -> Optional[Any]:
        with self._conn() as c, self._dictcur(c) as cur:
            cur.execute("SELECT * FROM scans WHERE id=%s AND user_id=%s", (sid, user_id))
            return cur.fetchone()

    def list_scan_rows(self, user_id: str, vehicle_id: Optional[str] = None) -> list[Any]:
        q = "SELECT * FROM scans WHERE user_id=%s"
        args: list[Any] = [user_id]
        if vehicle_id:
            q += " AND vehicle_id=%s"
            args.append(vehicle_id)
        with self._conn() as c, self._dictcur(c) as cur:
            cur.execute(q + " ORDER BY created_at", args)
            return cur.fetchall()

    def delete_scan(self, user_id: str, sid: str) -> bool:
        r = self.get_scan_row(user_id, sid)
        if not r:
            return False
        with self._conn() as c, c.cursor() as cur:
            cur.execute("DELETE FROM scans WHERE id=%s AND user_id=%s", (sid, user_id))
        return True

    def delete_all(self, user_id: str) -> None:
        with self._conn() as c, c.cursor() as cur:
            cur.execute("DELETE FROM scans WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM vehicles WHERE user_id=%s", (user_id,))