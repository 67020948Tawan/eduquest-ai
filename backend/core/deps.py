# ==============================================================================
# core/deps.py — Shared Dependencies (Authentication / Authorization)
# แยกออกจาก main.py เพื่อให้ routers ใช้ร่วมกันได้
# ==============================================================================

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from core.security import SECRET_KEY, ALGORITHM
from database import get_db
from models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="ไม่สามารถยืนยันตัวตนได้ (Token ไม่ถูกต้องหรือหมดอายุ)",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception
    return user


async def _user_from_bearer(request: Request, db: AsyncSession) -> User | None:
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(auth[7:].strip(), SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            return None
        result = await db.execute(select(User).where(User.email == email))
        return result.scalars().first()
    except JWTError:
        return None


async def get_player(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """
    Player identity สำหรับ gameplay endpoints:
      1. Bearer token (ผู้ใช้ที่ login)
      2. X-Player-Key header (guest — key สุ่มเก็บในเครื่องนักเรียน)
         → auto-create User แบบ guest เพื่อเก็บ progress แยกตามอุปกรณ์
    """
    user = await _user_from_bearer(request, db)
    if user:
        return user

    key = request.headers.get("X-Player-Key") or ""
    import re

    if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", key):
        email = f"{key.lower()}@guest.player"
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalars().first()
        if user is None:
            user = User(
                name=f"Guest {key[:6]}",
                email=email,
                password_hash="!",
                role=UserRole.STUDENT,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="กรุณาเข้าสู่ระบบหรือเล่นโดยไม่ระบุตัวตน (Guest)",
    )
