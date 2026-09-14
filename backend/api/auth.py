# ==============================================================================
# api/auth.py — Authentication Endpoints
# ==============================================================================

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from database import get_db
from models.user import User, UserRole
from schemas.user import UserCreate, UserResponse, Token
from core.deps import get_current_user
from core.security import get_password_hash, verify_password, create_access_token

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/register", response_model=UserResponse)
async def register_user(user: UserCreate, db: AsyncSession = Depends(get_db)):
    """สมัครสมาชิก: ตรวจอีเมลซ้ำ → แฮชรหัสผ่าน → สร้าง user ใหม่ (ไม่มี role ใน input, default เป็น STUDENT)"""
    result = await db.execute(select(User).where(User.email == user.email))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="อีเมลนี้ถูกใช้งานแล้ว")

    new_user = User(
        name=user.name,
        email=user.email,
        password_hash=get_password_hash(user.password),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """ล็อกอิน: รับ username(=email)+password แบบฟอร์ม → ตรวจรหัส → ออก JWT (เก็บ email ใน sub)"""
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalars().first()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="อีเมลหรือรหัสผ่านไม่ถูกต้อง",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": user.email, "role": user.role.value})
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/users/me", response_model=UserResponse)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """ดึงโปรไฟล์ตัวเองจาก token (ไม่ส่ง password_hash กลับ — ดู schemas/user.py)"""
    return current_user
