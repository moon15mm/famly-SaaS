"""Fetch licensed sample images and font files into local storage for development."""

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import io
import httpx
from PIL import Image

PHOTOS = [
    "photo-1578985545062-69928b1d9587",
    "photo-1555507036-ab1f4038808a",
    "photo-1608571423902-eed4a5ad8108",
    "photo-1490312278390-ab64016e0aa9",
    "photo-1513519245088-0e12902e5a38",
    "photo-1499636136210-6f4ee915583e",
    "photo-1544787219-7f47ccb76574",
    "photo-1578749556568-bc2c40e68b61",
]
Path("data/media").mkdir(parents=True, exist_ok=True)
Path("frontend/public/fonts").mkdir(parents=True, exist_ok=True)


def photo(pair):
    i, photo_id = pair
    target = Path(f"data/media/demo-{i}.webp")
    if target.exists():
        return
    response = httpx.get(f"https://images.unsplash.com/{photo_id}?auto=format&fit=crop&w=1200&q=85", timeout=45, follow_redirects=True)
    response.raise_for_status()
    with Image.open(io.BytesIO(response.content)) as image:
        image.convert("RGB").save(target, "WEBP", quality=85)
    print("Downloaded demo image", i)


with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(photo, enumerate(PHOTOS)))
for weight in ["Regular", "Bold"]:
    response = httpx.get(f"https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-{weight}.ttf", timeout=40)
    response.raise_for_status()
    Path(f"frontend/public/fonts/tajawal-{weight.lower()}.ttf").write_bytes(response.content)
response = httpx.get("https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/OFL.txt", timeout=30)
response.raise_for_status()
Path("frontend/public/fonts/OFL.txt").write_text(response.text, encoding="utf-8")
