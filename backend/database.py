# ==============================================================================
# database.py — Async SQLAlchemy Setup (PostgreSQL)
# ==============================================================================

import os
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_async_engine(DATABASE_URL, echo=False)

SessionLocal = sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


async def get_db():
    """ยืม DB session ให้ endpoint ใช้ครั้งเดียวแล้วปิด (FastAPI Depends)"""
    async with SessionLocal() as session:
        yield session


# ------------------------------------------------------------------------------
# Lightweight auto-migration: create_all + เติมคอลัมน์ที่เพิ่มใหม่ในตารางเดิม
# (create_all ไม่แก้ตารางที่มีอยู่แล้ว — จึงต้อง ALTER TABLE เอง)
# ใช้ production-grade migration tool (Alembic) เมื่อโปรเจกต์ใหญ่ขึ้น
# ------------------------------------------------------------------------------

_MISSING_COLUMN_DEFAULTS = {
    "courses": {
        "visual_style": "VARCHAR DEFAULT 'pixel_art'",
        "game_config": "JSON",
        "game_modes": "JSON DEFAULT '[\"standard_quiz\"]'",
        "share_token": "VARCHAR UNIQUE",
        "share_code": "VARCHAR UNIQUE",
        "access_mode": "VARCHAR DEFAULT 'private'",
    },
    "game_sessions": {
        "game_state": "JSON DEFAULT '{}'",
    },
}


async def init_db() -> None:
    """รันตอน backend start: สร้างตารางที่ยังไม่มี + ALTER เติมคอลัมน์ใหม่ตาม _MISSING_COLUMN_DEFAULTS"""
    from models import user, course, document, chapter, lesson, quiz_question, level, badge, game_session  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        for table_name, columns in _MISSING_COLUMN_DEFAULTS.items():
            for column_name, column_def in columns.items():
                exists = await conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name = :t AND column_name = :c"
                    ),
                    {"t": table_name, "c": column_name},
                )
                if not exists.scalar():
                    await conn.execute(
                        text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_def}")
                    )
