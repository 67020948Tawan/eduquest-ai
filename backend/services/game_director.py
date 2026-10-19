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
import traceback

from schemas.generation import CourseGenerationAI, ContentSufficiencyAI
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
    if question_types is None:
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
- matching: จับคู่ (ต้องมี matching_pairs และ correct_data)
- ordering: เรียงลำดับ (ต้องมี ordering_items และ correct_data)

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
5. สำหรับ matching: ให้กรอก matching_pairs (array ของ {{"left":"...","right":"..."}}) และ correct_data (map left_id → right_id)
6. สำหรับ ordering: ให้กรอก ordering_items (array ของ items ในลำดับที่ AI สุ่ม) และ correct_data (array ของ indices ตามลำดับที่ถูกต้อง)
7. บังคับ: อย่างน้อย {target_chapters} chapters · คำถาม chapter ละ {target_q_per_chapter} ข้อ (ห้ามน้อยกว่านี้) · ถ้าเอกสารสั้นให้แตกหัวข้อย่อย/ตัวอย่าง/แบบฝึกหัดให้ครบตามเป้า อย่ายุบรวม
8. ผสมประเภทคำถามให้หลากหลายในแต่ละบท ตามที่อนุญาตไว้ข้างต้น"""

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
                candidate = CourseGenerationAI.model_validate(raw)
            except AIProviderError as e:
                print(f"⚠️ [GameDirector] Attempt {i} failed: {e}")
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
    except Exception as e:
        print("❌ [GameDirector] Generation failed — full traceback:")
        traceback.print_exc()
        return {"error": f"AI สร้างเกมไม่สำเร็จ: {e}"}
