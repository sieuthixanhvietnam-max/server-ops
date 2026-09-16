import { getDomainChangesTimeseries } from '@/services/serverOps/api';
import { EVENT_LABELS, useEventTextColors } from '@/utils/domainChangeEvent';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { Column } from '@ant-design/plots';
import { Card, Empty, Segmented, Select, Space, Spin, Table } from 'antd';
import React, { useEffect, useState } from 'react';

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

const GRANULARITY_OPTIONS: { label: string; value: Granularity }[] = [
  { label: 'Ngày', value: 'day' },
  { label: '7 ngày', value: 'week' },
  { label: 'Tháng', value: 'month' },
  { label: 'Quý', value: 'quarter' },
  { label: 'Năm', value: 'year' },
];

const DomainChangesTrend: React.FC<{
  // Optional - the Dashboard embeds this widget without filter option lists
  // (it's a quick-glance overview, not the full filterable view), so the
  // filter row just renders with no choices rather than requiring callers
  // to fetch options they don't otherwise need.
  providerOptions?: { label: string; value: string }[];
  profileOptions?: { label: string; value: string }[];
  picOptions?: { label: string; value: string }[];
}> = ({ providerOptions = [], profileOptions = [], picOptions = [] }) => {
  const EVENT_TEXT_COLORS = useEventTextColors();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [provider, setProvider] = useState<string>();
  const [profile, setProfile] = useState<string>();
  const [pic, setPic] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<API.DomainChangeTimeseriesPoint[]>([]);

  useEffect(() => {
    setLoading(true);
    getDomainChangesTimeseries({ granularity, provider, profile, pic })
      .then((res) => setPoints(res.data || []))
      .finally(() => setLoading(false));
  }, [granularity, provider, profile, pic]);

  const chartData = points.flatMap((p) => [
    { label: p.label, type: EVENT_LABELS.added, value: p.added },
    { label: p.label, type: EVENT_LABELS.removed, value: p.removed },
    { label: p.label, type: EVENT_LABELS.moved, value: p.moved },
  ]);

  return (
    <>
      <Card
        title="Xu hướng thay đổi domain"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="Provider"
              style={{ width: 120 }}
              options={providerOptions}
              value={provider}
              onChange={setProvider}
            />
            <Select
              allowClear
              placeholder="Profile"
              style={{ width: 160 }}
              options={profileOptions}
              value={profile}
              onChange={setProfile}
            />
            <Select
              allowClear
              placeholder="PIC"
              style={{ width: 140 }}
              options={picOptions}
              value={pic}
              onChange={setPic}
            />
            <Segmented
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={(v) => setGranularity(v as Granularity)}
            />
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Spin spinning={loading}>
          {points.length ? (
            <Column
              data={chartData}
              xField="label"
              yField="value"
              colorField="type"
              group
              height={320}
              scale={{
                color: {
                  domain: [EVENT_LABELS.added, EVENT_LABELS.removed, EVENT_LABELS.moved],
                  range: [EVENT_TEXT_COLORS.added, EVENT_TEXT_COLORS.removed, EVENT_TEXT_COLORS.moved],
                },
              }}
              legend={{ color: { position: 'top' } }}
              axis={{ x: { labelAutoRotate: true } }}
            />
          ) : (
            <Empty description="Không có dữ liệu trong khoảng thời gian này" />
          )}
        </Spin>
      </Card>

      <Card title="Số liệu chi tiết theo kỳ">
        <Table<API.DomainChangeTimeseriesPoint>
          size="small"
          rowKey="period"
          loading={loading}
          dataSource={[...points].reverse()}
          pagination={DEFAULT_PAGINATION}
          columns={[
            { title: 'Kỳ', dataIndex: 'label' },
            {
              title: 'Đã thêm',
              dataIndex: 'added',
              sorter: (a, b) => a.added - b.added,
              render: (v) => <span style={{ color: EVENT_TEXT_COLORS.added }}>{v}</span>,
            },
            {
              title: 'Đã xoá',
              dataIndex: 'removed',
              sorter: (a, b) => a.removed - b.removed,
              render: (v) => <span style={{ color: EVENT_TEXT_COLORS.removed }}>{v}</span>,
            },
            {
              title: 'Đã chuyển server',
              dataIndex: 'moved',
              sorter: (a, b) => a.moved - b.moved,
              render: (v) => <span style={{ color: EVENT_TEXT_COLORS.moved }}>{v}</span>,
            },
            {
              title: 'Thay đổi ròng',
              dataIndex: 'net',
              sorter: (a, b) => a.net - b.net,
              render: (v) => (
                <span style={{ color: v > 0 ? EVENT_TEXT_COLORS.added : v < 0 ? EVENT_TEXT_COLORS.removed : undefined }}>
                  {v > 0 ? `+${v}` : v}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
};

export default DomainChangesTrend;
