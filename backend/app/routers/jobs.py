import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import Job, JobTarget

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])

VN_TZ = timezone(timedelta(hours=7))  # Asia/Ho_Chi_Minh, no DST - fixed offset is exact


def _job_out(job: Job, targets: list[JobTarget] | None = None, include_log: bool = True) -> dict:
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "created_by": job.created_by,
        "created_ip": job.created_ip,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "params": json.loads(job.params_json),
        # list_jobs() passes include_log=False - its rows never render `log`
        # (job-history's table only shows a status summary), and a job's log
        # can run to tens of thousands of lines (confirmed in production),
        # which is wasteful to ship on every paginated list load.
        "log": job.log if include_log else "",
        "result": json.loads(job.result_json),
        "fail_reason": job.fail_reason,
        # [] for job types that don't populate job_targets (most of them,
        # today) or for list_jobs() rows (progress bars only matter for the
        # single job actually being watched, not a list of history rows).
        "targets": [
            {
                "id": t.id, "target_label": t.target_label, "status": t.status,
                "started_at": t.started_at, "finished_at": t.finished_at, "note": t.note,
            }
            for t in (targets or [])
        ],
    }


@router.get("/reports/redirect-weekly")
def redirect_weekly_report(
    weeks: int = Query(8, ge=1, le=52),
    date_from: datetime | None = Query(None, description="Overrides `weeks` if given"),
    date_to: datetime | None = Query(None),
    db: Session = Depends(get_db),
):
    """Domain 301 count per PIC per week, for the 'Báo cáo Redirect 301'
    page. PIC here is deliberately Job.created_by (whoever actually ran the
    cf_redirect job) - a conscious choice discussed with the user, NOT the
    server-ownership PIC concept in pic_service.py used by Domain Changes.
    Returns one row per (pic, week, domain) actually applied (status
    created/updated/unchanged - excludes dry-run and failed entries), so the
    frontend can both aggregate counts and drill into per-cell detail/export
    from this single response without a second round-trip.

    Week buckets are Monday-Sunday in Vietnam local time (UTC+7), not raw
    UTC - Job.created_at is stored/read as UTC, so a job that ran, say,
    2026-09-21 20:00 UTC (Monday, 03:00 the next calendar day in Vietnam)
    would otherwise land in the wrong week for a VN-based team reading this
    report. Confirmed as a real, user-reported discrepancy, not a
    theoretical one.

    Excludes the literal username "admin" - NOT settings.admin_username
    (that's the current break-glass account, 'ssop' in production, unrelated).
    "admin" is a since-deleted/renamed user whose old jobs still carry that
    string in created_by (a plain snapshot, not an FK - see Job model), and
    those historical bulk runs would otherwise skew the per-PIC counts and
    leaderboard, per the user's explicit request. Report-only exclusion -
    the underlying Job rows are untouched, still visible in Job History."""
    since = date_from or (datetime.now(timezone.utc) - timedelta(weeks=weeks))
    until = date_to or datetime.now(timezone.utc)
    rows = db.execute(
        select(Job.id, Job.created_by, Job.created_at, Job.result_json)
        .where(
            Job.job_type == "cf_redirect",
            Job.status == "success",
            Job.created_at >= since,
            Job.created_at <= until,
            Job.created_by != "admin",
        )
        .order_by(Job.created_at)
    ).all()

    detail: list[dict] = []
    for job_id, created_by, created_at, result_json in rows:
        try:
            results = json.loads(result_json or "[]")
        except (TypeError, ValueError):
            continue
        created_at_vn = created_at.astimezone(VN_TZ)
        week_start = (created_at_vn - timedelta(days=created_at_vn.weekday())).strftime("%Y-%m-%d")
        for r in results:
            if not isinstance(r, dict) or r.get("status") not in ("created", "updated", "unchanged"):
                continue
            domain = r.get("domain")
            if not domain:
                continue
            detail.append(
                {
                    "pic": created_by,
                    "domain": domain,
                    "target_url": r.get("target_url", ""),
                    "redirected_at": created_at.isoformat(),
                    "week_start": week_start,
                    "job_id": job_id,
                }
            )
    return {"data": detail, "success": True}


@router.get("/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    targets = db.execute(
        select(JobTarget).where(JobTarget.job_id == job_id).order_by(JobTarget.id)
    ).scalars().all()
    return _job_out(job, targets=targets)


@router.get("")
def list_jobs(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=200),
    job_type: str | None = Query(None),
    status: str | None = Query(None, description="'pending', 'running', 'success' or 'failed'"),
    created_by: str | None = Query(None),
    created_ip: str | None = Query(None, description="Exact IP match"),
    date_from: datetime | None = Query(None, description="created_at >= this time (ISO 8601)"),
    date_to: datetime | None = Query(None, description="created_at <= this time (ISO 8601)"),
):
    stmt = select(Job)
    if job_type:
        stmt = stmt.where(Job.job_type == job_type)
    if status:
        stmt = stmt.where(Job.status == status)
    if created_by:
        stmt = stmt.where(Job.created_by.ilike(f"%{created_by}%"))
    if created_ip:
        stmt = stmt.where(Job.created_ip == created_ip)
    if date_from:
        stmt = stmt.where(Job.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Job.created_at <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(stmt.order_by(Job.id.desc()).offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )
    return {"data": [_job_out(r, include_log=False) for r in rows], "total": total, "success": True}
