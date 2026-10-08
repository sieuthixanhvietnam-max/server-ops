import asyncio
import json
import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Job, JobTarget
from app.ops.ssh_ops import has_internet_connection

logger = logging.getLogger("job_service")

# Per-job_id lock for JobContext.log's read-append-commit - many job types
# run several SSH/API calls concurrently across OS threads (check_health's
# ssh_health_workers, migrate's ssh_migrate_workers, etc.), each calling
# ctx.log(...) independently. Without this, two threads can both read the
# same job.log, each append their own line, and whichever commits last wins
# - the other thread's line silently vanishes from the job transcript.
_log_locks: dict[int, threading.Lock] = {}
_log_locks_meta_lock = threading.Lock()


def _log_lock(job_id: int) -> threading.Lock:
    with _log_locks_meta_lock:
        if job_id not in _log_locks:
            _log_locks[job_id] = threading.Lock()
        return _log_locks[job_id]


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
        with _log_lock(self.job_id):
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

    def init_targets(self, labels: list[str]) -> list[int]:
        """Call once, before any per-target work starts - creates one
        'pending' JobTarget per label, in order. Skip entirely for dry-run
        (nothing real happens, so there's nothing to track progress on).
        Returns the new rows' ids in the same order as `labels`, for callers
        that need to address a specific row unambiguously afterward (see
        start_target_by_id/finish_target_by_id) instead of matching by label
        - duplicate labels in one batch (e.g. the same domain twice) would
        otherwise be indistinguishable."""
        db = SessionLocal()
        try:
            targets = [JobTarget(job_id=self.job_id, target_label=label, status="pending") for label in labels]
            db.bulk_save_objects(targets, return_defaults=True)
            db.commit()
            return [t.id for t in targets]
        finally:
            db.close()

    def start_target(self, label: str):
        db = SessionLocal()
        try:
            target = db.execute(
                select(JobTarget)
                .where(JobTarget.job_id == self.job_id, JobTarget.target_label == label, JobTarget.status == "pending")
                .limit(1)
            ).scalar_one_or_none()
            if target is None:
                return
            target.status = "running"
            target.started_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

    def finish_target(self, label: str, status: str, note: str = ""):
        """status: 'success' or 'failed'. Matches whichever row for this
        label isn't already finished - normally the one start_target() just
        flipped to 'running', but also covers a target that fails validation
        before start_target() was ever called (still 'pending')."""
        db = SessionLocal()
        try:
            target = db.execute(
                select(JobTarget)
                .where(
                    JobTarget.job_id == self.job_id,
                    JobTarget.target_label == label,
                    JobTarget.status.in_(("pending", "running")),
                )
                .limit(1)
            ).scalar_one_or_none()
            if target is None:
                return
            target.status = status
            target.note = note
            target.finished_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

    def start_target_by_id(self, target_id: int):
        """Same as start_target, but addresses the exact JobTarget row by
        primary key instead of matching by label - use this (with the ids
        init_targets returned) whenever the batch can contain duplicate
        labels processed concurrently, e.g. migrate_wpsite's per-domain
        ThreadPoolExecutor."""
        db = SessionLocal()
        try:
            target = db.get(JobTarget, target_id)
            if target is None:
                return
            target.status = "running"
            target.started_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

    def finish_target_by_id(self, target_id: int, status: str, note: str = ""):
        db = SessionLocal()
        try:
            target = db.get(JobTarget, target_id)
            if target is None:
                return
            target.status = status
            target.note = note
            target.finished_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()


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

    # Fails the whole job in ~3-6s flat instead of letting every target in
    # a batch (sometimes dozens) each burn its own SSH connect timeout only
    # to discover the same thing - see ssh_ops.has_internet_connection.
    if not await asyncio.to_thread(has_internet_connection):
        ctx.log("[fatal] Không có kết nối Internet - huỷ tác vụ")
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            job.status = "failed"
            job.fail_reason = "no_internet"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()
        return

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
