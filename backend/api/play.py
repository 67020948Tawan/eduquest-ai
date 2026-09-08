# ==============================================================================
# api/play.py — Student Gameplay Endpoints
#
# กฎข้อ #41 ANTI-CHEAT: Frontend ห้ามกำหนด XP เอง
#   Student → Submit Answer → Backend ตรวจคำตอบ → Backend อนุมัติ XP
# กฎข้อ #37/#38: Save / Continue ผ่าน GameSession state
# กฎข้อ #56/#57: ส่ง Learning Coverage + Badge กลับตอนจบเกม
# ==============================================================================

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from database import get_db
from models.user import User
from models.course import Course, CourseStatus
from models.chapter import Chapter
from models.quiz_question import QuizQuestion
from models.level import Level
from models.badge import Badge
from models.game_session import GameSession
from core.deps import get_player
from services.game_catalog import (
    BUILDINGS,
    COMBAT,
    COLLECT_CAP_MINUTES,
    PASSIVE_YIELD,
    RAID,
    SKILL_STREAKS,
    STORAGE_CAP,
    apply_resources,
    building_effects,
    can_afford,
    compute_correct_rewards,
    default_game_state,
    deduct_cost,
    sanitize_game_state,
)

import random as _random
import time as _time
router = APIRouter(prefix="/api", tags=["play"])


def _now_ms() -> int:
    return int(_time.time() * 1000)


# ------------------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------------------

class AnswerSubmit(BaseModel):
    question_id: int
    answer_index: int = Field(ge=0, le=5)


class ChapterComplete(BaseModel):
    chapter_id: int


class BuildRequest(BaseModel):
    building_id: str


class HintRequest(BaseModel):
    question_id: int


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

async def _get_own_session(session_id: int, user: User, db: AsyncSession) -> GameSession:
    result = await db.execute(
        select(GameSession).where(
            GameSession.id == session_id,
            GameSession.user_id == user.id,
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="ไม่พบ Game Session")
    return session


async def _enrich_answered(db: AsyncSession, course_id: int, answered: dict) -> dict:
    """
    เติมข้อมูลคำตอบเก่าให้ครบ (correct index / explanation / source)
    เพื่อให้ frontend render สถานะ "ตอบแล้ว" ได้ถูกต้อง — ไม่ต้องกดซ้ำ
    """
    if not answered:
        return {}
    q_ids = [int(k) for k in answered.keys() if str(k).isdigit()]
    if not q_ids:
        return {}

    rows = await db.execute(select(QuizQuestion).where(QuizQuestion.id.in_(q_ids)))
    questions = {q.id: q for q in rows.scalars().all()}

    enriched = {}
    for key, record in answered.items():
        try:
            qid = int(key)
        except ValueError:
            continue
        q = questions.get(qid)
        enriched[key] = {
            "answer": record.get("answer"),
            "correct": record.get("correct", False),
            # reveal เฉพาะข้อที่ตอบแล้ว — ไม่ leak ข้อที่ยังไม่ได้ตอบ
            "correct_answer_index": q.correct_answer_index if q else None,
            "explanation": q.explanation if q else None,
            "source_reference": q.source_reference if q else None,
            "points": q.points if q else 0,
        }
    return enriched


def _compute_level(xp: int, levels) -> dict:
    current = {"level": 1, "title": "Novice", "xp_required": 0}
    for lv in sorted(levels, key=lambda x: x.level_number):
        if xp >= lv.xp_required:
            current = {"level": lv.level_number, "title": lv.title, "xp_required": lv.xp_required}
    return current


async def _course_modes(db: AsyncSession, course_id: int) -> list[str]:
    result = await db.execute(select(Course.game_modes).where(Course.id == course_id))
    row = result.scalar()
    return row if isinstance(row, list) else ["standard_quiz"]


def _ensure_state(session: GameSession, modes: list[str]) -> dict:
    """สร้าง/ปรับ game_state ให้ตรงกับโหมดที่คอร์สเปิด"""
    state = sanitize_game_state(session.game_state or {})
    if "turn_based" in modes:
        effects = building_effects(state["buildings"])
        max_hp = COMBAT["base_max_hp"] + effects.get("bonus_max_hp", 0)
        if state["max_hp"] != max_hp:
            ratio = state["hp"] / max(1, state["max_hp"])
            state["max_hp"] = max_hp
            state["hp"] = max(0, min(max_hp, round(max_hp * min(1.0, ratio))))
        elif state["hp"] > max_hp:
            state["hp"] = max_hp
    else:
        # ไม่ได้เล่น combat — ไม่ track HP
        state.pop("hp", None)
        state.pop("max_hp", None)
    return state


def _skills_for_combo(combo: int) -> list[dict]:
    return [s for s in SKILL_STREAKS if combo >= s["streak"]]


# ------------------------------------------------------------------------------
# Base Economy v2 — pending production / raid lifecycle
# ------------------------------------------------------------------------------

def _pending_production(state: dict) -> dict:
    """ผลผลิตที่สะสมไว้ (รอเก็บ) — จำกัดตามคลังต่ออาคาร"""
    lc = state.get("last_collected") or 0
    if not lc:
        return {}
    minutes = min((_now_ms() - lc) / 60000.0, COLLECT_CAP_MINUTES)
    totals: dict[str, float] = {}
    for b_id in state.get("buildings", []):
        rates = PASSIVE_YIELD.get(b_id, {})
        cap = STORAGE_CAP.get(b_id, 0)
        for res_key, per_min in rates.items():
            totals[res_key] = totals.get(res_key, 0.0) + min(cap, per_min * minutes)
    return {k: int(v) for k, v in totals.items() if v >= 1}


def _pending_per_building(state: dict) -> dict:
    """แยก pending ต่ออาคาร (สำหรับ bubble บน canvas)"""
    lc = state.get("last_collected") or 0
    if not lc:
        return {}
    minutes = min((_now_ms() - lc) / 60000.0, COLLECT_CAP_MINUTES)
    out: dict[str, dict[str, int]] = {}
    for b_id in state.get("buildings", []):
        cap = STORAGE_CAP.get(b_id, 0)
        entry = {}
        for res_key, per_min in PASSIVE_YIELD.get(b_id, {}).items():
            amt = int(min(cap, per_min * minutes))
            if amt > 0:
                entry[res_key] = amt
        if entry:
            out[b_id] = entry
    return out


def _resolve_raid_expiry(state: dict) -> str | None:
    """ถ้า raid หมดเวลา → ปล้นทรัพยากร 10% แล้วจบ event — คืนข้อความอธิบาย"""
    raid = state.get("raid")
    if not raid:
        return None
    now = _now_ms()
    if now < raid["ends_at"]:
        return None

    stolen: dict[str, int] = {}
    res = state.setdefault("resources", {})
    for key in ("gold", "wood", "stone", "crystal"):
        have = res.get(key, 0)
        take = int(have * RAID["steal_fraction"])
        if take > 0:
            res[key] = have - take
            stolen[key] = take
    state["raid"] = None
    state["raid_cooldown_until"] = now + RAID["cooldown_seconds"] * 1000
    state["raids_survived"] = (state.get("raids_survived") or 0)
    detail = ", ".join(f"{k} -{v}" for k, v in stolen.items()) or "ไม่มีอะไรให้ปล้น 😅"
    return f"👹 {raid['name']} โซมฐาน! เสีย {detail}"


def _maybe_trigger_raid(state: dict, modes: list[str]) -> None:
    """สุ่มเกิด raid เมื่อ cooldown หมด + มีอาคารแล้ว"""
    if "base_building" not in modes:
        return
    now = _now_ms()
    if state.get("raid"):
        return
    if now < (state.get("raid_cooldown_until") or 0):
        return
    if len(state.get("buildings", [])) < 1:
        return
    if _random.random() > RAID["trigger_chance"]:
        return

    state["raid"] = {
        "name": f"ผู้รุกรานนอนเลี้ยง #{_random.randint(1, 99)}",
        "started_at": now,
        "ends_at": now + RAID["duration_seconds"] * 1000,
    }


# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------

@router.post("/courses/{course_id}/sessions")
async def start_or_resume_session(
    course_id: int,
    fresh: bool = False,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """
    - ปกติ: resume active session (Continue)
    - session เดิม completed → สร้างใหม่อัตโนมัติ (เล่นซ้ำได้ไม่จำกัด)
    - ?fresh=true → เริ่ม run ใหม่ทันที (Restart) — session เก่าถูก mark abandoned
    """
    course_result = await db.execute(select(Course).where(Course.id == course_id))
    course = course_result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="ไม่พบคอร์สเรียน")

    existing_result = await db.execute(
        select(GameSession)
        .where(
            GameSession.user_id == current_user.id,
            GameSession.course_id == course_id,
            GameSession.status == "active",
        )
        .order_by(GameSession.updated_at.desc())
    )
    existing = existing_result.scalars().first()

    created = False
    if fresh and existing:
        existing.status = "abandoned"
        await db.flush()
        existing = None

    if not existing:
        session = GameSession(user_id=current_user.id, course_id=course_id)
        db.add(session)
        await db.flush()
        created = True
    else:
        session = existing

    modes = await _course_modes(db, course_id)

    # สร้าง/ปรับ state ให้ตรงโหมดเสมอ (sanitize ค่าฝั่ง server)
    session.game_state = _ensure_state(session, modes)
    state = session.game_state
    if created and not state.get("last_collected"):
        state["last_collected"] = _now_ms()

    # Raid lifecycle + production
    expire_msg = _resolve_raid_expiry(state)
    _maybe_trigger_raid(state, modes)
    session.game_state = sanitize_game_state(state)
    await db.commit()
    await db.refresh(session)

    return {
        "session_id": session.id,
        "created": created,
        "fresh_run": created,
        "xp": session.xp or 0,
        "answered": await _enrich_answered(db, course_id, session.answered or {}),
        "completed_chapters": session.completed_chapters or [],
        "status": session.status,
        "modes": modes,
        "game_state": session.game_state or {},
        "skills": _skills_for_combo((session.game_state or {}).get("combo", 0)),
        "pending": _pending_production(session.game_state or {}),
        "pending_per_building": _pending_per_building(session.game_state or {}),
        "raid": (session.game_state or {}).get("raid"),
        "notice": expire_msg,
    }


@router.get("/sessions/{session_id}")
async def get_session_state(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_own_session(session_id, current_user, db)
    return {
        "session_id": session.id,
        "course_id": session.course_id,
        "status": session.status,
        "xp": session.xp or 0,
        "answered": session.answered or {},
        "completed_chapters": session.completed_chapters or [],
    }


@router.post("/sessions/{session_id}/answer")
async def submit_answer(
    session_id: int,
    payload: AnswerSubmit,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """
    🛡️ Anti-cheat core:
    1. ดึง correct_answer_index จาก Database เท่านั้น
    2. คำนวณ + อนุมัติ XP ฝั่ง server
    3. ป้องกันการตอบซ้ำเพื่อฟาร์ม XP
    """
    session = await _get_own_session(session_id, current_user, db)
    if session.status != "active":
        raise HTTPException(status_code=400, detail="Session นี้จบไปแล้ว กรุณาเริ่ม Session ใหม่")

    answered = dict(session.answered or {})
    key = str(payload.question_id)

    # Replay protection — ตอบข้อนี้ไปแล้ว ไม่ให้ทำ XP ซ้ำ (กฎข้อ #40)
    # แต่ reveal ข้อมูลเต็มกลับไป เพื่อไม่ให้ UI ค้าง/กดแล้วเงียบ
    if key in answered:
        prev = answered[key]
        q_result2 = await db.execute(select(QuizQuestion).where(QuizQuestion.id == payload.question_id))
        q_old = q_result2.scalars().first()
        return {
            "already_answered": True,
            "correct": prev.get("correct", False),
            "correct_answer_index": q_old.correct_answer_index if q_old else None,
            "explanation": q_old.explanation if q_old else None,
            "source_reference": q_old.source_reference if q_old else None,
            "xp_awarded": 0,
            "total_xp": session.xp or 0,
        }

    q_result = await db.execute(select(QuizQuestion).where(QuizQuestion.id == payload.question_id))
    question = q_result.scalars().first()
    if not question:
        raise HTTPException(status_code=404, detail="ไม่พบคำถามนี้")

    modes = await _course_modes(db, session.course_id)
    state = _ensure_state(session, modes)

    is_correct = payload.answer_index == question.correct_answer_index
    xp_awarded = question.points if is_correct else 0
    resources_awarded = {}
    enemy_damage = 0

    if is_correct:
        # ---- Combo / Skills ----
        state["combo"] = (state.get("combo") or 0) + 1
        state["best_combo"] = max(state.get("best_combo") or 0, state["combo"])

        # ---- Resource rewards (base_building) — ×ความยาก ×streak, server-side ----
        if "base_building" in modes:
            rewards = compute_correct_rewards(
                state,
                difficulty=(question.difficulty or "easy").lower(),
                combo=state["combo"],
            )
            apply_resources(state, rewards)
            resources_awarded = rewards

        # ---- XP bonus จาก academy (xp_multiplier) ----
        effects = building_effects(state.get("buildings", []))
        xp_mult = 1 + effects.get("xp_multiplier", 0)
        if xp_mult > 1:
            xp_awarded = round(xp_awarded * xp_mult)
    else:
        state["combo"] = 0
        # ---- Turn-Based Combat: ตอบผิด → enemy โจมตี ----
        if "turn_based" in modes:
            enemy_damage = _random.randint(COMBAT["enemy_damage_min"], COMBAT["enemy_damage_max"])
            state["hp"] = max(0, (state.get("hp") or 0) - enemy_damage)

    # ---- Raid lifecycle: expiry / trigger หลังทุก interaction ----
    raid_expired_msg = _resolve_raid_expiry(state)
    _maybe_trigger_raid(state, modes)

    answered[key] = {
        "answer": payload.answer_index,
        "correct": is_correct,
        "chapter_id": question.chapter_id,
    }
    session.answered = answered
    session.xp = (session.xp or 0) + xp_awarded
    session.game_state = sanitize_game_state(state)
    await db.commit()

    return {
        "already_answered": False,
        "correct": is_correct,
        "correct_answer_index": question.correct_answer_index,
        "explanation": question.explanation,
        "source_reference": question.source_reference,
        "points": question.points,
        "xp_awarded": xp_awarded,
        "total_xp": session.xp,
        "resources_awarded": resources_awarded,
        "enemy_damage": enemy_damage,
        "game_state": session.game_state,
        "skills": _skills_for_combo(session.game_state.get("combo", 0)),
        "defeated": "turn_based" in modes and (session.game_state.get("hp") or 0) <= 0,
        "raid_expired": raid_expired_msg,
    }


@router.post("/sessions/{session_id}/complete-chapter")
async def complete_chapter(
    session_id: int,
    payload: ChapterComplete,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """Checkpoint system (กฎข้อ #39) + คืน Level/Badge ใหม่ที่ได้รับ"""
    session = await _get_own_session(session_id, current_user, db)

    ch_result = await db.execute(
        select(Chapter).where(Chapter.id == payload.chapter_id, Chapter.course_id == session.course_id)
    )
    chapter = ch_result.scalars().first()
    if not chapter:
        raise HTTPException(status_code=404, detail="ไม่พบ Chapter")

    completed = list(session.completed_chapters or [])
    newly_completed = payload.chapter_id not in completed
    checkpoint_bonus = 25 if newly_completed else 0

    if newly_completed:
        completed.append(payload.chapter_id)
        session.completed_chapters = completed

        # โบนัสต้องตอบถูกครบทุกข้อของ chapter ก่อน (validate จาก answered)
        answered = session.answered or {}
        qs_result = await db.execute(
            select(QuizQuestion).where(QuizQuestion.chapter_id == payload.chapter_id)
        )
        questions = list(qs_result.scalars().all())
        all_correct = bool(questions) and all(
            (answered.get(str(q.id)) or {}).get("correct") is True for q in questions
        )
        if all_correct:
            checkpoint_bonus += 50  # Perfect Chapter bonus

    session.xp = (session.xp or 0) + checkpoint_bonus

    # ---- Chapter clear rewards (base_building) ----
    modes = await _course_modes(db, session.course_id)
    state = _ensure_state(session, modes)
    chapter_rewards = {}
    if "base_building" in modes and newly_completed:
        answered_map = session.answered or {}
        qs_result2 = await db.execute(
            select(QuizQuestion).where(QuizQuestion.chapter_id == payload.chapter_id)
        )
        questions_c = list(qs_result2.scalars().all())
        perfect = bool(questions_c) and all(
            (answered_map.get(str(q.id)) or {}).get("correct") is True for q in questions_c
        )
        chapter_rewards = {"stone": 5 if perfect else 2, "crystal": 3 if perfect else 1}
        apply_resources(state, chapter_rewards)
    session.game_state = sanitize_game_state(state)

    # ---- คำนวณ Level ----
    levels_result = await db.execute(select(Level).where(Level.course_id == session.course_id))
    level_info = _compute_level(session.xp, list(levels_result.scalars().all()))

    # ---- ตรวจ Badge ใหม่ ----
    badges_result = await db.execute(select(Badge).where(Badge.course_id == session.course_id))
    earned_badges = []
    total_chapters = len((await db.execute(
        select(Chapter).where(Chapter.course_id == session.course_id)
    )).scalars().all())

    for bd in badges_result.scalars().all():
        hint = (bd.condition_hint or "").lower()
        name = bd.name
        earned = False
        if "perfect" in hint and checkpoint_bonus >= 75:
            earned = True
        elif ("boss" in hint or "final" in hint) and len(completed) >= total_chapters and total_chapters > 0:
            earned = True
        elif len(completed) >= max(1, total_chapters // 2) and "explor" in hint:
            earned = True
        elif checkpoint_bonus > 0 and len(completed) >= 1 and ("first" in hint or "begin" in hint or "start" in hint):
            earned = True
        if earned:
            earned_badges.append({"name": name, "description": bd.description})

    await db.commit()
    return {
        "message": f"Checkpoint! จบ Chapter '{chapter.title}' แล้ว",
        "newly_completed": newly_completed,
        "bonus_xp": checkpoint_bonus,
        "total_xp": session.xp,
        "level": level_info,
        "badges_earned": earned_badges,
        "completed_chapters": completed,
        "progress_percent": round(len(completed) / total_chapters * 100) if total_chapters else 0,
        "chapter_rewards": chapter_rewards,
        "game_state": session.game_state or {},
    }


# ------------------------------------------------------------------------------
# Base Building — ก่อสร้างอาคาร (ตรวจต้นทุนฝั่ง server)
# ------------------------------------------------------------------------------

@router.post("/sessions/{session_id}/build")
async def build_building(
    session_id: int,
    payload: BuildRequest,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_own_session(session_id, current_user, db)

    building = BUILDINGS.get(payload.building_id)
    if not building:
        raise HTTPException(status_code=404, detail="ไม่รู้จักอาคารนี้")

    modes = await _course_modes(db, session.course_id)
    state = sanitize_game_state(session.game_state or {})
    buildings = list(state.get("buildings", []))
    resources = state.get("resources", {})

    if payload.building_id in buildings:
        raise HTTPException(status_code=400, detail="สร้างอาคารนี้ไปแล้ว")
    if "base_building" not in modes:
        raise HTTPException(status_code=400, detail="คอร์สนี้ไม่ได้เปิดโหมด Base Building")

    # เงื่อนไขปลดล็อก
    chapters_done = len(session.completed_chapters or [])
    total_chapters = len((await db.execute(
        select(Chapter).where(Chapter.course_id == session.course_id)
    )).scalars().all())
    required = building["unlock_chapters"]
    # scale unlock requirement ตามสัดส่วน chapter (0=ทันที, 1=1/3 แรก, ...)
    scaled = 0
    if required > 0 and total_chapters > 0:
        scaled = max(1, round(total_chapters * required / 3))
    if chapters_done < scaled:
        raise HTTPException(
            status_code=400,
            detail=f"ต้องจบ Chapter ครบ {scaled} ก่อนจึงปลดล็อก{building['name']}",
        )

    for req in building.get("requires", []):
        if req not in buildings:
            req_name = BUILDINGS[req]["name"]
            raise HTTPException(status_code=400, detail=f"ต้องมี{req_name}ก่อน")

    if not can_afford(resources, building["cost"]):
        missing = {
            k: v - resources.get(k, 0) for k, v in building["cost"].items()
            if resources.get(k, 0) < v
        }
        raise HTTPException(status_code=400, detail=f"ทรัพยากรไม่พอ ขาด: {missing}")

    deduct_cost(resources, building["cost"])
    buildings.append(payload.building_id)
    state["buildings"] = buildings
    state["resources"] = resources

    # house เพิ่ม max HP ถ้าเล่น combat ด้วย
    if "turn_based" in modes:
        effects = building_effects(buildings)
        new_max = COMBAT["base_max_hp"] + effects.get("bonus_max_hp", 0)
        heal = new_max - state["max_hp"]
        state["max_hp"] = new_max
        state["hp"] = min(new_max, (state.get("hp") or 0) + max(0, heal))

    session.game_state = state
    await db.commit()

    return {
        "message": f"🏗️ สร้าง{building['name']}สำเร็จ! {building['effect_text']}",
        "building": payload.building_id,
        "game_state": state,
    }


# ------------------------------------------------------------------------------
# Hint — ใช้ Knowledge ตัดตัวเลือกผิด 1 ข้อ (50/50)
# ------------------------------------------------------------------------------

@router.post("/sessions/{session_id}/hint")
async def use_hint(
    session_id: int,
    payload: HintRequest,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_own_session(session_id, current_user, db)
    modes = await _course_modes(db, session.course_id)
    state = sanitize_game_state(session.game_state or {})
    knowledge = state.get("resources", {}).get("knowledge", 0)

    if knowledge < 1:
        raise HTTPException(status_code=400, detail="Knowledge ไม่พอ — สร้างห้องสมุดแล้วตอบถูกเพื่อสะสม")

    q_result = await db.execute(select(QuizQuestion).where(QuizQuestion.id == payload.question_id))
    question = q_result.scalars().first()
    if not question:
        raise HTTPException(status_code=404, detail="ไม่พบคำถาม")

    import random

    wrong_indexes = [
        i for i in range(len(question.options)) if i != question.correct_answer_index
    ]
    if len(wrong_indexes) <= 1:
        raise HTTPException(status_code=400, detail="Hint ใช้ไม่ได้แล้ว (เหลือตัวเลือกน้อย)")

    eliminated = random.choice(wrong_indexes)
    state["resources"]["knowledge"] = knowledge - 1
    session.game_state = state
    await db.commit()

    return {
        "eliminated_option": eliminated,
        "game_state": state,
        "message": "💡 Hint! ตัดตัวเลือกที่ผิดแน่นอน 1 ข้อออกแล้ว",
    }


# ------------------------------------------------------------------------------
# Revive — ฟื้นคืนชีพเมื่อ HP หมด (Game Over → เล่นต่อได้)
# ------------------------------------------------------------------------------

@router.post("/sessions/{session_id}/revive")
async def revive(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_own_session(session_id, current_user, db)
    modes = await _course_modes(db, session.course_id)
    state = _ensure_state(session, modes)

    state["hp"] = state["max_hp"]
    state["combo"] = 0
    state["deaths"] = (state.get("deaths") or 0) + 1

    # โทษเล็กน้อยแบบไม่ถึงกับเจ็บ: เสีย gold 10% (ปัดลง)
    res = state.get("resources", {})
    lost_gold = int(res.get("gold", 0) * 0.1)
    res["gold"] = res.get("gold", 0) - lost_gold
    state["resources"] = res

    session.game_state = sanitize_game_state(state)
    await db.commit()

    return {
        "message": f"✨ ฟื้นคืนชีพแล้ว! (เสีย Gold {lost_gold})",
        "game_state": session.game_state,
        "lost_gold": lost_gold,
    }


@router.post("/sessions/{session_id}/finish")
async def finish_session(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """จบเกม → Game Result + Learning Coverage (กฎข้อ #43/#56)"""
    session = await _get_own_session(session_id, current_user, db)

    answered = session.answered or {}
    total_answered = len(answered)
    total_correct = sum(1 for a in answered.values() if a.get("correct"))

    # ---- Learning Coverage per concept (จาก concept tag ของคำถาม) ----
    coverage: dict[str, dict] = {}

    chapters_result = await db.execute(
        select(Chapter)
        .options(selectinload(Chapter.quiz_questions))
        .where(Chapter.course_id == session.course_id)
    )
    chapters = list(chapters_result.scalars().all())
    total_questions_in_course = sum(len(ch.quiz_questions) for ch in chapters)

    for ch in chapters:
        for q in ch.quiz_questions:
            entry = coverage.setdefault(ch.title, {"attempted": 0, "correct": 0, "total": len(ch.quiz_questions)})
            record = answered.get(str(q.id))
            if record:
                entry["attempted"] += 1
                if record.get("correct"):
                    entry["correct"] += 1

    learning_coverage = [
        {
            "chapter": title,
            "percent": round(e["attempted"] / e["total"] * 100) if e["total"] else 0,
            "mastery_percent": round(e["correct"] / e["attempted"] * 100) if e["attempted"] else 0,
        }
        for title, e in coverage.items()
    ]

    overall_coverage = (
        round(total_answered / total_questions_in_course * 100)
        if total_questions_in_course else 0
    )
    accuracy = round(total_correct / total_answered * 100) if total_answered else 0

    needs_practice = [c["chapter"] for c in learning_coverage if c["mastery_percent"] < 60]

    session.status = "completed"
    await db.commit()

    return {
        "session_id": session.id,
        "score": session.xp,
        "accuracy_percent": accuracy,
        "learning_coverage_percent": overall_coverage,
        "per_chapter": learning_coverage,
        "needs_practice": needs_practice,
        "recommendations": (
            [f"ลองทบทวน '{t}' อีกครั้ง แล้วเล่น Chapter นั้นใหม่เพื่อเพิ่มความเข้าใจ" for t in needs_practice]
            if needs_practice else ["ยอดเยี่ยม! คุณเข้าใจครบทุกบทเรียนแล้ว 🎉"]
        ),
        "total_xp": session.xp,
        "questions_total": total_questions_in_course,
        "questions_attempted": total_answered,
        "questions_correct": total_correct,
    }


@router.get("/users/me/progress")
async def get_my_progress(
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """Student Analytics (กฎข้อ #95)"""
    result = await db.execute(
        select(GameSession).options(selectinload(GameSession.course)).where(GameSession.user_id == current_user.id)
    )
    sessions = list(result.scalars().all())

    total_xp = sum(s.xp or 0 for s in sessions)
    by_course = []
    for s in sessions:
        by_course.append({
            "course_id": s.course_id,
            "course_title": s.course.title if s.course else None,
            "status": s.status,
            "xp": s.xp or 0,
            "chapters_completed": len(s.completed_chapters or []),
            "last_played": s.updated_at.isoformat() if s.updated_at else None,
        })

    return {"total_xp": total_xp, "sessions": by_course}


@router.get("/courses/{course_id}/my-session-summary")
async def my_session_summary(
    course_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """Teacher analytics เบื้องต้น: สถิตินักเรียนในคอร์ส (กฎข้อ #94)"""
    course_result = await db.execute(
        select(Course).where(Course.id == course_id, Course.teacher_id == current_user.id)
    )
    if not course_result.scalars().first():
        raise HTTPException(status_code=404, detail="ไม่พบคอร์ส หรือไม่มีสิทธิ์")

    result = await db.execute(
        select(GameSession).options(selectinload(GameSession.user)).where(GameSession.course_id == course_id)
    )
    sessions = list(result.scalars().all())
    completed = [s for s in sessions if s.status == "completed"]

    avg_accuracy = 0
    if completed:
        accs = []
        for s in completed:
            ans = s.answered or {}
            if ans:
                accs.append(sum(1 for a in ans.values() if a.get("correct")) / len(ans))
        avg_accuracy = round(sum(accs) / len(accs) * 100) if accs else 0

    return {
        "players": len(sessions),
        "completions": len(completed),
        "average_accuracy_percent": avg_accuracy,
        "average_xp": round(sum(s.xp or 0 for s in sessions) / len(sessions)) if sessions else 0,
    }


# ------------------------------------------------------------------------------
# BASE ECONOMY v2 — เก็บผลผลิต / สถานะ / Raid defense
# ------------------------------------------------------------------------------

@router.post("/sessions/{session_id}/collect")
async def collect_production(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """เก็บผลผลิตที่อาคารสะสมไว้ (คำนวณจากเวลาจริง ฝั่ง server + cap ต่อคลัง)"""
    session = await _get_own_session(session_id, current_user, db)
    modes = await _course_modes(db, session.course_id)
    state = sanitize_game_state(session.game_state or {})

    if "base_building" not in modes:
        raise HTTPException(status_code=400, detail="คอร์สนี้ไม่ได้เปิดโหมด Base Building")
    if not state.get("last_collected"):
        state["last_collected"] = _now_ms()
        session.game_state = state
        await db.commit()
        raise HTTPException(status_code=400, detail="ยังไม่มีผลผลิตสะสม — กลับมาเก็บใหม่ภายหลัง")

    pending = _pending_production(state)
    total = sum(pending.values())
    if total <= 0:
        state["last_collected"] = _now_ms()
        session.game_state = sanitize_game_state(state)
        await db.commit()
        return {
            "message": "ยังไม่มีผลผลิตพอเก็บ — รออาคารผลิตอีกครั่ง ⏳",
            "collected": {},
            "game_state": state,
        }

    apply_resources(state, pending)
    state["last_collected"] = _now_ms()

    raid_msg = _resolve_raid_expiry(state)
    _maybe_trigger_raid(state, modes)
    session.game_state = sanitize_game_state(state)
    await db.commit()

    icons = {"gold": "💰", "wood": "🪵", "stone": "🪨", "crystal": "💎", "knowledge": "📖"}
    pretty = " ".join(f"{icons.get(k, '')}{v}" for k, v in pending.items())
    return {
        "message": f"📦 เก็บผลผลิตแล้ว: {pretty}",
        "collected": pending,
        "game_state": state,
        "raid_expired": raid_msg,
    }


@router.get("/sessions/{session_id}/status")
async def session_status(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """Polling endpoint — pending production + raid state (ฝั่ง server เป็นศาล)"""
    session = await _get_own_session(session_id, current_user, db)
    modes = await _course_modes(db, session.course_id)
    state = _ensure_state(session, modes)

    expire_msg = _resolve_raid_expiry(state)
    _maybe_trigger_raid(state, modes)
    session.game_state = sanitize_game_state(state)
    await db.commit()

    return {
        "game_state": session.game_state or {},
        "pending": _pending_production(session.game_state or {}),
        "pending_per_building": _pending_per_building(session.game_state or {}),
        "raid": (session.game_state or {}).get("raid"),
        "notice": expire_msg,
    }


@router.post("/sessions/{session_id}/raid/question")
async def raid_defense_question(
    session_id: int,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """สุ่มคำถามจากคอร์สมาเป็นบทขับไล่ (ไม่เผยคำตอบ)"""
    session = await _get_own_session(session_id, current_user, db)
    chapter_ids = list(
        (
            await db.execute(select(Chapter.id).where(Chapter.course_id == session.course_id))
        ).scalars().all()
    )
    questions: list[QuizQuestion] = []
    if chapter_ids:
        result = await db.execute(
            select(QuizQuestion).where(QuizQuestion.chapter_id.in_(chapter_ids))
        )
        questions = list(result.scalars().all())

    if not questions:
        raise HTTPException(status_code=404, detail="ไม่มีคำถามในคอร์สนี้")

    q = _random.choice(questions)
    return {
        "question_id": q.id,
        "question": q.question,
        "options": q.options,
        "points": q.points,
    }


class RaidDefend(BaseModel):
    question_id: int
    answer_index: int


@router.post("/sessions/{session_id}/raid/defend")
async def raid_defend(
    session_id: int,
    payload: RaidDefend,
    current_user: User = Depends(get_player),
    db: AsyncSession = Depends(get_db),
):
    """ตอบถูก = ขับไล่สำเร็จ + loot · ตอบผิด = ลองใหม่ได้จนหมดเวลา"""
    session = await _get_own_session(session_id, current_user, db)
    modes = await _course_modes(db, session.course_id)
    state = sanitize_game_state(session.game_state or {})
    raid = state.get("raid")
    if not raid:
        raise HTTPException(status_code=400, detail="ไม่มีการบุกอยู่ตอนนี้")

    # หมดเวลาก่อนตอบ?
    expired_msg = _resolve_raid_expiry(state)
    if expired_msg:
        session.game_state = sanitize_game_state(state)
        await db.commit()
        return {
            "repelled": False,
            "expired": True,
            "message": expired_msg,
            "game_state": state,
        }

    q_result = await db.execute(select(QuizQuestion).where(QuizQuestion.id == payload.question_id))
    question = q_result.scalars().first()
    if not question:
        raise HTTPException(status_code=404, detail="ไม่พบคำถาม")

    is_correct = payload.answer_index == question.correct_answer_index
    if not is_correct:
        state["combo"] = 0
        session.game_state = sanitize_game_state(state)
        await db.commit()
        return {
            "repelled": False,
            "correct_answer_index": question.correct_answer_index,
            "explanation": question.explanation,
            "message": "❌ ตอบผิด! ผู้รุกรานยังไม่ถอย — ลองอีกครั้ง!",
            "game_state": state,
        }

    # ---- ขับไล่สำเร็จ ----
    loot = dict(RAID["loot"])
    combo = state.get("combo", 0)
    mult = 1.0 + (0.5 if combo >= 5 else 0.25 if combo >= 3 else 0.0)
    loot = {k: max(1, round(v * mult)) for k, v in loot.items()}
    apply_resources(state, loot)

    state["raid"] = None
    state["raids_repelled"] = (state.get("raids_repelled") or 0) + 1
    state["raid_cooldown_until"] = _now_ms() + RAID["cooldown_seconds"] * 1000
    xp_bonus = 30

    session.xp = (session.xp or 0) + xp_bonus
    session.game_state = sanitize_game_state(state)
    await db.commit()

    icons = {"gold": "💰", "wood": "🪵", "stone": "🪨", "crystal": "💎", "knowledge": "📖"}
    pretty = " ".join(f"{icons.get(k, '')}{v}" for k, v in loot.items())
    return {
        "repelled": True,
        "message": f"🛡️ ขับไล่สำเร็จ! ป้องกันฐานได้ — Loot: {pretty} (+{xp_bonus} XP)",
        "loot": loot,
        "xp_bonus": xp_bonus,
        "total_xp": session.xp,
        "correct_answer_index": question.correct_answer_index,
        "explanation": question.explanation,
        "game_state": state,
    }
