import time
import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from .config import settings
from .db import engine, get_db
from . import auth, catalog, orders, payments, delivery, account, admin, telegram
from . import lifecycle, addresses, subscriptions, documents, scheduling, admin_ext


@asynccontextmanager
async def lifespan(app):
    settings.validate_production()
    yield


app = FastAPI(
    title="من بيوتنا API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.app_env != "production" else None,
    openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    return JSONResponse(
        {"detail": "تحقق من البيانات المدخلة", "fields": [".".join(str(x) for x in item["loc"][1:]) for item in error.errors()]},
        status_code=422,
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    started = time.monotonic()
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        webhook = request.url.path in {"/api/payments/webhook/test", "/api/telegram/webhook"}
        origin = request.headers.get("origin")
        if not webhook and (
            (origin and origin != settings.public_origin) or (request.cookies.get("session") and origin != settings.public_origin)
        ):
            return JSONResponse({"detail": "مصدر الطلب غير مصرح به"}, status_code=403)
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > 6 * 1024 * 1024:
            return JSONResponse({"detail": "حجم الطلب يتجاوز الحد المسموح"}, status_code=413)
    try:
        response = await call_next(request)
    except Exception as error:
        reference = secrets.token_hex(8)
        logging.getLogger("market").error("Request failed: reference=%s type=%s", reference, type(error).__name__)
        response = JSONResponse({"detail": "تعذر إكمال الطلب؛ حاول لاحقًا", "reference": reference}, status_code=500)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    response.headers["Server-Timing"] = f"app;dur={(time.monotonic() - started) * 1000:.1f}"
    if request.url.path.startswith(
        (
            "/api/auth",
            "/api/orders",
            "/api/seller",
            "/api/admin",
            "/api/driver",
            "/api/account",
            "/api/notifications",
            "/api/addresses",
            "/api/verification",
            "/api/dev",
            "/api/subscription",
            "/api/favorites",
        )
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health", tags=["operations"])
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1 FROM alembic_version"))
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {
        "status": "ok",
        "environment": settings.app_env,
        "payments": settings.payment_provider,
        "delivery": "disabled" if settings.app_env == "production" else "test",
        "ai": settings.ai_provider,
    }


for route in [
    auth.router,
    catalog.router,
    orders.router,
    payments.router,
    delivery.router,
    account.router,
    admin.router,
    telegram.router,
    lifecycle.router,
    addresses.router,
    subscriptions.router,
    documents.router,
    scheduling.router,
    admin_ext.router,
]:
    app.include_router(route, prefix="/api")

Path(settings.media_dir).mkdir(parents=True, exist_ok=True)


@app.get("/media/{filename}")
def media(filename: str, request: Request, db=Depends(get_db)):
    return catalog.media_file(filename, request, db)
