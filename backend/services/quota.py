# ==============================================================================
# services/quota.py — โควตาการเรียก AI ต่อบัญชีต่อวัน (ข้อ 3.4.6 / 3.4.7)
#
# Freemium: free 20 ครั้ง/วัน · pro 200 · school 1000
# ตรวจก่อนเรียก AI ทุกครั้ง และรีเซ็ตอัตโนมัติเมื่อข้ามวัน (UTC)
# ==============================================================================

from datetime import datetime, timezone

from fastapi import HTTPException

PLAN_LIMITS = {"free": 20, "pro": 200, "school": 1000}
PLAN_LABELS = {"free": "Free", "pro": "Pro", "school": "School"}


def quota_limit(user) -> int:
    return PLAN_LIMITS.get((user.plan or "free").lower(), PLAN_LIMITS["free"])


def quota_snapshot(user) -> dict:
    limit = quota_limit(user)
    used = user.quota_used_today or 0
    return {
        "plan": (user.plan or "free").lower(),
        "plan_label": PLAN_LABELS.get((user.plan or "free").lower(), "Free"),
        "quota_used": used,
        "quota_limit": limit,
        "quota_remaining": max(0, limit - used),
    }


async def enforce_quota(user, db, cost: int = 1) -> dict:
    """ตรวจ + หักโควตา (ยังไม่ commit — ผู้เรียกต้อง commit เอง)"""
    now = datetime.now(timezone.utc)
    reset_at = user.quota_reset_at
    if reset_at is not None and reset_at.tzinfo is None:
        reset_at = reset_at.replace(tzinfo=timezone.utc)

    if reset_at is None or reset_at.date() < now.date():
        user.quota_used_today = 0
        user.quota_reset_at = now

    limit = quota_limit(user)
    used = user.quota_used_today or 0
    if used + cost > limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"โควตาการใช้ AI วันนี้หมดแล้ว ({used}/{limit} ครั้ง) — "
                "กรุณาลองใหม่พรุ่งนี้ หรืออัปเกรดแผน Pro"
            ),
        )

    user.quota_used_today = used + cost
    return quota_snapshot(user)
