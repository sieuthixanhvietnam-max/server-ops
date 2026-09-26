import KpiCard from '@/components/KpiCard';
import { getRedirectWeeklyReport } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BarChartOutlined,
  CloseOutlined,
  DownloadOutlined,
  SwapOutlined,
  TableOutlined,
  TeamOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import { App, Button, Card, Col, DatePicker, Empty, Input, Row, Select, Space, Table, Tag, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';

// Light, distinct backgrounds for rows that share a target URL with at
// least one other domain in the same cell - readable in both themes since
// only the background changes, never the text color.
const CLUSTER_PALETTE = [
  '#e6f4ff',
  '#f6ffed',
  '#fff7e6',
  '#fff0f6',
  '#f9f0ff',
  '#e6fffb',
  '#fcffe6',
  '#fff1f0',
];

// A fixed accent per PIC (hashed from the name, stable across reloads) - a
// small colored dot in the pivot table's PIC column so a row is recognizable
// at a glance while scanning many weeks, without needing a full legend.
const PIC_ACCENT_PALETTE = [
  '#1677ff',
  '#52c41a',
  '#fa8c16',
  '#eb2f96',
  '#722ed1',
  '#13c2c2',
  '#faad14',
  '#f5222d',
];

function picAccent(pic: string): string {
  let hash = 0;
  for (let i = 0; i < pic.length; i += 1) hash = (hash * 31 + pic.charCodeAt(i)) >>> 0;
  return PIC_ACCENT_PALETTE[hash % PIC_ACCENT_PALETTE.length];
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const { Text } = Typography;
const { RangePicker } = DatePicker;

/** Monday (Mon=start) of the week containing `d`, formatted YYYY-MM-DD -
 * matches the backend's Vietnam-local (UTC+7) Monday-Sunday week bucketing,
 * so client and server line up exactly without needing a dayjs ISO-week
 * plugin (relies only on dayjs' built-in .day(), 0=Sun..6=Sat). */
function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = d.day();
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return d.subtract(diffToMonday, 'day').startOf('day');
}

function weekLabel(weekStart: string): string {
  const start = dayjs(weekStart);
  return `${start.format('DD/MM')} - ${start.add(6, 'day').format('DD/MM')}`;
}

function weekStartsBetween(start: dayjs.Dayjs, end: dayjs.Dayjs): string[] {
  const out: string[] = [];
  let cur = mondayOf(start);
  const last = mondayOf(end);
  while (!cur.isAfter(last)) {
    out.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(7, 'day');
  }
  return out;
}

const UNKNOWN_PIC = '(không rõ)';

type CellKey = { pic: string; weekStart: string };
type Range = [dayjs.Dayjs, dayjs.Dayjs];

const RedirectReport: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [range, setRange] = useState<Range>(() => [mondayOf(dayjs()).subtract(7, 'week'), dayjs()]);
  const [picFilter, setPicFilter] = useState<string>();
  const [domainSearch, setDomainSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<API.RedirectWeeklyItem[]>([]);
  const [detailCell, setDetailCell] = useState<CellKey | null>(null);

  useEffect(() => {
    setLoading(true);
    getRedirectWeeklyReport({
      date_from: range[0].toISOString(),
      date_to: range[1].endOf('day').toISOString(),
    })
      .then((res) => setItems(res.data || []))
      .catch(() => message.error('Không tải được báo cáo'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range[0].valueOf(), range[1].valueOf()]);

  const pics = useMemo(() => Array.from(new Set(items.map((r) => r.pic || UNKNOWN_PIC))).sort(), [items]);

  // Applying the PIC/domain filters here so every downstream number (KPI
  // cards, chart, leaderboard, pivot table, export) reflects the same
  // filtered view - one filter pipeline, no risk of the chart and table
  // silently disagreeing.
  const filteredItems = useMemo(() => {
    const search = domainSearch.trim().toLowerCase();
    return items.filter(
      (r) => (!picFilter || r.pic === picFilter) && (!search || r.domain.toLowerCase().includes(search)),
    );
  }, [items, picFilter, domainSearch]);

  // 1 "lượt" per distinct (pic, week, domain, target_url) - collapses only
  // an EXACT repeat (same domain re-pointed to the same target again,
  // usually a redundant re-run/retry: confirmed on real data, 132 of 1958
  // repeat cases in 8 weeks were exact repeats), while still counting a
  // domain re-pointed to a genuinely DIFFERENT target as its own separate
  // lượt (the dominant case - 1826 of those 1958 - and real distinct work,
  // e.g. job #2866's domains later redirected elsewhere by other jobs).
  // Keeps the latest action's timestamp/job_id as the representative row
  // for each distinct pair, same convention as the earlier per-domain dedup.
  const dedupedActions = useMemo(() => {
    const map = new Map<string, API.RedirectWeeklyItem>();
    for (const item of filteredItems) {
      const key = `${item.pic}|${item.week_start}|${item.domain}|${item.target_url}`;
      const existing = map.get(key);
      if (!existing || item.redirected_at > existing.redirected_at) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }, [filteredItems]);

  const weekStarts = useMemo(() => weekStartsBetween(range[0], range[1]), [range]);
  const currentWeekStart = useMemo(() => mondayOf(dayjs()).format('YYYY-MM-DD'), []);

  const filteredPics = useMemo(
    () => Array.from(new Set(dedupedActions.map((r) => r.pic || UNKNOWN_PIC))).sort(),
    [dedupedActions],
  );

  const counts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const r of dedupedActions) {
      const pic = r.pic || UNKNOWN_PIC;
      out[pic] = out[pic] || {};
      out[pic][r.week_start] = (out[pic][r.week_start] || 0) + 1;
    }
    return out;
  }, [dedupedActions]);

  const weekTotal = (ws: string) => filteredPics.reduce((sum, pic) => sum + (counts[pic]?.[ws] || 0), 0);
  const picTotal = (pic: string) => weekStarts.reduce((sum, ws) => sum + (counts[pic]?.[ws] || 0), 0);

  // Scales the pivot table's cell shading - based on individual PIC/week
  // cells only (not the "Tổng" row/column), so one very busy week doesn't
  // wash out the shading for every other, smaller cell.
  const maxCellCount = useMemo(
    () => Math.max(1, ...filteredPics.flatMap((pic) => weekStarts.map((ws) => counts[pic]?.[ws] || 0))),
    [filteredPics, weekStarts, counts],
  );

  const lastWeek = weekStarts[weekStarts.length - 1];
  const prevWeek = weekStarts[weekStarts.length - 2];
  const lastWeekTotal = lastWeek ? weekTotal(lastWeek) : 0;
  const prevWeekTotal = prevWeek ? weekTotal(prevWeek) : 0;
  const delta = lastWeekTotal - prevWeekTotal;
  const deltaPct = prevWeekTotal ? Math.round((delta / prevWeekTotal) * 100) : null;

  const leaderboard = useMemo(() => {
    if (!lastWeek) return [];
    return filteredPics
      .map((pic) => ({ pic, count: counts[pic]?.[lastWeek] || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filteredPics, counts, lastWeek]);

  const chartData = useMemo(() => weekStarts.map((ws) => ({ label: weekLabel(ws), value: weekTotal(ws) })), [
    weekStarts,
    counts,
    filteredPics,
  ]);

  // Every distinct (domain, target_url) action for the selected cell -
  // includes a domain re-pointed to a genuinely different target that week
  // as a separate row, grouped so domains sharing the same target URL sit
  // next to each other (biggest cluster first) instead of plain
  // alphabetical order.
  const cellDetail = useMemo(() => {
    if (!detailCell) return [];
    const rows = dedupedActions.filter(
      (r) => (r.pic || UNKNOWN_PIC) === detailCell.pic && r.week_start === detailCell.weekStart,
    );
    const byUrl = new Map<string, API.RedirectWeeklyItem[]>();
    for (const r of rows) {
      const list = byUrl.get(r.target_url) || [];
      list.push(r);
      byUrl.set(r.target_url, list);
    }
    for (const list of byUrl.values()) {
      list.sort((a, b) => (a.domain < b.domain ? -1 : 1) || (a.redirected_at < b.redirected_at ? -1 : 1));
    }
    return Array.from(byUrl.entries())
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .flatMap(([, list]) => list);
  }, [dedupedActions, detailCell]);

  // Number of redirect actions ("lượt") per domain within the cell - flags
  // a domain that was touched more than once that week, which is exactly
  // the case that prompted this report to stop deduping (see job #2866).
  const domainLuotCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of cellDetail) out.set(r.domain, (out.get(r.domain) || 0) + 1);
    return out;
  }, [cellDetail]);

  // Distinct domains per target URL - a domain redirected twice to the same
  // target is still 1 domain "in the cluster", not 2, so this counts unique
  // domains, not raw action rows.
  const urlDomainCounts = useMemo(() => {
    const byUrl = new Map<string, Set<string>>();
    for (const r of cellDetail) {
      const set = byUrl.get(r.target_url) || new Set<string>();
      set.add(r.domain);
      byUrl.set(r.target_url, set);
    }
    const out = new Map<string, number>();
    for (const [url, set] of byUrl) out.set(url, set.size);
    return out;
  }, [cellDetail]);

  // Only target URLs shared by 2+ domains get a color - a domain with a
  // unique target isn't really a "cluster", coloring it would just be noise.
  const clusterColors = useMemo(() => {
    const colors = new Map<string, string>();
    let i = 0;
    for (const [url, count] of urlDomainCounts) {
      if (count > 1) {
        colors.set(url, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]);
        i += 1;
      }
    }
    return colors;
  }, [urlDomainCounts]);

  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailCell) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [detailCell]);

  const exportRows = (rows: API.RedirectWeeklyItem[]) =>
    rows.map((r) => [
      r.pic || UNKNOWN_PIC,
      weekLabel(r.week_start),
      r.domain,
      r.target_url,
      dayjs(r.redirected_at).format('YYYY-MM-DD HH:mm:ss'),
      r.job_id,
    ]);

  const exportAll = () => {
    if (!dedupedActions.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    exportToCsv(
      `redirect-301-theo-pic-${dayjs().format('YYYY-MM-DD')}.csv`,
      ['PIC', 'Tuần', 'Domain', 'Target URL', 'Thời điểm redirect', 'Job ID'],
      exportRows(dedupedActions),
    );
    message.success(`Đã xuất ${dedupedActions.length} dòng`);
  };

  const exportCell = () => {
    if (!cellDetail.length) return;
    exportToCsv(
      `redirect-301-${detailCell?.pic}-${detailCell?.weekStart}.csv`,
      ['PIC', 'Tuần', 'Domain', 'Target URL', 'Thời điểm redirect', 'Job ID'],
      exportRows(cellDetail),
    );
    message.success(`Đã xuất ${cellDetail.length} dòng`);
  };

  const columns = [
    {
      title: 'PIC',
      dataIndex: 'pic',
      fixed: 'left' as const,
      width: 170,
      render: (v: string, row: any) => {
        if (row.key === '__total__') return <Text strong>{v}</Text>;
        const active = picFilter === v;
        return (
          <Space
            size={8}
            style={{ cursor: 'pointer' }}
            onClick={() => setPicFilter(active ? undefined : v)}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: picAccent(v),
                flexShrink: 0,
              }}
            />
            <Text strong={active}>{v}</Text>
          </Space>
        );
      },
    },
    ...weekStarts.map((ws) => ({
      title:
        ws === currentWeekStart ? (
          <Space size={4}>
            {weekLabel(ws)}
            <Tag color="blue">Tuần này</Tag>
          </Space>
        ) : (
          weekLabel(ws)
        ),
      dataIndex: ws,
      align: 'center' as const,
      width: 140,
      onHeaderCell: () => (ws === currentWeekStart ? { style: { background: token.colorPrimaryBg } } : {}),
      onCell: (row: any) => {
        const count = row[ws] || 0;
        const style: React.CSSProperties = { cursor: count ? 'pointer' : 'default' };
        if (row.key !== '__total__' && count > 0) {
          style.background = hexToRgba(token.colorPrimary, (count / maxCellCount) * 0.32 + 0.04);
        } else if (ws === currentWeekStart) {
          style.background = token.colorPrimaryBg;
        }
        return {
          style,
          onClick: () => count && setDetailCell({ pic: row.pic, weekStart: ws }),
        };
      },
      render: (_: unknown, row: any) => {
        const count = row[ws] || 0;
        if (!count) return <Text type="secondary">–</Text>;
        return <Text strong={row.key === '__total__'}>{count.toLocaleString('vi-VN')}</Text>;
      },
    })),
    {
      title: 'Tổng cả kỳ',
      dataIndex: '__periodTotal__',
      fixed: 'right' as const,
      align: 'right' as const,
      width: 110,
      render: (_: unknown, row: any) => (
        <Text strong style={{ color: token.colorPrimary }}>
          {(row.__periodTotal__ as number).toLocaleString('vi-VN')}
        </Text>
      ),
    },
  ];

  const dataSource = useMemo(() => {
    const rows: Record<string, unknown>[] = filteredPics.map((pic) => ({
      key: pic,
      pic,
      ...counts[pic],
      __periodTotal__: picTotal(pic),
    }));
    if (filteredPics.length) {
      const weekCounts = weekStarts.reduce<Record<string, number>>((acc, ws) => {
        acc[ws] = weekTotal(ws);
        return acc;
      }, {});
      rows.push({
        key: '__total__',
        pic: 'Tổng',
        ...weekCounts,
        __periodTotal__: Object.values(weekCounts).reduce((a, b) => a + b, 0),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPics, counts, weekStarts]);

  const trendUp = delta > 0;
  const trendDown = delta < 0;

  return (
    <PageContainer title="Báo cáo Redirect 301 theo PIC">
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={12} md={6}>
          <KpiCard
            icon={<SwapOutlined />}
            label={`Lượt redirect · ${lastWeek ? weekLabel(lastWeek) : 'tuần gần nhất'}`}
            value={lastWeekTotal.toLocaleString('vi-VN')}
            color={token.colorPrimary}
            bg={token.colorPrimaryBg}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={trendDown ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
            label="So với tuần trước"
            value={deltaPct === null ? '—' : `${delta >= 0 ? '+' : ''}${deltaPct}%`}
            color={trendUp ? token.colorSuccess : trendDown ? token.colorError : token.colorTextTertiary}
            bg={trendUp ? token.colorSuccessBg : trendDown ? token.colorErrorBg : token.colorFillTertiary}
            caption={prevWeek ? `Tuần trước: ${prevWeekTotal.toLocaleString('vi-VN')} lượt` : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<TrophyOutlined />}
            label="PIC dẫn đầu tuần này"
            value={leaderboard[0]?.pic || '—'}
            color={token.colorWarning}
            bg={token.colorWarningBg}
            caption={leaderboard[0] ? `${leaderboard[0].count.toLocaleString('vi-VN')} lượt` : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<TeamOutlined />}
            label="PIC hoạt động tuần này"
            value={leaderboard.length}
            color={token.colorInfo}
            bg={token.colorInfoBg}
          />
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => {
              if (v && v[0] && v[1]) setRange([v[0], v[1]]);
            }}
          />
          <Select
            allowClear
            placeholder="Lọc PIC"
            style={{ width: 140 }}
            options={pics.map((p) => ({ label: p, value: p }))}
            value={picFilter}
            onChange={setPicFilter}
          />
          <Input
            allowClear
            placeholder="Tìm domain"
            style={{ width: 200 }}
            value={domainSearch}
            onChange={(e) => setDomainSearch(e.target.value)}
          />
          <Button icon={<DownloadOutlined />} onClick={exportAll}>
            Xuất toàn bộ
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={24} xl={16}>
          <Card
            title={
              <Space size={8}>
                <BarChartOutlined /> Xu hướng theo tuần
              </Space>
            }
            style={{ height: '100%' }}
          >
            {chartData.some((d) => d.value > 0) ? (
              <Column
                data={chartData}
                xField="label"
                yField="value"
                height={280}
                color={token.colorPrimary}
                axis={{ x: { labelAutoRotate: true } }}
              />
            ) : (
              <Empty description="Không có dữ liệu trong khoảng thời gian này" />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            title={
              <Space size={8}>
                <TrophyOutlined /> Xếp hạng PIC - tuần gần nhất
              </Space>
            }
            style={{ height: '100%' }}
          >
            <Table
              rowKey="pic"
              size="small"
              loading={loading}
              dataSource={leaderboard}
              pagination={false}
              locale={{ emptyText: 'Chưa có dữ liệu' }}
              columns={[
                { title: '#', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
                { title: 'PIC', dataIndex: 'pic' },
                {
                  title: 'Số lượt',
                  dataIndex: 'count',
                  align: 'right' as const,
                  sorter: (a: any, b: any) => a.count - b.count,
                  render: (v: number, _r: unknown, i: number) => (
                    <Text strong={i === 0} style={i === 0 ? { color: token.colorWarning } : undefined}>
                      {v.toLocaleString('vi-VN')}
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space size={8}>
            <TableOutlined /> Chi tiết theo PIC × tuần
          </Space>
        }
        style={{ marginBottom: detailCell ? 16 : 0 }}
      >
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          scroll={{ x: 'max-content' }}
          sticky
          onRow={(row: any) =>
            row.key === '__total__' ? { style: { background: token.colorFillAlter } } : {}
          }
        />
      </Card>

      {detailCell && (
        <div ref={detailRef}>
          <Card
            title={`${detailCell.pic} — ${weekLabel(detailCell.weekStart)} (${cellDetail.length} lượt)`}
            extra={
              <Space>
                <Button icon={<DownloadOutlined />} onClick={exportCell}>
                  Xuất CSV
                </Button>
                <Button icon={<CloseOutlined />} onClick={() => setDetailCell(null)} />
              </Space>
            }
          >
            <Table
              rowKey={(r) => `${r.domain}-${r.job_id}-${r.target_url}`}
              dataSource={cellDetail}
              pagination={false}
              size="small"
              onRow={(record) => {
                const color = clusterColors.get(record.target_url);
                return color ? { style: { background: color } } : {};
              }}
              columns={[
                {
                  title: 'Domain',
                  dataIndex: 'domain',
                  render: (v: string) => {
                    const luot = domainLuotCounts.get(v) || 0;
                    return (
                      <Space size={6}>
                        {v}
                        {luot > 1 && <Tag color="gold">{luot} lượt</Tag>}
                      </Space>
                    );
                  },
                },
                {
                  title: 'Target URL',
                  dataIndex: 'target_url',
                  render: (v: string) => {
                    const count = urlDomainCounts.get(v) || 0;
                    return (
                      <Space size={6}>
                        {v}
                        {count > 1 && <Tag color="default">{count} domain</Tag>}
                      </Space>
                    );
                  },
                },
                {
                  title: 'Thời điểm',
                  dataIndex: 'redirected_at',
                  render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                },
                { title: 'Job', dataIndex: 'job_id', render: (v: number) => `#${v}` },
              ]}
            />
          </Card>
        </div>
      )}
    </PageContainer>
  );
};

export default RedirectReport;
