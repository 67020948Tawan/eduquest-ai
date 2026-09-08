# ==============================================================================
# api/public.py — Public Game Access (ไม่ต้อง login)
#
# GET /play/{token} → ข้อมูลเกมสำหรับ Landing Page
#   - ตรวจ share_token + access_mode (unlisted/public) + status PUBLISHED
#   - ห้ามเข้าถึง private ด้วยการเดา URL
#   - ไม่เปิดเผยข้อมูลส่วนตัวครู / เฉลยคำตอบ
# ==============================================================================

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from database import get_db
from models.course import Course, CourseStatus
from models.chapter import Chapter
from models.level import Level
from models.badge import Badge
from api.courses import _build_structure_payload

router = APIRouter(tags=["public"])


@router.get("/play/code/{code}")
async def resolve_join_code(code: str, db: AsyncSession = Depends(get_db)):
    """นักเรียนกรอกรหัส 6 หลัก → ได้ share_path กลับไปเปิดเกม"""
    normalized = (code or "").strip().upper()
    if len(normalized) != 6:
        raise HTTPException(status_code=404, detail="รหัสต้องมี 6 หลัก")
    result = await db.execute(
        select(Course).where(Course.share_code == normalized)
    )
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบห้องเรียนรหัสนี้ ตรวจรหัสอีกครั้ง")
    if course.access_mode not in ("unlisted", "public"):
        raise HTTPException(status_code=403, detail="ห้องนี้ปิดรับนักเรียนแล้ว")
    if course.status != CourseStatus.PUBLISHED:
        raise HTTPException(status_code=403, detail="เกมนี้ยังไม่ได้เผยแพร่")
    return {"share_path": f"/play/{course.share_token}", "course_title": course.title}


@router.get("/play/{token}")
async def public_game(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Course).where(Course.share_token == token)
    )
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบเกมนี้ — ลิงก์อาจถูกยกเลิกแล้ว")

    if course.access_mode not in ("unlisted", "public"):
        raise HTTPException(status_code=403, detail="เกมนี้เป็นส่วนตัว ไม่สามารถเข้าถึงได้")

    if course.status != CourseStatus.PUBLISHED:
        raise HTTPException(status_code=403, detail="เกมนี้ยังไม่ได้เผยแพร่")

    chapters_result = await db.execute(
        select(Chapter)
        .options(selectinload(Chapter.lesson), selectinload(Chapter.quiz_questions))
        .where(Chapter.course_id == course.id)
        .order_by(Chapter.order_index)
    )
    chapters = list(chapters_result.scalars().all())
    if not chapters:
        raise HTTPException(status_code=404, detail="เกมนี้ยังไม่มีเนื้อหา")

    levels_result = await db.execute(select(Level).where(Level.course_id == course.id))
    badges_result = await db.execute(select(Badge).where(Badge.course_id == course.id))

    payload = _build_structure_payload(
        course,
        chapters,
        list(levels_result.scalars().all()),
        list(badges_result.scalars().all()),
    )
    payload["access_mode"] = course.access_mode
    return payload
