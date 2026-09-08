from sqlalchemy import Column, Integer, String, Text, ForeignKey, Enum, DateTime, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from database import Base

# กำหนดสถานะของคอร์ส
class CourseStatus(enum.Enum):
    DRAFT = "DRAFT"
    GENERATING = "GENERATING"
    READY = "READY"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"

class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    subject = Column(String, nullable=True)
    difficulty = Column(String, nullable=True)
    
    # 🌟 โหมดเกมที่ครูเลือก
    game_modes = Column(JSON, default=["quiz"])

    # 🎨 Visual Style Bible (กฎข้อ #30) — pixel_art | modern_2d | fantasy | scifi
    visual_style = Column(String, default="pixel_art")

    # 🌍 Game Configuration ทั้งหมดที่ AI generate (world/npcs/enemies/bosses)
    game_config = Column(JSON, nullable=True)

    status = Column(Enum(CourseStatus), default=CourseStatus.DRAFT)
    thumbnail = Column(String, nullable=True)

    # ---- Share / Publish (public game link) ----
    share_token = Column(String, unique=True, nullable=True, index=True)
    share_code = Column(String, unique=True, nullable=True, index=True)  # รหัสเข้าห้อง 6 หลัก เช่น K7Q2XD
    access_mode = Column(String, default="private")  # private | unlisted | public

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at = Column(DateTime, nullable=True)

    teacher = relationship("User", back_populates="courses")
    documents = relationship("Document", back_populates="course")

    # ==== สำหรับ Quiz + Gamification Designer ====
    # cascade="all, delete-orphan" -> ลบ Course แล้ว Chapter/Level/Badge หายตามอัตโนมัติ
    chapters = relationship("Chapter", back_populates="course", cascade="all, delete-orphan")
    levels = relationship("Level", back_populates="course", cascade="all, delete-orphan")
    badges = relationship("Badge", back_populates="course", cascade="all, delete-orphan")
    game_sessions = relationship(
        "GameSession", back_populates="course", cascade="all, delete-orphan"
    )