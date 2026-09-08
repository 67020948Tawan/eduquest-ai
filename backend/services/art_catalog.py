# ==============================================================================
# services/art_catalog.py — AI ART DIRECTOR (metadata layer)
#
# คลัง asset "วาดด้วยโค้ดไว้ล่วงหน้า" ฝั่ง frontend (lib/pixel/library.ts)
# ไฟล์นี้เก็บเฉพาะ metadata (id/tags/subjects) สำหรับให้ AI เลือกชิ้นที่เหมาะสม
# แล้ว attach เข้า game_config.art_bible → frontend render ตาม id
#
# ห้ามมี gallery workflow — art director รันอัตโนมัติหลัง generate เสมอ
# ==============================================================================

from typing import Any

ART_ENTRIES: list[dict[str, Any]] = [
    # ---- HEROES ----
    {"id": "hero_knight_blue", "category": "hero", "tags": ["knight", "guardian", "defense", "security", "player"], "subjects": ["cs", "math"]},
    {"id": "hero_mage_arcane", "category": "hero", "tags": ["mage", "query", "logic", "magic", "caster"], "subjects": ["cs", "math", "science"]},
    {"id": "hero_scholar", "category": "hero", "tags": ["scholar", "student", "learner", "adventurer"], "subjects": ["*"]},
    {"id": "hero_medic", "category": "hero", "tags": ["medic", "healer", "health", "support"], "subjects": ["bio", "health"]},
    # ---- NPCS ----
    {"id": "npc_professor", "category": "npc", "tags": ["professor", "teacher", "mentor", "อาจารย์", "ครู", "นักวิชาการ"], "subjects": ["*"]},
    {"id": "npc_merchant", "category": "npc", "tags": ["merchant", "shop", "trader", "พ่อค้า"], "subjects": ["*", "business"]},
    {"id": "npc_guard", "category": "npc", "tags": ["guard", "gate", "firewall", "security", "ยาม"], "subjects": ["cs"]},
    {"id": "npc_blacksmith", "category": "npc", "tags": ["blacksmith", "craft", "upgrade", "ช่าง", "factory"], "subjects": ["*", "engineering"]},
    {"id": "npc_healer", "category": "npc", "tags": ["herbalist", "healer", "biology", "plant", "หมอ"], "subjects": ["bio", "chem"]},
    # ---- ENEMIES ----
    {"id": "enemy_slime_data", "category": "enemy", "tags": ["slime", "blob", "duplicate", "redundancy", "data", "ซ้ำ"], "subjects": ["cs"]},
    {"id": "enemy_wisp_error", "category": "enemy", "tags": ["error", "bug", "exception", "wisp", "ผิดพลาด"], "subjects": ["cs"]},
    {"id": "enemy_golem_stone", "category": "enemy", "tags": ["golem", "stone", "heavy", "structure", "หิน"], "subjects": ["*", "engineering"]},
    {"id": "enemy_brute_iron", "category": "enemy", "tags": ["brute", "iron", "machine", "robot", "sentinel"], "subjects": ["cs", "engineering"]},
    {"id": "enemy_slime_toxic", "category": "enemy", "tags": ["toxic", "poison", "chemical", "สารพิษ"], "subjects": ["chem", "bio"]},
    {"id": "enemy_brute_warlord", "category": "enemy", "tags": ["warlord", "history", "war", "king", "ศึก"], "subjects": ["history", "social"]},
    # ---- BOSSES ----
    {"id": "boss_overlord_core", "category": "boss", "tags": ["overlord", "final", "core", "boss", "จอมโฉด"], "subjects": ["cs", "*"]},
    {"id": "boss_corruption_titan", "category": "boss", "tags": ["corruption", "inconsistency", "chaos", "titan"], "subjects": ["cs", "*"]},
    {"id": "boss_plague_colossus", "category": "boss", "tags": ["plague", "disease", "virus", "health", "โรค"], "subjects": ["bio", "health"]},
]

_ENTRIES_BY_CATEGORY: dict[str, list[dict[str, Any]]] = {}
for _e in ART_ENTRIES:
    _ENTRIES_BY_CATEGORY.setdefault(_e["category"], []).append(_e)


def resolve_asset(category: str, keywords: list[str], subject: str | None = None) -> str:
    """เลือก asset id ที่เหมาะสมจาก keywords + subject (deterministic scoring)"""
    from services.art_catalog import extract_keywords  # self-ref safe

    pool = _ENTRIES_BY_CATEGORY.get(category) or ART_ENTRIES
    kw = [_norm_word(k).lower() for k in keywords if k]
    subject_l = (subject or "").lower()

    best_id = pool[0]["id"]
    best_score = -1.0
    for idx, entry in enumerate(pool):
        score = 0.0
        haystacks = [_norm_word(t).lower() for t in entry["tags"]] + [
            _norm_word(w).lower() for w in entry["id"].replace("_", " ").split()
        ]
        for k in kw:
            for h in haystacks:
                if len(k) >= 2 and len(h) >= 2 and (k in h or h in k):
                    score += 3.0
        if subject_l and (subject_l in entry["subjects"] or "*" in entry["subjects"]):
            score += 2.0
        score += idx * 0.01  # deterministic tie-break
        if score > best_score:
            best_score = score
            best_id = entry["id"]
    return best_id


def _norm_word(w: str) -> str:
    """เก็บตัวอักษรรวมสระ/วรรณยุกต์ไทย (ไม่ใช้ isalnum เพราะตัด combining marks)"""
    return "".join(ch for ch in w if not ch.isspace() and ch not in "._-,()[]{}\"'!?;:")


def extract_keywords(*texts: str | None) -> list[str]:
    """แตกคำจาก name/role/description — รองรับภาษาไทยเต็มรูปแบบ"""
    words: list[str] = []
    for t in texts:
        if not t:
            continue
        for w in str(t).replace("_", " ").split():
            w2 = _norm_word(w)
            if len(w2) >= 2:
                words.append(w2.lower())
    return words
