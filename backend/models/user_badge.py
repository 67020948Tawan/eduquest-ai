# ==============================================================================
# models/user_badge.py — ตารางเชื่อม ผู้ใช้ ↔ เหรียญตรา (สำหรับ Gamification)
# ==============================================================================

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class UserBadge(Base):
    """บันทึกว่า user คนไหนได้ badge อะไร ของคอร์สไหน และเมื่อไหร่"""
    __tablename__ = "user_badges"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    badge_id = Column(Integer, ForeignKey("badges.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    earned_at = Column(DateTime(timezone=True), server_default=func.now())

    # กัน badge ซ้ำกันสำหรับ user เดียวในคอร์สเดียว
    __table_args__ = (
        UniqueConstraint("user_id", "badge_id", "course_id", name="uq_user_badge_course"),
    )

    user = relationship("User")
    badge = relationship("Badge")
    course = relationship("Course")
