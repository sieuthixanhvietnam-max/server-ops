import asyncio
import json
import logging
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models import Job

logger = logging.getLogger("job_service")


def create_job(db, job_type: str, params: dict, created_by: str, created_ip: str = "") -> Job:
    job = Job(
        job_type=job_type,
        status="pending",
        created_by=created_by,
        created_ip=created_ip,
        created_at=datetime.now(timezone.utc),
        params_json=json.dumps(params, ensure_ascii=False),
        log="",
        result_json="[]",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class JobContext:
    """Passed into job worker functions so they can append log lines that
    become visible to pollers immediately (each append commits)."""

    def __init__(self, job_id: int):
        self.job_id = job_id

    def log(self, line: str):
        db = SessionLocal()
        try:
            job = db.get(Job, self.job_id)
            if job is None:
                return
            job.log = (job.log + line + "\n") if job.log else (line + "\n")
            db.commit()
        finally:
            db.close()
        logger.info("[job %s] %s", self.job_id, line)


async def run_job(job_id: int, worker_coro_fn):
    """worker_coro_fn(ctx: JobContext) -> list[dict]  (async function)"""
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()

    ctx = JobContext(job_id)
    try:
        result = await worker_coro_fn(ctx)
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            job.status = "success"
            job.finished_at = datetime.now(timezone.utc)
            job.result_json = json.dumps(result, ensure_ascii=False)
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        ctx.log(f"[fatal] {exc}")
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            job.status = "failed"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()


def launch_job(job_id: int, worker_coro_fn):
    asyncio.create_task(run_job(job_id, worker_coro_fn))
