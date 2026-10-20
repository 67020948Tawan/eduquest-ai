import enum
from sqlalchemy import Column, Integer, String, DateTime, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

# กำหนดสิทธิ์ผู้ใช้งาน (Role)
class UserRole(str, enum.Enum):
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"
    ADMIN = "ADMIN"

# สร้างแบบแปลนตาราง users
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.STUDENT)

    # 🔥 Streak / เกมมิฟิเคชัน (Hook Model — Investment)
    current_streak = Column(Integer, default=0)
    longest_streak = Column(Integer, default=0)
    last_played_at = Column(DateTime(timezone=True), nullable=True)

    # 💳 Freemium / โควตาการเรียก AI (ข้อ 3.4.6 / 3.4.7 ในรายงาน)
    plan = Column(String, default="free")                 # free | pro | school
    quota_used_today = Column(Integer, default=0)
    quota_reset_at = Column(DateTime(timezone=True), nullable=True)

    # เก็บเวลาที่สร้างและอัปเดตอัตโนมัติ
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # เชื่อมความสัมพันธ์กับตารางคอร์สเรียน
    courses = relationship("Course", back_populates="teacher")
    game_sessions = relationship("GameSession", back_populates="user")