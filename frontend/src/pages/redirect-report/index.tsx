import { getRedirectWeeklyReport } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import { CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import {
  App,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
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
  //
  // Every successful redirect action counts, including a domain redirected
  // more than once in the same week (each run is a separate "lượt") - a
  // deliberate choice after a real case (job #2866) where collapsing to
  // "latest action per domain" made a job look like it only touched 4
  // domains when it actually processed way more; some were just redirected
  // again later by a different job. Counting every action avoids that kind
  // of confusion, at the cost of the total no longer being "distinct
  // domains touched" - it's "redirect actions performed".
  const filteredItems = useMemo(() => {
    const search = domainSearch.trim().toLowerCase();
    return items.filter(
      (r) => (!picFilter || r.pic === picFilter) && (!search || r.domain.toLowerCase().includes(search)),
    );
  }, [items, picFilter, domainSearch]);

  const weekStarts = useMemo(() => weekStartsBetween(range[0], range[1]), [range]);
  const currentWeekStart = useMemo(() => mondayOf(dayjs()).format('YYYY-MM-DD'), []);

  const filteredPics = useMemo(
    () => Array.from(new Set(filteredItems.map((r) => r.pic || UNKNOWN_PIC))).sort(),
    [filteredItems],
  );

  const counts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const r of filteredItems) {
      const pic = r.pic || UNKNOWN_PIC;
      out[pic] = out[pic] || {};
      out[pic][r.week_start] = (out[pic][r.week_start] || 0) + 1;
    }
    return out;
  }, [filteredItems]);

  const weekTotal = (ws: string) => filteredPics.reduce((sum, pic) => sum + (counts[pic]?.[ws] || 0), 0);

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

  // Every redirect action for the selected cell (no dedup - includes a
  // domain redirected more than once that week as separate rows), grouped
  // so domains sharing the same target URL sit next to each other (biggest
  // cluster first) instead of plain alphabetical order.
  const cellDetail = useMemo(() => {
    if (!detailCell) return [];
    const rows = filteredItems.filter(
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
  }, [filteredItems, detailCell]);

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
    if (!filteredItems.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    exportToCsv(
      `redirect-301-theo-pic-${dayjs().format('YYYY-MM-DD')}.csv`,
      ['PIC', 'Tuần', 'Domain', 'Target URL', 'Thời điểm redirect', 'Job ID'],
      exportRows(filteredItems),
    );
    message.success(`Đã xuất ${filteredItems.length} dòng`);
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
      width: 160,
      render: (v: string) => <Text strong>{v}</Text>,
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
      onHeaderCell: () => (ws === currentWeekStart ? { style: { background: 'rgba(22,119,255,0.06)' } } : {}),
      onCell: () => (ws === currentWeekStart ? { style: { background: 'rgba(22,119,255,0.04)' } } : {}),
      render: (_: unknown, row: any) => {
        const count = row[ws] || 0;
        if (!count) return <Text type="secondary">0</Text>;
        return (
          <Button type="link" onClick={() => setDetailCell({ pic: row.pic, weekStart: ws })}>
            {count}
          </Button>
        );
      },
    })),
  ];

  const dataSource = useMemo(() => {
    const rows: Record<string, unknown>[] = filteredPics.map((pic) => ({ key: pic, pic, ...counts[pic] }));
    if (filteredPics.length) {
      rows.push({
        key: '__total__',
        pic: 'Tổng',
        ...weekStarts.reduce<Record<string, number>>((acc, ws) => {
          acc[ws] = weekTotal(ws);
          return acc;
        }, {}),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPics, counts, weekStarts]);

  return (
    <PageContainer title="Báo cáo Redirect 301 theo PIC">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card size="small">
          <Statistic title="Tuần gần nhất" value={lastWeekTotal} suffix="lượt" />
        </Card>
        <Card size="small">
          <Statistic
            title="So với tuần trước"
            value={deltaPct === null ? '—' : `${delta >= 0 ? '+' : ''}${deltaPct}%`}
            valueStyle={{ color: delta > 0 ? '#3f8600' : delta < 0 ? '#cf1322' : undefined }}
            prefix={delta > 0 ? '▲' : delta < 0 ? '▼' : undefined}
          />
        </Card>
        <Card size="small">
          <Statistic title="PIC dẫn đầu tuần này" value={leaderboard[0] ? `${leaderboard[0].pic} (${leaderboard[0].count})` : '—'} />
        </Card>
      </div>

      <Card
        title="Xu hướng theo tuần"
        extra={
          <Space wrap>
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
        }
        style={{ marginBottom: 16 }}
      >
        {chartData.some((d) => d.value > 0) ? (
          <Column data={chartData} xField="label" yField="value" height={280} axis={{ x: { labelAutoRotate: true } }} />
        ) : (
          <Empty description="Không có dữ liệu trong khoảng thời gian này" />
        )}
      </Card>

      <Card title="Xếp hạng PIC - tuần gần nhất" style={{ marginBottom: 16 }}>
        <Table
          rowKey="pic"
          size="small"
          loading={loading}
          dataSource={leaderboard}
          pagination={false}
          locale={{ emptyText: 'Chưa có dữ liệu' }}
          columns={[
            { title: '#', render: (_: unknown, __: unknown, i: number) => i + 1, width: 50 },
            { title: 'PIC', dataIndex: 'pic' },
            { title: 'Số lượt', dataIndex: 'count', sorter: (a: any, b: any) => a.count - b.count },
          ]}
        />
      </Card>

      <Card title="Chi tiết theo PIC × tuần" style={{ marginBottom: detailCell ? 16 : 0 }}>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowClassName={(row: any) => (row.key === '__total__' ? 'redirect-report-total-row' : '')}
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
              rowKey={(r) => `${r.domain}-${r.job_id}`}
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
