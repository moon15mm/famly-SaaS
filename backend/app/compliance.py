"""Contracts and required documents that families and drivers complete before operating."""

import hashlib
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from .db import get_db
from .models import Notification, User
from .models_ext import ContractAcceptance, ContractVersion, DocumentRequirement, VerificationDocument
from .security import audit, current_user, limit, roles

router = APIRouter(tags=["contracts and requirements"])
RIYADH = ZoneInfo("Asia/Riyadh")
EXPIRY_NOTICE_DAYS = 14
VALID = {"accepted", "expiring"}


def today() -> date:
    return datetime.now(RIYADH).date()


def current_contract(db, role):
    return db.scalar(select(ContractVersion).where(ContractVersion.role == role).order_by(ContractVersion.version.desc()).limit(1))


def acceptance_of(db, user, contract):
    if not contract:
        return None
    return db.scalar(
        select(ContractAcceptance).where(ContractAcceptance.user_id == user.id, ContractAcceptance.contract_id == contract.id)
    )


def contract_signed(db, user) -> bool:
    contract = current_contract(db, user.role)
    return contract is None or acceptance_of(db, user, contract) is not None


def document_state(uploads, requirement, day):
    """State of one requirement from the owner's uploads, newest first."""
    valid = [
        d
        for d in uploads
        if d.status == "accepted" and (not requirement.needs_expiry or (d.expires_on is not None and d.expires_on >= day))
    ]
    if valid:
        best = max(valid, key=lambda d: d.expires_on or date.max)
        soon = requirement.needs_expiry and best.expires_on <= day + timedelta(days=EXPIRY_NOTICE_DAYS)
        return ("expiring" if soon else "accepted"), best
    if uploads and uploads[0].status == "pending":
        return "pending", uploads[0]
    if any(d.status == "accepted" for d in uploads):
        return "expired", next(d for d in uploads if d.status == "accepted")
    if uploads and uploads[0].status == "rejected":
        return "rejected", uploads[0]
    return "missing", None


def status(db, user, include_body=True):
    contract = current_contract(db, user.role)
    accepted = acceptance_of(db, user, contract)
    requirements = db.scalars(
        select(DocumentRequirement)
        .where(DocumentRequirement.role == user.role, DocumentRequirement.active.is_(True))
        .order_by(DocumentRequirement.position, DocumentRequirement.id)
    )
    uploads = {}
    for d in db.scalars(
        select(VerificationDocument)
        .where(VerificationDocument.owner_id == user.id, VerificationDocument.requirement_id.is_not(None))
        .order_by(VerificationDocument.created_at.desc())
    ):
        uploads.setdefault(d.requirement_id, []).append(d)
    day = today()
    documents = []
    for r in requirements:
        state, document = document_state(uploads.get(r.id, []), r, day)
        documents.append(
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "required": r.required,
                "needs_expiry": r.needs_expiry,
                "state": state,
                "document_id": document.id if document else None,
                "expires_on": document.expires_on if document else None,
                "note": document.reviewer_note if document else "",
            }
        )
    missing = [d["title"] for d in documents if d["required"] and d["state"] not in VALID]
    signed = contract is None or accepted is not None
    if not signed:
        missing.insert(0, "قبول «" + contract.title + "»")
    result = {"role": user.role, "contract": None, "documents": documents, "missing": missing, "complete": not missing}
    if contract:
        result["contract"] = {
            "id": contract.id,
            "version": contract.version,
            "title": contract.title,
            "accepted": accepted is not None,
            "acceptance_id": accepted.id if accepted else None,
            "accepted_at": accepted.accepted_at if accepted else None,
        }
        if include_body:
            result["contract"]["body"] = contract.body
    return result


def require_ready(db, user, message):
    state = status(db, user, include_body=False)
    if not state["complete"]:
        raise HTTPException(409, message + ": " + "، ".join(state["missing"]))


def require_signed(db, user, message="يلزم قبول عقد الأسرة الحالي قبل إضافة المنتجات أو نشرها"):
    if not contract_signed(db, user):
        raise HTTPException(409, message)


@router.get("/compliance")
def mine(user=Depends(roles("seller", "driver")), db=Depends(get_db)):
    return status(db, user)


class AcceptInput(BaseModel):
    contract_id: str = Field(max_length=32)
    full_name: str = Field(min_length=3, max_length=100)
    agree: bool


def acceptance_json(item, contract, owner):
    return {
        "id": item.id,
        "contract_id": contract.id,
        "role": contract.role,
        "version": contract.version,
        "title": contract.title,
        "body": contract.body,
        "body_hash": contract.body_hash,
        "published_at": contract.published_at,
        "full_name": item.full_name,
        "accepted_at": item.accepted_at,
        "ip": item.ip,
        "account_email": owner.email,
    }


@router.post("/compliance/contract", status_code=201)
def accept(data: AcceptInput, request: Request, user=Depends(roles("seller", "driver")), db=Depends(get_db)):
    limit("contract:" + user.id, 10, 300)
    contract = current_contract(db, user.role)
    if not contract or contract.id != data.contract_id:
        raise HTTPException(409, "صدر إصدار أحدث من العقد؛ يلزم مراجعته قبل القبول")
    name = " ".join(data.full_name.split())
    if not data.agree or len(name) < 3:
        raise HTTPException(422, "يلزم كتابة الاسم الكامل والموافقة على العقد")
    existing = acceptance_of(db, user, contract)
    if existing:
        return acceptance_json(existing, contract, user)
    item = ContractAcceptance(
        user_id=user.id,
        contract_id=contract.id,
        full_name=name,
        ip=(request.client.host if request.client else "")[:64],
        user_agent=request.headers.get("user-agent", "")[:200],
    )
    db.add(item)
    try:
        db.flush()
        audit(db, user, "contract.accept." + contract.role + ".v" + str(contract.version), item.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        item = acceptance_of(db, user, contract)
    return acceptance_json(item, contract, user)


@router.get("/contracts/acceptances/{acceptance_id}")
def acceptance_copy(acceptance_id: str, user=Depends(current_user), db=Depends(get_db)):
    item = db.get(ContractAcceptance, acceptance_id)
    if not item or (item.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "نسخة العقد غير موجودة")
    return acceptance_json(item, db.get(ContractVersion, item.contract_id), db.get(User, item.user_id))


@router.get("/admin/contracts")
def contracts(user=Depends(roles("admin")), db=Depends(get_db)):
    result = []
    for role in ("seller", "driver"):
        versions = []
        for v in db.scalars(select(ContractVersion).where(ContractVersion.role == role).order_by(ContractVersion.version.desc()).limit(10)):
            versions.append(
                {
                    "id": v.id,
                    "version": v.version,
                    "title": v.title,
                    "published_at": v.published_at,
                    "acceptances": db.scalar(select(func.count()).select_from(ContractAcceptance).where(ContractAcceptance.contract_id == v.id)),
                }
            )
        current = current_contract(db, role)
        result.append({"role": role, "title": current.title if current else "", "body": current.body if current else "", "versions": versions})
    return result


class ContractInput(BaseModel):
    role: Literal["seller", "driver"]
    title: str = Field(min_length=3, max_length=150)
    body: str = Field(min_length=50, max_length=50000)


@router.post("/admin/contracts", status_code=201)
def publish(data: ContractInput, user=Depends(roles("admin")), db=Depends(get_db)):
    current = current_contract(db, data.role)
    if current and current.title == data.title.strip() and current.body == data.body.strip():
        raise HTTPException(409, "لا يوجد تغيير عن الإصدار الحالي")
    version = (current.version if current else 0) + 1
    body = data.body.strip()
    item = ContractVersion(
        role=data.role,
        version=version,
        title=data.title.strip(),
        body=body,
        body_hash=hashlib.sha256(body.encode()).hexdigest(),
        published_by=user.id,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "نُشر إصدار آخر في الوقت نفسه؛ أعد تحميل الصفحة") from None
    for user_id in db.scalars(select(User.id).where(User.role == data.role, User.active.is_(True))):
        db.add(Notification(user_id=user_id, message="صدر الإصدار " + str(version) + " من «" + item.title + "»؛ يلزم قبوله لمتابعة العمل"))
    audit(db, user, "contract.publish." + data.role + ".v" + str(version), item.id)
    db.commit()
    return {"id": item.id, "version": version}


def requirement_json(r):
    return {k: getattr(r, k) for k in ["id", "role", "title", "description", "required", "needs_expiry", "active", "position"]}


@router.get("/admin/requirements")
def requirements(user=Depends(roles("admin")), db=Depends(get_db)):
    return [
        requirement_json(r)
        for r in db.scalars(select(DocumentRequirement).order_by(DocumentRequirement.role, DocumentRequirement.position, DocumentRequirement.id))
    ]


class RequirementInput(BaseModel):
    role: Literal["seller", "driver"]
    title: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)
    required: bool = True
    needs_expiry: bool = False
    active: bool = True
    position: int = Field(default=0, ge=0, le=100)


@router.put("/admin/requirements/{requirement_id}")
def save_requirement(requirement_id: str, data: RequirementInput, user=Depends(roles("admin")), db=Depends(get_db)):
    import re

    if not re.fullmatch(r"[a-z0-9-]{2,50}", requirement_id):
        raise HTTPException(422, "معرف المتطلب غير صالح")
    item = db.get(DocumentRequirement, requirement_id)
    if item and item.role != data.role:
        raise HTTPException(409, "لا يُنقل المتطلب بين الأدوار؛ أنشئ متطلبًا جديدًا")
    if not item:
        item = DocumentRequirement(id=requirement_id)
        db.add(item)
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    audit(db, user, "requirement.save", requirement_id)
    db.commit()
    return requirement_json(item)


@router.get("/admin/compliance/{user_id}")
def user_compliance(user_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.role not in {"seller", "driver"}:
        raise HTTPException(404, "الحساب غير موجود")
    return status(db, target, include_body=False)
