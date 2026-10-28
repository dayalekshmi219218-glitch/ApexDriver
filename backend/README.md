# ApexDriver API - slices 1 and 2: parser, scorer, and the upload API

What works today:

1. **An ECU-log parser** that turns an uploaded Haltech "ECU Manager" CSV into the canonical scan shape.
2. **The scorer**, a Python port of the frontend scorer, proven identical to it by tests.
3. **A FastAPI server** with vehicles, upload, processing status, scans, delete (with cascade), export and delete-my-data.
4. **A command-line report** so you can try the parser and scorer without a server.

Still to come: Google sign-in and the real database (slice 3), trends and unusual-scan detection (slice 4), LLM explanations (slice 5).

## Setup

Needs Python 3.11 or newer.

    python3 -m venv .venv
    source .venv/bin/activate          # on Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    python -m pytest                   # 102 tests

## Run the server

    python -m uvicorn app.main:create_app --factory --reload --port 8000

Open http://localhost:8000/docs for the interactive API page. Data is kept in `./data` (SQLite file plus the uploaded files).
Settings (environment variables): `APEX_DATA_DIR`, `APEX_MAX_UPLOAD_BYTES` (default 10 MB), `APEX_CORS_ORIGINS`
(default `http://localhost:5173,http://localhost:4173`).

## Connect the web app

In the frontend project, copy `.env.example` to `.env.local` (it contains `VITE_API_URL=http://localhost:8000`) and run `npm run dev`.
Delete the file to go back to the in-browser simulator. In live mode:

- vehicles, uploads, scans and deletes all go to this server, and the report is the parser's real result;
- "Try the demo" loads its three synthetic vehicles into the server through `POST /scans/import`;
- sign-in is still simulated, and explanations are still built in the browser from the real scan data (until slices 3 and 5).

## The API

| Method and path | What it does |
|---|---|
| `GET /health` | Liveness check |
| `GET /vehicles`, `POST /vehicles`, `PATCH /vehicles/{id}`, `DELETE /vehicles/{id}` | Vehicle CRUD (name 1-40 chars, model year 1980 to next year or empty). Delete cascades to scans and files |
| `POST /scans` (multipart: `vehicle_id`, `file`) | Checks the file, stores it, returns `202 {id, status: "processing"}`. Parsing and scoring run in the background |
| `GET /scans/{id}` | `processing`, `failed` (with a reason), or the full scan in the frontend's `Scan` shape |
| `GET /scans[?vehicle_id=]` | Ready scans only |
| `POST /scans/import` (JSON) | Canonical-series ingestion: the path other adapters, such as the mobile app, will use |
| `DELETE /scans/{id}` | Removes the scan and its file |
| `GET /me/export`, `DELETE /me/data` | Export everything / delete everything for the caller |

Errors: `422` with a message the UI can show (wrong extension, unsupported format, invalid fields), `413` over the size limit, `404` unknown or someone else's.

Try it with curl:

    V=$(curl -s -X POST localhost:8000/vehicles -H 'Content-Type: application/json' -d '{"name":"My car","modelYear":2018}' | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
    S=$(curl -s -X POST localhost:8000/scans -F vehicle_id=$V -F file=@tests/fixtures/synthetic_haltech.csv | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
    curl -s localhost:8000/scans/$S | python -m json.tool | head -40

**Dev-only identity:** until slice 3, the caller names itself with an `X-Dev-User` header (default `dev-user`). Every query is scoped to it, but it
proves nothing about who the caller is. Do not expose this server to the internet; set `APEX_DEV_AUTH=0` to disable it.

## Command-line report

    python -m app.cli analyze tests/fixtures/synthetic_haltech.csv
    python -m app.cli analyze path/to/trip.csv --json

## How we know it is right

| Check | What it proves |
|---|---|
| `tests/test_scoring_parity.py` | The Python scorer matches the frontend scorer on 27 demo scans and 3,000+ values (golden file exported from the TypeScript code) |
| `tests/test_haltech_adapter.py` | Synthetic logs with independently computed true values must round-trip exactly; also channel reordering, midnight rollover, bad rows, impossible readings, bad files |
| `tests/test_api.py` | Every endpoint, user isolation, validation, 413/422/404 paths, failed and crashed processing never stuck at "processing", cascade delete removes files, restart persistence, CORS, and that the JSON has every field the frontend's `Scan` type needs |
| `tests/test_real_files.py` | Optional, local only: all 50 real trips parse and look physically sane (`ECU_DATALOG_DIR=... python -m pytest -m realfiles -s`) |
| End-to-end (run by hand before release) | Real server plus the built frontend in a headless browser: a real 30-minute log uploaded through the UI shows the same score the CLI computes, errors reach the screen, deleting a vehicle removes its scans and files on the server |

## Parser rules (app/adapters/haltech.py)

- Columns are matched **by name**, never by position: real files come in three layouts (19, 26 and 28 channels).
- Rows are event-driven. Each second keeps the last reading; gaps hold the last value; nothing is back-filled.
- Impossible clock times and timestamps that go backwards are skipped and counted. Midnight rollover is handled. Only the first logging session is used.
- Physically implausible readings (for example coolant above 150 C) are dropped and counted.
- Unit conversions are **inferred** (the dataset page lists no units); they live in one table and every result carries a warning saying so.
- Nothing is scored from a missing signal.

## Scoring rules (app/core/scoring.py)

Same as the frontend, including its deliberate differences from the Android scorer: missing signals are not scored as healthy; low-direction bands are
interpolated (Android scored a flat 60); overall = 60% weighted mean + 40% worst scored signal; any signal in Alert caps the overall score at 79.
JavaScript rounds halves up and Python rounds halves to even, so `js_round` keeps results identical. If you change a band, weight or rule in either
place, regenerate the golden file and run the tests:

    cd path/to/apexdriver-web
    FRONTEND_DIR=$PWD npx tsx path/to/apexdriver-api/scripts/export_golden.mts > path/to/apexdriver-api/tests/golden/scoring_golden.json

## Known limits of this slice

- Processing uses FastAPI background tasks inside the server process. If the server restarts mid-analysis, that scan stays "processing";
  slice 3 adds a clean-up on startup together with the real database.
- Files from scans that failed analysis are kept (so a bug can be reproduced) and are removed with the scan or vehicle.
- SQLite and local files are for development; Supabase replaces both behind the same `Store` methods.
- Only one adapter exists (ECU datalogs). Other formats are rejected with a clear message.

## Data and licence

No real dataset files are in this repo, and none should be committed: the Kaggle "Car ECU Datalogs" page shows "Data files (c) Original Authors",
which is not an open licence. All fixtures and golden data here are synthetic.

## Layout

    app/main.py             FastAPI app (routes, validation, dev identity)
    app/service.py          processing step, JSON shape for the frontend, canonical import
    app/store.py            SQLite + file storage (replaced by Supabase in slice 3)
    app/core/               config (bands, weights), scorer, canonical schema
    app/adapters/           upload checks and the ECU-log parser
    app/cli.py              command-line report
    scripts/                synthetic log maker, golden-file exporter
    tests/                  see the table above

## Next slices

3. Supabase: Google sign-in token check (replaces the dev identity), Postgres tables with row-level security, private file storage, start-up clean-up
4. Trends and unusual-scan detection endpoints (port of the frontend anomaly code, same golden-file approach)
5. LLM explanations with the faithfulness check and caching, then the evals harness
6. Dashboard endpoint and polish
