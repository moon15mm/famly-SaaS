"""Apply frozen migrations in a new test schema; never touch application tables."""

import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4
from urllib.parse import quote
import psycopg
from psycopg import sql

root = Path(__file__).resolve().parents[1]
config = json.loads((root / "data/pg-tools/runtime.json").read_text(encoding="utf-8"))
connection_config = {k: v for k, v in config.items() if k != "cluster_folder"}
if config["host"] != "127.0.0.1" or not config["dbname"].startswith("min_buyutna_test_"):
    raise SystemExit("Unexpected test target")
schema = "migration_" + uuid4().hex
url = f"postgresql+psycopg://{quote(config['user'])}:{quote(config['password'])}@127.0.0.1:{config['port']}/{config['dbname']}?options={quote('-csearch_path=' + schema)}"
env = {**os.environ, "DATABASE_URL": url, "PYTHONPATH": str(root / "backend")}
with psycopg.connect(**connection_config, autocommit=True) as db:
    db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    try:
        for command in [("upgrade", "head"), ("check",)]:
            subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *command], cwd=root, env=env, check=True)
        version = db.execute(sql.SQL("SELECT version_num FROM {}.alembic_version").format(sql.Identifier(schema))).fetchone()[0]
        result = {
            "status": "passed",
            "engine": db.execute("SHOW server_version").fetchone()[0],
            "migration": version,
            "isolated_schema": True,
        }
        (root / "reports/postgresql-migrations.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
    finally:
        db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
