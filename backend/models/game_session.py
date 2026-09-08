# ==============================================================================
# models/game_session.py — Game Session / Runtime State / Anti-cheat XP
#
# กฎข้อ #41: Frontend ห้ามกำหนด XP เอง — ทุกคำตอบต้องส่งมาให้ Backend ตรวจ
# กฎข้อ #37/#38: Runtime State save ลง Database เพื่อ Continue ได้
# ==============================================================================

from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class GameSession(Base):
    __tablename__ = "game_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)

    status = Column(String, default="active")  # active | completed | abandoned

    # Runtime state (กฎข้อ #69)
    xp = Column(Integer, default=0)                       # XP ที่ backend อนุมัติแล้วเท่านั้น
    answered = Column(JSON, default=dict)   # {question_id: {"answer": idx, "correct": bool}}
    completed_chapters = Column(JSON, default=list)       # [chapter_id, ...]

    # Game systems state (combat HP / resources / buildings) — server-owned
    game_state = Column(JSON, default=dict)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="game_sessions")
    course = relationship("Course", back_populates="game_sessions")
