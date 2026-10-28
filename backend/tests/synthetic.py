"""Generates SYNTHETIC ECU datalogs in the Haltech 'ECU Manager' CSV shape, plus the exact values a correct
parser must recover. Nothing here is copied from any real log: the signals come from a small seeded simulation.

The expected values are computed by an independent code path (raw integers -> per-second last value ->
forward fill -> unit conversion), so a parser bug cannot cancel itself out.
"""
from __future__ import annotations

import math
import random

import numpy as np

# name -> (Type, DisplayMaxMin). Format metadata only.
META = {
    "BaseFuel": ("Percentage", 2000), "BaseIgnition": ("AngleIgnSprt2K", 800), "TargetAFR": ("AFR", 2000),
    "FuelCoolantTempCorrection": ("Percentage1For1", 250), "FuelAirTempCorrection": ("Percentage", 500),
    "ThrottlePosition": ("Percentage", 1000), "AirTemp": ("Temperature", 4231), "CoolantTemp": ("Temperature", 4231),
    "LambdaSensor1": ("AFR", 2000), "RPM": ("EngineSpeed", 10000), "Load": ("Pressure", 1013),
    "BatteryVoltage": ("BatteryVoltage", 16000), "EngineRunningTime": ("Time_s", 10000), "DeltaLoad": ("Percentage", 1000),
    "MAPSource": ("Pressure", 1013), "TransientThrottleLoadSource": ("Percentage", 1000), "IgnitionLoad": ("Pressure", 1013),
    "AFRDifference": ("AFR", 150), "IgnitionTiming": ("Angle", 600),
    "CurrentDutyCycle": ("Percentage", 1000), "ShiftLight1": ("OnOff", 1), "IgnitionCoolantTempCorrection": ("Angle", 200),
    "IgnitionAirTempCorrection": ("Angle", 200), "TransientThrottleAccelCoolantCorr": ("Percentage", 1000),
    "TransientThrottleEnrichSensitivity": ("Percentage", 1000), "TransientThrottleEnrichDecayRate": ("Percentage", 1000),
    "TransientThrottlePercentageAsync": ("Percentage", 1000), "TransientThrottlePercentageEnrich": ("Percentage", 1000),
    "Pwm_State_2": ("OnOff", 1), "Pwm_State_1": ("OnOff", 1),
}
V0 = ["BaseFuel", "BaseIgnition", "TargetAFR", "FuelCoolantTempCorrection", "FuelAirTempCorrection", "ThrottlePosition",
      "AirTemp", "CoolantTemp", "LambdaSensor1", "RPM", "Load", "BatteryVoltage", "EngineRunningTime", "DeltaLoad",
      "MAPSource", "TransientThrottleLoadSource", "IgnitionLoad", "AFRDifference", "IgnitionTiming"]
V1 = ["RPM", "CurrentDutyCycle", "CoolantTemp", "ShiftLight1", "ThrottlePosition", "BatteryVoltage", "AirTemp",
      "IgnitionCoolantTempCorrection", "Load", "LambdaSensor1", "TargetAFR", "IgnitionTiming", "BaseFuel",
      "IgnitionAirTempCorrection", "EngineRunningTime", "MAPSource", "BaseIgnition", "FuelCoolantTempCorrection",
      "TransientThrottleAccelCoolantCorr", "FuelAirTempCorrection", "IgnitionLoad", "AFRDifference",
      "TransientThrottleEnrichSensitivity", "TransientThrottleEnrichDecayRate", "TransientThrottlePercentageAsync",
      "TransientThrottlePercentageEnrich"]
VARIANTS = {0: V0, 1: V1}

# independent restatement of the unit conversions: channel -> (canonical key, scale, offset)
CONV = {
    "CoolantTemp": ("coolant_temp_c", 0.1, -273.15), "AirTemp": ("intake_air_temp_c", 0.1, -273.15),
    "BatteryVoltage": ("battery_v", 0.001, 0.0), "RPM": ("rpm", 1.0, 0.0), "ThrottlePosition": ("throttle_pct", 0.1, 0.0),
    "Load": ("load_kpa", 0.1, 0.0), "IgnitionTiming": ("ignition_deg", 0.1, 0.0),
    "LambdaSensor1": ("afr", 0.01, 0.0), "TargetAFR": ("afr_target", 0.01, 0.0),
}


def _fmt_time(t: float, start_s: float) -> str:
    ms = int(round((start_s + t) * 1000)) % 86_400_000
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def make_log(seed: int = 1, duration_s: int = 300, variant: int = 0, start: str = "07:54:58",
             spike_coolant_at_s: int | None = None, marker: bool = True, dt: float = 0.1, drop: tuple = ()):
    """Return (csv_text, expected) where expected maps canonical key -> 1 Hz numpy array a correct parser must produce."""
    rng = random.Random(seed)
    channels = [c for c in VARIANTS[variant] if c not in drop]
    h, m, s = (int(x) for x in start.split(":"))
    start_s = h * 3600 + m * 60 + s

    n = int(duration_s / dt)
    mode, rpm_prev = 0, 780.0
    raw_by_tick: list[dict[str, int]] = []
    other = {c: rng.randint(0, 500) for c in channels if c not in CONV}
    for k in range(n):
        t = k * dt
        if k == 0 or rng.random() < 0.02:
            u = rng.random()
            mode = 0 if u < 0.25 else 1 if u < 0.8 else 2
        rpm_t = 780 + rng.gauss(0, 20) if mode == 0 else 1500 + rng.random() * 1100 if mode == 1 else 2600 + rng.random() * 1200
        rpm_prev = 0.9 * rpm_prev + 0.1 * rpm_t
        thr = 2.8 if mode == 0 else 8 + rng.random() * 10 if mode == 1 else 22 + rng.random() * 25
        load = 33 + rng.gauss(0, 1) if mode == 0 else 42 + rng.random() * 20 if mode == 1 else 72 + rng.random() * 22
        cool = 40 + (88 - 40) * (1 - math.exp(-t / 360)) + rng.gauss(0, 0.05)
        raw = {
            "RPM": round(rpm_prev), "CoolantTemp": round((cool + 273.15) * 10),
            "AirTemp": round((35 + t * 0.004 + rng.gauss(0, 0.05) + 273.15) * 10),
            "BatteryVoltage": round((12.9 + rng.gauss(0, 0.04)) * 1000), "ThrottlePosition": round(thr * 10),
            "Load": round(load * 10), "IgnitionTiming": round((14 if mode == 0 else 24) * 10 + rng.gauss(0, 5)),
            "LambdaSensor1": round((10.0 + rng.gauss(0, 0.2)) * 100), "TargetAFR": 980 if t < duration_s / 2 else 1000,
        }
        if k % 50 == 0:
            for c in other:
                other[c] = max(0, other[c] + rng.randint(-3, 3))
        raw.update(other)
        raw_by_tick.append(raw)

    lines = ["%DataLog%", "DataLogVersion : 1.0", "Software : ECU Manager", "SoftwareVersion : 1.1.14.0",
             "DownloadDateTime : 20180713 08:37:23"]
    for c in channels:
        lines += [f"Channel : {c}", f"Type : {META[c][0]}", f"DisplayMaxMin : {META[c][1]}"]
    if marker:
        lines.append(f"Log : 20180713 {start}")

    last_emitted: dict[str, int] = {}
    per_sec: dict[int, dict[str, int]] = {}
    for k, raw in enumerate(raw_by_tick):
        t = k * dt
        cells, changed = [], False
        for c in channels:
            v = raw[c]
            if last_emitted.get(c) != v:
                cells.append(str(v))
                last_emitted[c] = v
                changed = True
                per_sec.setdefault(int(t), {})[c] = v
            else:
                cells.append("")
        if changed:
            lines.append(",".join([_fmt_time(t, start_s)] + cells))
        if spike_coolant_at_s is not None and abs(t - (spike_coolant_at_s + 0.05)) < dt / 2:
            spike = [""] * len(channels)
            spike[channels.index("CoolantTemp")] = "5000"          # 226.85 C: not physically plausible
            lines.append(",".join([_fmt_time(t + dt / 2, start_s)] + spike))
            last_emitted["CoolantTemp"] = 5000                      # the next real reading will be emitted again
    text = "\n".join(lines) + "\n"

    n_sec = max(per_sec) + 1
    expected: dict[str, np.ndarray] = {}
    for c, (key, scale, offset) in CONV.items():
        if c in drop:
            continue
        arr = np.full(n_sec, np.nan)
        cur = np.nan
        for sec in range(n_sec):
            if c in per_sec.get(sec, {}):
                cur = per_sec[sec][c] * scale + offset
            arr[sec] = cur
        expected[key] = arr
    return text, expected
