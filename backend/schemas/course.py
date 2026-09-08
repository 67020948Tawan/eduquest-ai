from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from models.course import CourseStatus

class CourseCreate(BaseModel):
    title: str
    description: Optional[str] = None
    subject: Optional[str] = None
    difficulty: Optional[str] = None


class CourseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    subject: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[CourseStatus] = None


class CourseResponse(BaseModel):
    id: int
    teacher_id: int
    title: str
    description: Optional[str] = None
    subject: Optional[str] = None
    difficulty: Optional[str] = None
    game_modes: list[str] = []
    visual_style: str = "pixel_art"
    status: CourseStatus
    thumbnail: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True