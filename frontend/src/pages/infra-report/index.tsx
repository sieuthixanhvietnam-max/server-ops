import KpiCard from '@/components/KpiCard';
import { getInfraWeeklyReport } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import { mondayOf, weekLabel, weekStartsBetween } from '@/utils/week';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  GlobalOutlined,
  LineChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Column, Line } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import { App, Button, Card, Col, DatePicker, Empty, Row, Select, Space, Table, Tabs, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useState } from 'react';

const { Text } = Typography;
const { RangePicker } = DatePicker;

// GCP/Alibaba brand-adjacent colors - fixed hex rather than theme tokens so
// the two providers stay visually distinct regardless of light/dark theme
// (this is a categorical distinction, not a semantic status color).
const PROVIDER_COLOR: Record<string, string> = { GCP: '#4285F4', Ali: '#FF6A00' };
const PROVIDER_LABEL: Record<string, string> = { GCP: 'Google Cloud', Ali: 'Alibaba' };
const PROVIDERS = ['GCP', 'Ali'];

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('vi-VN');
}

type Range = [dayjs.Dayjs, dayjs.Dayjs];

const InfraReport: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [range, setRange] = useState<Range>(() => [mondayOf(dayjs()).subtract(7, 'week'), dayjs()]);
  const [providerFilter, setProviderFilter] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<API.InfraWeeklyItem[]>([]);

  useEffect(() => {
    setLoading(true);
    const weeks = Math.max(1, dayjs().diff(range[0], 'week') + 1);
    getInfraWeeklyReport({ weeks })
      .then((res) => setItems(res.data || []))
      .catch(() => message.error('Không tải được báo cáo'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range[0].valueOf()]);

  const weekStarts = useMemo(() => weekStartsBetween(range[0], range[1]), [range]);
  const currentWeekStart = useMemo(() => mondayOf(dayjs()).format('YYYY-MM-DD'), []);

  const providers = providerFilter ? [providerFilter] : PROVIDERS;

  // week_start -> provider -> row, restricted to the selected range/providers.
  const byWeekProvider = useMemo(() => {
    const out: Record<string, Record<string, API.InfraWeeklyItem>> = {};
    for (const r of items) {
      if (!weekStarts.includes(r.week_start)) continue;
      out[r.week_start] = out[r.week_start] || {};
      out[r.week_start][r.provider] = r;
    }
    return out;
  }, [items, weekStarts]);

  // Latest week that actually has a server_count for a given provider - the
  // "hiện tại" KPI numbers use this rather than blindly reading the last
  // week in range, since a freshly-picked range can end on a week that
  // hasn't been captured yet (or, for historic ranges, forecast into a
  // future partial week).
  const latestKnown = (provider: string): API.InfraWeeklyItem | undefined => {
    for (let i = weekStarts.length - 1; i >= 0; i -= 1) {
      const row = byWeekProvider[weekStarts[i]]?.[provider];
      if (row && row.server_count !== null) return row;
    }
    return undefined;
  };

  const currentServerTotal = providers.reduce((sum, p) => sum + (latestKnown(p)?.server_count || 0), 0);
  const currentDomainTotal = providers.reduce((sum, p) => sum + (latestKnown(p)?.domain_count || 0), 0);
  const serverCaption = providers.map((p) => `${PROVIDER_LABEL[p]}: ${fmt(latestKnown(p)?.server_count)}`).join(' · ');
  const domainCaption = providers.map((p) => `${PROVIDER_LABEL[p]}: ${fmt(latestKnown(p)?.domain_count)}`).join(' · ');

  const removedTotal = (ws: string) =>
    providers.reduce((sum, p) => sum + (byWeekProvider[ws]?.[p]?.domains_removed || 0), 0);

  const lastWeek = weekStarts[weekStarts.length - 1];
  const prevWeek = weekStarts[weekStarts.length - 2];
  const lastWeekRemoved = lastWeek ? removedTotal(lastWeek) : 0;
  const prevWeekRemoved = prevWeek ? removedTotal(prevWeek) : 0;
  const removedDelta = lastWeekRemoved - prevWeekRemoved;
  const removedDeltaPct = prevWeekRemoved ? Math.round((removedDelta / prevWeekRemoved) * 100) : null;
  const trendUp = removedDelta > 0;
  const trendDown = removedDelta < 0;

  const domainTrendData = useMemo(
    () =>
      weekStarts.flatMap((ws) =>
        providers
          .filter((p) => byWeekProvider[ws]?.[p]?.domain_count !== undefined && byWeekProvider[ws]?.[p]?.domain_count !== null)
          .map((p) => ({
            label: weekLabel(ws),
            value: byWeekProvider[ws][p].domain_count as number,
            provider: PROVIDER_LABEL[p],
          })),
      ),
    [weekStarts, providers, byWeekProvider],
  );

  const removedChartData = useMemo(
    () =>
      weekStarts.flatMap((ws) =>
        providers.map((p) => ({
          label: weekLabel(ws),
          value: byWeekProvider[ws]?.[p]?.domains_removed || 0,
          provider: PROVIDER_LABEL[p],
        })),
      ),
    [weekStarts, providers, byWeekProvider],
  );

  const exportAll = () => {
    const rows = weekStarts.flatMap((ws) =>
      providers.map((p) => {
        const r = byWeekProvider[ws]?.[p];
        return [
          PROVIDER_LABEL[p],
          weekLabel(ws),
          r?.server_count ?? '',
          r?.domain_count ?? '',
          r?.domains_removed ?? 0,
        ];
      }),
    );
    if (!rows.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    exportToCsv(
      `ha-tang-gcp-alibaba-${dayjs().format('YYYY-MM-DD')}.csv`,
      ['Nhà cung cấp', 'Tuần', 'Số server', 'Số domain', 'Domain đã xóa'],
      rows,
    );
    message.success(`Đã xuất ${rows.length} dòng`);
  };

  const pivotColumns = (metric: 'server_count' | 'domain_count' | 'domains_removed') => [
    {
      title: 'Nhà cung cấp',
      dataIndex: 'provider',
      fixed: 'left' as const,
      width: 150,
      render: (p: string) => (
        <Space size={8}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PROVIDER_COLOR[p], flexShrink: 0 }} />
          <Text>{PROVIDER_LABEL[p]}</Text>
        </Space>
      ),
    },
    ...weekStarts.map((ws) => ({
      title:
        ws === currentWeekStart ? (
          <Text strong style={{ color: token.colorPrimary, whiteSpace: 'nowrap' as const }}>
            {weekLabel(ws)}
          </Text>
        ) : (
          weekLabel(ws)
        ),
      dataIndex: ws,
      align: 'center' as const,
      width: 108,
      onHeaderCell: () => ({
        style: {
          whiteSpace: 'nowrap' as const,
          ...(ws === currentWeekStart ? { background: token.colorPrimaryBg } : {}),
        },
      }),
      render: (_: unknown, row: any) => {
        const r = byWeekProvider[ws]?.[row.provider];
        const v = r?.[metric];
        if (v === undefined || v === null) return <Text type="secondary">—</Text>;
        return <Text>{fmt(v)}</Text>;
      },
    })),
  ];

  return (
    <PageContainer title="Báo cáo hạ tầng GCP / Alibaba">
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={12} md={6}>
          <KpiCard
            icon={<CloudServerOutlined />}
            label="Server đang chạy"
            value={fmt(currentServerTotal)}
            color={token.colorPrimary}
            bg={token.colorPrimaryBg}
            caption={serverCaption}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<GlobalOutlined />}
            label="Domain đang chạy"
            value={fmt(currentDomainTotal)}
            color={token.colorInfo}
            bg={token.colorInfoBg}
            caption={domainCaption}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<DeleteOutlined />}
            label={`Domain đã xóa · ${lastWeek ? weekLabel(lastWeek) : 'tuần gần nhất'}`}
            value={fmt(lastWeekRemoved)}
            color={token.colorWarning}
            bg={token.colorWarningBg}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={trendDown ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
            label="So với tuần trước"
            value={removedDeltaPct === null ? '—' : `${removedDelta >= 0 ? '+' : ''}${removedDeltaPct}%`}
            color={trendUp ? token.colorError : trendDown ? token.colorSuccess : token.colorTextTertiary}
            bg={trendUp ? token.colorErrorBg : trendDown ? token.colorSuccessBg : token.colorFillTertiary}
            caption={prevWeek ? `Tuần trước: ${fmt(prevWeekRemoved)} domain` : undefined}
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
            placeholder="Lọc nhà cung cấp"
            style={{ width: 170 }}
            options={PROVIDERS.map((p) => ({ label: PROVIDER_LABEL[p], value: p }))}
            value={providerFilter}
            onChange={setProviderFilter}
          />
          <Button icon={<DownloadOutlined />} onClick={exportAll}>
            Xuất toàn bộ
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={24} xl={12}>
          <Card
            title={
              <Space size={8}>
                <LineChartOutlined /> Domain đang chạy theo tuần
              </Space>
            }
            style={{ height: '100%' }}
          >
            {domainTrendData.length ? (
              <Line
                data={domainTrendData}
                xField="label"
                yField="value"
                colorField="provider"
                height={280}
                color={providers.map((p) => PROVIDER_COLOR[p])}
                axis={{ x: { labelAutoRotate: true } }}
                point={{ shape: 'circle', size: 3 }}
              />
            ) : (
              <Empty description="Chưa có dữ liệu trong khoảng thời gian này" />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            title={
              <Space size={8}>
                <DeleteOutlined /> Domain đã xóa theo tuần
              </Space>
            }
            style={{ height: '100%' }}
          >
            {removedChartData.some((d) => d.value > 0) ? (
              <Column
                data={removedChartData}
                xField="label"
                yField="value"
                colorField="provider"
                height={280}
                color={providers.map((p) => PROVIDER_COLOR[p])}
                group={true}
                axis={{ x: { labelAutoRotate: true } }}
              />
            ) : (
              <Empty description="Không có domain nào bị xóa trong khoảng thời gian này" />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space size={8}>
            <TableOutlined /> Chi tiết theo nhà cung cấp × tuần
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'domain',
              label: 'Domain đang chạy',
              children: (
                <Table
                  rowKey="provider"
                  size="small"
                  loading={loading}
                  columns={pivotColumns('domain_count')}
                  dataSource={providers.map((p) => ({ provider: p }))}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              ),
            },
            {
              key: 'server',
              label: 'Server đang chạy',
              children: (
                <Table
                  rowKey="provider"
                  size="small"
                  loading={loading}
                  columns={pivotColumns('server_count')}
                  dataSource={providers.map((p) => ({ provider: p }))}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              ),
            },
            {
              key: 'removed',
              label: 'Domain đã xóa',
              children: (
                <Table
                  rowKey="provider"
                  size="small"
                  loading={loading}
                  columns={pivotColumns('domains_removed')}
                  dataSource={providers.map((p) => ({ provider: p }))}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              ),
            },
          ]}
        />
      </Card>
    </PageContainer>
  );
};

export default InfraReport;
