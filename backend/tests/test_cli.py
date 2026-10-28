import json
from pathlib import Path

from app.cli import main

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_haltech.csv"


def test_cli_prints_a_readable_report(capsys):
    assert main(["analyze", str(FIXTURE)]) == 0
    out = capsys.readouterr().out
    assert "Health score:" in out and "Coolant temperature" in out and "Battery voltage" in out
    assert "Fuel mixture (tuning indicator, not scored)" in out
    assert "not a mechanic's diagnosis" in out


def test_cli_json_is_valid_and_complete(capsys):
    assert main(["analyze", str(FIXTURE), "--json"]) == 0
    d = json.loads(capsys.readouterr().out)
    assert d["log"]["source"] == "Haltech ECU datalog" and d["log"]["duration_s"] > 200
    assert 0 <= d["summary"]["score"] <= 100 and len(d["summary"]["signals"]) == 7


def test_cli_reports_bad_input_without_a_traceback(tmp_path, capsys):
    bad = tmp_path / "x.csv"
    bad.write_text("a,b\n1,2\n")
    assert main(["analyze", str(bad)]) == 2
    assert "not supported" in capsys.readouterr().err
    assert main(["analyze", str(tmp_path / "missing.csv")]) == 2
