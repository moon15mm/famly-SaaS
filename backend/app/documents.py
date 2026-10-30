import hashlib
import hmac
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from .config import settings
from .db import get_db
from .models_ext import VerificationDocument
from .security import current_user, roles, household, audit, limit
from .catalog import save_image

router = APIRouter(tags=["private verification documents"])
development_signing_key = secrets.token_urlsafe(48)


def key():
    if len(settings.private_link_secret) >= 32:
        return settings.private_link_secret
    if settings.app_env == "production":
        raise HTTPException(503, "يلزم إعداد مفتاح توقيع المستندات الخاصة")
    return development_signing_key


def document_json(d):
    return {k: getattr(d, k) for k in ["id", "owner_id", "household_id", "kind", "status", "reviewer_note", "created_at"]}


def allowed(db, document_id, user):
    d = db.get(VerificationDocument, document_id)
    if not d or (d.owner_id != user.id and user.role != "admin"):
        raise HTTPException(404, "المستند غير موجود")
    return d


@router.post("/verification/documents", status_code=201)
async def upload(file: UploadFile, kind: str = "وثيقة أهلية", user=Depends(roles("seller", "driver")), db=Depends(get_db)):
    limit("document:" + user.id, 10, 300)
    if not 2 <= len(kind) <= 80:
        raise HTTPException(422, "نوع مستند غير صالح")
    raw = await file.read(5 * 1024 * 1024 + 1)
    # Re-encode phone scans. Active formats such as SVG, HTML and PDF are not accepted.
    url = save_image(raw)
    public_path = Path(settings.media_dir) / url.removeprefix("/media/")
    folder = Path(settings.private_dir)
    folder.mkdir(parents=True, exist_ok=True)
    filename = secrets.token_hex(24) + ".webp"
    public_path.replace(folder / filename)
    thumbnail = public_path.parent / ("thumb-" + public_path.name)
    thumbnail.unlink(missing_ok=True)
    h = household(db, user) if user.role == "seller" else None
    d = VerificationDocument(owner_id=user.id, household_id=h.id if h else None, kind=kind, filename=filename, mime_type="image/webp")
    db.add(d)
    db.flush()
    audit(db, user, "verification.upload", d.id)
    db.commit()
    return document_json(d)


@router.get("/verification/documents")
def listing(user=Depends(current_user), db=Depends(get_db)):
    statement = select(VerificationDocument).order_by(VerificationDocument.created_at.desc())
    if user.role != "admin":
        statement = statement.where(VerificationDocument.owner_id == user.id)
    return [document_json(d) for d in db.scalars(statement.limit(200))]


@router.post("/verification/documents/{document_id}/link")
def link(document_id: str, user=Depends(current_user), db=Depends(get_db)):
    d = allowed(db, document_id, user)
    expires = int(time.time()) + 300
    payload = f"{d.id}:{user.id}:{expires}"
    signature = hmac.new(key().encode(), payload.encode(), hashlib.sha256).hexdigest()
    return {"url": f"/api/verification/documents/{d.id}/file?expires={expires}&signature={signature}", "expires_in": 300}


@router.get("/verification/documents/{document_id}/file")
def download(document_id: str, expires: int, signature: str, user=Depends(current_user), db=Depends(get_db)):
    d = allowed(db, document_id, user)
    if expires < int(time.time()) or expires > int(time.time()) + 305:
        raise HTTPException(403, "انتهت صلاحية الرابط")
    expected = hmac.new(key().encode(), f"{d.id}:{user.id}:{expires}".encode(), hashlib.sha256).hexdigest()
    if not secrets.compare_digest(expected, signature):
        raise HTTPException(403, "الرابط غير صالح")
    path = Path(settings.private_dir) / d.filename
    if not path.is_file():
        raise HTTPException(404, "الملف غير موجود")
    return FileResponse(
        path,
        media_type=d.mime_type,
        filename="verification-" + d.id + ".webp",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


class ReviewInput(BaseModel):
    status: str = Field(pattern=r"^(accepted|rejected)$")
    note: str = Field(default="", max_length=1000)


@router.post("/admin/verification/{document_id}/review")
def review(document_id: str, data: ReviewInput, user=Depends(roles("admin")), db=Depends(get_db)):
    d = allowed(db, document_id, user)
    d.status, d.reviewer_note = data.status, data.note
    audit(db, user, "verification." + data.status, d.id)
    db.commit()
    return document_json(d)
