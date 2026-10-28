import numpy as np
import pytest

from app.adapters import ParseError, haltech, parse_log
from app.core.scoring import summarize_scan
from synthetic import make_log


def assert_series_equal(parsed, expected):
    assert set(expected) <= set(parsed.series), set(expected) - set(parsed.series)
    for key, exp in expected.items():
        got = parsed.series[key]
        assert len(got) == len(exp), key
        np.testing.assert_allclose(got, exp, atol=1e-9, equal_nan=True, err_msg=key)


@pytest.mark.parametrize("variant", [0, 1])
def test_round_trip_recovers_every_signal(variant):
    text, expected = make_log(seed=3, duration_s=240, variant=variant)
    p = parse_log(text.encode("latin-1"), "log.csv")
    assert p.duration_s == len(next(iter(expected.values())))
    assert_series_equal(p, expected)
    assert p.sample_rate_hz == 1 and p.source == "Haltech ECU datalog"
    assert p.started_at is not None and p.started_at.isoformat() == "2018-07-13T07:54:58"


def test_columns_are_mapped_by_name_not_position():
    t0, e0 = make_log(seed=5, duration_s=120, variant=0)
    t1, e1 = make_log(seed=5, duration_s=120, variant=1)
    p0, p1 = parse_log(t0), parse_log(t1)
    assert list(p0.series) != [] and set(e0) == set(e1)
    # same simulated drive, different channel order and extra channels -> same physical story
    assert_series_equal(p0, e0)
    assert_series_equal(p1, e1)
    assert len(p1.quality.ignored_channels) > len(p0.quality.ignored_channels)


def test_implausible_readings_are_dropped_and_counted():
    text, expected = make_log(seed=2, duration_s=150, spike_coolant_at_s=60)
    p = parse_log(text)
    assert p.quality.dropped_implausible == {"coolant_temp_c": 1}
    assert np.nanmax(p.series["coolant_temp_c"]) < 100          # the 226 C spike never reaches the series
    assert_series_equal(p, expected)


def test_midnight_rollover_keeps_time_moving_forward():
    text, expected = make_log(seed=4, duration_s=40, start="23:59:50")
    p = parse_log(text)
    assert p.duration_s == len(next(iter(expected.values()))) == 40
    assert_series_equal(p, expected)


def test_rows_that_go_back_in_time_are_skipped():
    text, expected = make_log(seed=6, duration_s=60)
    lines = text.rstrip("\n").split("\n")
    lines.insert(len(lines) - 5, "07:54:00.000" + "," * 19)      # an hour-old timestamp in the middle of the log
    p = parse_log("\n".join(lines) + "\n")
    assert p.quality.skipped_lines == 1
    assert_series_equal(p, expected)


def test_missing_log_marker_is_reported_not_fatal():
    text, _ = make_log(seed=8, duration_s=60, marker=False)
    p = parse_log(text)
    assert p.started_at is None
    assert any("No 'Log :' marker" in w for w in p.warnings)


def test_every_result_carries_the_unit_inference_warning():
    p = parse_log(make_log(seed=9, duration_s=60)[0])
    assert any("inferred" in w for w in p.warnings)


def test_signals_without_a_channel_are_listed_as_missing_and_not_scored():
    text, expected = make_log(seed=10, duration_s=600, drop=("BatteryVoltage",))   # long enough for coolant to pass warm-up
    p = parse_log(text)
    assert p.quality.missing_signals == ["battery_v"]
    assert any("battery voltage" in w for w in p.warnings)
    assert "battery_v" not in p.series
    assert_series_equal(p, expected)
    s = summarize_scan(p.series)
    assert s.scored_signals == 3            # not scored as healthy


def test_end_to_end_scoring_of_a_healthy_synthetic_drive():
    p = parse_log(make_log(seed=11, duration_s=900)[0])
    s = summarize_scan(p.series)
    assert s.scored_signals == 4 and s.severity == "normal" and s.score >= 90
    assert s.mixture is not None and 9.0 < s.mixture.median < 11.0      # the generator runs rich on purpose


@pytest.mark.parametrize("data,name,msg", [
    (b"", "a.csv", "empty"),
    (b"a,b\n1,2\n", "a.csv", "not supported"),
    (b"%DataLog%\nChannel : RPM\nType : EngineSpeed\nDisplayMaxMin : 10000\n", "a.csv", "no data rows"),
    (b"%DataLog%\nSoftware : x\n", "a.csv", "not supported"),
    (make_log(seed=1, duration_s=30)[0].encode(), "a.txt", ".csv"),
    (b"x" * (10 * 1024 * 1024 + 1), "a.csv", "10 MB"),
])
def test_bad_files_give_a_clear_error(data, name, msg):
    with pytest.raises(ParseError, match=msg):
        parse_log(data, name)


def test_file_with_only_unknown_channels_is_rejected():
    text = "%DataLog%\nChannel : Foo\nType : X\nDisplayMaxMin : 1\nLog : 20180713 07:54:58\n07:54:58.000,5\n"
    with pytest.raises(ParseError, match="None of the engine channels"):
        haltech.parse(text)


def test_garbage_rows_are_skipped_not_fatal():
    text, expected = make_log(seed=12, duration_s=60)
    lines = text.rstrip("\n").split("\n")
    lines.insert(len(lines) - 3, "this is not a data row")
    lines.insert(len(lines) - 2, "99:99:99.999,1,2")
    p = parse_log("\n".join(lines) + "\n")
    assert p.quality.skipped_lines >= 1
    assert_series_equal(p, expected)
