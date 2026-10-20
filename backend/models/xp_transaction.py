# ==============================================================================
# models/xp_transaction.py — บัญชีแยกธุรกรรม XP (XP Ledger)
#
# ทุกครั้งที่ XP ของผู้เล่นเปลี่ยน ต้องมีหลักฐานบันทึกไว้ตรวจย้อนหลังได้
# (ข้อ 3.4.3 ในรายงาน — xp_transactions)
# ==============================================================================

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class XpTransaction(Base):
    __tablename__ = "xp_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=True, index=True)
    amount = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # answer | chapter_bonus | perfect_bonus | raid | other
    created_at = Column(DateTime(timezone=True), server_default=func.now())
