"""Source handoff without credentials, local databases, uploads, or dependencies."""

import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path.cwd().resolve()
folders = ["backend", "frontend", "android", "deploy", "scripts", "docs", ".github", "reports"]
skip = {"node_modules", ".next", ".gradle", ".android", "build", "__pycache__", ".pytest_cache", ".ruff_cache", "test-results", "playwright-report"}
files = []
for folder in folders:
    for path in (root / folder).rglob("*"):
        relative = path.relative_to(root)
        if not path.is_file() or any(part in skip for part in relative.parts):
            continue
        if path.name in {"next-env.d.ts", "tsconfig.tsbuildinfo", "release-manifest.json", "local.properties"} or path.suffix in {".log", ".pyc", ".keystore"}:
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            continue
        files.append(path)
for name in [
    "README.md",
    "IMPLEMENTATION_PLAN.md",
    "IMPLEMENTATION_V2.md",
    "DECISIONS.md",
    "FINAL_ACCEPTANCE_REPORT.md",
    "CONTINUATION.md",
    "MEMORY.md",
    "Install-Android.cmd",
    ".env.example",
    ".gitignore",
    ".dockerignore",
    "compose.yaml",
    "pyproject.toml",
]:
    path = root / name
    if path.exists():
        files.append(path)
manifest = {str(p.relative_to(root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
manifest_path = root / "docs/release-manifest.json"
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
target = root / "releases/min-buyutna-source.zip"
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for path in files + [manifest_path]:
        archive.write(path, str(path.relative_to(root)))
    assert not any(
        name == ".env" or "/data/" in name.replace("\\", "/") or "/node_modules/" in name.replace("\\", "/") for name in archive.namelist()
    )
checksum = hashlib.sha256(target.read_bytes()).hexdigest()
(target.parent / "SHA256SUMS").write_text(checksum + "  " + target.name + "\n", encoding="utf-8")
print(json.dumps({"archive": str(target), "files": len(files) + 1, "bytes": target.stat().st_size, "sha256": checksum}))
