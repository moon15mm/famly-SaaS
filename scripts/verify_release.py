"""Verify a source archive without extracting or exposing local credentials."""

import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

archive_path = Path("releases/min-buyutna-source.zip")
with ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert len(names) == len(set(names))
    manifest = json.loads(archive.read("docs/release-manifest.json"))
    assert set(names) == set(manifest) | {"docs/release-manifest.json"}
    for name, expected in manifest.items():
        path = PurePosixPath(name)
        assert not path.is_absolute() and ".." not in path.parts
        assert path.name != ".env" and not {"data", "backups", "node_modules", ".venv", ".next"}.intersection(path.parts)
        assert hashlib.sha256(archive.read(name)).hexdigest() == expected
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
assert Path("releases/SHA256SUMS").read_text().split()[0] == digest
report = {"status": "passed", "files_verified": len(manifest), "archive_sha256": digest, "credentials_and_runtime_data_excluded": True}
Path("releases/verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
