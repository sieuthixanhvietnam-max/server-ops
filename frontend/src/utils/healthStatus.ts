/** Canonical Vietnamese labels for server health status codes - shared so
 * the same status code (e.g. "FAIL") reads the same regardless of which
 * page renders it (check-health's result table, Dashboard's summary). */
export const HEALTH_STATUS_LABELS: Record<string, string> = {
  OK: 'Bình thường',
  WARN: 'Cảnh báo',
  CRIT: 'Nghiêm trọng',
  FAIL: 'Không kết nối được',
  unknown: 'Chưa kiểm tra',
};

/** Tag-color-name variant (for `<Tag color=...>`) - Dashboard uses theme
 * tokens instead (Badge dot, not a Tag), so it keeps its own token-based
 * color function rather than sharing this one. */
export const HEALTH_STATUS_TAG_COLORS: Record<string, string> = {
  OK: 'green',
  WARN: 'gold',
  CRIT: 'red',
  FAIL: 'default',
};
