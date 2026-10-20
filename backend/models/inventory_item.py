# ==============================================================================
# models/inventory_item.py — คลังไอเทมของผู้เล่น (อาวุธ / ชุดเกราะ)
#
# ข้อ 3.4.3 ในรายงาน — inventory_items
# stat_bonus เก็บสำเนาไว้ ณ เวลาที่ได้รับ (catalog อาจเปลี่ยนภายหลัง)
# ==============================================================================

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from database import Base


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    item_key = Column(String, nullable=False)
    item_type = Column(String, nullable=False)  # weapon | armor
    rarity = Column(String, default="common")
    stat_bonus = Column(JSON, default=dict)
    equipped = Column(Boolean, default=False)
    acquired_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", "item_key", name="uq_inventory_user_item"),
    )
