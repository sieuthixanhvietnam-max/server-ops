import { getRedirectWeeklyReport } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import { DownloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { App, Button, Modal, Select, Statistic, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useState } from 'react';

const { Text } = Typography;

/** Monday (Mon=start) of the week containing `d`, formatted YYYY-MM-DD -
 * same convention the backend uses (Python's weekday(), Monday=0), so week
 * buckets line up exactly between client and server without needing a
 * dayjs ISO-week plugin. */
function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = d.day(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return d.subtract(diffToMonday, 'day').startOf('day');
}

function weekLabel(weekStart: string): string {
  const start = dayjs(weekStart);
  return `${start.format('DD/MM')} - ${start.add(6, 'day').format('DD/MM')}`;
}

type CellKey = { pic: string; weekStart: string };

const RedirectReport: React.FC = () => {
  const { message } = App.useApp();
  const [weeks, setWeeks] = useState(8);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<API.RedirectWeeklyItem[]>([]);
  const [detailCell, setDetailCell] = useState<CellKey | null>(null);

  useEffect(() => {
    setLoading(true);
    getRedirectWeeklyReport({ weeks })
      .then((res) => setItems(res.data || []))
      .catch(() => message.error('Không tải được báo cáo'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks]);

  // Dedup to 1 row per (pic, week_start, domain) - a domain redirected
  // more than once in the same week counts once, keeping the latest action
  // (highest redirected_at) as the representative row for that domain.
  const deduped = useMemo(() => {
    const map = new Map<string, API.RedirectWeeklyItem>();
    for (const item of items) {
      const key = `${item.pic}|${item.week_start}|${item.domain}`;
      const existing = map.get(key);
      if (!existing || item.redirected_at > existing.redirected_at) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }, [items]);

  const weekStarts = useMemo(() => {
    const thisMonday = mondayOf(dayjs());
    const out: string[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      out.push(thisMonday.subtract(i * 7, 'day').format('YYYY-MM-DD'));
    }
    return out;
  }, [weeks]);

  const pics = useMemo(
    () => Array.from(new Set(deduped.map((r) => r.pic || '(không rõ)'))).sort(),
    [deduped],
  );

  // counts[pic][weekStart] = số domain distinct
  const counts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const r of deduped) {
      const pic = r.pic || '(không rõ)';
      out[pic] = out[pic] || {};
      out[pic][r.week_start] = (out[pic][r.week_start] || 0) + 1;
    }
    return out;
  }, [deduped]);

  const currentWeekTotal = useMemo(() => {
    const lastWeek = weekStarts[weekStarts.length - 1];
    return deduped.filter((r) => r.week_start === lastWeek).length;
  }, [deduped, weekStarts]);

  const cellDetail = useMemo(() => {
    if (!detailCell) return [];
    return deduped
      .filter((r) => (r.pic || '(không rõ)') === detailCell.pic && r.week_start === detailCell.weekStart)
      .sort((a, b) => (a.domain < b.domain ? -1 : 1));
  }, [deduped, detailCell]);

  const exportRows = (rows: API.RedirectWeeklyItem[]) =>
    rows.map((r) => [
      r.pic || '(không rõ)',
      weekLabel(r.week_start),
      r.domain,
      r.target_url,
      dayjs(r.redirected_at).format('YYYY-MM-DD HH:mm:ss'),
      r.job_id,
    ]);

  const exportAll = () => {
    if (!deduped.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    exportToCsv(
      `redirect-301-theo-pic-${dayjs().format('YYYY-MM-DD')}.csv`,
      ['PIC', 'Tuần', 'Domain', 'Target URL', 'Thời điểm redirect', 'Job ID'],
      exportRows(deduped),
    );
    message.success(`Đã xuất ${deduped.length} dòng`);
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
      title: weekLabel(ws),
      dataIndex: ws,
      align: 'center' as const,
      width: 110,
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

  const dataSource = [
    ...pics.map((pic) => ({ key: pic, pic, ...counts[pic] })),
    {
      key: '__total__',
      pic: 'Tổng',
      ...weekStarts.reduce<Record<string, number>>((acc, ws) => {
        acc[ws] = pics.reduce((sum, pic) => sum + (counts[pic]?.[ws] || 0), 0);
        return acc;
      }, {}),
    },
  ];

  return (
    <PageContainer title="Báo cáo Redirect 301 theo PIC">
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, alignItems: 'center' }}>
        <Statistic title="Tuần này" value={currentWeekTotal} suffix="domain" />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Text>Số tuần:</Text>
          <Select
            value={weeks}
            style={{ width: 100 }}
            options={[4, 8, 12, 26].map((n) => ({ value: n, label: `${n} tuần` }))}
            onChange={setWeeks}
          />
          <Button icon={<DownloadOutlined />} onClick={exportAll}>
            Xuất toàn bộ
          </Button>
        </div>
      </div>

      <Table
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowClassName={(row) => (row.key === '__total__' ? 'redirect-report-total-row' : '')}
      />

      <Modal
        title={detailCell ? `${detailCell.pic} — ${weekLabel(detailCell.weekStart)}` : ''}
        open={!!detailCell}
        onCancel={() => setDetailCell(null)}
        footer={
          <Button icon={<DownloadOutlined />} onClick={exportCell}>
            Xuất CSV
          </Button>
        }
        width={720}
        destroyOnHidden
      >
        <Table
          rowKey={(r) => `${r.domain}-${r.job_id}`}
          dataSource={cellDetail}
          pagination={false}
          size="small"
          columns={[
            { title: 'Domain', dataIndex: 'domain' },
            { title: 'Target URL', dataIndex: 'target_url' },
            {
              title: 'Thời điểm',
              dataIndex: 'redirected_at',
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            { title: 'Job', dataIndex: 'job_id', render: (v: number) => `#${v}` },
          ]}
        />
      </Modal>
    </PageContainer>
  );
};

export default RedirectReport;
