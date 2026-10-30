"""Non-destructive local restore drill: restore only into a newly created directory."""

import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
source = Path("data/market.db")
if not source.exists():
    raise SystemExit("Local database does not exist")
folder = Path("backups") / stamp
folder.mkdir(parents=True, exist_ok=False)
with sqlite3.connect(source) as original, sqlite3.connect(folder / "market.db") as backup:
    original.backup(backup)
shutil.copytree("data/media", folder / "media")
if Path("data/private").exists():
    shutil.copytree("data/private", folder / "private")
manifest = {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob("*") if p.is_file()}
(folder / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
restored = Path("backups") / ("restore-drill-" + stamp)
restored.mkdir(exist_ok=False)
shutil.copy2(folder / "market.db", restored / "market.db")
shutil.copytree(folder / "media", restored / "media")
if (folder / "private").exists():
    shutil.copytree(folder / "private", restored / "private")
for relative, expected in manifest.items():
    assert hashlib.sha256((restored / relative).read_bytes()).hexdigest() == expected
with sqlite3.connect(restored / "market.db") as db:
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    counts = {
        table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
        for table in ["users", "households", "products", "orders", "alembic_version"]
    }
report = {
    "status": "passed",
    "database": "SQLite development only",
    "backup": str(folder),
    "restore": str(restored),
    "files_verified": len(manifest),
    "private_files_verified": sum(1 for relative in manifest if Path(relative).parts[0] == "private"),
    "counts": counts,
}
Path("reports").mkdir(exist_ok=True)
Path("reports/backup-restore.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
