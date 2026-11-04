# ==============================================================================
# services/dungeon.py — สร้าง/ตรวจสอบแผนที่ดันเจี้ยน RPG ต่อบทเรียน
#
# แนวคิด:
#   - โครงสร้างกราฟสร้างจากเทมเพลตที่Deterministic (เชื่อถือได้ 100%)
#   - AI ทำหน้าที่แค่ "แต่ง flavour" (ชื่อดันเจี้ยน/ชื่อห้อง/คำบรรยาย/ชื่อกุญแจ)
#     → ถ้า AI ไม่ส่งมา ใช้ชื่อสำรองได้ทันที งานไม่ล้ม
#   - เส้นทางหลัก (start → quiz → boss) เปิดเสมอ; ประตูล็อกกั้นแค่ห้องโบนัส
#     → ไม่มีทางตัน และคำถามครบทุกข้อตามหลักการสอน
#   - เก็บผลลัพธ์ใน course.game_config["dungeons"] (JSON) จึงไม่ต้องแก้ schema DB
# ==============================================================================

from __future__ import annotations

from typing import Any, Optional

DUNGEON_VERSION = 1
PHASE_HP = 100
TRAP_DAMAGE = 15

DEFAULT_ROOM_NAMES = [
    "ทางเข้าดันเจี้ยน",
    "โถงคำถาม",
    "ทางแยก",
    "ห้องสมบัติ",
    "วิญญาณผู้เฒ่า",
    "ห้องทดสอบที่สอง",
    "ห้องนิรภัย",
    "ห้องบอส",
]

DEFAULT_KEY_NAMES = ["กุญแจสำริด", "กุญแจเงิน", "กุญแจทอง", "กุญแจคริสตัล"]
DEFAULT_TRAP_NAME_TH = "ทางลัดอันตราย"
DEFAULT_TRAP_NAME_EN = "Trapped Passage"


def _clean(value: Any, limit: int = 160) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text[:limit]


def _flavor_list(flavor: Optional[dict], key: str) -> list[str]:
    if not isinstance(flavor, dict):
        return []
    raw = flavor.get(key)
    if not isinstance(raw, list):
        return []
    return [t for t in (_clean(x) for x in raw) if t]


def build_chapter_dungeon(
    chapter_index: int,
    chapter: dict,
    question_ids: list[int],
    flavor: Optional[dict] = None,
    lang: str = "th",
) -> dict:
    """สร้างแผนที่ดันเจี้ยนของบทหนึ่ง (โครงสร้างคงที่ + flavour จาก AI)"""
    chapter_title = _clean(chapter.get("title") or f"บทที่ {chapter_index + 1}", 80)
    lesson = chapter.get("lesson") or {}
    objective = _clean(lesson.get("objective") or "", 200)
    content = _clean(lesson.get("content") or "", 300)

    names = _flavor_list(flavor, "room_names")
    lore = _flavor_list(flavor, "lore")
    phase_names = _flavor_list(flavor, "boss_phase_names")
    key_name = _clean((flavor or {}).get("key_name") or "", 60)
    dungeon_name = _clean((flavor or {}).get("name") or "", 80)
    trap_name = _clean((flavor or {}).get("trap_name") or "", 60)

    def room_name(i: int) -> str:
        return names[i] if i < len(names) else DEFAULT_ROOM_NAMES[i]

    def lore_at(i: int, fallback: str) -> str:
        return lore[i] if i < len(lore) else fallback

    if not key_name:
        key_name = DEFAULT_KEY_NAMES[chapter_index % len(DEFAULT_KEY_NAMES)]
    if not dungeon_name:
        dungeon_name = f"ดันเจี้ยน: {chapter_title}"

    # ---- แบ่งคำถามลงห้อง quiz (ต้องครบทุกข้อ และอยู่บนเส้นทางหลักเสมอ) ----
    question_ids = list(question_ids)
    if not question_ids:
        q1_ids: list[int] = []
        q2_ids: list[int] = []
    elif len(question_ids) == 1:
        q1_ids, q2_ids = question_ids, []
    else:
        half = (len(question_ids) + 1) // 2
        q1_ids, q2_ids = question_ids[:half], question_ids[half:]

    # ---- variant ของทางแยก: สลับตามบทให้ไม่ซ้ำจำเจ ----
    variant = chapter_index % 3
    if variant == 0:
        branch_rooms = [("treasure", -1), ("npc", 1)]
    elif variant == 1:
        branch_rooms = [("treasure", -1), ("trap", 1)]
    else:
        branch_rooms = [("npc", -1), ("trap", 1)]

    key_id = f"key_{chapter_index}"
    potion_id = f"potion_{chapter_index}"
    has_treasure = any(t == "treasure" for t, _ in branch_rooms)

    items: dict[str, dict] = {
        potion_id: {
            "key": potion_id,
            "name": "โพชั่นฟื้นพลัง" if lang == "th" else "Healing Potion",
            "icon": "🧪",
            "type": "heal",
            "heal": 25,
        }
    }
    if has_treasure:
        items[key_id] = {
            "key": key_id,
            "name": key_name,
            "icon": "🗝️",
            "type": "key",
        }

    rooms: dict[str, dict] = {}

    has_q1 = bool(q1_ids)

    rooms["start"] = {
        "id": "start",
        "type": "npc",
        "name": room_name(0),
        "desc": lore_at(0, objective or content or chapter_title),
        "pos": {"x": 0, "y": 0},
        "doors": [{
            "to": "q1" if has_q1 else "branch",
            "requires": None,
            "label": "เข้าสู่ดันเจี้ยน",
        }],
        "reward": None,
        "damage": 0,
        "question_ids": [],
        "boss": None,
    }

    if has_q1:
        rooms["q1"] = {
            "id": "q1",
            "type": "quiz",
            "name": room_name(1),
            "desc": lore_at(1, "คำถามจากเนื้อหาบทเรียน"),
            "pos": {"x": 0, "y": 1},
            "doors": [{"to": "branch", "requires": None, "label": "ไปต่อ"}],
            "reward": None,
            "damage": 0,
            "question_ids": q1_ids,
            "boss": None,
        }

    has_q2 = bool(q2_ids)
    after_branch = "q2" if has_q2 else "boss"

    branch_doors = []
    for room_type, _x in branch_rooms:
        branch_doors.append({
            "to": room_type,
            "requires": None,
            "label": "ห้องสมบัติ" if room_type == "treasure" else ("วิญญาณผู้เฒ่า" if room_type == "npc" else "ทางลัดอันตราย"),
        })
    branch_doors.append({"to": after_branch, "requires": None, "label": "ประตูบอส" if not has_q2 else "ไปต่อ"})
    if not has_q2:
        branch_doors.insert(1, {
            "to": "vault",
            "requires": key_id if has_treasure else None,
            "label": "ห้องนิรภัย",
        })

    rooms["branch"] = {
        "id": "branch",
        "type": "npc",
        "name": room_name(2),
        "desc": lore_at(2, "ทางแยก — เลือกเส้นทางที่ต้องการ สำรวจให้คุ้มก่อนไปต่อ"),
        "pos": {"x": 0, "y": 2},
        "doors": branch_doors,
        "reward": None,
        "damage": 0,
        "question_ids": [],
        "boss": None,
    }

    # ทางตันต้องไม่มี: ห้องโบนัสทุกห้องมีทางออกไปสู่ห้องถัดไปหรือบอสเสมอ
    if has_q2:
        bonus_doors = [{"to": "q2", "requires": None, "label": "ไปต่อ"}]
    elif has_treasure:
        bonus_doors = [
            {"to": "vault", "requires": key_id, "label": "ห้องนิรภัย"},
            {"to": "boss", "requires": None, "label": "ประตูบอส"},
        ]
    else:
        bonus_doors = [{"to": "boss", "requires": None, "label": "ประตูบอส"}]

    for room_type, x in branch_rooms:
        if room_type == "treasure":
            rooms["treasure"] = {
                "id": "treasure",
                "type": "treasure",
                "name": room_name(3),
                "desc": lore_at(3, "หีบสมบัติเก่าแก่ — ข้างในมีของที่ช่วยให้ผ่านดันเจี้ยนได้ง่ายขึ้น"),
                "pos": {"x": x, "y": 3},
                "doors": list(bonus_doors),
                "reward": {"item_key": key_id},
                "damage": 0,
                "question_ids": [],
                "boss": None,
            }
        elif room_type == "npc":
            rooms["npc"] = {
                "id": "npc",
                "type": "npc",
                "name": room_name(4),
                "desc": lore_at(4, content or "วิญญาณผู้เฒ่าเล่าเรื่องราวของบทนี้ให้ฟัง"),
                "pos": {"x": x, "y": 3},
                "doors": list(bonus_doors),
                "reward": None,
                "damage": 0,
                "question_ids": [],
                "boss": None,
            }
        else:  # trap
            rooms["trap"] = {
                "id": "trap",
                "type": "trap",
                # ห้ามใช้ชื่อเดียวกับห้องวิญญาณ — variant อาจมี trap แทน npc
                "name": trap_name or (DEFAULT_TRAP_NAME_TH if lang == "th" else DEFAULT_TRAP_NAME_EN),
                "desc": (
                    f"กับดักโบราณใน {chapter_title} — ทางลัดแลกมาด้วยพลังชีวิต"
                    if lang == "th"
                    else f"An ancient trap in {chapter_title} — a shortcut paid for in health"
                ),
                "pos": {"x": x, "y": 3},
                "doors": list(bonus_doors),
                "reward": None,
                "damage": TRAP_DAMAGE,
                "question_ids": [],
                "boss": None,
            }

    if has_q2:
        rooms["q2"] = {
            "id": "q2",
            "type": "quiz",
            "name": room_name(5),
            "desc": lore_at(5, "ด่านทดสอบสุดท้ายก่อนถึงบอส"),
            "pos": {"x": 0, "y": 4},
            "doors": [
                {"to": "vault", "requires": key_id if has_treasure else None, "label": "ห้องนิรภัย"},
                {"to": "boss", "requires": None, "label": "ประตูบอส"},
            ],
            "reward": None,
            "damage": 0,
            "question_ids": q2_ids,
            "boss": None,
        }

    rooms["vault"] = {
        "id": "vault",
        "type": "treasure",
        "name": room_name(6),
        "desc": lore_at(6, "ห้องนิรภัยที่ต้องใช้กุญแจเปิด — ข้างในมีโพชั่นฟื้นพลัง"),
        "pos": {"x": -1, "y": 5},
        "doors": [{"to": "boss", "requires": None, "label": "ออกไปหาบอส"}],
        "reward": {"item_key": potion_id},
        "damage": 0,
        "question_ids": [],
        "boss": None,
    }

    boss_total = 2
    phases = []
    for i in range(boss_total):
        phases.append({
            "name": phase_names[i] if i < len(phase_names) else (f"ร่างที่ {i + 1}"),
            "hp": PHASE_HP,
            "concept": objective[:120] if i == 0 else chapter_title,
        })

    rooms["boss"] = {
        "id": "boss",
        "type": "boss",
        "name": room_name(7),
        "desc": lore_at(7, f"ผู้พิทักษ์แห่ง {chapter_title}"),
        "pos": {"x": 0, "y": 6},
        "doors": [],
        "reward": None,
        "damage": 0,
        "question_ids": [],
        "boss": {
            "name": _clean((flavor or {}).get("boss_name") or "", 80) or f"ผู้พิทักษ์{chapter_title}",
            "phases": phases,
        },
    }

    return {
        "version": DUNGEON_VERSION,
        "chapter_index": chapter_index,
        "name": dungeon_name,
        "start": "start",
        "boss_room": "boss",
        "quiz_rooms": [r for r in ("q1", "q2") if rooms.get(r, {}).get("question_ids")],
        "rooms": rooms,
        "items": items,
        "max_hp": 100,
    }


def build_dungeons(
    ai_chapters: list[dict],
    chapters_with_questions: list[dict],
    lang: str = "th",
) -> dict[str, dict]:
    """สร้างดันเจี้ยนครบทุกบท

    ai_chapters: list ของ chapter dict จาก AI (มี .dungeon flavour ถ้ามี)
    chapters_with_questions: [{"chapter_id", "index", "question_ids": [...]}, ...]
    """
    dungeons: dict[str, dict] = {}
    for entry in chapters_with_questions:
        idx = int(entry.get("index", 0))
        chapter = ai_chapters[idx] if idx < len(ai_chapters) else {}
        dungeons[str(idx)] = build_chapter_dungeon(
            chapter_index=idx,
            chapter=chapter,
            question_ids=list(entry.get("question_ids") or []),
            flavor=(chapter or {}).get("dungeon"),
            lang=lang,
        )
    return dungeons


_DUNGEON_ROOM_TYPES = {"quiz", "treasure", "trap", "npc", "boss"}


def sanitize_dungeon_state(raw: Any) -> Optional[dict]:
    """ตรวจ/จำกัดสถานะการเดินดันเจี้ยนใน game_state (กัน client ส่งขยะ)

    หมายเหตุ: game_state เป็น whitelist — ถ้าไม่เพิ่ม key นี้ สถานะจะหายทุกครั้งที่บันทึก
    """
    if not isinstance(raw, dict):
        return None

    def text_list(value: Any, limit: int = 40) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        for item in value:
            if isinstance(item, str) and item and item not in out:
                out.append(item[:60])
            if len(out) >= limit:
                break
        return out

    def as_int(value: Any, default: int = 0, lo: int = 0, hi: int = 999) -> int:
        try:
            return max(lo, min(int(value), hi))
        except (TypeError, ValueError):
            return default

    max_hp = as_int(raw.get("max_hp"), PHASE_HP, 1, 999)
    state = {
        "chapter_index": as_int(raw.get("chapter_index"), 0, 0, 99),
        "room": str(raw.get("room") or "start")[:40],
        "visited": text_list(raw.get("visited")),
        "keys": text_list(raw.get("keys")),
        "items": text_list(raw.get("items")),
        "hp": as_int(raw.get("hp"), max_hp, 0, max_hp),
        "max_hp": max_hp,
        "cleared": bool(raw.get("cleared")),
        "knockouts": as_int(raw.get("knockouts"), 0, 0, 99),
    }
    if not state["visited"]:
        state["visited"] = [state["room"]]

    boss = raw.get("boss")
    if isinstance(boss, dict):
        state["boss"] = {
            "phase": as_int(boss.get("phase"), 0, 0, 9),
            "hp": as_int(boss.get("hp"), PHASE_HP, 0, 9999),
            "defeated": bool(boss.get("defeated")),
        }

    log = raw.get("log")
    if isinstance(log, list):
        state["log"] = [str(x)[:120] for x in log[-20:] if isinstance(x, str)]
    return state


def sanitize_dungeon_store(raw: Any) -> dict[str, dict]:
    """เก็บความคืบหน้าดันเจี้ยนแยกตามบท — กันการเข้าบทอื่นแล้วความคืบหน้าหาย"""
    store: dict[str, dict] = {}
    if not isinstance(raw, dict):
        return store
    for key, value in list(raw.items())[:30]:
        clean = sanitize_dungeon_state(value)
        if clean is not None:
            store[str(key)] = clean
    return store


def validate_dungeon(dungeon: dict) -> list[str]:
    """ตรวจความถูกต้องของกราฟ — คืน list ของปัญหา (ว่าง = ผ่าน)"""
    problems: list[str] = []
    rooms = dungeon.get("rooms") or {}
    start = dungeon.get("start")
    boss_room = dungeon.get("boss_room")

    if start not in rooms:
        problems.append("ไม่มีห้องเริ่มต้น")
        return problems
    if boss_room not in rooms:
        problems.append("ไม่มีห้องบอส")
        return problems

    # ทุกห้องต้องเอื้อมถึงจากห้องเริ่ม
    seen: set[str] = set()
    stack = [start]
    while stack:
        rid = stack.pop()
        if rid in seen:
            continue
        seen.add(rid)
        for door in rooms[rid].get("doors") or []:
            target = door.get("to")
            if target in rooms and target not in seen:
                stack.append(target)
    unreachable = set(rooms) - seen
    if unreachable:
        problems.append(f"ห้องที่ไปไม่ถึง: {sorted(unreachable)}")

    # บอสต้องไปถึงได้โดยไม่ต้องใช้กุญแจ (กันทางตัน)
    seen_no_key: set[str] = set()
    stack = [start]
    while stack:
        rid = stack.pop()
        if rid in seen_no_key:
            continue
        seen_no_key.add(rid)
        for door in rooms[rid].get("doors") or []:
            if door.get("requires"):
                continue
            target = door.get("to")
            if target in rooms and target not in seen_no_key:
                stack.append(target)
    if boss_room not in seen_no_key:
        problems.append("บอสต้องเข้าถึงได้โดยไม่ต้องใช้กุญแจ")

    # คำถามทุกข้อต้องอยู่บนห้อง quiz
    for rid, room in rooms.items():
        if room.get("type") == "quiz" and not room.get("question_ids"):
            problems.append(f"ห้อง quiz '{rid}' ไม่มีคำถาม")

    # ประตูที่ล็อกต้องมีไอเทมนั้นอยู่จริงในดันเจี้ยน
    item_keys = set((dungeon.get("items") or {}).keys())
    for rid, room in rooms.items():
        for door in room.get("doors") or []:
            need = door.get("requires")
            if need and need not in item_keys:
                problems.append(f"ประตู {rid}→{door.get('to')} ต้องใช้ไอเทมที่ไม่มีอยู่ ({need})")

    # บอสต้องมีอย่างน้อย 1 เฟส
    boss = rooms.get(boss_room, {}).get("boss") or {}
    if not boss.get("phases"):
        problems.append("บอสไม่มีเฟส")

    return problems
