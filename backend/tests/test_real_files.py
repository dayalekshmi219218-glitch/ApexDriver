"""Optional: runs the parser over REAL log files on your own machine. Never committed, never bundled.

    ECU_DATALOG_DIR=/path/to/car-ecu-datalogs python -m pytest -m realfiles -s
"""
import os
from pathlib import Path

import numpy as np
import pytest

from app.adapters import parse_log
from app.core.scoring import summarize_scan

DIR = os.environ.get("ECU_DATALOG_DIR")
pytestmark = [pytest.mark.realfiles, pytest.mark.skipif(not DIR or not Path(DIR).is_dir(), reason="set ECU_DATALOG_DIR to run")]


def test_every_real_file_parses_and_looks_physically_sane():
    files = sorted(Path(DIR).glob("*.csv"))
    assert files, "no csv files found"
    rows = []
    for f in files:
        p = parse_log(f.read_bytes(), f.name)
        s = summarize_scan(p.series)
        assert 15 * 60 <= p.duration_s <= 90 * 60, f.name
        assert p.quality.skipped_lines == 0, f.name
        assert p.quality.missing_signals == [], f.name
        for key in ("coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c"):
            assert p.quality.coverage[key] > 0.97, (f.name, key)
        assert 20 < np.nanmedian(p.series["coolant_temp_c"]) < 105, f.name
        assert 11 < np.nanmedian(p.series["battery_v"]) < 15, f.name
        assert np.nanmax(p.series["rpm"]) < 9000, f.name
        assert 0 <= s.score <= 100 and s.scored_signals == 4, f.name
        rows.append((f.name[:17], p.duration_s // 60, s.score, s.severity, round(float(np.nanmedian(p.series["battery_v"])), 2)))
    print(f"\n{len(rows)} files parsed")
    for r in rows[:6]:
        print("  ", r)
