from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    title = Column(String, nullable=False)
    order_index = Column(Integer, default=0)

    course = relationship("Course", back_populates="chapters")
    # เป็น Lesson เดียวต่อ 1 Chapter (uselist=False) — ลบ Chapter แล้ว Lesson หายตามด้วย
    lesson = relationship(
        "Lesson", back_populates="chapter", uselist=False, cascade="all, delete-orphan"
    )
    # หลาย Quiz ต่อ 1 Chapter — ลบ Chapter แล้ว Quiz หายตามด้วย
    quiz_questions = relationship(
        "QuizQuestion", back_populates="chapter", cascade="all, delete-orphan"
    )