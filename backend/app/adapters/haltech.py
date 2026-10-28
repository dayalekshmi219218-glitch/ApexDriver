"""Adapter for aftermarket-ECU datalogs exported by "ECU Manager" (Haltech) as CSV.

File shape (seen in the Kaggle "Car ECU Datalogs" files):
  header : '%DataLog%', software lines, then one 3-line block per channel (Channel / Type / DisplayMaxMin)
  marker : 'Log : YYYYMMDD HH:MM:SS'
  rows   : 'HH:MM:SS.mmm,v1,v2,...'  event-driven: a cell is filled only when that channel changed
Channels differ between files (the three header variants seen have 19, 26 and 28 channels, in different
orders), so columns are mapped BY NAME, never by position.

Unit conversions below are inferred from channel types, display ranges and sanity checks; the dataset page
does not list units. They live in PROFILE so they can be corrected in one place.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Union

import numpy as np
import pandas as pd

from ..core.config import SIGNALS
from ..core.schema import ParsedLog, Quality
from .base import ParseError

NAME = "Haltech ECU datalog"
PROFILE_VERSION = "haltech_ecu_v1"


@dataclass(frozen=True)
class Conv:
    key: str          # canonical signal key
    scale: float
    offset: float
    lo: float         # physically plausible range, values outside are dropped
    hi: float
    status: str       # 'verified' | 'inferred'


PROFILE: dict[str, Conv] = {
    "CoolantTemp":     Conv("coolant_temp_c", 0.1, -273.15, -40, 150, "inferred"),     # deci-Kelvin
    "AirTemp":         Conv("intake_air_temp_c", 0.1, -273.15, -40, 150, "inferred"),   # deci-Kelvin
    "BatteryVoltage":  Conv("battery_v", 0.001, 0.0, 0, 20, "inferred"),               # millivolts
    "RPM":             Conv("rpm", 1.0, 0.0, 0, 12000, "inferred"),
    "ThrottlePosition": Conv("throttle_pct", 0.1, 0.0, 0, 100, "inferred"),
    "Load":            Conv("load_kpa", 0.1, 0.0, 0, 300, "inferred"),                 # manifold pressure
    "IgnitionTiming":  Conv("ignition_deg", 0.1, 0.0, -60, 90, "inferred"),
    "LambdaSensor1":   Conv("afr", 0.01, 0.0, 5, 25, "inferred"),                      # wideband AFR; fuel type unverified
    "TargetAFR":       Conv("afr_target", 0.01, 0.0, 5, 25, "inferred"),
}
EXPECTED_SIGNALS = ["coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c", "throttle_pct", "load_kpa",
                    "ignition_deg", "afr"]

_TIME_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$")
_LOG_RE = re.compile(r"^Log\s*:\s*(\d{8})\s+(\d{2}:\d{2}:\d{2})")


def sniff(head: str) -> bool:
    return "%DataLog%" in head[:2000] and "Channel :" in head


def parse(data: Union[bytes, str]) -> ParsedLog:
    text = data.decode("latin-1") if isinstance(data, (bytes, bytearray)) else data
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    channels: list[str] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("Channel :"):
            channels.append(ln.split(":", 1)[1].strip())
        elif ln.startswith(("Type :", "DisplayMaxMin :")) or not channels:
            pass
        else:
            break
        i += 1
    if not channels:
        raise ParseError("This does not look like an ECU datalog: no channel definitions were found.")

    conv_present = {c: PROFILE[c] for c in channels if c in PROFILE}
    if not any(c.key in EXPECTED_SIGNALS for c in conv_present.values()):
        raise ParseError("None of the engine channels we analyse (RPM, coolant, battery, ...) are in this file.")

    warnings: list[str] = []
    started_at: Optional[datetime] = None
    rows: list[str] = []
    markers = 0
    for ln in lines[i:]:
        if not ln.strip():
            continue
        m = _LOG_RE.match(ln)
        if m:
            markers += 1
            if markers == 1:
                started_at = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y%m%d %H:%M:%S")
                continue
            warnings.append("The file contains more than one logging session; only the first was analysed.")
            break
        if ln.startswith("Log"):
            continue
        rows.append(ln)
    if markers == 0:
        warnings.append("No 'Log :' marker found, so the start date and time are unknown.")
    if not rows:
        raise ParseError("The file has channel definitions but no data rows.")

    names = ["t"] + channels
    df = pd.read_csv(io.StringIO("\n".join(rows)), header=None, names=names, dtype={"t": str},
                     on_bad_lines="skip", engine="c")
    skipped = len(rows) - len(df)

    parts = df["t"].str.extract(_TIME_RE).astype(float)
    ok = parts.notna().all(axis=1) & (parts[0] < 24) & (parts[1] < 60) & (parts[2] < 60)   # real clock times only
    skipped += int((~ok).sum())
    df, parts = df[ok], parts[ok]
    if df.empty:
        raise ParseError("No readable data rows were found in this file.")
    secs = (parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000.0).to_numpy()
    secs = secs + 86400.0 * np.cumsum(np.diff(secs, prepend=secs[0]) < -43200)      # midnight rollover
    keep = secs >= np.maximum.accumulate(secs)                                      # drop rows that go back in time
    skipped += int((~keep).sum())
    df, secs = df[keep], secs[keep]

    quality = Quality(raw_rows=len(df), skipped_lines=skipped)
    quality.ignored_channels = [c for c in channels if c not in PROFILE]

    sec_idx = np.floor(secs - secs[0]).astype(int)
    canon = pd.DataFrame(index=range(len(df)))
    for ch, cv in conv_present.items():
        raw = pd.to_numeric(df[ch], errors="coerce").to_numpy(dtype=float)
        val = raw * cv.scale + cv.offset
        bad = np.isfinite(val) & ((val < cv.lo) | (val > cv.hi))
        if bad.any():
            quality.dropped_implausible[cv.key] = int(bad.sum())
            val[bad] = np.nan
        canon[cv.key] = val
    canon.index = sec_idx
    n_sec = int(sec_idx.max()) + 1
    per_sec = canon.groupby(level=0).last()                       # last non-null reading in each second
    per_sec = per_sec.reindex(range(n_sec)).ffill()               # hold the last value; never back-fill

    series: dict[str, np.ndarray] = {k: per_sec[k].to_numpy(dtype=float) for k in per_sec.columns}
    for k, arr in series.items():
        quality.coverage[k] = float(np.isfinite(arr).mean())
    quality.missing_signals = [k for k in EXPECTED_SIGNALS if k not in series or not np.isfinite(series[k]).any()]
    for k in quality.missing_signals:
        warnings.append(f"No readings for {SIGNALS[k].label.lower()} in this file.")
    warnings.append(f"Unit conversions come from profile {PROFILE_VERSION} and are inferred, not documented by the source.")
    return ParsedLog(source=NAME, started_at=started_at, duration_s=n_sec, sample_rate_hz=1, series=series,
                     quality=quality, warnings=warnings)
