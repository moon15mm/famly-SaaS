import asyncio
import json
import statistics
import time
from pathlib import Path
import httpx


async def main():
    semaphore = asyncio.Semaphore(5)
    results = []
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=20) as client:

        async def sample():
            async with semaphore:
                started = time.perf_counter()
                response = await client.get("/api/products")
                results.append({"status": response.status_code, "ms": (time.perf_counter() - started) * 1000})

        started = time.perf_counter()
        await asyncio.gather(*(sample() for _ in range(50)))
        elapsed = time.perf_counter() - started
    values = sorted(r["ms"] for r in results)
    report = {
        "requests": 50,
        "concurrency": 5,
        "endpoint": "GET /api/products",
        "database": "local SQLite",
        "successful": sum(r["status"] == 200 for r in results),
        "elapsed_seconds": round(elapsed, 3),
        "p50_ms": round(statistics.median(values), 2),
        "p95_ms": round(values[47], 2),
        "max_ms": round(max(values), 2),
        "limits": "Small local read-only load sample; not a capacity guarantee or production PostgreSQL benchmark.",
    }
    Path("reports/api-performance.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    if report["successful"] != 50:
        raise SystemExit(1)


asyncio.run(main())
