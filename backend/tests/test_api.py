import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.service as service
from app.adapters import parse_log
from app.core.scoring import summarize_scan
from app.main import create_app
from app.settings import Settings
from synthetic import make_log

GOLDEN = json.loads((Path(__file__).parent / "golden" / "scoring_golden.json").read_text())
TS_SCAN_KEYS = {"id", "vehicleId", "startedAt", "durationMin", "source", "fileName", "simulated", "score", "severity",
                "scoredSignals", "totalSignals", "states", "signals", "series", "mixture"}   # src/lib/types.ts `Scan`
TS_SIGNAL_KEYS = set(GOLDEN["scans"][0]["expected"]["signals"][0])
ALICE, BOB = {"X-Dev-User": "alice"}, {"X-Dev-User": "bob"}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(Settings(data_dir=tmp_path)))


def make_vehicle(c, headers=ALICE, name="Test car", year=2018):
    r = c.post("/vehicles", json={"name": name, "modelYear": year}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def upload(c, vehicle_id, text, name="trip.csv", headers=ALICE):
    return c.post("/scans", data={"vehicle_id": vehicle_id}, files={"file": (name, text.encode("latin-1"), "text/csv")}, headers=headers)


LOG, _ = make_log(seed=21, duration_s=600)


# ---------- vehicles ----------
def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_demo_vehicles_can_be_flagged_synthetic(client):
    r = client.post("/vehicles", json={"name": "Demo", "modelYear": 2020, "synthetic": True}, headers=ALICE)
    assert r.status_code == 201 and r.json()["synthetic"] is True


def test_vehicle_crud_round_trip(client):
    v = make_vehicle(client, name="  Daily hatchback  ")
    assert v["name"] == "Daily hatchback" and v["modelYear"] == 2018 and v["synthetic"] is False
    assert set(v) == {"id", "name", "modelYear", "createdAt", "synthetic"}
    assert client.get("/vehicles", headers=ALICE).json() == [v]
    r = client.patch(f"/vehicles/{v['id']}", json={"name": "Renamed", "modelYear": None}, headers=ALICE)
    assert r.status_code == 200 and r.json()["name"] == "Renamed" and r.json()["modelYear"] is None
    assert client.delete(f"/vehicles/{v['id']}", headers=ALICE).status_code == 204
    assert client.get("/vehicles", headers=ALICE).json() == []
    assert client.delete(f"/vehicles/{v['id']}", headers=ALICE).status_code == 404


@pytest.mark.parametrize("body", [{"name": ""}, {"name": "   "}, {"name": "x" * 41}, {"name": "ok", "modelYear": 1850},
                                  {"name": "ok", "modelYear": 3000}, {"modelYear": 2018}])
def test_vehicle_validation(client, body):
    assert client.post("/vehicles", json=body, headers=ALICE).status_code == 422


def test_users_cannot_see_or_touch_each_others_data(client):
    v = make_vehicle(client)
    sid = upload(client, v["id"], LOG).json()["id"]
    assert client.get("/vehicles", headers=BOB).json() == []
    assert client.patch(f"/vehicles/{v['id']}", json={"name": "x"}, headers=BOB).status_code == 404
    assert client.delete(f"/vehicles/{v['id']}", headers=BOB).status_code == 404
    assert client.get(f"/scans/{sid}", headers=BOB).status_code == 404
    assert client.delete(f"/scans/{sid}", headers=BOB).status_code == 404
    assert upload(client, v["id"], LOG, headers=BOB).status_code == 404
    assert client.get("/scans", headers=BOB).json() == []


def test_bad_user_header_is_rejected(client):
    assert client.get("/vehicles", headers={"X-Dev-User": "../etc"}).status_code == 400


# ---------- upload + processing ----------
def test_upload_is_accepted_then_ready_with_the_frontend_contract(client):
    v = make_vehicle(client)
    r = upload(client, v["id"], LOG, "20180713-home2mimos.csv")
    assert r.status_code == 202 and r.json()["status"] == "processing"
    sid = r.json()["id"]
    scan = client.get(f"/scans/{sid}", headers=ALICE).json()      # TestClient has run the background task by now
    assert scan["status"] == "ready"
    assert TS_SCAN_KEYS <= set(scan)
    assert {k for s in scan["signals"] for k in s} == TS_SIGNAL_KEYS
    assert scan["vehicleId"] == v["id"] and scan["fileName"] == "20180713-home2mimos.csv" and scan["simulated"] is False
    assert scan["source"] == "Haltech ECU datalog" and scan["startedAt"] == "2018-07-13T07:54:58" and scan["durationMin"] == 10
    expected = summarize_scan(parse_log(LOG).series)
    assert scan["score"] == expected.score and scan["severity"] == expected.severity
    assert scan["scoredSignals"] == 4 and scan["totalSignals"] == 4
    assert set(scan["states"]) == {"warmup", "idle", "driving"}


def test_series_are_120_points_for_charts(client):
    v = make_vehicle(client)
    scan = client.get(f"/scans/{upload(client, v['id'], LOG).json()['id']}", headers=ALICE).json()
    assert set(scan["series"]) >= {"coolant_temp_c", "battery_v", "rpm", "intake_air_temp_c", "throttle_pct", "load_kpa", "ignition_deg", "afr"}
    assert all(len(a) == 120 for a in scan["series"].values())
    assert 60 < scan["series"]["coolant_temp_c"][-1] < 100       # warmed up by the end of a 10-minute drive
    assert scan["mixture"] is not None and 9 < scan["mixture"]["median"] < 11


def test_short_logs_are_still_120_points(client):
    v = make_vehicle(client)
    text, _ = make_log(seed=1, duration_s=60)
    scan = client.get(f"/scans/{upload(client, v['id'], text).json()['id']}", headers=ALICE).json()
    assert all(len(a) == 120 for a in scan["series"].values())


@pytest.mark.parametrize("text,name,code,msg", [
    ("", "a.csv", 422, "empty"),
    ("a,b\n1,2\n", "a.csv", 422, "not supported"),
    (LOG, "a.txt", 422, ".csv"),
])
def test_rejected_uploads_explain_why(client, text, name, code, msg):
    v = make_vehicle(client)
    r = upload(client, v["id"], text, name)
    assert r.status_code == code and msg in r.json()["detail"]
    assert client.get("/scans", headers=ALICE).json() == []         # nothing half-created


def test_oversized_upload_is_413(tmp_path):
    c = TestClient(create_app(Settings(data_dir=tmp_path, max_upload_bytes=2048)))
    v = make_vehicle(c)
    r = upload(c, v["id"], LOG)
    assert r.status_code == 413 and "larger than" in r.json()["detail"]


def test_unknown_vehicle_is_404(client):
    assert upload(client, "veh_nope", LOG).status_code == 404


def test_a_file_that_passes_the_format_check_but_has_no_rows_ends_as_failed_with_a_reason(client):
    v = make_vehicle(client)
    header_only = "%DataLog%\nChannel : RPM\nType : EngineSpeed\nDisplayMaxMin : 10000\n"
    sid = upload(client, v["id"], header_only).json()["id"]
    scan = client.get(f"/scans/{sid}", headers=ALICE).json()
    assert scan["status"] == "failed" and "no data rows" in scan["error"]
    assert client.get("/scans", headers=ALICE).json() == []         # failed scans are not listed as results


def test_unexpected_errors_never_leave_a_scan_stuck_in_processing(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("disk on fire")
    monkeypatch.setattr(service, "parse_log", boom)
    v = make_vehicle(client)
    sid = upload(client, v["id"], LOG).json()["id"]
    scan = client.get(f"/scans/{sid}", headers=ALICE).json()
    assert scan["status"] == "failed" and scan["error"] == service.GENERIC_FAILURE and "fire" not in scan["error"]


def test_processing_scans_are_visible_by_id_but_not_in_the_list(client):
    v = make_vehicle(client)
    sid = client.app.state.store.create_scan("alice", v["id"], "x.csv", b"data")      # never processed
    assert client.get(f"/scans/{sid}", headers=ALICE).json()["status"] == "processing"
    assert client.get("/scans", headers=ALICE).json() == []


def test_list_can_filter_by_vehicle(client):
    a, b = make_vehicle(client, name="A"), make_vehicle(client, name="B")
    upload(client, a["id"], LOG)
    upload(client, a["id"], make_log(seed=22, duration_s=300)[0])
    upload(client, b["id"], LOG)
    assert len(client.get("/scans", headers=ALICE).json()) == 3
    assert len(client.get(f"/scans?vehicle_id={a['id']}", headers=ALICE).json()) == 2


# ---------- deleting ----------
def test_deleting_a_vehicle_cascades_to_scans_and_files(client, tmp_path):
    v = make_vehicle(client)
    sids = [upload(client, v["id"], LOG).json()["id"] for _ in range(2)]
    assert len(list((tmp_path / "uploads").glob("*.csv"))) == 2
    assert client.delete(f"/vehicles/{v['id']}", headers=ALICE).status_code == 204
    assert all(client.get(f"/scans/{s}", headers=ALICE).status_code == 404 for s in sids)
    assert list((tmp_path / "uploads").glob("*.csv")) == []


def test_deleting_a_scan_removes_its_file(client, tmp_path):
    v = make_vehicle(client)
    sid = upload(client, v["id"], LOG).json()["id"]
    assert client.delete(f"/scans/{sid}", headers=ALICE).status_code == 204
    assert client.get(f"/scans/{sid}", headers=ALICE).status_code == 404
    assert list((tmp_path / "uploads").glob("*.csv")) == []


def test_export_and_delete_my_data(client, tmp_path):
    v = make_vehicle(client)
    upload(client, v["id"], LOG)
    make_vehicle(client, headers=BOB, name="Bob's")
    exp = client.get("/me/export", headers=ALICE).json()
    assert len(exp["vehicles"]) == 1 and len(exp["scans"]) == 1
    assert client.delete("/me/data", headers=ALICE).status_code == 204
    assert client.get("/me/export", headers=ALICE).json() == {"vehicles": [], "scans": []}
    assert len(client.get("/vehicles", headers=BOB).json()) == 1          # other users untouched
    assert list((tmp_path / "uploads").glob("*.csv")) == []


def test_data_survives_a_restart(tmp_path):
    c1 = TestClient(create_app(Settings(data_dir=tmp_path)))
    v = make_vehicle(c1)
    sid = upload(c1, v["id"], LOG).json()["id"]
    c2 = TestClient(create_app(Settings(data_dir=tmp_path)))
    assert c2.get(f"/scans/{sid}", headers=ALICE).json()["status"] == "ready"


# ---------- canonical import (the path other adapters, such as the mobile app, will use) ----------
def _series(n=120):
    return {"rpm": [1500.0] * n, "coolant_temp_c": [90.0] * n, "battery_v": [13.4] * n, "intake_air_temp_c": [35.0] * n}


def test_canonical_import_scores_the_series(client):
    v = make_vehicle(client)
    body = {"vehicleId": v["id"], "series": _series(), "durationMin": 30, "source": "Demo", "simulated": True,
            "startedAt": "2026-10-01T08:00:00Z"}
    r = client.post("/scans/import", json=body, headers=ALICE)
    assert r.status_code == 201
    scan = r.json()
    assert scan["score"] == summarize_scan(_series()).score == 100 and scan["simulated"] is True
    assert scan["startedAt"] == "2026-10-01T08:00:00Z" and scan["durationMin"] == 30 and scan["source"] == "Demo"
    assert TS_SCAN_KEYS <= set(scan) and len(client.get("/scans", headers=ALICE).json()) == 1


@pytest.mark.parametrize("mutate,code", [
    (lambda b: b["series"].update(bogus=[1.0] * 120), 422),
    (lambda b: b["series"].update(rpm=[1.0] * 5), 422),
    (lambda b: b.update(series={}), 422),
    (lambda b: b.update(vehicleId="veh_nope"), 404),
    (lambda b: b.update(durationMin=0), 422),
])
def test_canonical_import_validation(client, mutate, code):
    v = make_vehicle(client)
    body = {"vehicleId": v["id"], "series": _series()}
    mutate(body)
    assert client.post("/scans/import", json=body, headers=ALICE).status_code == code


def test_canonical_import_accepts_gaps_as_null(client):
    v = make_vehicle(client)
    s = _series()
    s["battery_v"] = [None] * 120
    scan = client.post("/scans/import", json={"vehicleId": v["id"], "series": s}, headers=ALICE).json()
    assert scan["scoredSignals"] == 3 and "battery_v" not in scan["series"]


def test_cors_preflight_allows_the_frontend_origin(client):
    r = client.options("/scans", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                                          "Access-Control-Request-Headers": "x-dev-user"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "http://localhost:5173"
