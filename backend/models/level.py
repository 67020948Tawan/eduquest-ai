from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Level(Base):
    __tablename__ = "levels"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    level_number = Column(Integer, nullable=False)
    title = Column(String, nullable=False)
    xp_required = Column(Integer, default=0)

    course = relationship("Course", back_populates="levels")