import dayjs from 'dayjs';

/** Canonical timestamp format used across the app (table cells, detail
 * panels, tooltips) - `YYYY-MM-DD HH:mm:ss`, the format the large majority
 * of pages already used before this was extracted; a couple of outliers
 * (Dashboard's exact-time tooltip, SiteCredentialCell) previously showed
 * the same kind of "last updated" timestamp in a different order
 * (`DD/MM/YYYY HH:mm[:ss]`) - now unified through this helper. */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

export const formatDateTime = (v?: string | null) => (v ? dayjs(v).format(DATETIME_FORMAT) : '-');
