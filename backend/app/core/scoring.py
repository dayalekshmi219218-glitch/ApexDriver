"""Scorer: Python port of src/lib/scoring.ts (which is itself a port of the Android ScoreCalculator).

Rules, in one place:
  * Each sample gets a score 0-100 from the signal's bands (normal 100, moderate 100->60, critical 60->10).
  * A signal's score is the time-weighted mean over the samples that count (after warm-up / while running).
  * A signal is Alert at >= 1% of its time in the alert zone, Watch at >= 5% outside the normal zone.
  * Overall = 60% weighted mean + 40% worst scored signal, capped at 79 while any signal is in Alert.
  * Signals with no data are NOT scored as healthy (the Android app did that).

Deliberate differences from the Android code are listed in the README and covered by tests.
Series values may be NaN (missing); NaN samples never count.
"""
from __future__ import annotations

import math
from typing import Mapping, Optional, Sequence

from .config import (
    ALERT_CAP, ALERT_PCT, FLOOR, IDLE_RPM, IDLE_THROTTLE, RUNNING_RPM, SCORED_KEYS, SIGNALS, SIGNAL_ORDER,
    TOTAL_SCORED_SIGNALS, WARMUP_C, WATCH_PCT, WEIGHTED_MEAN_SHARE, ScoreCfg,
)
from .schema import EngineStates, MixtureSummary, ScanSummary, SignalSummary

Series = Mapping[str, Sequence[float]]


def js_round(x: float) -> int:
    """JavaScript Math.round (halves round up). Python's round() rounds halves to even, which would break parity."""
    return int(math.floor(x + 0.5))


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def score_sample(value: float, cfg: ScoreCfg) -> float:
    """Per-sample score 0-100. Port of ScoreCalculator.scoreForPid with the low-band interpolation fixed
    (the Android 'low' branch never interpolated, so everything in a low-moderate band scored a flat 60)."""
    if not math.isfinite(value):
        return math.nan
    in_normal = (cfg.normal_min is None or value >= cfg.normal_min) and (cfg.normal_max is None or value <= cfg.normal_max)
    if in_normal:
        return 100.0

    d = cfg.direction
    if d == "high":
        upper = cfg.normal_max if cfg.normal_max is not None else math.inf
        if cfg.moderate_max is not None and value <= cfg.moderate_max and value > upper:
            t = _clamp01((value - upper) / (cfg.moderate_max - upper)) if cfg.moderate_max > upper else 1.0
            return 100 - t * 40
        crit = cfg.critical_high if cfg.critical_high is not None else (cfg.moderate_max if cfg.moderate_max is not None else upper)
        if value >= crit:
            t = _clamp01((value - crit) / max(1.0, crit)) if value > crit else 0.0
            return 60 - t * (60 - FLOOR)
        return 100.0
    if d == "low":
        lower = cfg.normal_min if cfg.normal_min is not None else -math.inf
        if cfg.moderate_min is not None and value >= cfg.moderate_min and value < lower:
            t = _clamp01((lower - value) / (lower - cfg.moderate_min)) if lower > cfg.moderate_min else 1.0
            return 100 - t * 40
        crit = cfg.critical_low if cfg.critical_low is not None else (cfg.moderate_min if cfg.moderate_min is not None else lower)
        if value <= crit:
            t = _clamp01((crit - value) / abs(crit)) if crit != 0 else 1.0
            return 60 - t * (60 - FLOOR)
        return 100.0
    if d == "both":
        from dataclasses import replace
        hi = score_sample(value, replace(cfg, direction="high"))
        lo = score_sample(value, replace(cfg, direction="low"))
        return min(hi, lo)
    return 100.0


def band_of_score(score: float) -> str:
    if score >= 99.5:
        return "normal"
    if score >= 60:
        return "watch"
    return "alert"


def severity_for_score(score: float) -> str:
    """Overall severity: 80+ Normal, 60-79 Watch, below 60 Alert."""
    if score >= 80:
        return "normal"
    if score >= 60:
        return "watch"
    return "alert"


def severity_label(sev: str) -> str:
    return {"normal": "Normal", "watch": "Watch", "alert": "Alert"}.get(sev, "No data")


def _lst(series: Series, key: str) -> Optional[list[float]]:
    v = series.get(key)
    if v is None:
        return None
    return [float(x) for x in v]


def engine_states(series: Series) -> EngineStates:
    coolant, rpm, throttle = _lst(series, "coolant_temp_c"), _lst(series, "rpm"), _lst(series, "throttle_pct")
    if coolant is None or rpm is None:
        return EngineStates(0.0, 0.0, 0.0)
    n = min(len(coolant), len(rpm))
    w = i = d = 0
    for k in range(n):
        if not (rpm[k] > RUNNING_RPM):      # engine off, or rpm missing (NaN)
            continue
        if coolant[k] < WARMUP_C:
            w += 1
        elif rpm[k] < IDLE_RPM and (throttle[k] if throttle is not None else 0.0) < IDLE_THROTTLE:
            i += 1
        else:
            d += 1
    total = (w + i + d) or 1
    return EngineStates(w / total * 100, i / total * 100, d / total * 100)


def sample_mask(key: str, series: Series, n: int) -> list[bool]:
    state = SIGNALS[key].state
    rpm, coolant = _lst(series, "rpm"), _lst(series, "coolant_temp_c")
    mask: list[bool] = []
    for k in range(n):
        running = (rpm[k] > RUNNING_RPM) if rpm is not None else True
        if state == "all":
            mask.append(True)
        elif state == "running":
            mask.append(running)
        else:
            mask.append(running and ((coolant[k] >= WARMUP_C) if coolant is not None else True))
    return mask


def used_values(key: str, series: Series) -> list[float]:
    vals = _lst(series, key)
    if vals is None:
        return []
    mask = sample_mask(key, series, len(vals))
    return [v for v, m in zip(vals, mask) if m and math.isfinite(v)]


def summarize_signal(key: str, series: Series) -> SignalSummary:
    cfg = SIGNALS[key]
    empty = SignalSummary(key=key, label=cfg.label, unit=cfg.unit, available=False, scored=cfg.scored, weight=cfg.weight)
    used = used_values(key, series)
    if not used:
        return empty
    n = len(used)
    base = SignalSummary(key=key, label=cfg.label, unit=cfg.unit, available=True, scored=cfg.scored, weight=cfg.weight,
                         min=min(used), avg=sum(used) / n, max=max(used))
    if not cfg.scored:
        return base
    n_normal = n_watch = n_alert = 0
    score_sum = 0.0
    for v in used:
        s = score_sample(v, cfg.cfg)
        score_sum += s
        band = band_of_score(s)
        if band == "normal":
            n_normal += 1
        elif band == "watch":
            n_watch += 1
        else:
            n_alert += 1
    base.pct_normal, base.pct_watch, base.pct_alert = n_normal / n * 100, n_watch / n * 100, n_alert / n * 100
    if base.pct_alert >= ALERT_PCT:
        base.severity = "alert"
    elif base.pct_watch + base.pct_alert >= WATCH_PCT:
        base.severity = "watch"
    else:
        base.severity = "normal"
    base.score = score_sum / n
    return base


def summarize_mixture(series: Series) -> Optional[MixtureSummary]:
    afr, rpm = _lst(series, "afr"), _lst(series, "rpm")
    if not afr:
        return None
    vals = [v for k, v in enumerate(afr) if math.isfinite(v) and ((rpm[k] > RUNNING_RPM) if rpm is not None else True)]
    if not vals:
        return None
    srt = sorted(vals)
    n = len(vals)
    rich = sum(1 for v in vals if v < 12.5)
    lean = sum(1 for v in vals if v > 15.5)
    return MixtureSummary(median=srt[n // 2], pct_rich=rich / n * 100, pct_lean=lean / n * 100,
                          pct_in_range=(n - rich - lean) / n * 100)


def summarize_scan(series: Series) -> ScanSummary:
    signals = [summarize_signal(k, series) for k in SIGNAL_ORDER]
    w_sum = s_sum = 0.0
    count = 0
    worst = 100.0
    for s in signals:
        if s.scored and s.available and s.score is not None:
            w_sum += s.weight
            s_sum += s.score * s.weight
            count += 1
            worst = min(worst, s.score)
    if w_sum > 0:
        blended = WEIGHTED_MEAN_SHARE * (s_sum / w_sum) + (1 - WEIGHTED_MEAN_SHARE) * worst
        any_alert = any(s.scored and s.severity == "alert" for s in signals)
        score = js_round(min(blended, ALERT_CAP) if any_alert else blended)
    else:
        score = 0
    return ScanSummary(
        signals=signals, score=score, severity="none" if count == 0 else severity_for_score(score),
        scored_signals=count, total_signals=TOTAL_SCORED_SIGNALS, states=engine_states(series),
        mixture=summarize_mixture(series),
    )


__all__ = [
    "score_sample", "band_of_score", "severity_for_score", "severity_label", "engine_states", "summarize_signal",
    "summarize_scan", "summarize_mixture", "used_values", "js_round", "SCORED_KEYS",
]
