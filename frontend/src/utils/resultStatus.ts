/** Tag color for the common OK/DRYRUN/FAIL(/SKIP) result status shape used
 * by most per-domain job-result tables (restore, maintenance, force-index,
 * etc.) - shared so the same status code always gets the same color, while
 * each page still keeps its own label wording (the verb differs per action,
 * e.g. "Đã restore" vs "Đã gửi"). */
export const RESULT_STATUS_COLORS: Record<string, string> = {
  OK: 'green',
  PARTIAL: 'orange',
  ROLLBACK: 'gold',
  ROLLBACK_FAILED: 'red',
  DRYRUN: 'blue',
  FAIL: 'red',
  SKIP: 'default',
};
