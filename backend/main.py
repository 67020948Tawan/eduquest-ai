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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, init_db
from api.auth import router as auth_router
from api.courses import router as courses_router
from api.play import router as play_router
from api.public import router as public_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables + auto-migrate new columns
    await init_db()
    print("✅ Database ready")
    yield
    # Shutdown
    await engine.dispose()


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
    return {"message": "EduQuest AI is running", "docs": "/docs"}


# uploads dir ต้องพร้อมก่อนรับ request แรก
os.makedirs("uploads", exist_ok=True)
