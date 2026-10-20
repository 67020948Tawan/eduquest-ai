from pydantic import BaseModel

# Schema สำหรับรับข้อมูลตอนสมัครสมาชิก
class UserCreate(BaseModel):
    name: str
    email: str
    password: str

# Schema สำหรับส่งข้อมูลกลับไปให้หน้าเว็บ (จะไม่ส่งรหัสผ่านกลับไปเด็ดขาด!)
class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    plan: str = "free"
    quota_used_today: int = 0
    current_streak: int = 0
    longest_streak: int = 0

    class Config:
        from_attributes = True

# Schema สำหรับส่ง Token กลับไปให้ตอน Login สำเร็จ
class Token(BaseModel):
    access_token: str
    token_type: str