from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Lesson(Base):
    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, index=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False, unique=True)
    title = Column(String, nullable=False)
    objective = Column(Text, nullable=True)
    content = Column(Text, nullable=False)

    chapter = relationship("Chapter", back_populates="lesson")