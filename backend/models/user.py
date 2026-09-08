import enum
from sqlalchemy import Column, Integer, String, DateTime, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship  # <--- เพิ่มบรรทัดนี้เข้ามาครับ!
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
    
    # เก็บเวลาที่สร้างและอัปเดตอัตโนมัติ
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # เชื่อมความสัมพันธ์กับตารางคอร์สเรียน
    courses = relationship("Course", back_populates="teacher")
    game_sessions = relationship("GameSession", back_populates="user")