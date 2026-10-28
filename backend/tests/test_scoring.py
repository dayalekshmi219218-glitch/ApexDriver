import math

from app.core.config import ALERT_CAP, SIGNALS
from app.core.scoring import band_of_score, js_round, score_sample, summarize_scan

COOL, BATT, RPM = (SIGNALS[k].cfg for k in ("coolant_temp_c", "battery_v", "rpm"))


def test_normal_values_score_100_including_cold_coolant():
    assert score_sample(90, COOL) == 100
    assert score_sample(60, COOL) == 100       # warm-up is handled by the state mask, not by the band


def test_moderate_band_interpolates_100_to_60():
    assert score_sample(112.5, COOL) == 80
    assert score_sample(5000, RPM) == 80


def test_critical_band_follows_the_android_heuristic():
    assert math.isclose(score_sample(130, COOL), 60 - (10 / 120) * 50)
    assert math.isclose(score_sample(6500, RPM), 60 - (500 / 6000) * 50)


def test_battery_low_band_is_interpolated_not_flat_60():
    # Android scored every value in 11.5-12.0 V as exactly 60; here it interpolates 100 -> 60
    assert score_sample(11.75, BATT) == 80
    assert score_sample(11.9, BATT) > score_sample(11.6, BATT) > 60
    assert math.isclose(score_sample(11.0, BATT), 60 - (0.5 / 11.5) * 50)
    assert score_sample(13, BATT) == 100


def test_scores_stay_between_floor_and_100():
    for v in (-50, 0, 11, 12, 50, 150, 1e6):
        for cfg in (COOL, BATT, RPM):
            assert 10 <= score_sample(v, cfg) <= 100


def test_non_finite_values_are_nan():
    assert math.isnan(score_sample(float("nan"), COOL))
    assert math.isnan(score_sample(float("inf"), COOL))


def test_band_thresholds():
    assert band_of_score(100) == "normal" and band_of_score(99.6) == "normal"
    assert band_of_score(99.4) == "watch" and band_of_score(60) == "watch"
    assert band_of_score(59.9) == "alert"


def test_js_round_rounds_halves_up_like_javascript():
    assert [js_round(x) for x in (0.5, 1.5, 2.5, 79.5)] == [1, 2, 3, 80]   # Python round() would give 0, 2, 2, 80
    assert js_round(-0.5) == 0


def test_missing_signals_are_not_scored_as_healthy():
    s = summarize_scan({})
    assert (s.scored_signals, s.score, s.severity) == (0, 0, "none")


def test_nan_samples_are_ignored_not_treated_as_normal():
    n = 10
    series = {"rpm": [900.0] * n, "battery_v": [float("nan")] * n, "coolant_temp_c": [90.0] * n}
    s = summarize_scan(series)
    batt = next(x for x in s.signals if x.key == "battery_v")
    assert not batt.available
    assert s.scored_signals == 2


def test_warmup_samples_are_excluded_from_coolant():
    n = 10
    s = summarize_scan({"rpm": [900.0] * n, "coolant_temp_c": [50.0] * n, "battery_v": [13.5] * n})
    assert not next(x for x in s.signals if x.key == "coolant_temp_c").available
    assert s.states.warmup == 100


def test_overall_blends_weighted_mean_with_worst_signal():
    n = 20
    s = summarize_scan({"rpm": [1500.0] * n, "coolant_temp_c": [90.0] * n, "battery_v": [11.0] * n})
    b = next(x for x in s.signals if x.key == "battery_v")
    assert b.severity == "alert"
    mean = (6 * 100 + 3.5 * b.score + 5 * 100) / (6 + 3.5 + 5)
    assert s.score == min(js_round(0.6 * mean + 0.4 * b.score), ALERT_CAP)


def test_alert_caps_the_overall_score():
    n = 50
    # 2 of 50 samples (4%) above 6000 rpm -> rpm is Alert although the average is healthy
    rpm = [1500.0] * 48 + [6500.0, 6500.0]
    s = summarize_scan({"rpm": rpm, "coolant_temp_c": [90.0] * n, "battery_v": [13.5] * n, "intake_air_temp_c": [30.0] * n})
    assert next(x for x in s.signals if x.key == "rpm").severity == "alert"
    assert s.score <= ALERT_CAP and s.severity == "watch"


def test_short_spike_below_one_percent_is_not_an_alert():
    n = 200
    rpm = [1500.0] * 199 + [6500.0]     # 0.5% of the time
    s = summarize_scan({"rpm": rpm, "coolant_temp_c": [90.0] * n, "battery_v": [13.5] * n})
    assert next(x for x in s.signals if x.key == "rpm").severity == "normal"
