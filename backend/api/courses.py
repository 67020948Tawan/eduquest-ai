# ==============================================================================
# api/courses.py — Course / Document / AI Generation Endpoints (Teacher side)
# ==============================================================================

import os
import uuid
import json
import shutil
import secrets
import asyncio
import time

from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from database import SessionLocal, get_db
from services import generation_jobs
from models.user import User
from models.document import Document
from models.course import Course, CourseStatus
from models.chapter import Chapter
from models.lesson import Lesson
from models.quiz_question import QuizQuestion
from models.level import Level
from models.badge import Badge
from models.game_session import GameSession
from models.xp_transaction import XpTransaction
from models.inventory_item import InventoryItem
from schemas.course import CourseResponse, CourseUpdate
from core.deps import get_current_user
from services.quota import enforce_quota
from services.extractors import ALLOWED_EXTENSIONS
from services.art_catalog import resolve_asset, extract_keywords
from services.game_director import (
    analyze_content,
    analyze_content_sufficiency,
    recommend_game_genres,
    generate_game,
)

router = APIRouter(prefix="/api", tags=["courses"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_FILE_SIZE_MB = 25


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

async def get_owned_course(
    course_id: int,
    current_user: User,
    db: AsyncSession,
) -> Course:
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.teacher_id == current_user.id)
    )
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบคอร์สเรียน หรือคุณไม่มีสิทธิ์เข้าถึง")
    return course


async def get_latest_document(course_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.course_id == course_id).order_by(Document.id.desc())
    )
    document = result.scalars().first()
    if not document:
        raise HTTPException(status_code=400, detail="ไม่พบไฟล์ในคอร์สนี้ กรุณาอัปโหลดไฟล์ก่อน")
    return document


# ------------------------------------------------------------------------------
# Course CRUD
# ------------------------------------------------------------------------------

@router.post("/courses", response_model=CourseResponse)
async def create_course(
    title: str = Form(...),
    description: str = Form(None),
    subject: str = Form(None),
    difficulty: str = Form(None),
    game_modes: str = Form('["standard_quiz"]'),
    visual_style: str = Form("pixel_art"),
    game_length: str = Form("medium"),
    question_types: str = Form('["multiple_choice"]'),
    questions_per_chapter: str = Form("3"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        parsed_game_modes = json.loads(game_modes)
        if not isinstance(parsed_game_modes, list):
            raise ValueError
    except Exception:
        parsed_game_modes = ["standard_quiz"]

    try:
        parsed_question_types = json.loads(question_types)
        if not isinstance(parsed_question_types, list):
            raise ValueError
    except Exception:
        parsed_question_types = ["multiple_choice"]

    try:
        parsed_qpc = int(questions_per_chapter)
        if parsed_qpc < 1:
            parsed_qpc = 3
    except Exception:
        parsed_qpc = 3

    valid_lengths = {"short", "medium", "long"}
    if game_length not in valid_lengths:
        game_length = "medium"

    new_course = Course(
        title=title.strip(),
        description=description,
        subject=subject,
        difficulty=difficulty,
        game_modes=parsed_game_modes,
        visual_style=visual_style if visual_style in ("pixel_art", "modern_2d", "fantasy", "scifi") else "pixel_art",
        game_length=game_length,
        question_types=parsed_question_types,
        questions_per_chapter=parsed_qpc,
        teacher_id=current_user.id,
        status=CourseStatus.DRAFT,
    )
    db.add(new_course)
    await db.commit()
    await db.refresh(new_course)
    return new_course


@router.get("/courses", response_model=list[CourseResponse])
async def list_my_courses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Course).where(Course.teacher_id == current_user.id))
    return list(result.scalars().all())


@router.patch("/courses/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: int,
    payload: CourseUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)

    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] is not None:
        # Publish ต้องมีเนื้อหาที่ generate แล้วเท่านั้น (กฎข้อ #52)
        if updates["status"] == CourseStatus.PUBLISHED and not course.game_config:
            raise HTTPException(status_code=400, detail="ต้อง Generate เกมก่อนจึงจะ Publish ได้")
        course.status = updates["status"]
    for field in ("title", "description", "subject", "difficulty"):
        if updates.get(field) is not None:
            setattr(course, field, updates[field])
    if updates.get("game_modes") is not None:
        modes = [m for m in updates["game_modes"] if isinstance(m, str)]
        if modes:
            course.game_modes = modes
    if updates.get("question_types") is not None:
        qtypes = [q for q in updates["question_types"] if isinstance(q, str)]
        if qtypes:
            course.question_types = qtypes
    if updates.get("visual_style") in ("pixel_art", "modern_2d", "fantasy", "scifi"):
        course.visual_style = updates["visual_style"]
    if updates.get("game_length") in ("short", "medium", "long"):
        course.game_length = updates["game_length"]

    await db.commit()
    await db.refresh(course)
    return course


@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ลบคอร์ส + cascade ลูกทั้งหมด"""
    result = await db.execute(
        select(Course)
        .options(
            selectinload(Course.chapters),
            selectinload(Course.levels),
            selectinload(Course.badges),
            selectinload(Course.documents),
            selectinload(Course.game_sessions),
        )
        .where(Course.id == course_id, Course.teacher_id == current_user.id)
    )
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบคอร์สเรียน หรือคุณไม่มีสิทธิ์ลบ")

    course_title = course.title

    # ลบไฟล์ upload ทิ้งด้วย
    for doc in course.documents:
        if doc.file_path and os.path.exists(doc.file_path):
            try:
                os.remove(doc.file_path)
            except OSError:
                pass

    # XP ledger / inventory อ้าง FK ตรงมาที่คอร์ส (ไม่มี cascade) — ต้องลบก่อน
    await db.execute(delete(XpTransaction).where(XpTransaction.course_id == course_id))
    await db.execute(delete(InventoryItem).where(InventoryItem.course_id == course_id))

    await db.delete(course)
    await db.commit()
    return {"message": f"ลบคอร์ส '{course_title}' และข้อมูลที่เกี่ยวข้องทั้งหมดสำเร็จ"}


# ------------------------------------------------------------------------------
# Documents
# ------------------------------------------------------------------------------

@router.post("/courses/{course_id}/documents")
async def upload_document(
    course_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_course(course_id, current_user, db)

    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"ไม่รองรับไฟล์ '{extension or file.filename}' (รองรับ: {', '.join(sorted(ALLOWED_EXTENSIONS))})",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"ไฟล์ใหญ่เกิน {MAX_FILE_SIZE_MB}MB")

    safe_filename = f"{uuid.uuid4().hex}{extension}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    new_doc = Document(
        course_id=course_id,
        filename=file.filename,
        file_path=file_path,
        file_type=file.content_type or "",
    )
    db.add(new_doc)
    await db.commit()
    await db.refresh(new_doc)

    return {"message": f"อัปโหลดไฟล์ {file.filename} สำเร็จ!", "document_id": new_doc.id}


# ------------------------------------------------------------------------------
# Content Editor — ครูแก้ไข/เพิ่ม/ลบ/จัดลำดับเนื้อหาก่อนเผยแพร่ (ข้อ 4.2)
# ------------------------------------------------------------------------------

class ChapterCreate(BaseModel):
    title: str


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    lesson_title: Optional[str] = None
    lesson_objective: Optional[str] = None
    lesson_content: Optional[str] = None


class ChapterReorder(BaseModel):
    chapter_ids: list[int]


class QuestionPayload(BaseModel):
    question: str
    options: list[str] = []
    correct_answer_index: int = 0
    explanation: str = ""
    difficulty: str = "easy"
    points: int = 50
    source_reference: Optional[str] = None
    question_type: str = "multiple_choice"
    matching_pairs: Optional[list[dict[str, Any]]] = None
    ordering_items: Optional[list[str]] = None
    correct_data: Optional[Any] = None


VALID_QUESTION_TYPES = {"multiple_choice", "true_false", "matching", "ordering"}


def _normalize_question(payload: QuestionPayload) -> dict:
    """ตรวจ + ปรับข้อมูลคำถามให้อยู่ในรูปแบบที่เกมเล่นได้จริง"""
    qtype = payload.question_type if payload.question_type in VALID_QUESTION_TYPES else "multiple_choice"
    options = [str(o).strip() for o in payload.options if str(o).strip()]
    difficulty = payload.difficulty if payload.difficulty in ("easy", "medium", "hard") else "easy"
    points = max(1, min(int(payload.points or 50), 1000))

    matching_pairs = None
    ordering_items = None
    correct_data = None
    correct_index = 0

    if qtype in ("multiple_choice", "true_false"):
        if len(options) < 2:
            raise HTTPException(status_code=400, detail="ต้องมีตัวเลือกอย่างน้อย 2 ข้อ")
        if qtype == "true_false" and len(options) != 2:
            raise HTTPException(status_code=400, detail="คำถามจริง/เท็จต้องมี 2 ตัวเลือก")
        if not (0 <= payload.correct_answer_index < len(options)):
            raise HTTPException(status_code=400, detail="คำตอบที่ถูกต้องต้องชี้ไปที่ตัวเลือกที่มีอยู่")
        correct_index = payload.correct_answer_index
    elif qtype == "matching":
        raw_pairs = payload.matching_pairs or []
        pairs = []
        for pair in raw_pairs:
            left = str(pair.get("left", "")).strip()
            right = str(pair.get("right", "")).strip()
            if left and right:
                pairs.append({"left": left, "right": right})
        if len(pairs) < 2:
            raise HTTPException(status_code=400, detail="คำถามจับคู่ต้องมีอย่างน้อย 2 คู่")
        matching_pairs = pairs
        correct_data = {p["left"]: p["right"] for p in pairs}
        options = [p["left"] for p in pairs]
    elif qtype == "ordering":
        items = [str(i).strip() for i in (payload.ordering_items or []) if str(i).strip()]
        if len(items) < 2:
            raise HTTPException(status_code=400, detail="คำถามเรียงลำดับต้องมีอย่างน้อย 2 รายการ")
        ordering_items = items
        correct_data = list(range(len(items)))
        options = items

    return {
        "question": payload.question.strip(),
        "options": options,
        "correct_answer_index": correct_index,
        "explanation": (payload.explanation or "").strip(),
        "difficulty": difficulty,
        "points": points,
        "source_reference": (payload.source_reference or "").strip() or None,
        "question_type": qtype,
        "matching_pairs": matching_pairs,
        "ordering_items": ordering_items,
        "correct_data": correct_data,
    }


def _serialize_question(q: QuizQuestion) -> dict:
    return {
        "id": q.id,
        "question": q.question,
        "options": q.options,
        "correct_answer_index": q.correct_answer_index,
        "explanation": q.explanation,
        "difficulty": q.difficulty,
        "points": q.points,
        "source_reference": q.source_reference,
        "question_type": q.question_type,
        "matching_pairs": q.matching_pairs,
        "ordering_items": q.ordering_items,
        "correct_data": q.correct_data,
    }


def _mark_edited(course: Course) -> bool:
    """แก้ไขเนื้อหาขณะ Published → กลับเป็น Ready (ต้องกด Publish ยืนยันใหม่)"""
    if course.status == CourseStatus.PUBLISHED:
        course.status = CourseStatus.READY
        return True
    return False


async def _get_owned_chapter(
    course_id: int,
    chapter_id: int,
    current_user: User,
    db: AsyncSession,
) -> tuple[Course, Chapter]:
    course = await get_owned_course(course_id, current_user, db)
    result = await db.execute(
        select(Chapter)
        .options(selectinload(Chapter.lesson), selectinload(Chapter.quiz_questions))
        .where(Chapter.id == chapter_id, Chapter.course_id == course_id)
    )
    chapter = result.scalars().first()
    if not chapter:
        raise HTTPException(status_code=404, detail="ไม่พบ Chapter ในคอร์สนี้")
    return course, chapter


@router.get("/courses/{course_id}/edit-data")
async def get_course_edit_data(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ข้อมูลสำหรับหน้าตัวแก้ไข — ครูเห็นเฉลยได้ (ไม่ส่งให้ฝั่งนักเรียน)"""
    course = await get_owned_course(course_id, current_user, db)
    result = await db.execute(
        select(Chapter)
        .options(selectinload(Chapter.lesson), selectinload(Chapter.quiz_questions))
        .where(Chapter.course_id == course_id)
        .order_by(Chapter.order_index)
    )
    chapters = list(result.scalars().all())

    return {
        "course_id": course.id,
        "course_title": course.title,
        "course_description": course.description,
        "status": course.status.value if hasattr(course.status, "value") else str(course.status),
        "game_modes": course.game_modes or [],
        "visual_style": course.visual_style or "pixel_art",
        "chapters": [
            {
                "chapter_id": ch.id,
                "title": ch.title,
                "order_index": ch.order_index,
                "lesson": {
                    "title": ch.lesson.title if ch.lesson else "",
                    "objective": ch.lesson.objective if ch.lesson else "",
                    "content": ch.lesson.content if ch.lesson else "",
                },
                "quiz_questions": [
                    _serialize_question(q)
                    for q in sorted(ch.quiz_questions, key=lambda x: x.id)
                ],
            }
            for ch in chapters
        ],
    }


@router.post("/courses/{course_id}/chapters")
async def create_chapter(
    course_id: int,
    payload: ChapterCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อ Chapter")

    max_order = (await db.execute(
        select(func.max(Chapter.order_index)).where(Chapter.course_id == course_id)
    )).scalar()
    chapter = Chapter(
        course_id=course_id,
        title=title,
        order_index=0 if max_order is None else int(max_order) + 1,
    )
    db.add(chapter)
    await db.flush()
    db.add(Lesson(
        chapter_id=chapter.id,
        title=title,
        objective="",
        content="",
    ))
    republish = _mark_edited(course)
    await db.commit()
    await db.refresh(chapter)
    return {
        "message": "เพิ่ม Chapter สำเร็จ",
        "chapter_id": chapter.id,
        "republish_required": republish,
    }


@router.patch("/courses/{course_id}/chapters/{chapter_id}")
async def update_chapter(
    course_id: int,
    chapter_id: int,
    payload: ChapterUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course, chapter = await _get_owned_chapter(course_id, chapter_id, current_user, db)
    updates = payload.model_dump(exclude_unset=True)

    if updates.get("title") is not None:
        title = updates["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="ชื่อ Chapter ห้ามว่าง")
        chapter.title = title

    if any(k in updates for k in ("lesson_title", "lesson_objective", "lesson_content")):
        if not chapter.lesson:
            chapter.lesson = Lesson(
                chapter_id=chapter.id,
                title=chapter.title,
                objective="",
                content="",
            )
        if updates.get("lesson_title") is not None:
            chapter.lesson.title = updates["lesson_title"]
        if updates.get("lesson_objective") is not None:
            chapter.lesson.objective = updates["lesson_objective"]
        if updates.get("lesson_content") is not None:
            chapter.lesson.content = updates["lesson_content"]

    republish = _mark_edited(course)
    await db.commit()
    return {"message": "บันทึก Chapter แล้ว", "republish_required": republish}


@router.delete("/courses/{course_id}/chapters/{chapter_id}")
async def delete_chapter(
    course_id: int,
    chapter_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course, chapter = await _get_owned_chapter(course_id, chapter_id, current_user, db)

    total = (await db.execute(
        select(func.count(Chapter.id)).where(Chapter.course_id == course_id)
    )).scalar() or 0
    if total <= 1:
        raise HTTPException(status_code=400, detail="ต้องเหลืออย่างน้อย 1 Chapter")

    await db.delete(chapter)
    await db.flush()

    remaining = await db.execute(
        select(Chapter).where(Chapter.course_id == course_id).order_by(Chapter.order_index)
    )
    for index, row in enumerate(remaining.scalars().all()):
        row.order_index = index

    republish = _mark_edited(course)
    await db.commit()
    return {"message": "ลบ Chapter สำเร็จ", "republish_required": republish}


@router.post("/courses/{course_id}/chapters/reorder")
async def reorder_chapters(
    course_id: int,
    payload: ChapterReorder,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    result = await db.execute(
        select(Chapter).where(Chapter.course_id == course_id)
    )
    chapters = {ch.id: ch for ch in result.scalars().all()}

    if set(payload.chapter_ids) != set(chapters.keys()):
        raise HTTPException(status_code=400, detail="รายการ Chapter ไม่ครบหรือไม่ถูกต้อง")

    for index, chapter_id in enumerate(payload.chapter_ids):
        chapters[chapter_id].order_index = index

    republish = _mark_edited(course)
    await db.commit()
    return {"message": "จัดลำดับ Chapter แล้ว", "republish_required": republish}


@router.post("/courses/{course_id}/chapters/{chapter_id}/questions")
async def create_question(
    course_id: int,
    chapter_id: int,
    payload: QuestionPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course, chapter = await _get_owned_chapter(course_id, chapter_id, current_user, db)
    data = _normalize_question(payload)

    question = QuizQuestion(chapter_id=chapter.id, **data)
    db.add(question)
    republish = _mark_edited(course)
    await db.commit()
    await db.refresh(question)
    return {
        "message": "เพิ่มคำถามสำเร็จ",
        "question": _serialize_question(question),
        "republish_required": republish,
    }


@router.patch("/courses/{course_id}/questions/{question_id}")
async def update_question(
    course_id: int,
    question_id: int,
    payload: QuestionPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    result = await db.execute(
        select(QuizQuestion)
        .join(Chapter, Chapter.id == QuizQuestion.chapter_id)
        .where(QuizQuestion.id == question_id, Chapter.course_id == course_id)
    )
    question = result.scalars().first()
    if not question:
        raise HTTPException(status_code=404, detail="ไม่พบคำถามในคอร์สนี้")

    data = _normalize_question(payload)
    for field, value in data.items():
        setattr(question, field, value)

    republish = _mark_edited(course)
    await db.commit()
    await db.refresh(question)
    return {
        "message": "บันทึกคำถามแล้ว",
        "question": _serialize_question(question),
        "republish_required": republish,
    }


@router.delete("/courses/{course_id}/questions/{question_id}")
async def delete_question(
    course_id: int,
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    result = await db.execute(
        select(QuizQuestion)
        .join(Chapter, Chapter.id == QuizQuestion.chapter_id)
        .where(QuizQuestion.id == question_id, Chapter.course_id == course_id)
    )
    question = result.scalars().first()
    if not question:
        raise HTTPException(status_code=404, detail="ไม่พบคำถามในคอร์สนี้")

    total = (await db.execute(
        select(func.count(QuizQuestion.id)).where(QuizQuestion.chapter_id == question.chapter_id)
    )).scalar() or 0
    if total <= 1:
        raise HTTPException(status_code=400, detail="แต่ละ Chapter ต้องเหลืออย่างน้อย 1 คำถาม")

    await db.delete(question)
    republish = _mark_edited(course)
    await db.commit()
    return {"message": "ลบคำถามแล้ว", "republish_required": republish}


@router.post("/courses/{course_id}/archive")
async def archive_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """เก็บคอร์สเข้ากรุ — ลิงก์สาธารณะใช้ไม่ได้จนกว่าจะกู้คืน"""
    course = await get_owned_course(course_id, current_user, db)
    course.status = CourseStatus.ARCHIVED
    await db.commit()
    return {"message": "📦 เก็บคอร์สเข้ากรุแล้ว", "status": "ARCHIVED"}


@router.post("/courses/{course_id}/restore")
async def restore_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    course.status = CourseStatus.READY if course.game_config else CourseStatus.DRAFT
    await db.commit()
    return {
        "message": "♻️ กู้คืนคอร์สแล้ว",
        "status": course.status.value if hasattr(course.status, "value") else str(course.status),
    }


# ------------------------------------------------------------------------------
# AI Analysis / Recommendation / Generation
# ------------------------------------------------------------------------------

@router.post("/courses/{course_id}/analyze")
async def analyze_course_content(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_course(course_id, current_user, db)
    document = await get_latest_document(course_id, db)

    quota = await enforce_quota(current_user, db)
    await db.commit()

    ai_result = await analyze_content(document.file_path)
    if "error" in ai_result:
        raise HTTPException(status_code=500, detail=ai_result["error"])

    return {
        "message": "AI วิเคราะห์เนื้อหาสำเร็จ",
        "filename": document.filename,
        "quota": quota,
        "ai_analysis": ai_result,
    }


@router.post("/courses/{course_id}/analyze-content")
async def analyze_content_sufficiency_endpoint(
    course_id: int,
    game_length: str = Form("medium"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI ตรวจสอบว่าเนื้อหาในเอกสารเพียงพอต่อความยาวเกมที่เลือกหรือไม่
    """
    await get_owned_course(course_id, current_user, db)
    document = await get_latest_document(course_id, db)

    valid_lengths = {"short", "medium", "long"}
    if game_length not in valid_lengths:
        game_length = "medium"

    quota = await enforce_quota(current_user, db)
    await db.commit()

    ai_result = await analyze_content_sufficiency(document.file_path, game_length=game_length)
    if "error" in ai_result:
        raise HTTPException(status_code=500, detail=ai_result["error"])

    return {
        "message": "AI ตรวจสอบความเพียงพอของเนื้อหาสำเร็จ",
        "filename": document.filename,
        "game_length": game_length,
        "quota": quota,
        "sufficiency": ai_result,
    }


@router.post("/courses/{course_id}/recommendations")
async def recommend_genres(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_course(course_id, current_user, db)
    document = await get_latest_document(course_id, db)

    await enforce_quota(current_user, db)
    await db.commit()

    ai_result = await recommend_game_genres(document.file_path)
    if "error" in ai_result:
        raise HTTPException(status_code=500, detail=ai_result["error"])
    return ai_result


async def _tick_generation_progress(
    course_id: int,
    start: int,
    end: int,
    step: str,
    message: str,
    interval: float = 3.0,
) -> None:
    """ขยับแถบความคืบหน้าระหว่างรอ AI ตอบ (ไม่ให้หน้าจอค้างที่เดิมนาน ๆ)"""
    progress = start
    try:
        while progress < end:
            await asyncio.sleep(interval)
            progress = min(end, progress + 2)
            generation_jobs.update(
                course_id, step=step, progress=progress, message=message
            )
    except asyncio.CancelledError:
        return


async def _mark_generation_failed(course_id: int, message: str) -> None:
    """คืนคอร์สที่ค้าง GENERATING กลับเป็น DRAFT และบันทึก error ให้ frontend อ่าน"""
    generation_jobs.fail(course_id, message)
    try:
        async with SessionLocal() as db:
            course = await db.get(Course, course_id)
            if course and course.status == CourseStatus.GENERATING:
                course.status = CourseStatus.DRAFT
                await db.commit()
    except Exception as exc:  # pragma: no cover - best effort cleanup
        print(f"❌ [Generate] reset course {course_id} failed: {exc}")


async def _run_generation(
    db: AsyncSession,
    course_id: int,
    visual_style: Optional[str],
    ai_instruction: Optional[str],
    game_length: Optional[str],
    question_types: Optional[list[str]],
) -> dict:
    """สร้างเกมจริง — เรียกจาก background task พร้อมอัปเดตความคืบหน้าทุกช่วง"""
    course = await db.get(Course, course_id)
    if not course:
        raise RuntimeError("ไม่พบคอร์สนี้ในระบบ")
    document = await get_latest_document(course_id, db)

    generation_jobs.update(
        course_id,
        status="running",
        step="extract",
        progress=8,
        message="กำลังอ่านและวิเคราะห์เอกสารบทเรียน...",
    )

    if visual_style:
        course.visual_style = visual_style
    if game_length:
        course.game_length = game_length
    if question_types is not None:
        course.question_types = question_types
    course.status = CourseStatus.GENERATING
    await db.commit()

    generation_jobs.update(
        course_id,
        step="ai",
        progress=25,
        message="AI กำลังออกแบบโลก บทเรียน และคำถาม...",
    )
    ticker = asyncio.create_task(
        _tick_generation_progress(
            course_id, 25, 68, "ai", "AI กำลังออกแบบโลก บทเรียน และคำถาม..."
        )
    )
    try:
        ai_result = await generate_game(
            file_path=document.file_path,
            game_modes=course.game_modes or ["standard_quiz"],
            visual_style=course.visual_style or "pixel_art",
            ai_instruction=ai_instruction,
            game_length=course.game_length or "medium",
            question_types=course.question_types or ["multiple_choice"],
        )
    finally:
        ticker.cancel()
        await asyncio.gather(ticker, return_exceptions=True)

    if "error" in ai_result:
        print(f"❌ [Generate] course_id={course_id} failed: {ai_result['error']}")
        raise RuntimeError(ai_result["error"])

    generation_jobs.update(
        course_id,
        step="validate",
        progress=74,
        message="ตรวจสอบคำถาม เฉลย และรูปแบบคำตอบ...",
    )

    # ---- เคลียร์โครงสร้างเดิมแล้วสร้างใหม่จากผลลัพธ์ AI ----
    old = await db.execute(
        select(Chapter).options(
            selectinload(Chapter.lesson), selectinload(Chapter.quiz_questions)
        ).where(Chapter.course_id == course_id)
    )
    for ch in old.scalars().all():
        await db.delete(ch)
    for model_ in (Level, Badge):
        rows = await db.execute(select(model_).where(model_.course_id == course_id))
        for row in rows.scalars().all():
            await db.delete(row)

    # Reset session เก่าทั้งหมด — question/chapter IDs เปลี่ยน ของเก่าใช้ไม่ได้อีก
    old_sessions = await db.execute(
        select(GameSession).where(GameSession.course_id == course_id)
    )
    for s in old_sessions.scalars().all():
        s.status = "abandoned"
    await db.flush()

    total_chapters = max(1, len(ai_result["chapters"]))
    created_chapter_ids = []
    for idx, chapter_data in enumerate(ai_result["chapters"]):
        generation_jobs.update(
            course_id,
            step="save",
            progress=78 + int(14 * idx / total_chapters),
            message=f"บันทึกบทที่ {idx + 1}/{total_chapters} และคำถาม...",
        )
        new_chapter = Chapter(course_id=course_id, title=chapter_data["title"], order_index=idx)
        db.add(new_chapter)
        await db.flush()

        lesson_data = chapter_data["lesson"]
        db.add(Lesson(
            chapter_id=new_chapter.id,
            title=lesson_data["title"],
            objective=lesson_data["objective"],
            content=lesson_data["content"],
        ))
        for q in chapter_data["quiz_questions"]:
            db.add(QuizQuestion(
                chapter_id=new_chapter.id,
                question=q["question"],
                options=q["options"],
                correct_answer_index=q["correct_answer_index"],
                explanation=q["explanation"],
                difficulty=q["difficulty"],
                points=q["points"],
                source_reference=q.get("source_reference"),
                question_type=q.get("question_type", "multiple_choice"),
                matching_pairs=q.get("matching_pairs"),
                ordering_items=q.get("ordering_items"),
                correct_data=q.get("correct_data"),
            ))
        created_chapter_ids.append({"chapter_id": new_chapter.id, "index": idx})

    gamification = ai_result["gamification"]
    for lv in gamification["levels"]:
        db.add(Level(course_id=course_id, level_number=lv["level"], title=lv["title"], xp_required=lv["xp_required"]))
    for bd in gamification["badges"]:
        db.add(Badge(course_id=course_id, name=bd["name"], description=bd["description"], condition_hint=bd["condition_hint"]))

    # เก็บ Game Config ทั้งชุด (world/npcs/enemies/bosses) — map chapter_index → chapter_id
    game_config = dict(ai_result)
    game_config["chapter_map"] = created_chapter_ids

    # 🎨 AI ART DIRECTOR — เลือก asset จากคลังโค้ด → attach อัตโนมัติ
    generation_jobs.update(
        course_id,
        step="art",
        progress=93,
        message="จัดวางภาพ ตัวละคร และฉากประกอบ...",
    )
    course.game_config = game_config
    art_bible = run_art_director(course)
    game_config["art_bible"] = art_bible
    course.game_config = game_config

    course.status = CourseStatus.READY
    await db.commit()

    generation_jobs.update(
        course_id,
        step="ready",
        progress=98,
        message="เกมพร้อมแล้ว กำลังเตรียมหน้าจอ...",
    )

    return {
        "message": (
            "สร้างโลกเกม Chapter Quiz และ Gamification สำเร็จ! "
            f"🎨 Art Director attached {1 + len(ai_result['world']['npcs']) + len(ai_result['world']['enemies']) + len(ai_result['world']['bosses'])} assets"
        ),
        "world_name": ai_result["world_name"],
        "theme": gamification["theme"],
        "chapters_created": [ch["title"] for ch in ai_result["chapters"]],
        "zones_created": len(ai_result["world"]["zones"]),
        "npcs_created": len(ai_result["world"]["npcs"]),
        "enemies_created": len(ai_result["world"]["enemies"]),
        "bosses_created": len(ai_result["world"]["bosses"]),
        "levels_created": len(gamification["levels"]),
        "badges_created": len(gamification["badges"]),
        "art_summary": {
            "hero_id": art_bible["hero_id"],
            "total_assets": 1 + len(art_bible["npcs"]) + len(art_bible["enemies"]) + len(art_bible["bosses"]),
        },
    }


async def _run_generation_safe(
    course_id: int,
    visual_style: Optional[str],
    ai_instruction: Optional[str],
    game_length: Optional[str],
    question_types: Optional[list[str]],
) -> None:
    """Background task entrypoint — จัดการ session/error ให้ runner หลัก"""
    try:
        async with SessionLocal() as db:
            result = await _run_generation(
                db,
                course_id,
                visual_style,
                ai_instruction,
                game_length,
                question_types,
            )
        generation_jobs.succeed(course_id, result)
    except asyncio.CancelledError:
        await _mark_generation_failed(course_id, "งานสร้างเกมถูกยกเลิก")
        raise
    except HTTPException as exc:
        message = str(exc.detail)
        print(f"❌ [Generate] course_id={course_id} failed: {message}")
        await _mark_generation_failed(course_id, message)
    except Exception as exc:
        message = str(exc) or "เกิดข้อผิดพลาดระหว่างสร้างเกม"
        print(f"❌ [Generate] course_id={course_id} crashed: {exc}")
        await _mark_generation_failed(course_id, message)


@router.post("/courses/{course_id}/generate", status_code=202)
async def generate_course(
    course_id: int,
    background_tasks: BackgroundTasks,
    visual_style: str = Form(None),
    ai_instruction: str = Form(None),
    game_length: str = Form(None),
    question_types: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    เริ่มสร้างเกมแบบ background job แล้วคืนสถานะทันที
    frontend จะ poll ที่ GET /courses/{id}/generation-status เพื่อดูความคืบหน้า
    """
    course = await get_owned_course(course_id, current_user, db)
    await get_latest_document(course_id, db)

    job, created = generation_jobs.start(course_id)
    if not created:
        return {
            "message": "เกมนี้กำลังถูกสร้างอยู่แล้ว",
            "already_running": True,
            "job": generation_jobs.payload(job),
        }

    try:
        await enforce_quota(current_user, db)
        await db.commit()
    except HTTPException as exc:
        generation_jobs.fail(course_id, str(exc.detail))
        raise
    except Exception:
        generation_jobs.fail(course_id, "เริ่มสร้างเกมไม่สำเร็จ กรุณาลองใหม่")
        raise

    parsed_types: Optional[list[str]] = None
    if question_types:
        try:
            raw_types = json.loads(question_types)
            if isinstance(raw_types, list):
                parsed_types = [str(t) for t in raw_types]
        except Exception:
            parsed_types = None

    background_tasks.add_task(
        _run_generation_safe,
        course_id,
        visual_style,
        ai_instruction,
        game_length,
        parsed_types,
    )

    fresh = generation_jobs.get(course_id) or job
    return {
        "message": "เริ่มสร้างเกมแล้ว ระบบกำลังทำงานเบื้องหลัง",
        "already_running": False,
        "job": generation_jobs.payload(fresh),
    }


@router.get("/courses/{course_id}/generation-status")
async def generation_status(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """สถานะงานสร้างเกม — ใช้ poll จากหน้า Create"""
    course = await get_owned_course(course_id, current_user, db)
    job = generation_jobs.get(course_id)

    if job:
        # กันงานค้าง: ถ้าไม่มีอัปเดตนานเกิน 15 นาที ถือว่าล้มเหลว
        if (
            job.status in generation_jobs.ACTIVE_STATUSES
            and time.time() - job.updated_at > 15 * 60
        ):
            await _mark_generation_failed(
                course_id, "งานสร้างเกมใช้เวลานานเกินไป กรุณากดสร้างอีกครั้ง"
            )
            job = generation_jobs.get(course_id)
        if job:
            return generation_jobs.payload(job)

    if course.status == CourseStatus.GENERATING:
        # ไม่มี job ในหน่วยความจำ = โปรเซสรีสตาร์ทระหว่างสร้าง → คืนคอร์สให้แก้ต่อได้
        course.status = CourseStatus.DRAFT
        await db.commit()
        return {
            "course_id": course_id,
            "status": "error",
            "step": "error",
            "progress": 0,
            "message": "งานสร้างเกมหยุดกลางทาง",
            "error": "เซิร์ฟเวอร์รีสตาร์ทระหว่างสร้างเกม กรุณากดสร้างอีกครั้ง",
            "result": None,
            "started_at": None,
            "updated_at": None,
            "finished_at": None,
        }

    if course.status in (CourseStatus.READY, CourseStatus.PUBLISHED):
        return {
            "course_id": course_id,
            "status": "ready",
            "step": "ready",
            "progress": 100,
            "message": "สร้างเกมสำเร็จแล้ว",
            "error": None,
            "result": None,
            "started_at": None,
            "updated_at": None,
            "finished_at": None,
        }

    return {
        "course_id": course_id,
        "status": "idle",
        "step": "idle",
        "progress": 0,
        "message": "ยังไม่ได้เริ่มสร้างเกม",
        "error": None,
        "result": None,
        "started_at": None,
        "updated_at": None,
        "finished_at": None,
    }


# ------------------------------------------------------------------------------
# Publish / Share — public game link
# ------------------------------------------------------------------------------

ACCESS_MODES = ("private", "unlisted", "public")


class PublishRequest(BaseModel):
    access_mode: str = "unlisted"


_SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # ตัด 0/O/1/I กันสับสน


async def _new_share_code(db: AsyncSession) -> str:
    """สุ่มรหัส 6 หลักที่ไม่ซ้ำกับคอร์สอื่น"""
    for _ in range(20):
        code = "".join(secrets.choice(_SHARE_CODE_ALPHABET) for _ in range(6))
        exists = await db.execute(select(Course).where(Course.share_code == code))
        if not exists.scalars().first():
            return code
    raise HTTPException(status_code=500, detail="สร้างรหัสเข้าห้องไม่สำเร็จ กรุณาลองใหม่")


@router.post("/courses/{course_id}/publish")
async def publish_course(
    course_id: int,
    payload: PublishRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    if not course.game_config:
        raise HTTPException(status_code=400, detail="ต้อง Generate เกมก่อนจึงจะ Publish ได้")

    mode = payload.access_mode if payload.access_mode in ACCESS_MODES else "unlisted"
    course.status = CourseStatus.PUBLISHED
    course.access_mode = mode
    if not course.share_token:
        course.share_token = secrets.token_urlsafe(12)
    if not course.share_code:
        course.share_code = await _new_share_code(db)
    await db.commit()

    return {
        "message": "🎉 เผยแพร่เกมสำเร็จ!",
        "status": "PUBLISHED",
        "access_mode": mode,
        "share_token": course.share_token,
        "share_path": f"/play/{course.share_token}",
        "share_code": course.share_code,
    }


@router.post("/courses/{course_id}/share/regenerate")
async def regenerate_share_link(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """สร้างลิงก์ + รหัสใหม่ — ของเก่าใช้ไม่ได้ทันที"""
    course = await get_owned_course(course_id, current_user, db)
    course.share_token = secrets.token_urlsafe(12)
    course.share_code = await _new_share_code(db)
    await db.commit()
    return {
        "share_token": course.share_token,
        "share_path": f"/play/{course.share_token}",
        "share_code": course.share_code,
    }


@router.post("/courses/{course_id}/share/disable")
async def disable_share_link(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ปิดลิงก์ — ใครเปิด URL เดิมจะเข้าไม่ได้"""
    course = await get_owned_course(course_id, current_user, db)
    course.access_mode = "private"
    await db.commit()
    return {"message": "🔒 ปิดลิงก์แล้ว (Private)", "access_mode": "private"}


@router.get("/courses/{course_id}/share/info")
async def share_info(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    return {
        "status": course.status.value if hasattr(course.status, "value") else str(course.status),
        "access_mode": course.access_mode or "private",
        "share_token": course.share_token,
        "share_path": f"/play/{course.share_token}" if course.share_token else None,
        "share_code": course.share_code,
    }


# ------------------------------------------------------------------------------
# AI ART DIRECTOR — ออกแบบ/เลือก asset จากคลังโค้ด → attach เข้าเกมอัตโนมัติ
# ------------------------------------------------------------------------------

def run_art_director(course: Course) -> dict:
    """
    วิเคราะห์ game_config (world/npcs/enemies/bosses) + subject
    → เลือก asset id จาก ART_ENTRIES ให้ทุก entity
    → เก็บเป็น game_config.art_bible (frontend render ตาม id)
    """
    cfg = course.game_config or {}
    subject = course.subject or None
    world = cfg.get("world") or {}
    theme_words = extract_keywords(cfg.get("world_name"), world.get("name"), course.title)

    def assign(category: str, name: str, *extra: str | None) -> str:
        kws = extract_keywords(name, *extra) + theme_words
        return resolve_asset(category, kws, subject)

    # Hero — จากธีมโลกหลัก
    hero_id = assign("hero", cfg.get("world_name") or "", world.get("intro_story"))

    npc_assign = [
        {"name": n["name"], "role": n.get("role", ""), "asset_id": assign("npc", n["name"], n.get("role"), n.get("personality"))}
        for n in world.get("npcs", [])
    ]
    enemy_assign = [
        {"name": e["name"], "concept": e.get("represents_concept", ""), "asset_id": assign("enemy", e["name"], e.get("represents_concept"), e.get("attack_description"))}
        for e in world.get("enemies", [])
    ]
    boss_assign = [
        {"name": b["name"], "title": b.get("title", ""), "asset_id": assign("boss", b["name"], b.get("title"), ",".join(b.get("related_concepts", []) or []))}
        for b in world.get("bosses", [])
    ]

    art_bible = {
        "version": 2,
        "style": course.visual_style or "pixel_art",
        "lighting": "top_left",
        "hero_id": hero_id,
        "npcs": npc_assign,
        "enemies": enemy_assign,
        "bosses": boss_assign,
    }
    return art_bible


@router.post("/courses/{course_id}/art-director")
async def run_art_director_endpoint(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """รัน Art Director มือเปล่า — ใช้เมื่ออยาก re-assign หลังแก้ชื่อ/role"""
    course = await get_owned_course(course_id, current_user, db)
    if not course.game_config:
        raise HTTPException(status_code=400, detail="ต้อง Generate เกมก่อน")

    bible = run_art_director(course)
    cfg = dict(course.game_config)
    cfg["art_bible"] = bible
    course.game_config = cfg
    await db.commit()

    return {
        "message": (
            f"🎨 Art Director: hero 1 · npcs {len(bible['npcs'])} · "
            f"enemies {len(bible['enemies'])} · bosses {len(bible['bosses'])} attached"
        ),
        "art_bible": bible,
    }


# ------------------------------------------------------------------------------
# Structure (public read — student ต้องเรียกได้)
# ------------------------------------------------------------------------------

def _build_structure_payload(course: Course, chapters, levels, badges) -> dict:
    world = {}
    if course.game_config and isinstance(course.game_config, dict):
        cfg = course.game_config
        chapter_map = {m["index"]: m["chapter_id"] for m in cfg.get("chapter_map", [])}
        world_cfg = cfg.get("world") or {}

        zones = []
        for z in world_cfg.get("zones", []):
            zone = dict(z)
            zone["chapter_id"] = chapter_map.get(z.get("chapter_index"))
            zones.append(zone)

        world = {
            "world_name": cfg.get("world_name"),
            "intro_story": world_cfg.get("intro_story"),
            "ending_story": world_cfg.get("ending_story"),
            "visual_style": course.visual_style or "pixel_art",
            "language": cfg.get("language", "th"),
            "zones": zones,
            "npcs": world_cfg.get("npcs", []),
            "enemies": world_cfg.get("enemies", []),
            "bosses": world_cfg.get("bosses", []),
        }

    chapters_output = []
    for ch in sorted(chapters, key=lambda c: c.order_index):
        chapters_output.append({
            "chapter_id": ch.id,
            "title": ch.title,
            "lesson": {
                "title": ch.lesson.title,
                "objective": ch.lesson.objective,
                "content": ch.lesson.content,
            } if ch.lesson else None,
            "quiz_questions": [
                {
                    "id": q.id,
                    "question": q.question,
                    "options": q.options,
                    "explanation": q.explanation,
                    "difficulty": q.difficulty,
                    "points": q.points,
                    "source_reference": q.source_reference,
                    "question_type": q.question_type,
                    "matching_pairs": q.matching_pairs,
                    "ordering_items": q.ordering_items,
                    "correct_data": q.correct_data,
                    # ❗ ไม่ส่ง correct_answer_index ไป frontend — กันโกง (anti-cheat)
                }
                for q in ch.quiz_questions
            ],
        })

    return {
        "course_id": course.id,
        "course_title": course.title,
        "course_description": course.description,
        "status": course.status.value if hasattr(course.status, "value") else str(course.status),
        "game_modes": course.game_modes or ["standard_quiz"],
        "art_bible": (course.game_config or {}).get("art_bible") or None,
        "world": world,
        "chapters": chapters_output,
        "gamification": {
            "levels": [
                {"level": lv.level_number, "title": lv.title, "xp_required": lv.xp_required}
                for lv in sorted(levels, key=lambda x: x.level_number)
            ],
            "badges": [
                {"name": bd.name, "description": bd.description, "condition_hint": bd.condition_hint}
                for bd in badges
            ],
        },
    }


@router.get("/courses/{course_id}/structure")
async def get_course_structure(
    course_id: int,
    db: AsyncSession = Depends(get_db),
):
    course_result = await db.execute(select(Course).where(Course.id == course_id))
    course = course_result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบคอร์สเรียน")

    result = await db.execute(
        select(Chapter)
        .options(selectinload(Chapter.lesson), selectinload(Chapter.quiz_questions))
        .where(Chapter.course_id == course_id)
        .order_by(Chapter.order_index)
    )
    chapters = list(result.scalars().all())
    if not chapters:
        raise HTTPException(status_code=404, detail="คอร์สนี้ยังไม่มีโครงสร้าง กรุณา Generate ก่อน")

    levels_result = await db.execute(select(Level).where(Level.course_id == course_id))
    badges_result = await db.execute(select(Badge).where(Badge.course_id == course_id))

    return _build_structure_payload(course, chapters, list(levels_result.scalars().all()), list(badges_result.scalars().all()))
