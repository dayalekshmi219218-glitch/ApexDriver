"""Turns parsed logs into the JSON the frontend expects (its `Scan` type) and runs the processing step."""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
import pandas as pd

from .adapters import ParseError, parse_log
from .core.schema import ParsedLog, Quality, ScanSummary
from .core.scoring import summarize_scan
from .store import Store

log = logging.getLogger("apexdriver")

SERIES_POINTS = 120
SERIES_KEYS = ["coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c", "throttle_pct", "load_kpa", "ignition_deg", "afr"]
GENERIC_FAILURE = "Something went wrong while analysing this file. Please try again or upload a different file."


def downsample(arr: np.ndarray, n: int = SERIES_POINTS) -> Optional[list[float]]:
    """Fixed-length series for charts: bin means for long logs, linear interpolation for short ones.
    Gaps are filled for display only; the health numbers are computed from the full-resolution series."""
    s = pd.Series(np.asarray(arr, dtype=float))
    if not s.notna().any():
        return None
    s = s.ffill().bfill()
    x = s.to_numpy()
    if len(x) >= n:
        out = np.array([chunk.mean() for chunk in np.array_split(x, n)])
    else:
        out = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return [round(float(v), 2) for v in out]


def build_api_scan(scan_id: str, vehicle_id: str, file_name: str, parsed: ParsedLog, summary: ScanSummary,
                   fallback_started_at: str, simulated: bool = False) -> dict[str, Any]:
    series = {}
    for k in SERIES_KEYS:
        if k in parsed.series:
            d = downsample(parsed.series[k])
            if d is not None:
                series[k] = d
    return {
        "id": scan_id,
        "vehicleId": vehicle_id,
        "startedAt": parsed.started_at.isoformat() if parsed.started_at else fallback_started_at,
        "durationMin": max(1, round(parsed.duration_s / 60)),
        "source": parsed.source,
        "fileName": file_name,
        "simulated": simulated,
        "score": summary.score,
        "severity": summary.severity,
        "scoredSignals": summary.scored_signals,
        "totalSignals": summary.total_signals,
        "states": {"warmup": summary.states.warmup, "idle": summary.states.idle, "driving": summary.states.driving},
        "signals": [
            {"key": s.key, "label": s.label, "unit": s.unit, "available": s.available, "scored": s.scored, "weight": s.weight,
             "min": s.min, "avg": s.avg, "max": s.max, "pctNormal": s.pct_normal, "pctWatch": s.pct_watch,
             "pctAlert": s.pct_alert, "score": s.score, "severity": s.severity}
            for s in summary.signals
        ],
        "series": series,
        "mixture": None if summary.mixture is None else {
            "median": summary.mixture.median, "pctRich": summary.mixture.pct_rich,
            "pctInRange": summary.mixture.pct_in_range, "pctLean": summary.mixture.pct_lean},
        "quality": {
            "rawRows": parsed.quality.raw_rows, "skippedLines": parsed.quality.skipped_lines,
            "coverage": parsed.quality.coverage, "droppedImplausible": parsed.quality.dropped_implausible,
            "missingSignals": parsed.quality.missing_signals, "ignoredChannels": len(parsed.quality.ignored_channels),
        },
        "warnings": parsed.warnings,
    }


def process_scan(store: Store, user_id: str, scan_id: str) -> None:
    """Background step: parse the stored file, score it, save the result or the reason it failed."""
    row = store.get_scan_row(user_id, scan_id)
    if row is None:
        return
    try:
        data = store.read_file(scan_id)
        if data is None:
            raise ParseError("The uploaded file is no longer available.")
        parsed = parse_log(data, row["file_name"])
        summary = summarize_scan(parsed.series)
        store.set_ready(scan_id, build_api_scan(scan_id, row["vehicle_id"], row["file_name"], parsed, summary, row["created_at"]))
    except ParseError as e:
        store.set_failed(scan_id, str(e))
    except Exception:  # noqa: BLE001 - never leave a scan stuck in "processing"
        log.exception("processing failed for scan %s", scan_id)
        store.set_failed(scan_id, GENERIC_FAILURE)


def import_canonical(store: Store, user_id: str, vehicle_id: str, series: dict[str, list[Optional[float]]], *,
                     started_at: Optional[str], duration_min: Optional[int], source: str, file_name: str,
                     simulated: bool) -> dict[str, Any]:
    """Canonical-schema ingestion: the same path a mobile snapshot or another adapter will use."""
    arrays = {k: np.array([math.nan if v is None else float(v) for v in vals], dtype=float) for k, vals in series.items()}
    n = len(next(iter(arrays.values())))
    parsed = ParsedLog(
        source=source, started_at=None, duration_s=int((duration_min or 0) * 60) or n, sample_rate_hz=1, series=arrays,
        quality=Quality(raw_rows=n, coverage={k: float(np.isfinite(a).mean()) for k, a in arrays.items()}),
        warnings=["Imported as canonical series; sample spacing was not provided."],
    )
    summary = summarize_scan(arrays)
    sid = store.create_scan(user_id, vehicle_id, file_name, None)
    fallback = started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = build_api_scan(sid, vehicle_id, file_name, parsed, summary, fallback, simulated)
    store.set_ready(sid, result)
    return result
