import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
config = json.loads((root / "data/pg-tools/runtime.json").read_text(encoding="utf-8"))
if config["host"] != "127.0.0.1" or not config["dbname"].startswith("min_buyutna_test_"):
    raise SystemExit("Refusing an unexpected database target")
env = {
    **os.environ,
    "TEST_DATABASE_URL": f"postgresql+psycopg://{quote(config['user'])}:{quote(config['password'])}@127.0.0.1:{config['port']}/{config['dbname']}",
    "PYTHONPATH": str(root / "backend"),
}
result = subprocess.run(
    [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "-x",
        "--tb=short",
        "--basetemp",
        str(root / "data" / ("pytest-pg-" + uuid4().hex)),
        "--junitxml",
        str(root / "reports/pytest-postgresql.xml"),
    ],
    cwd=root,
    env=env,
)
raise SystemExit(result.returncode)
