"""Try the backend core from the command line, no server needed.

    python -m app.cli analyze path/to/trip.csv
    python -m app.cli analyze path/to/trip.csv --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .adapters import ParseError, parse_log
from .core.config import SIGNALS
from .core.scoring import severity_label, summarize_scan


def _fmt(v: float, key: str) -> str:
    if key == "rpm":
        return f"{v:.0f}"
    return f"{v:.2f}" if key in ("battery_v", "afr") else f"{v:.1f}"


def render(parsed, summary) -> str:
    out: list[str] = []
    when = parsed.started_at.strftime("%d %b %Y %H:%M") if parsed.started_at else "start time unknown"
    out.append(f"ApexDriver health report - {parsed.source}")
    out.append(f"{when}  |  {parsed.duration_s // 60} min {parsed.duration_s % 60} s  |  {parsed.sample_rate_hz} Hz after resampling")
    out.append("")
    out.append(f"Health score: {summary.score} / 100  ({severity_label(summary.severity)})")
    out.append(f"Based on {summary.scored_signals} of {summary.total_signals} scored signals")
    st = summary.states
    out.append(f"Engine state: warm-up {st.warmup:.0f}%  idle {st.idle:.0f}%  driving {st.driving:.0f}%")
    out.append("")
    head = f"{'Signal':<24}{'Average':>10}  {'Min - Max':<18}{'Normal/Watch/Alert %':<24}Status"
    out.append(head)
    out.append("-" * len(head))
    for s in summary.signals:
        cfg = SIGNALS[s.key]
        if not s.available:
            out.append(f"{cfg.label:<24}{'-':>10}  {'-':<18}{'-':<24}No data")
            continue
        rng = f"{_fmt(s.min, s.key)} - {_fmt(s.max, s.key)}"
        if s.scored:
            tib = f"{s.pct_normal:.0f} / {s.pct_watch:.0f} / {s.pct_alert:.0f}"
            status = severity_label(s.severity)
        else:
            tib, status = "-", "Context"
        out.append(f"{cfg.label:<24}{_fmt(s.avg, s.key) + ' ' + cfg.unit:>10}  {rng:<18}{tib:<24}{status}")
    if summary.mixture:
        m = summary.mixture
        out.append("")
        out.append(f"Fuel mixture (tuning indicator, not scored): median {m.median:.1f}:1, {m.pct_rich:.0f}% richer than 12.5:1")
    q = parsed.quality
    out.append("")
    out.append(f"Data quality: {q.raw_rows} raw rows, {q.skipped_lines} skipped, "
               f"{len(q.ignored_channels)} channels ignored, coverage "
               + ", ".join(f"{k} {v * 100:.0f}%" for k, v in sorted(q.coverage.items()) if k in SIGNALS and SIGNALS[k].scored))
    if q.dropped_implausible:
        out.append(f"Dropped implausible readings: {q.dropped_implausible}")
    for w in parsed.warnings:
        out.append(f"Note: {w}")
    out.append("This reflects only the uploaded log. It is not a mechanic's diagnosis.")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="apexdriver")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="parse a log file and print its health report")
    a.add_argument("file", type=Path)
    a.add_argument("--json", action="store_true", help="print machine-readable JSON instead of text")
    args = ap.parse_args(argv)
    try:
        data = args.file.read_bytes()
    except OSError as e:
        print(f"Could not read {args.file}: {e.strerror}", file=sys.stderr)
        return 2
    try:
        parsed = parse_log(data, args.file.name)
    except ParseError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    summary = summarize_scan(parsed.series)
    if args.json:
        print(json.dumps({"log": parsed.to_dict(), "summary": summary.to_dict()}, indent=2))
    else:
        print(render(parsed, summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
