from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database import Base


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True, index=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False)
    question = Column(Text, nullable=False)
    options = Column(JSON, nullable=False)              # list[str] — สำหรับ multiple_choice / true_false
    correct_answer_index = Column(Integer, nullable=False)
    explanation = Column(Text, nullable=True)
    difficulty = Column(String, default="easy")
    points = Column(Integer, default=50)
    source_reference = Column(String, nullable=True)

    # 🎯 ประเภทคำถาม — multiple_choice | true_false | matching | ordering
    question_type = Column(String, default="multiple_choice")

    # 🔗 สำหรับ matching — [{"left": "...", "right": "..."}, ...]
    matching_pairs = Column(JSON, nullable=True)

    # 🔢 สำหรับ ordering — ["item1", "item2", ...] (ลำดับที่ AI สุ่มไว้ก่อน)
    ordering_items = Column(JSON, nullable=True)

    # ✅ สำหรับ matching/ordering — เก็บคำตอบที่ถูก (รูปแบบยืดหยุ่นตามประเภท)
    correct_data = Column(JSON, nullable=True)

    chapter = relationship("Chapter", back_populates="quiz_questions")