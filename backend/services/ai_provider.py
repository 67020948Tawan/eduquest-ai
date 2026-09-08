# ==============================================================================
# services/ai_provider.py — AI Provider Layer (DeepSeek Only)
#
# Provider Logic ถูกรวมไว้ที่นี่ที่เดียว ห้ามกระจายทั่วระบบ
# ❗ ตัด Gemini ออกทั้งหมดตาม requirement — ใช้ DeepSeek เพียงตัวเดียว
# ==============================================================================

import os
import json
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


class AIProviderError(Exception):
    """Raised เมื่อเรียก AI Provider ไม่สำเร็จ"""


def _strip_markdown_fence(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


class DeepSeekProvider:
    """DeepSeek Chat (OpenAI-compatible API)"""

    name = "DeepSeek"

    def __init__(self, api_key: str):
        from openai import AsyncOpenAI

        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com",
            # generation เป็นงานยาว — ตั้ง timeout ให้พอ
            timeout=max(120.0, float(os.getenv("AI_TIMEOUT_SECONDS", "300"))),
        )

    async def generate_json(self, system_prompt: str, user_prompt: str, max_tokens: int | None = None) -> dict:
        """เรียก DeepSeek และคืน dict ที่ parse จาก JSON output"""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                # deepseek-chat รองรับ output สูงสุด 8192 tokens
                max_tokens=min(max_tokens or 8192, 8192),
            )
        except Exception as e:
            raise AIProviderError(f"[DeepSeek] เชื่อมต่อ AI ไม่สำเร็จ: {e}") from e

        choice = response.choices[0]
        raw = choice.message.content or ""

        # ถ้าโดนตัดกลางคัน (โดน token limit) — JSON จะไม่สมบูรณ์ แจ้งให้ caller retry แบบ compact
        if choice.finish_reason == "length":
            raise AIProviderError(
                "[DeepSeek] Output ถูกตัดเพราะยาวเกิน limit (truncated) — ต้องลดขนาดเกมที่สร้าง"
            )

        try:
            return json.loads(_strip_markdown_fence(raw))
        except json.JSONDecodeError as e:
            snippet = raw[:200].replace("\n", " ")
            raise AIProviderError(
                f"[DeepSeek] AI ตอบ JSON ไม่ถูกต้อง: {e} | เริ่ม response: {snippet}"
            ) from e


_PROVIDER: DeepSeekProvider | None = None


def get_ai_provider() -> DeepSeekProvider:
    """คืน DeepSeek provider (singleton) — raise ถ้าไม่มี key"""
    global _PROVIDER
    if _PROVIDER is None:
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise AIProviderError(
                "ไม่พบ DEEPSEEK_API_KEY — กรุณาตั้งค่าในไฟล์ .env"
            )
        _PROVIDER = DeepSeekProvider(api_key)
    return _PROVIDER
