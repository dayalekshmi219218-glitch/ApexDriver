"""Canonical scan schema. Every adapter (ECU log, OBD logger CSV, mobile snapshot) produces a ParsedLog;
everything after the adapter (scoring, anomalies, LLM facts) only sees this shape."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np


@dataclass
class SignalSummary:
    key: str
    label: str
    unit: str
    available: bool
    scored: bool
    weight: float
    min: float = 0.0
    avg: float = 0.0
    max: float = 0.0
    pct_normal: float = 0.0
    pct_watch: float = 0.0
    pct_alert: float = 0.0
    score: Optional[float] = None
    severity: str = "none"


@dataclass
class MixtureSummary:
    median: float
    pct_rich: float
    pct_in_range: float
    pct_lean: float


@dataclass
class EngineStates:
    warmup: float
    idle: float
    driving: float


@dataclass
class ScanSummary:
    signals: list[SignalSummary]
    score: int
    severity: str
    scored_signals: int
    total_signals: int
    states: EngineStates
    mixture: Optional[MixtureSummary]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Quality:
    raw_rows: int = 0
    skipped_lines: int = 0
    coverage: dict[str, float] = field(default_factory=dict)       # fraction of seconds with a value, per signal
    dropped_implausible: dict[str, int] = field(default_factory=dict)
    ignored_channels: list[str] = field(default_factory=list)
    missing_signals: list[str] = field(default_factory=list)       # canonical signals with no source channel


@dataclass
class ParsedLog:
    source: str
    started_at: Optional[datetime]
    duration_s: int
    sample_rate_hz: int
    series: dict[str, np.ndarray]                                  # canonical key -> float array, NaN = missing
    quality: Quality
    warnings: list[str] = field(default_factory=list)

    def to_dict(self, include_series: bool = False) -> dict:
        d = {
            "source": self.source,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "duration_s": self.duration_s,
            "sample_rate_hz": self.sample_rate_hz,
            "quality": asdict(self.quality),
            "warnings": list(self.warnings),
        }
        if include_series:
            d["series"] = {k: [None if np.isnan(x) else float(x) for x in v] for k, v in self.series.items()}
        return d
