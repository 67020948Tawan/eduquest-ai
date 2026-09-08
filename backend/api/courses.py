# ==============================================================================
# api/courses.py — Course / Document / AI Generation Endpoints (Teacher side)
# ==============================================================================

import os
import uuid
import json
import shutil
import secrets

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from database import get_db
from models.user import User
from models.document import Document
from models.course import Course, CourseStatus
from models.chapter import Chapter
from models.lesson import Lesson
from models.quiz_question import QuizQuestion
from models.level import Level
from models.badge import Badge
from models.game_session import GameSession
from schemas.course import CourseResponse, CourseUpdate
from core.deps import get_current_user
from services.extractors import ALLOWED_EXTENSIONS
from services.art_catalog import resolve_asset, extract_keywords
from services.game_director import analyze_content, recommend_game_genres, generate_game

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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        parsed_game_modes = json.loads(game_modes)
        if not isinstance(parsed_game_modes, list):
            raise ValueError
    except Exception:
        parsed_game_modes = ["standard_quiz"]

    new_course = Course(
        title=title.strip(),
        description=description,
        subject=subject,
        difficulty=difficulty,
        game_modes=parsed_game_modes,
        visual_style=visual_style if visual_style in ("pixel_art", "modern_2d", "fantasy", "scifi") else "pixel_art",
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

    ai_result = await analyze_content(document.file_path)
    if "error" in ai_result:
        raise HTTPException(status_code=500, detail=ai_result["error"])

    return {
        "message": "AI วิเคราะห์เนื้อหาสำเร็จ",
        "filename": document.filename,
        "ai_analysis": ai_result,
    }


@router.post("/courses/{course_id}/recommendations")
async def recommend_genres(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_course(course_id, current_user, db)
    document = await get_latest_document(course_id, db)

    ai_result = await recommend_game_genres(document.file_path)
    if "error" in ai_result:
        raise HTTPException(status_code=500, detail=ai_result["error"])
    return ai_result


@router.post("/courses/{course_id}/generate")
async def generate_course(
    course_id: int,
    visual_style: str = Form(None),
    ai_instruction: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    course = await get_owned_course(course_id, current_user, db)
    document = await get_latest_document(course_id, db)

    if visual_style:
        course.visual_style = visual_style
    course.status = CourseStatus.GENERATING
    await db.commit()

    ai_result = await generate_game(
        file_path=document.file_path,
        game_modes=course.game_modes or ["standard_quiz"],
        visual_style=course.visual_style or "pixel_art",
        ai_instruction=ai_instruction,
    )

    if "error" in ai_result:
        print(f"❌ [Generate] course_id={course_id} failed: {ai_result['error']}")
        course.status = CourseStatus.DRAFT
        await db.commit()
        raise HTTPException(status_code=500, detail=ai_result["error"])

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

    created_chapter_ids = []
    for idx, chapter_data in enumerate(ai_result["chapters"]):
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
    course.game_config = game_config
    art_bible = run_art_director(course)
    game_config["art_bible"] = art_bible
    course.game_config = game_config

    course.status = CourseStatus.READY
    await db.commit()

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
