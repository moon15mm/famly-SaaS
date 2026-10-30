from datetime import timedelta
from sqlalchemy import select
from app.bootstrap import ensure_defaults
from app.compliance import today
from app.models import Household, Notification, User
from app.models_ext import VerificationDocument

DRIVER_DOCS = ["national-id", "driving-license", "vehicle-registration", "vehicle-insurance", "driver-photo"]
DRAFT = {"name": "منتج جديد", "description": "وصف", "price": 1500, "stock": 3, "category_id": "food", "status": "draft"}


def defaults(factory):
    with factory() as db:
        ensure_defaults(db)
        db.commit()


def sign(c, role):
    contract = c[role].get("/api/compliance").json()["contract"]
    return c[role].post("/api/compliance/contract", json={"contract_id": contract["id"], "full_name": "اسم الاختبار الكامل", "agree": True})


def upload(c, role, requirement, image_bytes, expires=None):
    url = "/api/verification/documents?requirement_id=" + requirement + ("&expires_on=" + expires.isoformat() if expires else "")
    return c[role].post(url, files={"file": ("doc.png", image_bytes, "image/png")})


def complete_driver(c, role, image_bytes):
    assert sign(c, role).status_code == 201
    future = today() + timedelta(days=200)
    for requirement in DRIVER_DOCS:
        document = upload(c, role, requirement, image_bytes, None if requirement == "driver-photo" else future)
        assert document.status_code == 201
        assert c["admin"].post(f"/api/admin/verification/{document.json()['id']}/review", json={"status": "accepted"}).status_code == 200


def test_driver_needs_contract_and_valid_documents_before_shift(setup, image_bytes):
    factory, c = setup
    defaults(factory)
    with factory() as db:
        db.get(User, "driver").available = False
        db.commit()
    state = c["driver"].get("/api/compliance").json()
    assert not state["complete"] and state["contract"]["accepted"] is False and "مسودة" in state["contract"]["body"]
    assert [d["id"] for d in state["documents"] if d["required"]] == DRIVER_DOCS
    blocked = c["driver"].post("/api/driver/availability?available=true")
    assert blocked.status_code == 409 and "رخصة القيادة" in blocked.json()["detail"]
    assert c["driver"].post("/api/compliance/contract", json={"contract_id": state["contract"]["id"], "full_name": "اسم كامل", "agree": False}).status_code == 422
    assert sign(c, "driver").status_code == 201
    assert upload(c, "driver", "driving-license", image_bytes).status_code == 422
    assert upload(c, "driver", "driving-license", image_bytes, today() - timedelta(days=1)).status_code == 422
    assert upload(c, "driver", "health-certificate", image_bytes, today() + timedelta(days=9)).status_code == 422
    ids = []
    for requirement in DRIVER_DOCS:
        document = upload(c, "driver", requirement, image_bytes, None if requirement == "driver-photo" else today() + timedelta(days=200))
        assert document.status_code == 201
        ids.append(document.json()["id"])
    assert c["driver"].post("/api/driver/availability?available=true").status_code == 409
    for document_id in ids:
        assert c["admin"].post(f"/api/admin/verification/{document_id}/review", json={"status": "accepted"}).status_code == 200
    assert c["driver"].get("/api/compliance").json()["complete"] is True
    assert c["driver"].post("/api/driver/availability?available=true").status_code == 200
    assert c["driver"].get("/api/driver/summary").json()["compliance"] == {"complete": True, "missing": []}
    with factory() as db:
        assert any("مقبول" in n.message for n in db.scalars(select(Notification).where(Notification.user_id == "driver")))


def test_admin_verifies_driver_only_after_requirements(setup, image_bytes):
    factory, c = setup
    defaults(factory)
    with factory() as db:
        driver = db.get(User, "driver2")
        driver.driver_verified, driver.available = False, False
        db.commit()
    blocked = c["admin"].post("/api/admin/users/driver2/status?active=true&driver_verified=true")
    assert blocked.status_code == 409 and "قبول" in blocked.json()["detail"]
    complete_driver(c, "driver2", image_bytes)
    assert c["admin"].post("/api/admin/users/driver2/status?active=true&driver_verified=true").status_code == 200
    assert c["admin"].get("/api/admin/compliance/driver2").json()["complete"] is True


def test_expired_document_ends_shift_and_expiry_is_announced_once(setup, image_bytes, monkeypatch):
    from app import jobs, worker

    factory, c = setup
    defaults(factory)
    complete_driver(c, "driver", image_bytes)
    assert c["driver"].post("/api/driver/availability?available=true").status_code == 200
    with factory() as db:
        documents = {d.requirement_id: d for d in db.scalars(select(VerificationDocument).where(VerificationDocument.owner_id == "driver"))}
        documents["driving-license"].expires_on = today() - timedelta(days=1)
        documents["vehicle-insurance"].expires_on = today() + timedelta(days=5)
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", factory)
    for _ in range(2):
        monkeypatch.setattr(jobs, "_swept_at", 0.0)
        worker.tick()
    with factory() as db:
        assert db.get(User, "driver").available is False
        messages = [n.message for n in db.scalars(select(Notification).where(Notification.user_id == "driver"))]
    assert any("توقف استقبال المشاوير" in m and "رخصة القيادة" in m for m in messages)
    assert sum("ينتهي «تأمين المركبة»" in m for m in messages) == 1
    states = {d["id"]: d["state"] for d in c["driver"].get("/api/compliance").json()["documents"]}
    assert (states["driving-license"], states["vehicle-insurance"]) == ("expired", "expiring")
    assert c["driver"].post("/api/driver/availability?available=true").status_code == 409


def test_family_signs_before_adding_or_publishing_but_keeps_selling(setup):
    factory, c = setup
    defaults(factory)
    assert c["seller"].post("/api/seller/products", json=DRAFT).status_code == 409
    assert any(p["id"] == "product0" for p in c["customer"].get("/api/products").json()["items"])
    existing = next(p for p in c["seller"].get("/api/seller/products").json() if p["id"] == "product0")
    edit = {k: existing[k] for k in ["name", "description", "category_id", "price", "prep_hours", "images", "options", "status"]}
    assert c["seller"].put("/api/seller/products/product0", json={**edit, "stock": 9}).status_code == 200
    assert sign(c, "seller").status_code == 201
    assert c["seller"].post("/api/seller/products", json=DRAFT).status_code == 201


def test_new_contract_version_requires_new_acceptance(setup):
    factory, c = setup
    defaults(factory)
    assert sign(c, "seller").status_code == 201
    first = c["seller"].get("/api/compliance").json()["contract"]["id"]
    current = next(x for x in c["admin"].get("/api/admin/contracts").json() if x["role"] == "seller")
    change = {"role": "seller", "title": current["title"], "body": current["body"] + "\n\n11. بند إضافي للاختبار يوضح التزامًا جديدًا."}
    assert c["seller"].post("/api/admin/contracts", json=change).status_code == 403
    assert c["admin"].post("/api/admin/contracts", json={**change, "body": current["body"]}).status_code == 409
    published = c["admin"].post("/api/admin/contracts", json=change)
    assert published.status_code == 201 and published.json()["version"] == 2
    stale = c["seller"].post("/api/compliance/contract", json={"contract_id": first, "full_name": "اسم الاختبار الكامل", "agree": True})
    assert stale.status_code == 409
    assert c["seller"].post("/api/seller/products", json=DRAFT).status_code == 409
    assert sign(c, "seller").status_code == 201
    assert c["seller"].post("/api/seller/products", json=DRAFT).status_code == 201
    copy_id = c["seller"].get("/api/compliance").json()["contract"]["acceptance_id"]
    copy = c["seller"].get("/api/contracts/acceptances/" + copy_id).json()
    assert (copy["version"], copy["full_name"]) == (2, "اسم الاختبار الكامل")
    assert c["seller2"].get("/api/contracts/acceptances/" + copy_id).status_code == 404
    assert c["admin"].get("/api/contracts/acceptances/" + copy_id).status_code == 200
    with factory() as db:
        assert any("الإصدار 2" in n.message for n in db.scalars(select(Notification).where(Notification.user_id == "seller")))


def test_required_family_document_blocks_verification_until_accepted(setup, image_bytes):
    factory, c = setup
    defaults(factory)
    with factory() as db:
        db.get(Household, "seller2").verified = False
        db.commit()
    health = next(r for r in c["admin"].get("/api/admin/requirements").json() if r["id"] == "health-certificate")
    fields = {k: health[k] for k in ["role", "title", "description", "required", "needs_expiry", "active", "position"]}
    assert c["admin"].put("/api/admin/requirements/health-certificate", json={**fields, "role": "driver"}).status_code == 409
    assert c["admin"].put("/api/admin/requirements/health-certificate", json={**fields, "required": True}).status_code == 200
    assert sign(c, "seller2").status_code == 201
    blocked = c["admin"].post("/api/admin/households/seller2/verify?verified=true")
    assert blocked.status_code == 409 and "الشهادة الصحية" in blocked.json()["detail"]
    document = upload(c, "seller2", "health-certificate", image_bytes, today() + timedelta(days=90)).json()
    assert c["admin"].post(f"/api/admin/verification/{document['id']}/review", json={"status": "accepted"}).status_code == 200
    assert c["admin"].post("/api/admin/households/seller2/verify?verified=true").status_code == 200
