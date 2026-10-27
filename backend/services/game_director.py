# ==============================================================================
# services/game_director.py — AI Agent Orchestrator
#
# Agents:
#   1. analyze_content()        — Content Analyzer Agent
#   2. recommend_game_genres()  — Game Director Agent (genre recommender)
#   3. generate_game()          — Game Designer + World Builder + Story +
#                                 Character + Quest Generator (structured output)
#
# กฎสำคัญ (Content Grounding — ข้อ #44):
#   - ทุก element ต้องสร้างจากเนื้อหาที่ upload เท่านั้น
# ==============================================================================

import json
import random
import traceback
from collections import Counter
from typing import Any, Optional

from pydantic import ValidationError

from schemas.generation import CourseGenerationAI, ContentSufficiencyAI, QuizQuestionAI
from services.ai_provider import get_ai_provider, AIProviderError
from services.extractors import extract_text, ExtractionError

MAX_SOURCE_CHARS = 24000

# ------------------------------------------------------------------------------
# Game Length Config — จำนวนบทและคำถามต่อบทตามความยาวที่เลือก
# ------------------------------------------------------------------------------

GAME_LENGTH_CONFIG = {
    "short":   {"chapters": 5,  "questions_per_chapter": 2},
    "medium":  {"chapters": 10, "questions_per_chapter": 3},
    "long":    {"chapters": 15, "questions_per_chapter": 4},
}

VALID_LENGTHS = set(GAME_LENGTH_CONFIG.keys())
VALID_QUESTION_TYPES = {"multiple_choice", "true_false", "matching", "ordering"}

# Language codes ที่รองรับการบังคับ (map → ชื่อภาษาเต็มส่งให้ AI)
LANGUAGE_NAMES = {
    "th": "ไทย (Thai)",
    "en": "อังกฤษ (English)",
}


def detect_language(text: str) -> str:
    """ตรวจภาษาหลักของเอกสารแบบ heuristic (นับสัดส่วนอักขระ)"""
    thai_chars = sum(1 for c in text if "\u0e00" <= c <= "\u0e7f")
    latin_chars = sum(1 for c in text if c.isascii() and c.isalpha())
    total = thai_chars + latin_chars
    if total == 0:
        return "en"
    return "th" if thai_chars / total >= 0.05 else "en"


def _language_matches(text: str, expected: str) -> bool:
    """
    ตรวจว่า output ของ AI ตรงกับภาษาที่ต้องการไหม
    - th: ต้องมีสัดส่วนไทยพอสมควร
    - en: ต้องเป็น latin เป็นหลัก และแทบไม่มีอักขระจีน/ญี่ปุ่น
    """
    sample = text[:6000]
    if not sample:
        return False
    thai = sum(1 for c in sample if "\u0e00" <= c <= "\u0e7f")
    cjk = sum(1 for c in sample if "\u4e00" <= c <= "\u9fff" or "\u3040" <= c <= "\u30ff")
    letters = max(1, sum(1 for c in sample if c.isalpha()))

    if expected == "th":
        return thai / letters >= 0.25 and cjk < letters * 0.02
    # en (หรืออื่นๆ): อักขระ CJK ต้องแทบไม่มี
    return cjk / letters < 0.02


def _read_source(file_path: str) -> str:
    """อ่านไฟล์ผ่าน Extraction Layer (รองรับ PDF/DOCX/PPTX/TXT จริง)"""
    return extract_text(file_path)[:MAX_SOURCE_CHARS]


# ------------------------------------------------------------------------------
# Question Type Coverage — รับประกันว่าทุกประเภทที่ผู้สอนเลือกมีคำถามจริง
# ------------------------------------------------------------------------------

def _clean_text(value) -> str:
    return str(value or "").strip()


def _build_supplement_question(data: dict, expected_type: str) -> QuizQuestionAI | None:
    """แปลงคำถามจาก supplementary AI call → QuizQuestionAI (คืน None ถ้าข้อมูลใช้ไม่ได้)"""
    if not isinstance(data, dict):
        return None
    qtype = _clean_text(data.get("question_type")) or expected_type
    if qtype != expected_type:
        return None

    question = _clean_text(data.get("question"))
    explanation = _clean_text(data.get("explanation"))
    if not question or not explanation:
        return None

    options = [_clean_text(o) for o in (data.get("options") or []) if _clean_text(o)]
    correct_index = data.get("correct_answer_index", 0)
    try:
        correct_index = int(correct_index)
    except (TypeError, ValueError):
        correct_index = 0

    matching_pairs = None
    ordering_items = None
    correct_data = None

    if qtype == "matching":
        pairs: list[dict[str, str]] = []
        seen_left: set[str] = set()
        for pair in data.get("matching_pairs") or []:
            if not isinstance(pair, dict):
                continue
            left = _clean_text(pair.get("left"))
            right = _clean_text(pair.get("right"))
            if left and right and left not in seen_left:
                seen_left.add(left)
                pairs.append({"left": left, "right": right})
        if len(pairs) < 2:
            return None

        raw_correct = data.get("correct_data")
        correct_map: dict[str, str] = {}
        if isinstance(raw_correct, dict):
            rights = {p["right"] for p in pairs}
            for pair in pairs:
                value = _clean_text(raw_correct.get(pair["left"]))
                if value in rights:
                    correct_map[pair["left"]] = value
        if len(correct_map) != len(pairs):
            correct_map = {p["left"]: p["right"] for p in pairs}

        matching_pairs = pairs
        correct_data = correct_map
        options = ["-", "-"]
        correct_index = 0

    elif qtype == "ordering":
        items: list[str] = []
        for item in data.get("ordering_items") or []:
            text = _clean_text(item)
            if text and text not in items:
                items.append(text)
        if len(items) < 3:
            return None

        raw_correct = data.get("correct_data")
        valid_order = (
            isinstance(raw_correct, list)
            and len(raw_correct) == len(items)
            and all(isinstance(i, int) for i in raw_correct)
            and sorted(raw_correct) == list(range(len(items)))
        )
        if valid_order:
            order = list(raw_correct)
        else:
            # AI ไม่ส่งเฉลยที่ใช้ได้ — สลับ items แล้วคำนวณเฉลยให้เอง
            shuffled = items[:]
            random.shuffle(shuffled)
            order = [shuffled.index(item) for item in items]
            items = shuffled

        ordering_items = items
        correct_data = order
        options = ["-", "-"]
        correct_index = 0

    elif qtype == "true_false":
        options = options[:2] if len(options) >= 2 else ["จริง", "เท็จ"]
        correct_index = correct_index if 0 <= correct_index < len(options) else 0

    else:
        if len(options) < 2 or not (0 <= correct_index < len(options)):
            return None

    difficulty = _clean_text(data.get("difficulty")) or "medium"
    if difficulty not in ("easy", "medium", "hard"):
        difficulty = "medium"
    try:
        points = max(1, int(data.get("points", 50)))
    except (TypeError, ValueError):
        points = 50

    try:
        return QuizQuestionAI(
            question=question,
            options=options,
            correct_answer_index=correct_index,
            explanation=explanation,
            difficulty=difficulty,
            points=points,
            source_reference=_clean_text(data.get("source_reference")) or "เนื้อหาบทเรียน",
            concept=_clean_text(data.get("concept")) or None,
            question_type=qtype,
            matching_pairs=matching_pairs,
            ordering_items=ordering_items,
            correct_data=correct_data,
        )
    except Exception as exc:
        print(f"⚠️ [GameDirector] Invalid supplementary question: {exc}")
        return None


_QUESTION_TYPE_ALIASES = {
    "mcq": "multiple_choice",
    "multiple-choice": "multiple_choice",
    "multiplechoice": "multiple_choice",
    "choice": "multiple_choice",
    "tf": "true_false",
    "true/false": "true_false",
    "truefalse": "true_false",
    "boolean": "true_false",
    "match": "matching",
    "matching_pairs": "matching",
    "pair": "matching",
    "order": "ordering",
    "sorting": "ordering",
    "sequence": "ordering",
    "arrange": "ordering",
}
_VALID_QUESTION_TYPES = {"multiple_choice", "true_false", "matching", "ordering"}
_MAX_OPTIONS = 6


def _clean_text_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, (int, float)):
            text = str(item).strip()
        else:
            text = ""
        if text:
            out.append(text)
    return out


def _normalize_question(raw: Any) -> Optional[dict]:
    """ซ่อมคำถามที่ AI ส่งมาให้ผ่าน schema ได้

    ปัญหาที่เจอบ่อย (ทำให้ทั้งงานล้มด้วย Pydantic ValidationError):
      - matching/ordering ใส่ options เป็นคำใบ้คำเดียว เช่น ["จับคู่"], ["เรียงลำดับ"]
        → เติม options จาก matching_pairs / ordering_items จริง (ตัวเล่นใช้สองฟิลด์นั้นอยู่แล้ว)
      - correct_answer_index หลุดช่วง / ชี้ option ที่ไม่มี
      - ลืม field ที่ schema บังคับ (explanation, source_reference)
    คืน None เมื่อซ่อมไม่ได้ เพื่อให้ coverage เติมคำถามประเภทนั้นกลับให้ภายหลัง
    """
    if not isinstance(raw, dict):
        return None

    q = dict(raw)

    qtype = str(q.get("question_type") or "multiple_choice").strip().lower()
    qtype = _QUESTION_TYPE_ALIASES.get(qtype, qtype)
    if qtype not in _VALID_QUESTION_TYPES:
        qtype = "multiple_choice"
    q["question_type"] = qtype

    question_text = str(q.get("question") or "").strip()
    if not question_text:
        return None
    q["question"] = question_text

    # field บังคับที่ AI มักลืม
    q.setdefault("explanation", "")
    q.setdefault("source_reference", "")
    if not isinstance(q.get("explanation"), str):
        q["explanation"] = str(q.get("explanation") or "")
    if not isinstance(q.get("source_reference"), str):
        q["source_reference"] = str(q.get("source_reference") or "")

    options = _clean_text_list(q.get("options"))

    if qtype == "matching":
        pairs = q.get("matching_pairs")
        clean_pairs = [
            {"left": str(p["left"]).strip(), "right": str(p["right"]).strip()}
            for p in (pairs if isinstance(pairs, list) else [])
            if isinstance(p, dict)
            and str(p.get("left") or "").strip()
            and str(p.get("right") or "").strip()
        ]
        lefts = list(dict.fromkeys(p["left"] for p in clean_pairs))
        if len(lefts) < 2:
            return None  # ซ่อมไม่ได้ — ปล่อยให้ coverage สร้าง matching ใหม่ให้
        q["matching_pairs"] = clean_pairs
        q["options"] = lefts[:_MAX_OPTIONS]
        q["correct_data"] = {p["left"]: p["right"] for p in clean_pairs}
        q["correct_answer_index"] = 0
        return q

    if qtype == "ordering":
        items = list(dict.fromkeys(_clean_text_list(q.get("ordering_items")) or options))
        if len(items) < 3:
            return None  # เรียงลำดับต้องมีอย่างน้อย 3 ชิ้น
        q["ordering_items"] = items
        q["options"] = items[:_MAX_OPTIONS]
        raw_order = q.get("correct_data")
        if not (
            isinstance(raw_order, list)
            and len(raw_order) == len(items)
            and sorted(raw_order) == list(range(len(items)))
        ):
            q["correct_data"] = list(range(len(items)))
        q["correct_answer_index"] = 0
        return q

    if qtype == "true_false":
        if len(options) < 2:
            options = ["จริง", "เท็จ"]
        q["options"] = options[:2]
    else:  # multiple_choice
        options = list(dict.fromkeys(options))
        if len(options) < 2:
            return None
        q["options"] = options[:_MAX_OPTIONS]

    idx = q.get("correct_answer_index")
    if not isinstance(idx, int) or isinstance(idx, bool) or not (0 <= idx < len(q["options"])):
        q["correct_answer_index"] = 0
    return q


def _fallback_question(chapter: dict) -> Optional[dict]:
    """สร้างคำถามสำรองจากเนื้อหาบท เมื่อคำถามที่ AI ส่งมาซ่อมไม่ได้ทั้งหมด

    ใช้ข้อความจริงจากบทเรียน (ไม่แต่งเนื้อหาใหม่) ทำเป็นข้อถูก/ผิด
    เพื่อไม่ให้ทั้งงานล้มเพราะ schema บังคับทุกบทต้องมีคำถามอย่างน้อย 1 ข้อ
    """
    lesson = chapter.get("lesson") if isinstance(chapter.get("lesson"), dict) else {}
    statement = str(lesson.get("content") or lesson.get("objective") or "").strip()
    if not statement:
        title = str(chapter.get("title") or "").strip()
        statement = title
    if not statement:
        return None
    statement = statement.split("\n")[0].strip()
    if len(statement) > 180:
        statement = statement[:180].rstrip() + "…"
    return {
        "question": f"ข้อความนี้ถูกหรือผิด: {statement}",
        "options": ["จริง", "เท็จ"],
        "correct_answer_index": 0,
        "explanation": f"เนื้อหานี้มาจากบท “{chapter.get('title', '')}” ในเอกสารต้นฉบับ",
        "difficulty": "easy",
        "points": 50,
        "source_reference": str(chapter.get("title") or ""),
        "concept": None,
        "question_type": "true_false",
        "matching_pairs": None,
        "ordering_items": None,
        "correct_data": None,
    }


def _normalize_ai_payload(raw: Any) -> Any:
    """normalize คำถามทุกข้อก่อน model_validate (กัน ValidationError ทำให้งานล้มทั้งใบ)"""
    if not isinstance(raw, dict):
        return raw

    payload = dict(raw)
    chapters = payload.get("chapters")
    if not isinstance(chapters, list):
        return payload

    fixed_chapters: list[dict] = []
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        ch = dict(chapter)
        questions = ch.get("quiz_questions")
        normalized = [
            nq
            for nq in (_normalize_question(q) for q in (questions if isinstance(questions, list) else []))
            if nq is not None
        ]
        if not normalized:
            fallback = _fallback_question(ch)
            if not fallback:
                continue
            print(f"⚠️ [GameDirector] บท '{ch.get('title')}' คำถามเสียทั้งหมด — ใช้คำถามสำรอง")
            normalized = [fallback]
        ch["quiz_questions"] = normalized
        fixed_chapters.append(ch)

    payload["chapters"] = fixed_chapters
    return payload


def _shuffle_ordering_questions(validated: CourseGenerationAI) -> None:
    """สลับลำดับ ordering_items ให้ผู้เล่นต้องเรียงจริง และคงเฉลยที่ถูกต้องไว้"""
    for chapter in validated.chapters:
        for q in chapter.quiz_questions:
            if q.question_type != "ordering":
                continue
            items = list(q.ordering_items or [])
            if len(items) < 3 or len(set(items)) != len(items):
                continue

            raw_order = q.correct_data
            valid_order = (
                isinstance(raw_order, list)
                and len(raw_order) == len(items)
                and sorted(raw_order) == list(range(len(items)))
            )
            ordered_texts = (
                [items[i] for i in raw_order] if valid_order else items[:]
            )
            original = items[:]
            random.shuffle(items)
            if items == original:
                items = items[1:] + items[:1]
            q.ordering_items = items
            q.correct_data = [items.index(text) for text in ordered_texts]


async def _ensure_question_type_coverage(
    validated: CourseGenerationAI,
    required_types: list[str],
    source: str,
    lang: str,
    provider,
) -> None:
    """
    AI หลักมักสร้างแค่ multiple_choice/true_false เพราะ output limit
    → ตรวจสัดส่วนคำถามแต่ละประเภท ถ้าน้อยเกินไป ให้เรียก AI รอบเล็กสร้างเพิ่ม
      แล้วแทนที่คำถามเดิม (คงจำนวนข้อต่อบทเดิม) หรือ append ถ้าจำเป็น
    """
    chapters = validated.chapters
    counts = Counter(
        q.question_type or "multiple_choice"
        for chapter in chapters
        for q in chapter.quiz_questions
    )
    total_questions = sum(counts.values())
    if total_questions == 0:
        return

    # เป้าหมายขั้นต่ำต่อประเภท: อย่างน้อย 2 ข้อ และไม่น้อยกว่า ~ครึ่งของสัดส่วนที่เท่ากัน
    per_type_target = max(2, total_questions // (len(required_types) * 2))
    needed = {
        qt: max(0, per_type_target - counts.get(qt, 0))
        for qt in required_types
    }
    plan: list[str] = []
    for qt, amount in needed.items():
        plan.extend([qt] * amount)
    if not plan:
        return

    # กระจายประเภทที่ขาดสลับกันไปตาม chapter
    assignment = [
        (i % len(chapters), qtype) for i, qtype in enumerate(plan)
    ]
    language_rule = LANGUAGE_NAMES.get(lang, lang)
    plan_text = "\n".join(
        f"- chapter_index {idx}: {qtype}" for idx, qtype in assignment
    )
    schema_hint = """{"questions": [
  {"chapter_index": 0, "question_type": "matching", "question": "...", "explanation": "...",
   "difficulty": "easy|medium|hard", "points": 50, "source_reference": "...",
   "matching_pairs": [{"left": "...", "right": "..."}], "correct_data": {"left": "right"}},
  {"chapter_index": 1, "question_type": "ordering", "question": "...", "explanation": "...",
   "difficulty": "easy|medium|hard", "points": 50, "source_reference": "...",
   "ordering_items": ["...", "..."], "correct_data": [2, 0, 1]},
  {"chapter_index": 2, "question_type": "true_false", "question": "...", "explanation": "...",
   "options": ["จริง", "เท็จ"], "correct_answer_index": 0, "source_reference": "..."},
  {"chapter_index": 3, "question_type": "multiple_choice", "question": "...", "explanation": "...",
   "options": ["...", "...", "...", "..."], "correct_answer_index": 1, "source_reference": "..."}
]}"""

    prompt = f"""คุณคือ EduQuest Question Generator
สร้างคำถามเพิ่มเพื่อให้ครบทุกประเภทที่ผู้สอนเลือก โดยอิงจากเอกสารต้นทางเท่านั้น

=== เอกสารต้นทาง ===
{source[:18000]}
=====================

ประเภทที่ต้องเสริม: {", ".join(qt for qt, amount in needed.items() if amount > 0)}

แผนการสร้าง (ต้องสร้างตามจำนวนและ chapter_index นี้เท่านั้น):
{plan_text}

ข้อกำหนด:
- สร้างทั้งหมด {len(assignment)} ข้อ ตาม chapter_index ในแผน ห้ามข้าม chapter
- ทุกข้อต้องมี question, explanation, difficulty, points, source_reference
- matching: ต้องมี matching_pairs อย่างน้อย 2 คู่ และ correct_data เป็น map left→right
- ordering: ต้องมี ordering_items อย่างน้อย 3 รายการ (สลับลำดับไว้) และ correct_data เป็น array ของ index ตามลำดับที่ถูก
- true_false: options = ["จริง","เท็จ"] และ correct_answer_index = 0 หรือ 1
- multiple_choice: options 4 ข้อ และ correct_answer_index ชี้ข้อถูก
- ห้ามใช้ double quote ซ้อนใน string ใช้ single quote แทน
- ภาษา: {language_rule} เท่านั้น

ตอบเป็น JSON object ตามรูปแบบนี้เท่านั้น:
{schema_hint}"""

    try:
        raw = await provider.generate_json(
            system_prompt=(
                "You are a strict JSON generator. Output valid JSON only. "
                f"All content MUST be in {language_rule}."
            ),
            user_prompt=prompt,
            max_tokens=4096,
        )
    except AIProviderError as exc:
        print(f"⚠️ [GameDirector] Question type supplement failed: {exc}")
        return

    raw_questions = raw.get("questions") if isinstance(raw, dict) else None
    if not isinstance(raw_questions, list):
        print("⚠️ [GameDirector] Question type supplement returned no questions")
        return

    remaining = list(assignment)
    filled_chapters: set[int] = set()
    for data in raw_questions:
        if not isinstance(data, dict) or not remaining:
            continue
        raw_type = _clean_text(data.get("question_type"))
        match_pos = next(
            (i for i, (_, qtype) in enumerate(remaining) if qtype == raw_type),
            None,
        )
        if match_pos is None:
            match_pos = 0
        expected_idx, expected_type = remaining.pop(match_pos)

        try:
            idx = int(data.get("chapter_index"))
        except (TypeError, ValueError):
            idx = expected_idx
        if not (0 <= idx < len(chapters)):
            idx = expected_idx

        question = _build_supplement_question(data, expected_type)
        if question is None:
            continue

        chapter = chapters[idx]
        if chapter.quiz_questions and idx not in filled_chapters:
            # แทนข้อสุดท้าย → จำนวนข้อต่อบทเท่าเดิม แต่ได้ประเภทที่ขาด
            chapter.quiz_questions[-1] = question
        elif len(chapter.quiz_questions) < 8:
            chapter.quiz_questions.append(question)
        else:
            chapter.quiz_questions[-1] = question
        filled_chapters.add(idx)

    final_counts = Counter(
        q.question_type or "multiple_choice"
        for chapter in chapters
        for q in chapter.quiz_questions
    )
    still_missing = [qt for qt in required_types if final_counts.get(qt, 0) == 0]
    if still_missing:
        print(f"⚠️ [GameDirector] Still missing question types: {still_missing}")
    print(f"🎯 [GameDirector] Question type counts: {dict(final_counts)}")


# ------------------------------------------------------------------------------
# Agent 1 — Content Analyzer
# ------------------------------------------------------------------------------

async def analyze_content(file_path: str) -> dict:
    """Agent 1: อ่านเอกสาร → สกัด subject/topics/objectives/difficulty (คืน dict หรือ {"error": ...})"""
    try:
        source = _read_source(file_path)
        provider = get_ai_provider()
        lang = detect_language(source)

        prompt = f"""คุณคือ Content Analyzer Agent ผู้เชี่ยวชาญด้านการศึกษา
จงอ่านเนื้อหาเอกสารบทเรียนต่อไปนี้อย่างละเอียด:

{source}

🌐 LANGUAGE RULE: เอกสารนี้เป็นภาษา{LANGUAGE_NAMES[lang]} — คุณต้องตอบกลับเป็นภาษา{LANGUAGE_NAMES[lang]}ทั้งหมด ห้ามแปลงเป็นภาษาอื่น

สกัดใจความสำคัญและโครงสร้างของเนื้อหา ตอบกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{{
  "subject": "ชื่อวิชาโดยย่อ",
  "topics": ["หัวข้อ 1", "หัวข้อ 2"],
  "learning_objectives": ["วัตถุประสงค์การเรียนรู้ 1", "..."],
  "difficulty": "beginner | intermediate | advanced",
  "summary": "สรุปสั้นๆ",
  "content_structure": "sequential | systemic | decision_based",
  "estimated_chapters": 5
}}

- content_structure: sequential = เนื้อหาไล่ลำดับขั้น, systemic = เป็นระบบ/สถาปัตยกรรม, decision_based = เน้นการตัดสินใจ
- estimated_chapters: จำนวน chapter ที่เหมาะสมกับปริมาณเนื้อหา (3-8)"""

        return await provider.generate_json(
            system_prompt="You are an education analysis agent that outputs only valid JSON.",
            user_prompt=prompt,
        )
    except (ExtractionError, AIProviderError) as e:
        print(f"❌ [ContentAnalyzer] {e}")
        traceback.print_exc()
        return {"error": str(e)}
    except Exception as e:
        print("❌ [ContentAnalyzer] Unexpected error:")
        traceback.print_exc()
        return {"error": f"AI วิเคราะห์ไฟล์ไม่สำเร็จ: {e}"}


# ------------------------------------------------------------------------------
# NEW: Content Sufficiency Checker — AI ตรวจสอบว่าเนื้อหาพอต่อความยาวเกมหรือไม่
# ------------------------------------------------------------------------------

async def analyze_content_sufficiency(file_path: str, game_length: str = "medium") -> dict:
    """
    Agent 1b: ตรวจสอบว่าเนื้อหาในเอกสารเพียงพอต่อการสร้างเกมความยาวที่เลือกหรือไม่
    คืน dict หรือ {"error": ...}
    """
    if game_length not in VALID_LENGTHS:
        return {"error": f"game_length ต้องเป็นหนึ่งใน {VALID_LENGTHS}"}

    try:
        source = _read_source(file_path)
        provider = get_ai_provider()
        lang = detect_language(source)

        length_cfg = GAME_LENGTH_CONFIG[game_length]
        target_questions = length_cfg["chapters"] * length_cfg["questions_per_chapter"]

        prompt = f"""คุณคือ Content Sufficiency Checker Agent ผู้เชี่ยวชาญด้านการออกแบบการเรียนรู้
จงอ่านเนื้อหาเอกสารบทเรียนต่อไปนี้และประเมินว่ามีเนื้อหาเพียงพอที่จะสร้างเกม
ตามความยาวที่กำหนดหรือไม่:

=== เอกสารต้นทาง ===
{source}

=== ความยาวเกมที่ต้องการ ===
- ระดับ: {game_length}
- จำนวนบท: {length_cfg['chapters']} บท
- คำถามต่อบท: {length_cfg['questions_per_chapter']} ข้อ
- คำถามรวมเป้าหมาย: {target_questions} ข้อ

🌐 LANGUAGE RULE: ตอบกลับเป็นภาษา{LANGUAGE_NAMES[lang]}ทั้งหมด

ประเมินตามเกณฑ์:
- "sufficient": เนื้อหามีแนวคิด/ข้อเท็จจริงเพียงพอต่อคำถามเป้าหมาย (แนวคิด ≥ คำถามเป้าหมาย × 1.5)
- "borderline": เนื้อหาพอพอดี (แนวคิด ≥ คำถามเป้าหมาย × 1.0 แต่ < × 1.5)
- "insufficient": เนื้อหาน้อยเกินไป (แนวคิด < คำถามเป้าหมาย)

นับจำนวนแนวคิดหลัก (key concepts) ที่สามารถแยกออกเป็นคำถามได้จริงจากเอกสาร
ประเมินจากความหนาแน่นของข้อเท็จจริง ตัวอย่าง คำอธิบาย และความซ้ำซ้อน

ตอบกลับเป็น JSON Object ตามโครงสร้างนี้เท่านั้น:
{{
  "sufficient": true/false,
  "level": "sufficient | borderline | insufficient",
  "estimated_questions": <จำนวนคำถามสูงสุดที่สร้างได้จริงจากเนื้อหานี้>,
  "recommended_length": "short | medium | long",
  "warnings": ["คำเตือนถ้ามี"],
  "suggestions": ["คำแนะนำ เช่น เพิ่มเอกสาร หรือลดความยาวเกม"]
}}"""

        return await provider.generate_json(
            system_prompt="You are a content sufficiency analysis agent that outputs only valid JSON.",
            user_prompt=prompt,
        )
    except (ExtractionError, AIProviderError) as e:
        print(f"❌ [ContentSufficiency] {e}")
        traceback.print_exc()
        return {"error": str(e)}
    except Exception as e:
        print("❌ [ContentSufficiency] Unexpected error:")
        traceback.print_exc()
        return {"error": f"AI ตรวจสอบความเพียงพอของเนื้อหาไม่สำเร็จ: {e}"}


# ------------------------------------------------------------------------------
# Agent 2 — Game Director (Genre Recommender)
# ------------------------------------------------------------------------------

GENRE_CATALOG = [
    {"id": "rpg_adventure", "name": "RPG Adventure", "icon": "🎭",
     "fits": ["sequential", "systemic"], "reason": "เหมาะกับเนื้อหาที่มีหลาย Chapter ไล่ระดับความยาก"},
    {"id": "quiz_battle", "name": "Quiz Battle", "icon": "⚔️",
     "fits": ["sequential", "decision_based"], "reason": "เน้นทดสอบความรู้ผ่านการต่อสู้ ตอบถูกคือโจมตี"},
    {"id": "city_builder", "name": "City Builder", "icon": "🏙️",
     "fits": ["systemic"], "reason": "เหมาะกับเนื้อหาเชิงระบบ ปลดล็อกอาคารตามบทเรียน"},
    {"id": "strategy", "name": "Strategy", "icon": "🧭",
     "fits": ["decision_based"], "reason": "เหมาะกับเนื้อหาที่ต้องตัดสินใจเลือกวิธีแก้ปัญหา"},
    {"id": "puzzle_adventure", "name": "Puzzle Adventure", "icon": "🧩",
     "fits": ["sequential"], "reason": "เหมาะกับเนื้อหาที่มีขั้นตอนซ้อนกัน เช่น การจัดลำดับ concept"},
]


async def recommend_game_genres(file_path: str) -> dict:
    """
    วิเคราะห์เนื้อหาแล้วแนะนำ genre พร้อม recommendation score (กฎข้อ #15/#75)
    """
    analysis = await analyze_content(file_path)
    if "error" in analysis:
        return analysis

    scores = []
    structure = analysis.get("content_structure", "sequential")
    n_topics = len(analysis.get("topics", []) or [])
    base_by_structure = {
        "sequential": [94, 88, 72, 68, 81],
        "systemic": [86, 78, 92, 84, 70],
        "decision_based": [80, 90, 74, 93, 76],
    }
    base_scores = base_by_structure.get(structure, base_by_structure["sequential"])

    for i, genre in enumerate(GENRE_CATALOG):
        score = base_scores[i % len(base_scores)]
        if structure in genre["fits"]:
            score = min(97, score + 3)
        # เนื้อหา topic เยอะ → RPG เด่นเพราะแบ่งเป็นโซนได้
        if genre["id"] == "rpg_adventure" and n_topics >= 4:
            score = min(98, score + 2)
        scores.append({
            "genre_id": genre["id"],
            "genre_name": genre["name"],
            "icon": genre["icon"],
            "score": score,
            "reason": genre["reason"],
        })

    scores.sort(key=lambda x: x["score"], reverse=True)
    return {
        "subject": analysis.get("subject"),
        "summary": analysis.get("summary"),
        "learning_objectives": analysis.get("learning_objectives", []),
        "recommended": scores,
    }


# ------------------------------------------------------------------------------
# Agent 3 — Full Game Generation (Designer + World Builder + Story + Quests)
# ------------------------------------------------------------------------------

GAME_MODE_INSTRUCTIONS = {
    "rpg_lore": """- [RPG STORYTELLING]: เขียน lesson.content เป็นนิยายผจญภัย ไม่ใช่หนังสือเรียน
  มี NPC, บทสนทนา, บรรยายบรรยากาศ โดยสอดแทรกความรู้จากเอกสารเป็น 'เบาะแส' ที่ผู้เล่นต้องใช้แก้ปัญหา""",
    "turn_based": """- [TURN-BASED COMBAT]: คำถามแต่ละข้อคือสถานการณ์ต่อสู้ (ระบุ HP ศัตรูใน question)
  options คือสกิล/ท่าโจมตีที่อิงความรู้ในบท, explanation บอกผลของการโจมตี เช่น 'คริติคอล! ศัตรูเสีย HP 250'""",
    "base_building": """- [BASE BUILDING]: explanation ต้องสรุปรางวัลทรัพยากรที่ได้ เช่น 'ได้รับ ไม้กลายพันธุ์ x50, Blueprint หอสังเกตการณ์'
  รางวัลสอดคล้องความยากของเนื้อหา""",
    "standard_quiz": """- [STANDARD QUIZ]: คำถามวัดความเข้าใจเชิงวิเคราะห์จากสถานการณ์จริง ไม่ใช่แค่ท่องจำ""",
}

VISUAL_STYLE_HINTS = {
    "pixel_art": "16-bit Pixel Art retro RPG",
    "modern_2d": "Modern flat 2D cartoon",
    "fantasy": "High fantasy hand-painted",
    "scifi": "Sci-fi neon cyberpunk",
}


async def generate_game(
    file_path: str,
    game_modes: list[str] | None = None,
    visual_style: str = "pixel_art",
    ai_instruction: str | None = None,
    game_length: str = "medium",
    question_types: list[str] | None = None,
) -> dict:
    """
    Pipeline: Extract → Prompt (Game Plan) → LLM → Schema Validation
    คืน validated dict หรือ {"error": ...}
    """
    game_modes = game_modes or ["standard_quiz"]
    mode_lines = "\n".join(
        GAME_MODE_INSTRUCTIONS[m] for m in game_modes if m in GAME_MODE_INSTRUCTIONS
    )
    style_hint = VISUAL_STYLE_HINTS.get(visual_style, VISUAL_STYLE_HINTS["pixel_art"])
    instruction_block = (
        f"\nคำสั่งพิเศษจากผู้สอน (ต้องปฏิบัติตาม):\n{ai_instruction}\n" if ai_instruction else ""
    )

    # ---- Game Length Config ----
    if game_length not in VALID_LENGTHS:
        game_length = "medium"
    length_cfg = GAME_LENGTH_CONFIG[game_length]
    target_chapters = length_cfg["chapters"]
    target_q_per_chapter = length_cfg["questions_per_chapter"]

    # ---- Question Types ----
    question_types = list(dict.fromkeys(
        qt for qt in (question_types or []) if qt in VALID_QUESTION_TYPES
    ))
    if not question_types:
        question_types = ["multiple_choice"]
    # บังคับให้มี multiple_choice เสมอ (เป็น fallback)
    if "multiple_choice" not in question_types:
        question_types = ["multiple_choice"] + question_types
    qt_lines = "\n".join(f"- {qt}" for qt in question_types)

    schema_structure = json.dumps(CourseGenerationAI.model_json_schema(), ensure_ascii=False)

    try:
        source = _read_source(file_path)
        provider = get_ai_provider()
        lang = detect_language(source)
        language_rule = (
            f"ภาษา{LANGUAGE_NAMES[lang]}" if lang in LANGUAGE_NAMES else f"'{lang}'"
        )
    except (ExtractionError, AIProviderError) as e:
        return {"error": str(e)}

    user_prompt = f"""คุณคือ EduQuest Game Director — ผสมผสาน Game Designer, World Builder, Story Writer และ Quest Generator
จงเปลี่ยนเอกสารบทเรียนนี้ให้เป็นเกมการเรียนรู้ที่เล่นได้จริง

=== เอกสารต้นทาง (SOURCE OF TRUTH — ห้ามแต่งเรื่องนอกเหนือจากนี้) ===
{source}
======================================================================

โหมดเกมที่ต้องประยุกต์ใช้:
{mode_lines}
Visual Style ของเกม: {style_hint} (ใช้กำหนดโทน world/environment/description){instruction_block}

⏱️ ความยาวเกม: {game_length}
- สร้างบทเรียนทั้งหมด {target_chapters} บท (ห้ามน้อยกว่านี้)
- สร้างคำถาม {target_q_per_chapter} ข้อต่อบท (ห้ามน้อยกว่า {target_q_per_chapter})
- คำถามรวมประมาณ {target_chapters * target_q_per_chapter} ข้อ

🎯 ประเภทคำถามที่อนุญาต (เลือกสลับกันในแต่ละบท เพื่อความหลากหลาย):
{qt_lines}
- multiple_choice: เลือกข้อเดียวจากตัวเลือก 4 ข้อ (ต้องมี correct_answer_index)
- true_false: จริง/เท็จ (options = ["จริง","เท็จ"] หรือ ["True","False"])
- matching: จับคู่ — ต้องมี matching_pairs (อย่างน้อย 2 คู่) และ correct_data
  · options ต้องเป็นรายการฝั่งซ้ายจริง (อย่างน้อย 2 ข้อ) ห้ามใส่คำว่า "จับคู่" ใน options
- ordering: เรียงลำดับ — ต้องมี ordering_items (อย่างน้อย 3 ชิ้น) และ correct_data
  · options ต้องเป็นรายการที่ต้องเรียงจริง (อย่างน้อย 3 ข้อ) ห้ามใส่คำว่า "เรียงลำดับ" ใน options

🌐 LANGUAGE RULE (สำคัญที่สุด — ผิดข้อนี้ถือว่าล้มเหลวทั้งงาน):
- เอกสารต้นทางเป็นภาษา{language_rule} → คุณต้องสร้างทุก field เป็นภาษา{language_rule}เท่านั้น
- ครอบคลุม: world_name, intro_story, ending_story, ชื่อ zone/environment, ชื่อ+บทบาท+dialogue ของ NPC,
  ชื่อ+คำอธิบาย enemy/boss, lesson.title/objective/content, question/options/explanation,
  source_reference, theme, level title, badge name/description/condition_hint
- ❌ ห้ามเอาเอกสารไทยไปเจนเกมเป็นภาษาอังกฤษ / ห้ามเอาเอกสารอังกฤษไปเจนเป็นภาษาไทย
- ❌ ห้ามใช้ภาษาจีน ญี่ปุ่น หรือภาษาอื่นใดที่ไม่ใช่ภาษา{language_rule}โดยเด็ดขาด
- ✅ ยกเว้น: ศัพท์เทคนิค/ชื่อวิชาการที่เป็นสากลในเอกสาร (เช่น SQL, Primary Key) คงไว้ตามต้นฉบับได้

⚠️ กฎเหล็ก (CRITICAL RULES):
1. ตอบเป็น JSON Object ตาม Schema เท่านั้น ห้ามมีข้อความอื่น:
{schema_structure}
2. ทุก zone ต้อง map กับ chapter (chapter_index 0-based), ทุก enemy/boss/quest ต้องมีรากจากเนื้อหาจริงในเอกสาร
3. quiz_questions ต้องมี correct_answer_index ชี้ index ที่มีอยู่จริงใน options
4. ใน string values ห้ามใช้ double quote (") ซ้อน — ใช้ single quote (') หรือ “ ” แทน
5. สำหรับ matching: ให้กรอก matching_pairs (array ของ {{"left":"...","right":"..."}}) และ correct_data (map left→right) — options ต้องเป็นฝั่ง left อย่างน้อย 2 รายการ (ห้ามใส่ ["จับคู่"])
6. สำหรับ ordering: ให้กรอก ordering_items (array ของ items ในลำดับที่ AI สุ่ม) และ correct_data (array ของ indices ตามลำดับที่ถูกต้อง) — options ต้องเป็น items อย่างน้อย 3 รายการ (ห้ามใส่ ["เรียงลำดับ"])
7. บังคับ: อย่างน้อย {target_chapters} chapters · คำถาม chapter ละ {target_q_per_chapter} ข้อ (ห้ามน้อยกว่านี้) · ถ้าเอกสารสั้นให้แตกหัวข้อย่อย/ตัวอย่าง/แบบฝึกหัดให้ครบตามเป้า อย่ายุบรวม
8. ต้องมีคำถามอย่างน้อย 1 ข้อของทุกประเภทที่ระบุไว้ข้างต้น (multiple_choice, true_false, matching, ordering ตามที่เลือก) — ห้ามสร้างแต่ multiple_choice/true_false
9. ผสมประเภทคำถามให้หลากหลายในแต่ละบท ตามที่อนุญาตไว้ข้างต้น"""

    try:
        # Retry สูงสุด 3 รอบ:
        #   เอกสารยาวมาก (>12K chars) → เริ่ม COMPACT เลย (output มีโอกาสล้น token สูง)
        #   รอบถัดไป: COMPACT → ULTRA COMPACT
        start_compact = len(source) > 12000
        attempts = [
            {"compact": start_compact},
            {"compact": True},
            {"compact": True, "ultra": True},
        ]
        validated = None

        for i, cfg in enumerate(attempts, start=1):
            extra = ""
            if cfg.get("compact"):
                extra += (
                    f"\n\n📦 OUTPUT SIZE LIMIT (บังคับ เพื่อไม่ให้ output ยาวเกินไป):"
                    f"\n- chapters: {target_chapters} chapters (ห้ามน้อยกว่านี้ — ต้องครบ {target_chapters} ด่าน)"
                    f"\n- quiz_questions: chapter ละ {target_q_per_chapter} ข้อเท่านั้น"
                    "\n- intro_story/ending_story: ไม่เกิน 2 ประโยค"
                    "\n- lesson.content: กระชับ ไม่เกิน 5-6 ประโยค"
                    "\n- enemies: 4 ตัว, npcs: 3 ตัว, bosses: 1 ตัว"
                )
            if cfg.get("ultra"):
                extra += (
                    f"\n🚨 ULTRA COMPACT: ยังคง {target_chapters} chapters ครบ, ข้อละ {target_q_per_chapter} คำถามเท่านั้น,"
                    " lesson 3-4 ประโยค, description ประโยคเดียว แต่ยังคุณภาพและภาษาเดิม"
                )

            try:
                raw = await provider.generate_json(
                    system_prompt=(
                        f"You are a strict JSON generator for educational game design. "
                        f"You output valid JSON only, never unescaped double quotes inside string values. "
                        f"CRITICAL: All generated content MUST be written in {language_rule}, "
                        f"matching the source document's language exactly. "
                        f"NEVER use Chinese, Japanese, or any language other than {language_rule}."
                    ),
                    user_prompt=user_prompt + extra,
                )
                candidate = CourseGenerationAI.model_validate(_normalize_ai_payload(raw))
            except AIProviderError as e:
                print(f"⚠️ [GameDirector] Attempt {i} failed: {e}")
                continue
            except ValidationError as e:
                # AI ตอบโครงสร้างไม่ครบ (ซ่อมแล้วยังไม่ผ่าน) — ลองรอบถัดไปที่กระชับกว่า
                print(f"⚠️ [GameDirector] Attempt {i} schema mismatch: {e.error_count()} error(s)")
                print(f"   first: {e.errors()[0].get('loc')} {e.errors()[0].get('msg')}")
                continue

            # Post-check: เนื้อหาต้องเป็นภาษาเดียวกับเอกสาร
            sample_text = " ".join(
                [
                    candidate.world_name,
                    candidate.world.intro_story or "",
                    candidate.chapters[0].title,
                    candidate.chapters[0].lesson.content,
                    candidate.chapters[0].quiz_questions[0].question,
                ]
            )
            if _language_matches(sample_text, lang):
                validated = candidate
                break
            print(
                f"⚠️ [GameDirector] Language mismatch on attempt {i} "
                f"(expected={lang}) — retrying..."
            )

        if validated is None:
            return {
                "error": "AI สร้างเกมไม่สำเร็จ (output ใหญ่เกิน/ผิดภาษาซ้ำ) — ลองอีกครั้ง หรือใช้เอกสารที่สั้นลง"
            }

        # Post-validate: ต้องมีคำถามครบทุกประเภทที่เลือก (AI มักข้าม matching/ordering)
        await _ensure_question_type_coverage(
            validated, question_types, source, lang, provider
        )
        _shuffle_ordering_questions(validated)

        # Post-validate: zones ต้องครอบคลุมทุก chapter (Learning Coverage — ข้อ #43)
        chapter_count = len(validated.chapters)
        mapped_zones = {z.chapter_index for z in validated.world.zones}
        if chapter_count and not mapped_zones:
            # AI ไม่สร้าง zone mapping — patch อัตโนมัติให้เล่นได้
            from schemas.generation import ZoneAI
            validated.world.zones = [
                ZoneAI(
                    name=ch.title,
                    chapter_index=i,
                    environment="dungeon" if i == chapter_count - 1 else "village",
                    description=f"โซนบทเรียน: {ch.title}",
                )
                for i, ch in enumerate(validated.chapters)
            ]

        result = validated.model_dump()
        result["language"] = lang
        result["game_length"] = game_length
        result["questions_per_chapter"] = target_q_per_chapter
        return result
    except ValidationError as e:
        # ซ่อมแล้วยังไม่ผ่าน (เช่น ไม่เหลือคำถามที่ใช้ได้เลย) — แจ้งแบบคนอ่านรู้เรื่อง
        print(f"❌ [GameDirector] Payload invalid after normalization: {e.error_count()} error(s)")
        traceback.print_exc()
        return {
            "error": (
                "AI สร้างรูปแบบคำถามไม่ถูกต้อง (ตัวเลือก/เฉลยไม่ครบ) — "
                "กรุณากด “ลองสร้างอีกครั้ง” หรือเปลี่ยนประเภทคำถามที่เลือก"
            )
        }
    except Exception as e:
        print("❌ [GameDirector] Generation failed — full traceback:")
        traceback.print_exc()
        return {"error": f"AI สร้างเกมไม่สำเร็จ: {e}"}
