"""Isolated PostgreSQL 17 test server, never a system service or production database."""

import json
import os
from uuid import uuid4
import secrets
import socket
import subprocess
from pathlib import Path
import psycopg

root = Path(__file__).resolve().parents[1]
bin_dir = root / "data/pg-tools/node_modules/@embedded-postgres/windows-x64/native/bin"
folder = root / ("data/pg-test-" + uuid4().hex[:8])
config_file = root / "data/pg-tools/runtime.json"
port = 55432
os.environ["PATH"] = str(bin_dir) + os.pathsep + str(bin_dir.parent / "lib") + os.pathsep + os.environ.get("PATH", "")
if not (bin_dir / "postgres.exe").is_file():
    raise SystemExit("Install the isolated PostgreSQL binary package first")
if config_file.exists():
    config = json.loads(config_file.read_text(encoding="utf-8"))
    folder = Path(config["cluster_folder"])
    if not folder.resolve().is_relative_to((root / "data").resolve()):
        raise SystemExit("Unexpected test cluster directory")
else:
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            raise SystemExit("Test port is already occupied; no service changed")
    folder.mkdir(parents=True, exist_ok=False)
    password = secrets.token_urlsafe(32)
    password_file = folder / "init-password.txt"
    password_file.write_text(password, encoding="utf-8")
    try:
        result = subprocess.run(
            [
                str(bin_dir / "initdb.exe"),
                "-D",
                str(folder / "cluster"),
                "-U",
                "market_test",
                "--auth=scram-sha-256",
                "--no-locale",
                "--encoding=UTF8",
                "--no-sync",
                "--pwfile",
                str(password_file),
            ],
            stdout=(folder / "init.log").open("w", encoding="utf-8"),
            stderr=subprocess.STDOUT,
            timeout=300,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode:
            raise SystemExit("initdb failed; inspect the isolated init.log file")
    finally:
        password_file.unlink(missing_ok=True)
    config = {"host": "127.0.0.1", "port": port, "user": "market_test", "password": password, "dbname": "min_buyutna_test_suite"}
    config_file.write_text(json.dumps({**config, "cluster_folder": str(folder)}), encoding="utf-8")
status = subprocess.run(
    [str(bin_dir / "pg_ctl.exe"), "-D", str(folder / "cluster"), "status"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW
)
if status.returncode:
    startup = subprocess.run(
        [
            str(bin_dir / "pg_ctl.exe"),
            "-D",
            str(folder / "cluster"),
            "-l",
            str(folder / "postgres.log"),
            "-o",
            f"-h 127.0.0.1 -p {port} -c max_connections=40",
            "-w",
            "start",
        ],
        stdout=(folder / "control.log").open("a", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        timeout=300,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if startup.returncode:
        raise SystemExit("PostgreSQL test startup failed; inspect the isolated control.log file")
connection_config = {k: v for k, v in config.items() if k != "cluster_folder"}
with psycopg.connect(**{**connection_config, "dbname": "postgres"}, autocommit=True) as db:
    if not db.execute("SELECT 1 FROM pg_database WHERE datname=%s", (config["dbname"],)).fetchone():
        db.execute(psycopg.sql.SQL("CREATE DATABASE {}").format(psycopg.sql.Identifier(config["dbname"])))
    version = db.execute("SHOW server_version").fetchone()[0]
print(
    json.dumps(
        {
            "status": "ready",
            "server_version": version,
            "port": port,
            "database": config["dbname"],
            "scope": "isolated tests; app configuration unchanged",
        }
    )
)
