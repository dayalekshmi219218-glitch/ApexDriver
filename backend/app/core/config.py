"""Signal configuration: bands, weights and rules.

This mirrors src/lib/config.ts in the frontend. Keep the two in step: tests/test_scoring_parity.py
fails if the Python scorer and the TypeScript scorer ever disagree.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

SignalKey = Literal[
    "coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c",
    "throttle_pct", "load_kpa", "ignition_deg", "afr",
]
Severity = Literal["normal", "watch", "alert", "none"]  # none = "No data" or context-only

WARMUP_C = 70.0          # coolant below this is warm-up and is excluded from temperature scoring
RUNNING_RPM = 600.0      # engine counts as running above this
IDLE_RPM = 1000.0
IDLE_THROTTLE = 4.0
ALERT_PCT = 1.0          # a signal is Alert when >= 1% of its time is in the alert zone
WATCH_PCT = 5.0          # ... and Watch when >= 5% of its time is outside the normal zone
MIN_SCANS_FOR_ANOMALIES = 8

FLOOR = 10.0
WEIGHTED_MEAN_SHARE = 0.6   # overall = 60% weighted mean + 40% worst scored signal
ALERT_CAP = 79              # overall may not read Normal while any scored signal is in Alert


@dataclass(frozen=True)
class ScoreCfg:
    """Same shape as the Android pid_config.json entries."""
    direction: Literal["high", "low", "both", "neutral"]
    normal_min: Optional[float] = None
    normal_max: Optional[float] = None
    moderate_min: Optional[float] = None
    moderate_max: Optional[float] = None
    critical_low: Optional[float] = None
    critical_high: Optional[float] = None


@dataclass(frozen=True)
class SignalConfig:
    key: str
    label: str
    unit: str
    weight: float
    scored: bool
    state: Literal["warmed", "running", "all"]
    cfg: ScoreCfg = field(default_factory=lambda: ScoreCfg("neutral"))


SIGNALS: dict[str, SignalConfig] = {
    "coolant_temp_c": SignalConfig(
        "coolant_temp_c", "Coolant temperature", "°C", 6, True, "warmed",
        ScoreCfg("high", normal_min=70, normal_max=105, moderate_min=105, moderate_max=120, critical_high=120)),
    "battery_v": SignalConfig(
        "battery_v", "Battery voltage", "V", 3.5, True, "running",
        ScoreCfg("both", normal_min=12, normal_max=14.8, moderate_min=11.5, moderate_max=15.5,
                 critical_low=11.5, critical_high=15.5)),
    "rpm": SignalConfig(
        "rpm", "Engine speed", "rpm", 5, True, "running",
        ScoreCfg("high", normal_min=600, normal_max=4000, moderate_min=4000, moderate_max=6000, critical_high=6000)),
    "intake_air_temp_c": SignalConfig(
        "intake_air_temp_c", "Intake air temperature", "°C", 1.5, True, "running",
        ScoreCfg("high", normal_min=-10, normal_max=50, moderate_min=50, moderate_max=70, critical_high=70)),
    "throttle_pct": SignalConfig("throttle_pct", "Throttle position", "%", 0, False, "running"),
    "load_kpa": SignalConfig("load_kpa", "Engine load", "kPa", 0, False, "running"),
    "ignition_deg": SignalConfig("ignition_deg", "Ignition timing", "°", 0, False, "running"),
    "afr": SignalConfig("afr", "Air-fuel ratio", ":1", 0, False, "running"),
}

SIGNAL_ORDER = [
    "coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c", "throttle_pct", "load_kpa", "ignition_deg",
]
SCORED_KEYS = [k for k in SIGNAL_ORDER if SIGNALS[k].scored]
TOTAL_SCORED_SIGNALS = len(SCORED_KEYS)
