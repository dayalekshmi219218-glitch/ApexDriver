"""Write a synthetic ECU datalog you can feed to the CLI:  python scripts/make_synthetic_log.py out.csv [seconds] [variant]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tests"))
from synthetic import make_log  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "synthetic_haltech.csv")
secs = int(sys.argv[2]) if len(sys.argv) > 2 else 300
variant = int(sys.argv[3]) if len(sys.argv) > 3 else 0
text, _ = make_log(seed=7, duration_s=secs, variant=variant)
out.write_text(text)
print(f"wrote {out} ({out.stat().st_size // 1024} KB, {secs} s, variant {variant})")
