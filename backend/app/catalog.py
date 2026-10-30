import io
import warnings
from pathlib import Path
from uuid import uuid4
from PIL import Image, UnidentifiedImageError
from fastapi import APIRouter, Depends, HTTPException, UploadFile, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select, func, and_, or_
from .config import settings
from .db import get_db
from .models import Product, Household, Category, Plan, Review, Media, now
from .schemas import ProductInput, HouseholdInput
from .security import roles, household, audit, limit, current_user

router = APIRouter(tags=["catalog"])
Image.MAX_IMAGE_PIXELS = 20_000_000


def product_json(product, store=None):
    result = {
        k: getattr(product, k)
        for k in [
            "id",
            "household_id",
            "category_id",
            "name",
            "description",
            "price",
            "stock",
            "prep_hours",
            "images",
            "status",
            "featured",
            "options",
        ]
    }
    if store:
        result["household_name"] = store.name
        result["city"] = store.city
    return result


def store_json(store):
    return {
        k: getattr(store, k)
        for k in [
            "id",
            "name",
            "description",
            "city",
            "verified",
            "free_delivery",
            "delivery_enabled",
            "on_vacation",
            "opening_hour",
            "closing_hour",
            "slot_capacity",
        ]
    }


def subscription_lapsed(h):
    return h.subscription_status in {"expired", "suspended"} or (
        h.subscription_status == "trial" and h.trial_ends_at is not None and h.trial_ends_at < now()
    )


def storefront_open():
    """SQL twin of `verified and not subscription_lapsed(h)`; a lapsed store keeps its data but leaves the market."""
    status = Household.subscription_status
    return and_(
        Household.verified.is_(True),
        or_(status.is_(None), status.not_in(["expired", "suspended"])),
        or_(status.is_(None), status != "trial", Household.trial_ends_at.is_(None), Household.trial_ends_at >= now()),
    )


@router.get("/categories")
def categories(db=Depends(get_db)):
    return [{"id": c.id, "name": c.name, "icon": c.icon} for c in db.scalars(select(Category))]


@router.get("/products")
def products(
    q: str = Query("", max_length=100),
    category: str = "",
    household_id: str = "",
    sort: str = "featured",
    page: int = Query(1, ge=1),
    db=Depends(get_db),
):
    statement = select(Product, Household).join(Household).where(Product.status == "published", storefront_open())
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        statement = statement.where(Product.name.ilike(f"%{escaped}%", escape="\\") | Household.name.ilike(f"%{escaped}%", escape="\\"))
    if category:
        statement = statement.where(Product.category_id == category)
    if household_id:
        statement = statement.where(Product.household_id == household_id)
    count = db.scalar(select(func.count()).select_from(statement.subquery()))
    ordering = {"price_asc": Product.price.asc(), "price_desc": Product.price.desc(), "newest": Product.created_at.desc()}
    statement = statement.order_by(ordering.get(sort, Product.featured.desc()), Product.created_at.desc(), Product.id)
    return {"items": [product_json(p, h) for p, h in db.execute(statement.offset((page - 1) * 24).limit(24))], "total": count, "page": page}


@router.get("/products/{product_id}")
def product(product_id: str, db=Depends(get_db)):
    p = db.get(Product, product_id)
    h = db.get(Household, p.household_id) if p else None
    if not p or p.status != "published" or not h.verified or subscription_lapsed(h):
        raise HTTPException(404, "المنتج غير متاح")
    result = product_json(p, h)
    result["household"] = store_json(h)
    result["reviews"] = [
        {"rating": r.rating, "comment": r.comment} for r in db.scalars(select(Review).where(Review.household_id == h.id).limit(20))
    ]
    return result


@router.get("/households")
def stores(db=Depends(get_db)):
    return [store_json(h) for h in db.scalars(select(Household).where(storefront_open()).limit(50))]


@router.get("/households/{household_id}")
def store(household_id: str, db=Depends(get_db)):
    h = db.get(Household, household_id)
    if not h or not h.verified or subscription_lapsed(h):
        raise HTTPException(404, "الأسرة غير متاحة")
    return store_json(h)


@router.get("/seller/household")
def my_store(user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    return {
        **store_json(h),
        "pickup_address": h.pickup_address,
        "subscription_status": h.subscription_status,
        "trial_ends_at": h.trial_ends_at,
        "plan_id": h.plan_id,
        "telegram_linked": bool(h.telegram_user_id),
        "storefront_visible": h.verified and not subscription_lapsed(h),
    }


@router.put("/seller/household")
def update_store(data: HouseholdInput, user=Depends(roles("seller")), db=Depends(get_db)):
    if data.opening_hour >= data.closing_hour:
        raise HTTPException(422, "وقت الإغلاق يجب أن يلي وقت الافتتاح")
    h = household(db, user)
    for key, value in data.model_dump().items():
        setattr(h, key, value)
    audit(db, user, "household.update", h.id)
    db.commit()
    return {"ok": True}


@router.get("/seller/products")
def seller_products(user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    statement = select(Product).where(Product.household_id == h.id, Product.status != "archived").order_by(Product.created_at.desc())
    return [product_json(p, h) for p in db.scalars(statement)]


def validate_product(db, h, data):
    if any(data.price + option.price_delta < 100 for option in data.options):
        raise HTTPException(422, "سعر كل خيار يجب أن يكون ريالًا على الأقل")
    if not db.get(Category, data.category_id):
        raise HTTPException(422, "اختر تصنيفًا صحيحًا")
    if data.status == "published" and (not h.verified or not data.images or not h.pickup_address):
        raise HTTPException(422, "النشر يتطلب اعتماد الأسرة وصورة وموقع استلام")
    if data.status == "published" and subscription_lapsed(h):
        raise HTTPException(403, "انتهت صلاحية النشر؛ راجع حالة اشتراك الأسرة")
    for image in data.images:
        if not (Path(settings.media_dir) / image.removeprefix("/media/")).is_file():
            raise HTTPException(422, "الصورة غير موجودة")
        media = db.get(Media, image)
        if not media or media.owner_id != h.owner_id:
            raise HTTPException(422, "الصورة ليست مملوكة لهذا المتجر")


def sync_media(db, h):
    db.flush()
    published = db.scalars(select(Product).where(Product.household_id == h.id, Product.status == "published"))
    public_urls = {url for p in published for url in p.images}
    for item in db.scalars(select(Media).where(Media.owner_id == h.owner_id)):
        item.public = item.url in public_urls


@router.post("/seller/products", status_code=201)
def create_product(data: ProductInput, user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    validate_product(db, h, data)
    ensure_product_capacity(db, h)
    p = Product(household_id=h.id, **data.model_dump())
    db.add(p)
    db.flush()
    audit(db, user, "product.create", p.id)
    sync_media(db, h)
    db.commit()
    return product_json(p, h)


def ensure_product_capacity(db, h):
    db.scalar(select(Household).where(Household.id == h.id).with_for_update())
    plan = db.get(Plan, h.plan_id) if h.plan_id else None
    maximum = plan.product_limit if plan else 20
    # Deleted (archived) products stay for order history but no longer use a plan slot.
    if db.scalar(select(func.count()).select_from(Product).where(Product.household_id == h.id, Product.status != "archived")) >= maximum:
        raise HTTPException(409, "تم بلوغ حد المنتجات في الباقة")


@router.put("/seller/products/{product_id}")
def update_product(product_id: str, data: ProductInput, user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    p = db.get(Product, product_id)
    if not p or p.household_id != h.id or p.status == "archived":
        raise HTTPException(404, "المنتج غير موجود")
    validate_product(db, h, data)
    for key, value in data.model_dump().items():
        setattr(p, key, value)
    audit(db, user, "product.update", p.id)
    sync_media(db, h)
    db.commit()
    return product_json(p, h)


@router.delete("/seller/products/{product_id}")
def archive_product(product_id: str, user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    p = db.get(Product, product_id)
    if not p or p.household_id != h.id or p.status == "archived":
        raise HTTPException(404, "المنتج غير موجود")
    # Soft delete: order items still reference the product.
    p.status, p.featured = "archived", False
    audit(db, user, "product.archive", p.id)
    sync_media(db, h)
    db.commit()
    return {"ok": True}


def save_image(raw: bytes):
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "الحد الأقصى للصورة 5 ميجابايت")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("format")
                source.load()
                clean = source.convert("RGB")
                clean.thumbnail((1600, 1600))
                folder = Path(settings.media_dir)
                folder.mkdir(parents=True, exist_ok=True)
                filename = uuid4().hex + ".webp"
                clean.save(folder / filename, "WEBP", quality=85)
                thumb = clean.copy()
                thumb.thumbnail((480, 480))
                thumb.save(folder / ("thumb-" + filename), "WEBP", quality=80)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "الصورة غير صالحة؛ استخدم JPG أو PNG أو WebP") from None
    return "/media/" + filename


@router.post("/seller/media", status_code=201)
async def upload(file: UploadFile, request: Request, user=Depends(roles("seller")), db=Depends(get_db)):
    limit("upload:" + user.id, 30, 300)
    raw = await file.read(5 * 1024 * 1024 + 1)
    url = save_image(raw)
    db.add(Media(url=url, owner_id=user.id, public=False))
    db.commit()
    return {"url": url}


def media_file(filename, request, db):
    import re

    if not re.fullmatch(r"(?:thumb-)?(?:[a-f0-9]{32}|demo-[0-9]+)\.webp", filename):
        raise HTTPException(404, "الصورة غير موجودة")
    original = filename.removeprefix("thumb-")
    item = db.get(Media, "/media/" + original)
    if not item:
        raise HTTPException(404, "الصورة غير موجودة")
    if not item.public:
        try:
            user = current_user(request, db)
        except HTTPException:
            raise HTTPException(404, "الصورة غير موجودة") from None
        if user.id != item.owner_id:
            raise HTTPException(404, "الصورة غير موجودة")
    path = Path(settings.media_dir) / filename
    if not path.is_file():
        raise HTTPException(404, "الصورة غير موجودة")
    return FileResponse(
        path, media_type="image/webp", headers={"Cache-Control": "public, max-age=300" if item.public else "private, no-store"}
    )
