import { theme } from 'antd';

/** Domain-change event type (added/removed/moved) - shared label + color so
 * "added" reads the same everywhere it's shown: the history table's Tag,
 * the summary Statistics, the trend chart, and the hotspots rankings.
 * `EVENT_TAG_COLORS` are antd preset color names (for `<Tag color=...>`) -
 * those already adapt to dark mode on their own. Inline text/chart colors
 * need real color values instead (a preset name isn't valid CSS), so
 * `useEventTextColors` sources those from the current theme's tokens rather
 * than hardcoding hex - hardcoded hex wouldn't adapt when the user switches
 * to dark mode. */
export const EVENT_LABELS: Record<string, string> = {
  added: 'Đã thêm',
  removed: 'Đã xoá',
  moved: 'Đã chuyển server',
};

export const EVENT_TAG_COLORS: Record<string, string> = {
  added: 'green',
  removed: 'red',
  moved: 'blue',
};

export function useEventTextColors(): Record<'added' | 'removed' | 'moved', string> {
  const { token } = theme.useToken();
  return {
    added: token.colorSuccess,
    removed: token.colorError,
    moved: token.colorInfo,
  };
}
