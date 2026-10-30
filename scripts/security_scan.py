"""Small transparent source scan. Not a substitute for a dedicated secret scanner."""

import json
import re
from pathlib import Path

roots = [Path("backend/app"), Path("frontend/app"), Path("frontend/components"), Path("frontend/lib"), Path("deploy"), Path("scripts")]
patterns = {
    "private_key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "telegram_token": r"\b\d{8,12}:[A-Za-z0-9_-]{35}\b",
    "aws_access_key": r"\bAKIA[0-9A-Z]{16}\b",
    "openai_style_key": r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b",
}
findings = []
count = 0
for root in roots:
    for path in root.rglob("*"):
        if path.suffix not in {".py", ".ts", ".tsx", ".css", ".json", ".yaml", ".Dockerfile", ".sh", ".ps1"} or "__pycache__" in path.parts:
            continue
        count += 1
        text = path.read_text(encoding="utf-8")
        for label, pattern in patterns.items():
            if re.search(pattern, text):
                findings.append({"file": str(path), "type": label})
report = {
    "files_checked": count,
    "findings": findings,
    "limits": "Pattern scan only; excludes .env, test credentials, binaries and dependency files. Does not prove absence of secrets.",
}
Path("reports").mkdir(exist_ok=True)
Path("reports/secret-scan.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
raise SystemExit(bool(findings))
