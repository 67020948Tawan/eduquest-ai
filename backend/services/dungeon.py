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
#
# v2 — ขยายความยาวเกมต่อบท:
#   - แตกห้อง quiz ตามจำนวนคำถาม (สูงสุด 4 ห้อง) แทนที่จะรวมเป็น 2 ห้อง
#   - ทุกห้อง quiz มีทางแยก + ห้องโบนัสของตัวเอง ทำให้แผนที่ยาวและมีทางเลือกมากขึ้น
#   - บอส 4 เฟสขึ้นไป (สูงสุด 6) แทน 2 เฟส → ต้องตอบถูกมากขึ้นก่อนปราบได้
#   - คง id ห้องหลักเดิม (start/q1/q2/branch/treasure/npc/trap/vault/boss)
#     เพื่อให้ state ที่บันทึกไว้เล่นต่อได้หลังอัปเกรด
# ==============================================================================

from __future__ import annotations

from typing import Any, Optional

DUNGEON_VERSION = 2
PHASE_HP = 100
TRAP_DAMAGE = 15

# จำนวนห้อง quiz สูงสุดต่อบท — 1 ห้องต่อคำถาม (ไม่เกิน 4 ห้อง)
MAX_QUIZ_ROOMS = 4
# บอสเริ่มที่ 4 เฟส และเพิ่มตามจำนวนคำถาม (สูงสุด 6 เฟส)
BOSS_BASE_PHASES = 4
BOSS_MAX_PHASES = 6

DEFAULT_ROOM_NAMES = [
    "ทางเข้าดันเจี้ยน",
    "โถงคำถาม",
    "ทางแยก",
    "ห้องสมบัติ",
    "วิญญาณผู้เฒ่า",
    "ห้องทดสอบที่สอง",
    "ห้องนิรภัย",
    "ห้องบอส",
    "ห้องทดสอบที่สาม",
    "ห้องทดสอบที่สี่",
    "ทางแยกที่สอง",
    "ทางแยกที่สาม",
    "ห้องสมบัติที่สอง",
    "ห้องสมบัติที่สาม",
    "วิญญาณผู้เฒ่าที่สอง",
    "ประตูสุดท้าย",
]

# ตำแหน่งชื่อ/คำบรรยายใน flavour ของ AI (AI ส่งได้สูงสุด 8 รายการ)
QUIZ_NAME_INDEX = [1, 5, 8, 9]
BRANCH_NAME_INDEX = [2, 10, 11, 15]

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


def _split_questions(question_ids: list[int]) -> list[list[int]]:
    """แบ่งคำถามเป็นห้อง quiz หลายห้อง (1–4 ห้อง) โดยกระจายให้เท่ากันที่สุด"""
    ids = [q for q in question_ids]
    if not ids:
        return []
    room_count = min(MAX_QUIZ_ROOMS, len(ids))
    base, extra = divmod(len(ids), room_count)
    groups: list[list[int]] = []
    cursor = 0
    for i in range(room_count):
        size = base + (1 if i < extra else 0)
        groups.append(ids[cursor:cursor + size])
        cursor += size
    return groups


def _bonus_plan(quiz_count: int, variant: int) -> list[str]:
    """วางประเภทห้องโบนัสของแต่ละช่วง — ต้องมีห้องสมบัติ (กุญแจ) เสมอ"""
    cycle = {
        0: ["npc", "trap"],
        1: ["trap", "npc"],
        2: ["npc", "trap"],
    }[variant]
    if quiz_count <= 0:
        return ["treasure"]
    if variant == 0:
        plan = ["treasure"] + [cycle[i % 2] for i in range(quiz_count - 1)]
    else:
        plan = [cycle[0], "treasure"] + [
            cycle[(i + 1) % 2] for i in range(max(0, quiz_count - 2))
        ]
    plan = plan[:quiz_count]
    if "treasure" not in plan:
        plan[-1] = "treasure"
    return plan


def _phase_count(question_count: int) -> int:
    count = BOSS_BASE_PHASES
    if question_count >= 5:
        count += 1
    if question_count >= 8:
        count += 1
    return max(2, min(BOSS_MAX_PHASES, count))


def build_chapter_dungeon(
    chapter_index: int,
    chapter: dict,
    question_ids: list[int],
    flavor: Optional[dict] = None,
    lang: str = "th",
    name_slots: Optional[dict] = None,
) -> dict:
    """สร้างแผนที่ดันเจี้ยนของบทหนึ่ง (โครงสร้างคงที่ + flavour จาก AI)

    name_slots: ชื่อห้องที่ต้องการคงไว้ (ใช้ตอนอัปเกรดดันเจี้ยนรุ่นเก่า)
    """
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
    slots = name_slots or {}

    def slot_name(slot: str, default_index: int, fallback: str) -> str:
        explicit = _clean(slots.get(slot) or "", 80)
        if explicit:
            return explicit
        if default_index < len(names):
            return names[default_index]
        if default_index < len(DEFAULT_ROOM_NAMES):
            return DEFAULT_ROOM_NAMES[default_index]
        return fallback

    def lore_at(default_index: int, fallback: str) -> str:
        return lore[default_index] if default_index < len(lore) else fallback

    if not key_name:
        key_name = DEFAULT_KEY_NAMES[chapter_index % len(DEFAULT_KEY_NAMES)]
    if not dungeon_name:
        dungeon_name = f"ดันเจี้ยน: {chapter_title}"

    question_ids = list(question_ids)
    groups = _split_questions(question_ids)
    quiz_count = len(groups)
    variant = chapter_index % 3
    bonus_plan = _bonus_plan(quiz_count, variant)

    key_id = f"key_{chapter_index}"
    potion_id = f"potion_{chapter_index}"
    has_treasure = "treasure" in bonus_plan

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

    def bonus_name_slot(i: int, bonus_type: str) -> str:
        return f"bonus:{bonus_type}" if i == 0 else f"bonus{i + 1}"

    def bonus_name_index(bonus_type: str) -> int:
        if bonus_type == "treasure":
            return 3
        if bonus_type == "npc":
            return 4
        return 3

    def bonus_room(i: int, bonus_type: str, pos: dict, doors: list[dict]) -> dict:
        if bonus_type == "treasure":
            return {
                "id": "",
                "type": "treasure",
                "name": slot_name(
                    bonus_name_slot(i, bonus_type),
                    bonus_name_index(bonus_type),
                    "ห้องสมบัติ",
                ),
                "desc": lore_at(
                    bonus_name_index(bonus_type),
                    "หีบสมบัติเก่าแก่ — ข้างในมีของที่ช่วยให้ผ่านดันเจี้ยนได้ง่ายขึ้น",
                ),
                "pos": pos,
                "doors": list(doors),
                "reward": {"item_key": key_id},
                "damage": 0,
                "question_ids": [],
                "boss": None,
            }
        if bonus_type == "npc":
            return {
                "id": "",
                "type": "npc",
                "name": slot_name(
                    bonus_name_slot(i, bonus_type),
                    bonus_name_index(bonus_type),
                    "วิญญาณผู้เฒ่า",
                ),
                "desc": lore_at(
                    bonus_name_index(bonus_type),
                    content or "วิญญาณผู้เฒ่าเล่าเรื่องราวของบทนี้ให้ฟัง",
                ),
                "pos": pos,
                "doors": list(doors),
                "reward": None,
                "damage": 0,
                "question_ids": [],
                "boss": None,
            }
        return {
            "id": "",
            "type": "trap",
            "name": slot_name(
                bonus_name_slot(i, bonus_type),
                3,
                trap_name or (DEFAULT_TRAP_NAME_TH if lang == "th" else DEFAULT_TRAP_NAME_EN),
            ),
            "desc": (
                f"กับดักโบราณใน {chapter_title} — ทางลัดแลกมาด้วยพลังชีวิต"
                if lang == "th"
                else f"An ancient trap in {chapter_title} — a shortcut paid for in health"
            ),
            "pos": pos,
            "doors": list(doors),
            "reward": None,
            "damage": TRAP_DAMAGE,
            "question_ids": [],
            "boss": None,
        }

    # ---- ทางเข้า ----
    first_target = "q1" if quiz_count else "branch"
    rooms["start"] = {
        "id": "start",
        "type": "npc",
        "name": slot_name("start", 0, "ทางเข้าดันเจี้ยน"),
        "desc": lore_at(0, objective or content or chapter_title),
        "pos": {"x": 0, "y": 0},
        "doors": [{
            "to": first_target,
            "requires": None,
            "label": "เข้าสู่ดันเจี้ยน",
        }],
        "reward": None,
        "damage": 0,
        "question_ids": [],
        "boss": None,
    }

    # ---- แต่ละช่วง: ห้องคำถาม → ทางแยก → ห้องโบนัส (ไม่บังคับ) ----
    for i in range(quiz_count):
        qid = f"q{i + 1}"
        branch_id = "branch" if i == 0 else f"branch{i + 1}"
        bonus_type = bonus_plan[i]
        bonus_id = bonus_type if i == 0 else f"bonus{i + 1}"
        next_qid = f"q{i + 2}" if i + 1 < quiz_count else None
        q_y = 1 + i * 3
        branch_y = q_y + 1
        bonus_y = q_y + 2
        bonus_x = -1 if i % 2 == 0 else 1

        rooms[qid] = {
            "id": qid,
            "type": "quiz",
            "name": slot_name(
                qid,
                QUIZ_NAME_INDEX[i] if i < len(QUIZ_NAME_INDEX) else 8,
                f"ห้องทดสอบที่ {i + 1}",
            ),
            "desc": lore_at(
                QUIZ_NAME_INDEX[i] if i < len(QUIZ_NAME_INDEX) else 8,
                "คำถามจากเนื้อหาบทเรียน" if i == 0 else "ด่านทดสอบก่อนถึงบอส",
            ),
            "pos": {"x": 0, "y": q_y},
            "doors": [{"to": branch_id, "requires": None, "label": "ไปต่อ"}],
            "reward": None,
            "damage": 0,
            "question_ids": groups[i],
            "boss": None,
        }

        branch_doors: list[dict] = [{
            "to": bonus_id,
            "requires": None,
            "label": "ห้องสมบัติ" if bonus_type == "treasure" else (
                "วิญญาณผู้เฒ่า" if bonus_type == "npc" else "ทางลัดอันตราย"
            ),
        }]
        if next_qid:
            branch_doors.append({"to": next_qid, "requires": None, "label": "ไปต่อ"})
        else:
            branch_doors.append({
                "to": "vault",
                "requires": key_id if has_treasure else None,
                "label": "ห้องนิรภัย",
            })
            branch_doors.append({"to": "boss", "requires": None, "label": "ประตูบอส"})

        rooms[branch_id] = {
            "id": branch_id,
            "type": "npc",
            "name": slot_name(
                branch_id,
                BRANCH_NAME_INDEX[i] if i < len(BRANCH_NAME_INDEX) else 10,
                "ทางแยก",
            ),
            "desc": lore_at(
                BRANCH_NAME_INDEX[i] if i < len(BRANCH_NAME_INDEX) else 10,
                "ทางแยก — เลือกเส้นทางที่ต้องการ สำรวจให้คุ้มก่อนไปต่อ",
            ),
            "pos": {"x": 0, "y": branch_y},
            "doors": branch_doors,
            "reward": None,
            "damage": 0,
            "question_ids": [],
            "boss": None,
        }

        bonus_doors: list[dict] = []
        if next_qid:
            bonus_doors.append({"to": next_qid, "requires": None, "label": "ไปต่อ"})
        else:
            bonus_doors.append({
                "to": "vault",
                "requires": key_id if has_treasure else None,
                "label": "ห้องนิรภัย",
            })
            bonus_doors.append({"to": "boss", "requires": None, "label": "ประตูบอส"})

        bonus_room_obj = bonus_room(i, bonus_type, {"x": bonus_x, "y": bonus_y}, bonus_doors)
        bonus_room_obj["id"] = bonus_id
        rooms[bonus_id] = bonus_room_obj

    # ---- กรณีบทไม่มีคำถามเลย: ยังต้องมีทางแยก + ห้องโบนัส + บอส ----
    if quiz_count == 0:
        bonus_type = bonus_plan[0]
        bonus_id = bonus_type
        rooms["branch"] = {
            "id": "branch",
            "type": "npc",
            "name": slot_name("branch", 2, "ทางแยก"),
            "desc": lore_at(2, "ทางแยก — เลือกเส้นทางที่ต้องการ"),
            "pos": {"x": 0, "y": 1},
            "doors": [
                {"to": bonus_id, "requires": None, "label": "สำรวจ"},
                {
                    "to": "vault",
                    "requires": key_id if has_treasure else None,
                    "label": "ห้องนิรภัย",
                },
                {"to": "boss", "requires": None, "label": "ประตูบอส"},
            ],
            "reward": None,
            "damage": 0,
            "question_ids": [],
            "boss": None,
        }
        bonus_room_obj = bonus_room(
            0,
            bonus_type,
            {"x": -1, "y": 2},
            [
                {
                    "to": "vault",
                    "requires": key_id if has_treasure else None,
                    "label": "ห้องนิรภัย",
                },
                {"to": "boss", "requires": None, "label": "ประตูบอส"},
            ],
        )
        bonus_room_obj["id"] = bonus_id
        rooms[bonus_id] = bonus_room_obj
        vault_y = 3
        boss_y = 4
    else:
        vault_y = 1 + quiz_count * 3
        boss_y = vault_y + 1

    rooms["vault"] = {
        "id": "vault",
        "type": "treasure",
        "name": slot_name("vault", 6, "ห้องนิรภัย"),
        "desc": lore_at(6, "ห้องนิรภัยที่ต้องใช้กุญแจเปิด — ข้างในมีโพชั่นฟื้นพลัง"),
        "pos": {"x": -1, "y": vault_y},
        "doors": [{"to": "boss", "requires": None, "label": "ออกไปหาบอส"}],
        "reward": {"item_key": potion_id},
        "damage": 0,
        "question_ids": [],
        "boss": None,
    }

    phase_total = _phase_count(len(question_ids))
    phases = []
    for i in range(phase_total):
        phases.append({
            "name": phase_names[i] if i < len(phase_names) else f"ร่างที่ {i + 1}",
            "hp": PHASE_HP,
            "concept": objective[:120] if i % 2 == 0 else chapter_title,
        })

    rooms["boss"] = {
        "id": "boss",
        "type": "boss",
        "name": slot_name("boss", 7, "ห้องบอส"),
        "desc": lore_at(7, f"ผู้พิทักษ์แห่ง {chapter_title}"),
        "pos": {"x": 0, "y": boss_y},
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
        "quiz_rooms": [f"q{i + 1}" for i in range(quiz_count)],
        "rooms": rooms,
        "items": items,
        "max_hp": 100,
    }


def flavor_from_dungeon(dungeon: Optional[dict]) -> Optional[dict]:
    """ดึง flavour เดิมกลับมาใช้เมื่อต้องสร้างดันเจี้ยนรุ่นใหม่ (คงชื่อ/เรื่องเล่าไว้)"""
    if not isinstance(dungeon, dict):
        return None
    rooms = dungeon.get("rooms")
    if not isinstance(rooms, dict) or not rooms:
        return None

    boss_room = rooms.get(dungeon.get("boss_room")) or {}
    boss = boss_room.get("boss") or {}
    phases = boss.get("phases") or []
    room_names = []
    lore = []
    for room in rooms.values():
        if not isinstance(room, dict):
            continue
        name = _clean(room.get("name"), 80)
        desc = _clean(room.get("desc"), 200)
        if name:
            room_names.append(name)
        if desc:
            lore.append(desc)

    key_name = ""
    for item in (dungeon.get("items") or {}).values():
        if isinstance(item, dict) and item.get("type") == "key":
            key_name = _clean(item.get("name"), 60)
            break
    trap_name = ""
    for room in rooms.values():
        if isinstance(room, dict) and room.get("type") == "trap":
            trap_name = _clean(room.get("name"), 60)
            break

    return {
        "name": _clean(dungeon.get("name"), 80),
        "key_name": key_name,
        "boss_name": _clean(boss.get("name"), 80),
        "room_names": room_names[:16],
        "lore": lore[:16],
        "boss_phase_names": [
            _clean(p.get("name"), 80)
            for p in phases
            if isinstance(p, dict) and _clean(p.get("name"), 80)
        ][:BOSS_MAX_PHASES],
        "trap_name": trap_name,
    }


def core_name_slots(dungeon: Optional[dict]) -> dict[str, str]:
    """เก็บชื่อห้องหลักของดันเจี้ยนเดิมไว้ใช้ซ้ำหลังอัปเกรดโครงสร้าง"""
    if not isinstance(dungeon, dict):
        return {}
    rooms = dungeon.get("rooms")
    if not isinstance(rooms, dict):
        return {}
    slots: dict[str, str] = {}
    for rid in (
        "start", "q1", "q2", "q3", "q4",
        "branch", "branch2", "branch3", "branch4",
        "vault", "boss",
    ):
        name = _clean((rooms.get(rid) or {}).get("name"), 80)
        if name:
            slots[rid] = name
    for room_type in ("treasure", "npc", "trap"):
        name = _clean((rooms.get(room_type) or {}).get("name"), 80)
        if name:
            slots[f"bonus:{room_type}"] = name
    for rid in ("bonus2", "bonus3", "bonus4"):
        name = _clean((rooms.get(rid) or {}).get("name"), 80)
        if name:
            slots[rid] = name
    return slots


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

    def int_list(value: Any, limit: int = 40) -> list[int]:
        if not isinstance(value, list):
            return []
        out: list[int] = []
        for item in value:
            try:
                number = int(item)
            except (TypeError, ValueError):
                continue
            if number not in out:
                out.append(number)
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
        "boss_seen": int_list(raw.get("boss_seen")),
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
