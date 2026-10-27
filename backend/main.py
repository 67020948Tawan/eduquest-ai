# ==============================================================================
# main.py — FastAPI App Entry Point (EduQuest AI)
# จัดโครงสร้างเป็น Routers: auth / courses / play
# ==============================================================================

import os
import sys
from contextlib import asynccontextmanager

# Windows console อาจเป็น cp1252 — บังคับ UTF-8 กัน UnicodeEncodeError จาก print emoji
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from database import engine, init_db, SessionLocal
from api.auth import router as auth_router
from api.courses import router as courses_router
from api.play import router as play_router
from api.public import router as public_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """lifecycle ของแอป: startup → init_db() สร้างตาราง, shutdown → ปิด connection pool"""
    # Startup: create tables + auto-migrate new columns
    await init_db()
    await _reset_stuck_generations()
    print("✅ Database ready")
    yield
    # Shutdown
    await engine.dispose()


async def _reset_stuck_generations() -> None:
    """งาน generate เก็บในหน่วยความจำ — หลังรีสตาร์ทให้คืนคอร์สที่ค้าง GENERATING เป็น DRAFT"""
    from sqlalchemy import select
    from models.course import Course, CourseStatus
    from services import generation_jobs

    async with SessionLocal() as db:
        rows = await db.execute(select(Course).where(Course.status == CourseStatus.GENERATING))
        stuck = list(rows.scalars().all())
        if not stuck:
            return
        for course in stuck:
            course.status = CourseStatus.DRAFT
        await db.commit()
        # เก็บสาเหตุไว้ให้ frontend อ่าน: งานหายเพราะโปรเซสถูก restart (เช่น ตอน deploy)
        for course in stuck:
            generation_jobs.record_failure(
                course.id,
                "เซิร์ฟเวอร์รีสตาร์ทระหว่างสร้างเกม (เช่น มีการอัปเดตระบบ) — "
                "ไฟล์บทเรียนยังอยู่ กด “ลองสร้างอีกครั้ง” ได้เลย",
            )
        print(f"♻️ Reset {len(stuck)} stuck GENERATING course(s) to DRAFT")


app = FastAPI(
    title="EduQuest AI",
    description="Turn Learning Materials into Playable Games with AI",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS — เพิ่ม origin ได้ผ่าน env: CORS_ORIGINS=https://a.com,https://b.com
_cors = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Player-Key", "Accept", "Origin", "X-Requested-With"],
)

# ---- Routers ----
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(play_router)
app.include_router(public_router)


@app.get("/")
def read_root():
    """health check: ใช้ตรวจว่า backend รันอยู่ (เช่น Render healthCheckPath)"""
    return {"message": "EduQuest AI is running", "docs": "/docs"}


# uploads dir ต้องพร้อมก่อนรับ request แรก
os.makedirs("uploads", exist_ok=True)
