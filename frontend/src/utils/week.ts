import dayjs from 'dayjs';

/** Monday (Mon=start) of the week containing `d`, formatted YYYY-MM-DD -
 * matches the backend's Vietnam-local (UTC+7) Monday-Sunday week bucketing
 * used by every weekly report, so client and server line up exactly
 * without needing a dayjs ISO-week plugin (relies only on dayjs' built-in
 * .day(), 0=Sun..6=Sat). */
export function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = d.day();
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return d.subtract(diffToMonday, 'day').startOf('day');
}

export function weekLabel(weekStart: string): string {
  const start = dayjs(weekStart);
  return `${start.format('DD/MM')} - ${start.add(6, 'day').format('DD/MM')}`;
}

export function weekStartsBetween(start: dayjs.Dayjs, end: dayjs.Dayjs): string[] {
  const out: string[] = [];
  let cur = mondayOf(start);
  const last = mondayOf(end);
  while (!cur.isAfter(last)) {
    out.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(7, 'day');
  }
  return out;
}
