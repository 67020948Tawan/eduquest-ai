# ==============================================================================
# services/game_catalog.py — Game Systems Constants
#
# ค่ากลางของระบบเกม (Base Building / Turn-Based Combat)
# Backend ใช้ validate + คำนวณรางวัลจริง — Frontend mirror เพื่อ render
# ==============================================================================

RESOURCES = ("gold", "wood", "stone", "crystal", "knowledge")

# ------------------------------------------------------------------------------
# Base Building Catalog — ต้นทุน / เงื่อนไขปลดล็อก / เอฟเฟกต์จริง
# effect keys:
#   gold_per_correct, wood_per_correct, stone_per_correct, knowledge_per_correct,
#   bonus_max_hp, xp_multiplier
# ------------------------------------------------------------------------------

BUILDINGS = {
    "house": {
        "name": "บ้าน",
        "icon": "🏠",
        "cost": {"wood": 20, "stone": 10},
        "unlock_chapters": 0,
        "effect": {"bonus_max_hp": 20},
        "effect_text": "+20 Max HP",
    },
    "farm": {
        "name": "ไร่",
        "icon": "🌾",
        "cost": {"gold": 30},
        "unlock_chapters": 0,
        "effect": {"gold_per_correct": 5},
        "effect_text": "+5 Gold ทุกครั้งที่ตอบถูก",
    },
    "mine": {
        "name": "เหมืองหิน",
        "icon": "⛏️",
        "cost": {"wood": 15},
        "unlock_chapters": 1,
        "effect": {"stone_per_correct": 3},
        "effect_text": "+3 Stone ทุกครั้งที่ตอบถูก",
    },
    "workshop": {
        "name": "โรงฝึกงาน",
        "icon": "🔨",
        "cost": {"stone": 20, "wood": 10},
        "unlock_chapters": 1,
        "effect": {"wood_per_correct": 2},
        "effect_text": "+2 Wood ทุกครั้งที่ตอบถูก",
    },
    "library": {
        "name": "ห้องสมุด",
        "icon": "📚",
        "cost": {"gold": 40, "wood": 20},
        "unlock_chapters": 2,
        "effect": {"knowledge_per_correct": 1},
        "effect_text": "+1 Knowledge ทุกครั้งที่ตอบถูก (ใช้ซื้อ Hint)",
    },
    "academy": {
        "name": "สถาบันการศึกษา",
        "icon": "🏛️",
        "cost": {"gold": 60, "stone": 30, "knowledge": 10},
        "unlock_chapters": 2,
        "effect": {"xp_multiplier": 0.25},
        "effect_text": "XP +25%",
    },
    "castle": {
        "name": "ปราสาท",
        "icon": "🏰",
        "cost": {"wood": 50, "stone": 50, "crystal": 10},
        "unlock_chapters": 3,
        "requires": ["house", "farm", "library"],
        "effect": {},
        "effect_text": "🏆 สัญลักษณ์แห่งชัยชนะ — เป้าหมายสูงสุดของ Base Builder",
    },
}

# ------------------------------------------------------------------------------
# Combat constants — Turn-Based Combat
# ------------------------------------------------------------------------------

COMBAT = {
    "base_max_hp": 100,          # HP ผู้เล่นเริ่มต้น
    "base_attack": 22,           # damage พื้นฐานเมื่อตอบถูก
    "enemy_damage_min": 10,      # damage ที่ enemy โจมตีผู้เล่นเมื่อตอบผิด
    "enemy_damage_max": 18,
    "crit_combo_threshold": 3,   # combo ≥3 → critical ×2
    "crit_multiplier": 2.0,
    "enemy_base_hp": 55,         # HP enemy ปกติ (+ ตาม chapter)
    "enemy_hp_per_chapter": 15,
    "boss_hp": 140,
    "defeat_xp_bonus": 25,       # โบนัสฆ่า enemy
}

SKILL_STREAKS = [
    {"streak": 3, "skill": "critical_strike", "name": "🔥 Critical Strike", "desc": "Combo x3 → ดาเมจคริติคอล ×2"},
    {"streak": 5, "skill": "triple_strike", "name": "⚡ Triple Strike", "desc": "Combo x5 → ดาเมจ ×3"},
]

DEFAULT_RESOURCES = {"gold": 0, "wood": 0, "stone": 0, "crystal": 0, "knowledge": 0}


def default_game_state(max_hp: int | None = None) -> dict:
    return {
        "hp": max_hp or COMBAT["base_max_hp"],
        "max_hp": max_hp or COMBAT["base_max_hp"],
        "combo": 0,
        "best_combo": 0,
        "deaths": 0,
        "resources": dict(DEFAULT_RESOURCES),
        "buildings": [],
    }


def sanitize_game_state(state: dict) -> dict:
    """บังคับโครงสร้าง + clamp ค่า — กัน client ส่งขยะ"""
    base = default_game_state()
    if not isinstance(state, dict):
        return base

    hp = state.get("hp", base["hp"])
    max_hp = state.get("max_hp", base["max_hp"])
    try:
        max_hp = max(1, min(int(max_hp), 999))
        hp = max(0, min(int(hp), max_hp))
    except (TypeError, ValueError):
        hp, max_hp = base["hp"], base["max_hp"]

    combo = state.get("combo", 0)
    best = state.get("best_combo", 0)
    deaths = state.get("deaths", 0)
    try:
        combo = max(0, int(combo))
        best = max(int(best), combo)
        deaths = max(0, int(deaths))
    except (TypeError, ValueError):
        combo, best, deaths = 0, 0, 0

    raw_res = state.get("resources") or {}
    resources = {}
    for key in RESOURCES:
        try:
            resources[key] = max(0, min(int(raw_res.get(key, 0)), 999999))
        except (TypeError, ValueError):
            resources[key] = 0

    buildings = [
        b for b in (state.get("buildings") or [])
        if isinstance(b, str) and b in BUILDINGS
    ]

    def _int(v, default=0):
        try:
            return max(0, min(int(v), 10_000_000_000_000))  # รองรับ epoch-ms
        except (TypeError, ValueError):
            return default

    raid = state.get("raid")
    if not (isinstance(raid, dict) and all(k in raid for k in ("name", "started_at", "ends_at"))):
        raid = None

    return {
        "hp": hp,
        "max_hp": max_hp,
        "combo": combo,
        "best_combo": best,
        "deaths": deaths,
        "last_collected": _int(state.get("last_collected")),
        "raid_cooldown_until": _int(state.get("raid_cooldown_until")),
        "raid": raid,
        "raids_repelled": _int(state.get("raids_repelled")),
        "resources": resources,
        "buildings": buildings,
    }


def building_effects(buildings: list[str]) -> dict:
    """รวม effect ของอาคารที่สร้างแล้วทั้งหมด"""
    total: dict = {}
    for b_id in buildings:
        for k, v in BUILDINGS.get(b_id, {}).get("effect", {}).items():
            total[k] = total.get(k, 0) + v
    return total


# ------------------------------------------------------------------------------
# BASE ECONOMY v2 — ผลผลิตรายนาที / คลังเก็บ / Raid / ตัวคูณรางวัล
# ------------------------------------------------------------------------------

# ผลผลิตต่อนาทีต่ออาคาร (ฐานผลิตเองแม้ไม่ได้ตอบ — กด "เก็บผลผลิต" รับ)
PASSIVE_YIELD = {
    "house": {"gold": 2},
    "farm": {"gold": 6},
    "mine": {"stone": 4},
    "workshop": {"wood": 3},
    "library": {"knowledge": 1},
    "academy": {"knowledge": 1},
    "castle": {"crystal": 1},
}

# คลังสูงสุดต่ออาคาร (กัน idle farm ไม่จำกัด — ต้องมาเก็บบ่อยๆ)
STORAGE_CAP = {
    "house": 40,
    "farm": 80,
    "mine": 60,
    "workshop": 50,
    "library": 20,
    "academy": 20,
    "castle": 10,
}

COLLECT_CAP_MINUTES = 240  # สะสมข้ามคืนได้ แต่ไม่เกิน 4 ชม.

# Raid — ศัตรูบุกฐาน (ขับไล่ด้วยการตอบคำถาม)
RAID = {
    "cooldown_seconds": 180,      # เว้นช่วงหลัง raid จบ
    "trigger_chance": 0.45,       # โอกาสเกิดเมื่อ cooldown หมด + มี interaction
    "duration_seconds": 150,      # เวลา 2.5 นาทีในการขับไล่
    "steal_fraction": 0.10,       # หมดเวลา → ปล้นทรัพยากร 10%
    "loot": {"gold": 45, "crystal": 2, "knowledge": 1},  # ขับไล่สำเร็จ
}

DIFFICULTY_MULT = {"easy": 1.0, "medium": 1.35, "hard": 1.8}


def streak_resource_bonus(combo: int) -> float:
    """โบนัสทรัพยากรตาม combo: x3=+25%, x5+=+50%"""
    if combo >= 5:
        return 0.50
    if combo >= 3:
        return 0.25
    return 0.0


def compute_correct_rewards(game_state: dict, difficulty: str = "easy", combo: int = 0) -> dict:
    """รางวัลตอบถูก — ×ความยากข้อสอบ ×โบนัส streak (server-side)"""
    effects = building_effects(game_state.get("buildings", []))
    base = {
        "gold": 50 + effects.get("gold_per_correct", 0),
        "wood": 5 + effects.get("wood_per_correct", 0),
        "stone": effects.get("stone_per_correct", 0),
        "knowledge": effects.get("knowledge_per_correct", 0),
    }
    diff = DIFFICULTY_MULT.get(difficulty, 1.0)
    mult = diff * (1.0 + streak_resource_bonus(combo))
    return {k: max(1, round(v * mult)) for k, v in base.items() if v > 0}


def apply_resources(game_state: dict, rewards: dict) -> None:
    res = game_state.setdefault("resources", dict(DEFAULT_RESOURCES))
    for key, amount in rewards.items():
        if key in RESOURCES:
            res[key] = max(0, res.get(key, 0) + int(amount))


def can_afford(resources: dict, cost: dict) -> bool:
    return all(resources.get(k, 0) >= v for k, v in cost.items())


def deduct_cost(resources: dict, cost: dict) -> None:
    for k, v in cost.items():
        resources[k] = resources.get(k, 0) - v
