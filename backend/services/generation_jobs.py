# ==============================================================================
# services/generation_jobs.py — In-memory job registry สำหรับการสร้างเกมด้วย AI
#
# ทำไมใช้ in-memory:
#   - Render free tier รัน instance เดียว — งานเบื้องหลังอยู่ในโปรเซสเดียวกัน
#   - ไม่ต้องเพิ่มตาราง/คอลัมน์ใน DB (คง Neon schema เดิม)
#   - ถ้าโปรเซสรีสตาร์ท งานจะหาย → ตัว endpoint สถานะจะคืนคอร์สที่ค้าง
#     GENERATING กลับเป็น DRAFT อัตโนมัติ (ดู reconcile ใน api/courses.py + main.py)
# ==============================================================================

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional

ACTIVE_STATUSES = ("queued", "running")
FINISHED_JOB_TTL_SECONDS = 60 * 60  # เก็บผลลัพธ์ไว้ 1 ชั่วโมงให้ frontend มาอ่าน


@dataclass
class GenerationJob:
    course_id: int
    status: str = "queued"  # queued | running | ready | error
    step: str = "queued"  # extract | ai | validate | save | art | ready
    message: str = "รอเริ่มงาน..."
    progress: int = 0
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


_jobs: dict[int, GenerationJob] = {}


def _prune() -> None:
    """ลบงานเก่าที่จบแล้วเกิน 1 ชั่วโมง กัน dict โตไม่จำกัด"""
    cutoff = time.time() - FINISHED_JOB_TTL_SECONDS
    stale = [
        cid
        for cid, job in _jobs.items()
        if job.finished_at is not None and job.finished_at < cutoff
    ]
    for cid in stale:
        _jobs.pop(cid, None)


def start(course_id: int) -> tuple[GenerationJob, bool]:
    """เริ่มงานใหม่ หรือคืนงานเดิมถ้ายังทำงานอยู่ (idempotent)"""
    _prune()
    existing = _jobs.get(course_id)
    if existing and existing.status in ACTIVE_STATUSES:
        return existing, False

    job = GenerationJob(course_id=course_id)
    _jobs[course_id] = job
    return job, True


def get(course_id: int) -> Optional[GenerationJob]:
    return _jobs.get(course_id)


def is_active(course_id: int) -> bool:
    job = _jobs.get(course_id)
    return bool(job and job.status in ACTIVE_STATUSES)


def update(
    course_id: int,
    *,
    status: Optional[str] = None,
    step: Optional[str] = None,
    message: Optional[str] = None,
    progress: Optional[int] = None,
) -> Optional[GenerationJob]:
    job = _jobs.get(course_id)
    if not job:
        return None
    if status is not None:
        job.status = status
    if step is not None:
        job.step = step
    if message is not None:
        job.message = message
    if progress is not None:
        job.progress = max(0, min(100, int(progress)))
    job.updated_at = time.time()
    return job


def succeed(course_id: int, result: dict[str, Any]) -> Optional[GenerationJob]:
    job = update(
        course_id,
        status="ready",
        step="ready",
        progress=100,
        message="สร้างเกมสำเร็จ!",
    )
    if job:
        job.result = result
        job.error = None
        job.finished_at = time.time()
        job.updated_at = job.finished_at
    return job


def fail(course_id: int, message: str) -> Optional[GenerationJob]:
    job = update(
        course_id,
        status="error",
        step="error",
        message="สร้างเกมไม่สำเร็จ",
    )
    if job:
        job.error = message
        job.finished_at = time.time()
        job.updated_at = job.finished_at
    return job


def record_failure(course_id: int, message: str) -> GenerationJob:
    """บันทึกงานที่ล้มเหลวทั้งที่ไม่มี job อยู่ในหน่วยความจำ

    ใช้ตอน startup: คอร์สที่ค้าง GENERATING (โปรเซสรีสตาร์ท/รีดีพลอยระหว่างสร้าง)
    จะได้มีสถานะ error พร้อมสาเหตุให้ frontend อ่าน แทนที่จะกลายเป็น "idle" เฉย ๆ
    """
    _prune()
    job = _jobs.get(course_id)
    if job is None:
        job = GenerationJob(course_id=course_id)
        _jobs[course_id] = job
    job.status = "error"
    job.step = "error"
    job.message = "สร้างเกมไม่สำเร็จ"
    job.error = message
    job.finished_at = time.time()
    job.updated_at = job.finished_at
    return job


def payload(job: GenerationJob) -> dict[str, Any]:
    return {
        "course_id": job.course_id,
        "status": job.status,
        "step": job.step,
        "message": job.message,
        "progress": job.progress,
        "error": job.error,
        "result": job.result,
        "started_at": job.started_at,
        "updated_at": job.updated_at,
        "finished_at": job.finished_at,
    }
