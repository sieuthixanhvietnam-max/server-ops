import { getDomainChangesHotspots } from '@/services/serverOps/api';
import { useEventTextColors } from '@/utils/domainChangeEvent';
import { PIC_UNASSIGNED } from '@/utils/picOptions';
import { Card, Col, DatePicker, Empty, Row, Select, Space, Spin, Table, theme } from 'antd';
import type { Dayjs } from 'dayjs';
import React, { useEffect, useState } from 'react';

const { RangePicker } = DatePicker;

// A plain factory (not a hook itself) so it can be called from inside the
// component with hook-resolved colors, instead of hardcoding hex at module
// scope where `theme.useToken()` isn't callable.
const churnValueColumns = (colors: Record<'added' | 'removed' | 'moved', string>) => [
  { title: 'Đã thêm', dataIndex: 'added', render: (v: number) => <span style={{ color: colors.added }}>{v}</span> },
  { title: 'Đã xoá', dataIndex: 'removed', render: (v: number) => <span style={{ color: colors.removed }}>{v}</span> },
  { title: 'Đã chuyển', dataIndex: 'moved', render: (v: number) => <span style={{ color: colors.moved }}>{v}</span> },
  {
    title: 'Tổng biến động',
    dataIndex: 'total',
    sorter: (a: { total: number }, b: { total: number }) => a.total - b.total,
    defaultSortOrder: 'descend' as const,
  },
];

/** "Phân tích" tab - who/what is churning the most, and which server pairs
 * show up most often in "moved" events. Aggregate rankings, not a
 * time-series, so it lives in its own tab/component next to Trend rather
 * than being stacked underneath the chart there. */
const DomainChangesHotspots: React.FC<{
  providerOptions: { label: string; value: string }[];
  profileOptions: { label: string; value: string }[];
}> = ({ providerOptions, profileOptions }) => {
  const { token } = theme.useToken();
  const eventTextColors = useEventTextColors();
  const [provider, setProvider] = useState<string>();
  const [profile, setProfile] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<API.DomainChangeHotspots>();

  useEffect(() => {
    setLoading(true);
    getDomainChangesHotspots({
      provider,
      profile,
      date_from: range?.[0] ? range[0].startOf('day').toISOString() : undefined,
      date_to: range?.[1] ? range[1].endOf('day').toISOString() : undefined,
    })
      .then(setData)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, profile, range]);

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
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
        <RangePicker value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
      </Space>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="Server biến động nhiều nhất" size="small">
              {data?.by_server.length ? (
                <Table<API.DomainChangeHotspotServer>
                  rowKey="server_name"
                  size="small"
                  pagination={false}
                  dataSource={data.by_server}
                  columns={[{ title: 'Server', dataIndex: 'server_name' }, ...churnValueColumns(eventTextColors)]}
                />
              ) : (
                <Empty description="Không có dữ liệu" />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="PIC biến động nhiều nhất" size="small">
              {data?.by_pic.length ? (
                <Table<API.DomainChangeHotspotPic>
                  rowKey="pic"
                  size="small"
                  pagination={false}
                  dataSource={data.by_pic}
                  columns={[
                    {
                      title: 'PIC',
                      dataIndex: 'pic',
                      render: (v: string) => (v === PIC_UNASSIGNED ? 'Chưa gán PIC' : v),
                    },
                    ...churnValueColumns(eventTextColors),
                  ]}
                />
              ) : (
                <Empty description="Không có dữ liệu" />
              )}
            </Card>
          </Col>
          <Col xs={24}>
            <Card
              title="Cặp server di chuyển nhiều nhất"
              size="small"
              extra={
                <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                  Chỉ tính sự kiện "Đã chuyển server"
                </span>
              }
            >
              {data?.server_pairs.length ? (
                <Table<API.DomainChangeServerPair>
                  rowKey={(r) => `${r.from_server_name}->${r.to_server_name}`}
                  size="small"
                  pagination={false}
                  dataSource={data.server_pairs}
                  columns={[
                    { title: 'Từ server', dataIndex: 'from_server_name' },
                    { title: 'Đến server', dataIndex: 'to_server_name' },
                    {
                      title: 'Số lần',
                      dataIndex: 'count',
                      sorter: (a, b) => a.count - b.count,
                      defaultSortOrder: 'descend',
                    },
                  ]}
                />
              ) : (
                <Empty description="Không có domain nào ghi nhận chuyển server trong khoảng này" />
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </>
  );
};

export default DomainChangesHotspots;
