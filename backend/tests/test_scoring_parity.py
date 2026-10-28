"""Proves the Python scorer gives the same answers as the frontend (TypeScript) scorer.

tests/golden/scoring_golden.json is produced by scripts/export_golden.mts from the frontend code. If either
scorer changes, regenerate the file and this test tells you whether the two still agree.
"""
import json
from pathlib import Path

import pytest

from app.core.config import SIGNALS
from app.core.scoring import score_sample, summarize_scan

GOLDEN = json.loads((Path(__file__).parent / "golden" / "scoring_golden.json").read_text())
TOL = 1e-6


@pytest.mark.parametrize("key", sorted(GOLDEN["samples"]))
def test_per_sample_scores_match_typescript(key):
    cfg = SIGNALS[key].cfg
    g = GOLDEN["samples"][key]
    bad = [(v, e, score_sample(v, cfg)) for v, e in zip(g["values"], g["scores"]) if abs(score_sample(v, cfg) - e) > TOL]
    assert not bad, f"{len(bad)} of {len(g['values'])} grid values differ, first: {bad[:3]}"


@pytest.mark.parametrize("scan", GOLDEN["scans"], ids=lambda s: s["id"])
def test_scan_summary_matches_typescript(scan):
    exp, got = scan["expected"], summarize_scan(scan["series"])
    assert got.score == exp["score"]
    assert got.severity == exp["severity"]
    assert got.scored_signals == exp["scoredSignals"] and got.total_signals == exp["totalSignals"]
    for k in ("warmup", "idle", "driving"):
        assert getattr(got.states, k) == pytest.approx(exp["states"][k], abs=TOL)
    if exp["mixture"] is None:
        assert got.mixture is None
    else:
        m = got.mixture
        assert m is not None
        assert m.median == pytest.approx(exp["mixture"]["median"], abs=TOL)
        assert m.pct_rich == pytest.approx(exp["mixture"]["pctRich"], abs=TOL)
        assert m.pct_in_range == pytest.approx(exp["mixture"]["pctInRange"], abs=TOL)
        assert m.pct_lean == pytest.approx(exp["mixture"]["pctLean"], abs=TOL)
    assert [s.key for s in got.signals] == [s["key"] for s in exp["signals"]]
    for g, e in zip(got.signals, exp["signals"]):
        assert g.available == e["available"] and g.scored == e["scored"], g.key
        assert g.severity == e["severity"], g.key
        for a, b in (("min", "min"), ("avg", "avg"), ("max", "max"), ("pct_normal", "pctNormal"),
                     ("pct_watch", "pctWatch"), ("pct_alert", "pctAlert")):
            assert getattr(g, a) == pytest.approx(e[b], abs=TOL), f"{g.key}.{a}"
        if e["score"] is None:
            assert g.score is None
        else:
            assert g.score == pytest.approx(e["score"], abs=TOL), g.key


def test_golden_actually_exercises_every_outcome():
    """Guard against a golden file that would pass trivially."""
    sev = {s["expected"]["severity"] for s in GOLDEN["scans"]}
    sig_sev = {x["severity"] for s in GOLDEN["scans"] for x in s["expected"]["signals"]}
    assert {"normal", "watch"} <= sev
    assert {"normal", "watch", "alert"} <= sig_sev
    assert any(s["expected"]["mixture"] for s in GOLDEN["scans"])
