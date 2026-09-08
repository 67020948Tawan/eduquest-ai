# ==============================================================================
# schemas/generation.py — Pydantic Schema ควบคุม Output ของ AI (Structured Output)
#
# ทุก AI output ต้องผ่าน Schema Validation ก่อนเข้าระบบเสมอ (กฎข้อ #96)
# ทุก Game Element ต้องมี Learning Mapping + Source Reference (กฎข้อ #42)
# ==============================================================================

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional


# ------------------------------------------------------------------------------
# Learning Mapping — ใช้ย้อนกลับไปหา Source ได้ (กฎข้อ #61)
# ------------------------------------------------------------------------------

class SourceReferenceAI(BaseModel):
    document: str = Field(description="ชื่อไฟล์เอกสารต้นทาง เช่น Normalization.pdf")
    location: str = Field(description="ตำแหน่ง เช่น 'Page 12-20' หรือ 'Section 3'")


class QuizQuestionAI(BaseModel):
    question: str
    options: List[str] = Field(min_length=2, max_length=6)
    correct_answer_index: int = Field(ge=0, le=5)
    explanation: str
    difficulty: str = "easy"          # "easy" | "medium" | "hard"
    points: int = Field(default=50, ge=1)
    source_reference: str             # อ้างอิงว่ามาจากส่วนไหนของเอกสาร
    concept: Optional[str] = None     # Concept ที่คำถามนี้วัด

    @field_validator("correct_answer_index")
    @classmethod
    def answer_index_in_range(cls, v, info):
        options = info.data.get("options") or []
        if options and v >= len(options):
            raise ValueError("correct_answer_index ต้องชี้ไปที่ option ที่มีอยู่จริง")
        return v


class LessonAI(BaseModel):
    title: str
    objective: str
    content: str


class ChapterAI(BaseModel):
    title: str
    lesson: LessonAI
    quiz_questions: List[QuizQuestionAI] = Field(min_length=3, max_length=6)


# ------------------------------------------------------------------------------
# Game World Elements — RPG / Adventure Layer
# ------------------------------------------------------------------------------

class ZoneAI(BaseModel):
    """โซนในแผนที่ — 1 โซนต่อ 1 Chapter (กฎข้อ #6)"""
    name: str
    chapter_index: int = Field(ge=0, description="index ของ chapter ที่โซนนี้ผูกอยู่")
    environment: str = Field(description="บรรยากาศ/สภาพแวดล้อม เช่น หมู่บ้าน ป่า ปราสาท")
    description: str


class NpcAI(BaseModel):
    name: str
    role: str
    personality: str
    dialogue: str
    related_concept: str


class EnemyAI(BaseModel):
    """Enemy = ตัวแทนของ Problem/Concept (กฎข้อ #21)"""
    name: str
    represents_concept: str
    attack_description: str
    weakness_hint: str
    hp: int = Field(default=100, ge=10)
    xp_reward: int = Field(default=50, ge=0)


class BossAI(BaseModel):
    """Boss = รวมหลาย Learning Objectives (กฎข้อ #22)"""
    name: str
    title: str
    phases: List[str] = Field(min_length=1, description="phase แต่ละด่านผูกกับ concept")
    total_hp: int = Field(default=500, ge=50)
    xp_reward: int = Field(default=300, ge=0)
    related_concepts: List[str] = Field(min_length=1)
    source_reference: str


class WorldAI(BaseModel):
    name: str
    intro_story: str
    ending_story: str
    zones: List[ZoneAI]
    npcs: List[NpcAI]
    enemies: List[EnemyAI]
    bosses: List[BossAI]


# ------------------------------------------------------------------------------
# Gamification
# ------------------------------------------------------------------------------

class LevelAI(BaseModel):
    level: int
    title: str
    xp_required: int


class BadgeAI(BaseModel):
    name: str
    description: str
    condition_hint: str


class GamificationAI(BaseModel):
    theme: str
    levels: List[LevelAI]
    badges: List[BadgeAI]


# ------------------------------------------------------------------------------
# Root schema — ผลลัพธ์สุดท้ายของ Game Generation Pipeline
# ------------------------------------------------------------------------------

class CourseGenerationAI(BaseModel):
    world_name: str
    world: WorldAI
    chapters: List[ChapterAI] = Field(min_length=10, max_length=12)
    gamification: GamificationAI
    learning_objectives: List[str] = Field(default_factory=list)

    model_config = {
        "json_schema_extra": {
            "description": "EduQuest AI game configuration generated from learning materials"
        }
    }
