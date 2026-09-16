// Shared across every page that triggers a job (see JobResultPanel) - the
// backend's Job.result is almost always list[dict] with a "status" field
// per row (see backend/app/routers/jobs.py worker functions), except
// cf_master_discover which returns a single summary dict instead.
export const isErrorLikeStatus = (status: unknown): boolean => /error|fail|not_found/i.test(String(status));

export type JobResultTone = 'success' | 'warning' | 'error' | 'info';

export type JobResultSummary = {
  text: string;
  tone: JobResultTone;
};

/** Null means "nothing worth summarizing" (empty/missing result) - callers
 * should skip showing a summary line/toast in that case rather than print
 * an empty one. */
export function summarizeJobResult(result: unknown): JobResultSummary | null {
  if (Array.isArray(result)) {
    if (!result.length) return null;
    const hasStatus = result.every((r) => r && typeof r === 'object' && 'status' in r);
    if (!hasStatus) return { text: `${result.length} dòng`, tone: 'info' };
    const errorCount = result.filter((r) => isErrorLikeStatus(r.status)).length;
    const okCount = result.length - errorCount;
    if (errorCount === 0) return { text: `${okCount} thành công`, tone: 'success' };
    if (okCount === 0) return { text: `${errorCount} lỗi`, tone: 'error' };
    return { text: `${okCount} thành công, ${errorCount} lỗi`, tone: 'warning' };
  }
  if (result && typeof result === 'object' && Object.keys(result).length) {
    const text = Object.entries(result as Record<string, unknown>)
      .map(([k, v]) => `${SUMMARY_KEY_LABELS[k] || k}: ${v}`)
      .join(', ');
    return { text, tone: 'info' };
  }
  return null;
}

// Vietnamese labels for known summary-dict keys (currently only
// cf_master_discover's {discovered, zones} - see backend/app/cf_account_service.py).
// Falls back to the raw key for any other/future dict shape rather than
// erroring, since this is best-effort display text, not a strict contract.
export const SUMMARY_KEY_LABELS: Record<string, string> = {
  discovered: 'Account phát hiện',
  zones: 'Tổng zone',
};
