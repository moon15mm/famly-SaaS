"""
WhatsApp Gateway integration powered by Evolution API v2
Handles QR code generation, session management, and outbound messaging.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import requests
import re
import logging
from .security import roles
from .config import settings

logger = logging.getLogger("market.whatsapp")

router = APIRouter(prefix="/admin/whatsapp", tags=["admin-whatsapp"], dependencies=[Depends(roles("admin"))])

def get_evo_url() -> str:
    return settings.evolution_api_url

def get_evo_key() -> str:
    return settings.evolution_api_key  # from EVOLUTION_API_KEY; never stored in code

def get_instance_name() -> str:
    return settings.whatsapp_instance

def get_headers():
    return {
        "apikey": get_evo_key(),
        "Content-Type": "application/json"
    }

def clean_phone(phone: str) -> str:
    cleaned = re.sub(r"[^\d]", "", phone or "")
    if cleaned.startswith("05"):
        cleaned = "966" + cleaned[1:]
    elif cleaned.startswith("5") and len(cleaned) == 9:
        cleaned = "966" + cleaned
    elif cleaned.startswith("00966"):
        cleaned = cleaned[2:]
    return cleaned

def ensure_instance():
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    try:
        r = requests.get(f"{evo_url}/instance/fetchInstances", headers=get_headers(), timeout=5)
        if r.status_code == 200:
            instances = r.json()
            if not any(i.get("name") == inst_name for i in instances):
                requests.post(
                    f"{evo_url}/instance/create",
                    json={"instanceName": inst_name, "qrcode": True, "integration": "WHATSAPP-BAILEYS"},
                    headers=get_headers(),
                    timeout=8
                )
    except Exception as e:
        logger.error(f"Error ensuring WhatsApp instance: {e}")

class SendMessageRequest(BaseModel):
    phone: str
    message: str

@router.get("/status")
def whatsapp_status():
    ensure_instance()
    
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    connected = False
    state = "close"
    owner = None
    profile_name = None
    profile_pic = None
    qrcode = None
    
    try:
        # Check connection state
        st = requests.get(f"{evo_url}/instance/connectionState/{inst_name}", headers=get_headers(), timeout=5)
        if st.status_code == 200:
            data = st.json().get("instance", {})
            state = data.get("state", "close")
            if state == "open":
                connected = True
        
        # If connected, fetch instance details (phone number, name, avatar)
        if connected:
            insts = requests.get(f"{evo_url}/instance/fetchInstances", headers=get_headers(), timeout=5)
            if insts.status_code == 200:
                inst = next((i for i in insts.json() if i.get("name") == inst_name), None)
                if inst:
                    owner_jid = inst.get("ownerJid") or ""
                    owner = owner_jid.split("@")[0] if "@" in owner_jid else owner_jid
                    profile_name = inst.get("profileName")
                    profile_pic = inst.get("profilePicUrl")
        else:
            # If not connected, get QR Code
            conn = requests.get(f"{evo_url}/instance/connect/{inst_name}", headers=get_headers(), timeout=8)
            if conn.status_code == 200:
                cdata = conn.json()
                qrcode = cdata.get("base64")
    except Exception as e:
        logger.error(f"WhatsApp status error: {e}")
        state = "error"
        
    return {
        "instance": inst_name,
        "connected": connected,
        "state": state,
        "owner": owner,
        "profile_name": profile_name,
        "profile_pic": profile_pic,
        "qrcode": qrcode
    }

@router.post("/refresh-qr")
def refresh_qr():
    ensure_instance()
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    try:
        conn = requests.get(f"{evo_url}/instance/connect/{inst_name}", headers=get_headers(), timeout=8)
        if conn.status_code == 200:
            cdata = conn.json()
            return {"qrcode": cdata.get("base64"), "code": cdata.get("code")}
    except Exception as e:
        logger.error(f"Error refreshing QR: {e}")
    raise HTTPException(status_code=500, detail="تعذر توليد باركود جديد، حاول مرة أخرى")

@router.post("/disconnect")
def disconnect_whatsapp():
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    try:
        requests.delete(f"{evo_url}/instance/logout/{inst_name}", headers=get_headers(), timeout=8)
        return {"success": True, "message": "تم قطع الاتصال بنجاح وتفريغ الجلسة"}
    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(status_code=500, detail="تعذر قطع الاتصال بالخادم")

@router.post("/send")
def send_message(payload: SendMessageRequest):
    phone = clean_phone(payload.phone)
    if len(phone) < 9:
        raise HTTPException(status_code=400, detail="رقم الجوال غير صحيح")
    
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    try:
        r = requests.post(
            f"{evo_url}/message/sendText/{inst_name}",
            json={"number": phone, "text": payload.message},
            headers=get_headers(),
            timeout=10
        )
        if r.status_code in (200, 201):
            return {"success": True, "message": "تم إرسال الرسالة بنجاح عبر الواتساب"}
        else:
            detail = ""
            try:
                detail = r.json().get("response", {}).get("message")
            except Exception:
                detail = r.text
            raise HTTPException(status_code=400, detail=f"فشل الإرسال: {detail or 'تأكد من اتصال الواتساب'}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send error: {e}")
        raise HTTPException(status_code=500, detail=f"خطأ أثناء الإرسال: {str(e)}")

def send_whatsapp_direct(phone: str, message: str) -> bool:
    """Helper function to send notification from anywhere in the codebase"""
    cphone = clean_phone(phone)
    if not cphone:
        return False
    evo_url = get_evo_url()
    inst_name = get_instance_name()
    try:
        r = requests.post(
            f"{evo_url}/message/sendText/{inst_name}",
            json={"number": cphone, "text": message},
            headers=get_headers(),
            timeout=8
        )
        return r.status_code in (200, 201)
    except Exception as e:
        logger.warning(f"Failed to send direct WhatsApp to {phone}: {e}")
        return False
