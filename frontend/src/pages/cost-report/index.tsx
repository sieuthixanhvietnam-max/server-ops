import KpiCard from '@/components/KpiCard';
import { deleteCost, getCostAccounts, getCosts, upsertCost } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BarChartOutlined,
  DollarOutlined,
  DownloadOutlined,
  EditOutlined,
  TableOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Space,
  Table,
  theme,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useState } from 'react';

const { Text } = Typography;

// Stable per-account color for the stacked chart - fixed hex, not a theme
// token, since these are categorical (which account) not semantic.
const ACCOUNT_COLORS = ['#1677ff', '#fa8c16', '#52c41a', '#eb2f96', '#722ed1', '#13c2c2'];

function monthsBetween(start: dayjs.Dayjs, end: dayjs.Dayjs): string[] {
  const out: string[] = [];
  let cur = start.startOf('month');
  const last = end.startOf('month');
  while (!cur.isAfter(last)) {
    out.push(cur.format('YYYY-MM'));
    cur = cur.add(1, 'month');
  }
  return out;
}

function monthLabel(m: string): string {
  return dayjs(`${m}-01`).format('MM/YYYY');
}

function fmtVnd(n: number | undefined): string {
  return n ? `${n.toLocaleString('vi-VN')} đ` : '—';
}

type EditTarget = { accountLabel: string; month: string } | null;

const CostReport: React.FC = () => {
  const access = useAccess();

  if (!access.canAdmin) {
    return (
      <PageContainer title="Báo cáo chi phí hàng tháng">
        <Result status="403" title="Không có quyền truy cập" subTitle="Chỉ admin mới xem được trang này." />
      </PageContainer>
    );
  }

  return <CostReportBody />;
};

const CostReportBody: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [monthRange, setMonthRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => [
    dayjs().subtract(5, 'month'),
    dayjs(),
  ]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [rows, setRows] = useState<API.ProviderCostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const months = useMemo(() => monthsBetween(monthRange[0], monthRange[1]), [monthRange]);
  const currentMonth = dayjs().format('YYYY-MM');

  useEffect(() => {
    getCostAccounts()
      .then((res) => setAccounts(res.data || []))
      .catch(() => message.error('Không tải được danh sách tài khoản'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = () => {
    setLoading(true);
    getCosts({ month_from: months[0], month_to: months[months.length - 1] })
      .then((res) => setRows(res.data || []))
      .catch(() => message.error('Không tải được báo cáo chi phí'))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [months.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const byAccountMonth = useMemo(() => {
    const out: Record<string, Record<string, API.ProviderCostItem>> = {};
    for (const r of rows) {
      out[r.account_label] = out[r.account_label] || {};
      out[r.account_label][r.month] = r;
    }
    return out;
  }, [rows]);

  const monthTotal = (m: string) => accounts.reduce((sum, a) => sum + (byAccountMonth[a]?.[m]?.amount_vnd || 0), 0);
  const accountTotal = (a: string) => months.reduce((sum, m) => sum + (byAccountMonth[a]?.[m]?.amount_vnd || 0), 0);

  const lastMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const lastMonthTotal = lastMonth ? monthTotal(lastMonth) : 0;
  const prevMonthTotal = prevMonth ? monthTotal(prevMonth) : 0;
  const delta = lastMonthTotal - prevMonthTotal;
  const deltaPct = prevMonthTotal ? Math.round((delta / prevMonthTotal) * 100) : null;
  const trendUp = delta > 0;
  const trendDown = delta < 0;

  const leaderboard = useMemo(() => {
    if (!lastMonth) return [];
    return accounts
      .map((a) => ({ account: a, amount: byAccountMonth[a]?.[lastMonth]?.amount_vnd || 0 }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [accounts, byAccountMonth, lastMonth]);

  const enteredCount = lastMonth ? accounts.filter((a) => byAccountMonth[a]?.[lastMonth]).length : 0;

  const chartData = useMemo(
    () =>
      months.flatMap((m) =>
        accounts.map((a) => ({
          label: monthLabel(m),
          value: byAccountMonth[a]?.[m]?.amount_vnd || 0,
          account: a,
        })),
      ),
    [months, accounts, byAccountMonth],
  );

  const openEdit = (accountLabel: string, month: string) => {
    const existing = byAccountMonth[accountLabel]?.[month];
    form.setFieldsValue({ amount_vnd: existing?.amount_vnd, note: existing?.note || '' });
    setEditTarget({ accountLabel, month });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      await upsertCost(editTarget.accountLabel, editTarget.month, {
        amount_vnd: values.amount_vnd || 0,
        note: values.note || '',
      });
      message.success('Đã lưu chi phí');
      setEditTarget(null);
      reload();
    } catch {
      message.error('Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const clearEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await deleteCost(editTarget.accountLabel, editTarget.month);
      message.success('Đã xóa');
      setEditTarget(null);
      reload();
    } catch {
      message.error('Xóa thất bại');
    } finally {
      setSaving(false);
    }
  };

  const exportAll = () => {
    const data = accounts.flatMap((a) =>
      months
        .filter((m) => byAccountMonth[a]?.[m])
        .map((m) => {
          const r = byAccountMonth[a][m];
          return [a, monthLabel(m), r.amount_vnd, r.note, r.created_by, r.updated_at];
        }),
    );
    if (!data.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    exportToCsv(
      `chi-phi-hang-thang-${dayjs().format('YYYY-MM-DD')}.csv`,
      ['Tài khoản', 'Tháng', 'Số tiền (VNĐ)', 'Ghi chú', 'Người nhập', 'Cập nhật lúc'],
      data,
    );
    message.success(`Đã xuất ${data.length} dòng`);
  };

  const columns = [
    {
      title: 'Tài khoản',
      dataIndex: 'account',
      fixed: 'left' as const,
      width: 190,
      render: (v: string, row: any) => (row.key === '__total__' ? <Text strong>{v}</Text> : v),
    },
    ...months.map((m) => ({
      title:
        m === currentMonth ? (
          <Text strong style={{ color: token.colorPrimary, whiteSpace: 'nowrap' as const }}>
            {monthLabel(m)}
          </Text>
        ) : (
          monthLabel(m)
        ),
      dataIndex: m,
      align: 'right' as const,
      width: 130,
      onHeaderCell: () => ({
        style: {
          whiteSpace: 'nowrap' as const,
          ...(m === currentMonth ? { background: token.colorPrimaryBg } : {}),
        },
      }),
      onCell: (row: any) =>
        row.key === '__total__'
          ? {}
          : { style: { cursor: 'pointer' }, onClick: () => openEdit(row.account, m) },
      render: (_: unknown, row: any) => {
        if (row.key === '__total__') {
          return <Text strong>{fmtVnd(monthTotal(m))}</Text>;
        }
        const amount = byAccountMonth[row.account]?.[m]?.amount_vnd;
        return (
          <Space size={4}>
            <Text type={amount ? undefined : 'secondary'}>{fmtVnd(amount)}</Text>
            <EditOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
          </Space>
        );
      },
    })),
    {
      title: 'Tổng kỳ',
      dataIndex: '__total__',
      fixed: 'right' as const,
      align: 'right' as const,
      width: 140,
      render: (_: unknown, row: any) => (
        <Text strong style={{ color: token.colorPrimary }}>
          {row.key === '__total__'
            ? fmtVnd(months.reduce((s, m) => s + monthTotal(m), 0))
            : fmtVnd(accountTotal(row.account))}
        </Text>
      ),
    },
  ];

  const dataSource = [
    ...accounts.map((a) => ({ key: a, account: a })),
    { key: '__total__', account: 'Tổng' },
  ];

  return (
    <PageContainer title="Báo cáo chi phí hàng tháng">
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={12} md={6}>
          <KpiCard
            icon={<DollarOutlined />}
            label={`Chi phí · ${lastMonth ? monthLabel(lastMonth) : 'tháng gần nhất'}`}
            value={fmtVnd(lastMonthTotal)}
            color={token.colorPrimary}
            bg={token.colorPrimaryBg}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            label="So với tháng trước"
            value={deltaPct === null ? '—' : `${delta >= 0 ? '+' : ''}${deltaPct}%`}
            color={trendUp ? token.colorError : trendDown ? token.colorSuccess : token.colorTextTertiary}
            bg={trendUp ? token.colorErrorBg : trendDown ? token.colorSuccessBg : token.colorFillTertiary}
            caption={prevMonth ? `Tháng trước: ${fmtVnd(prevMonthTotal)}` : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<TrophyOutlined />}
            label="Cao nhất tháng này"
            value={leaderboard[0]?.account || '—'}
            color={token.colorWarning}
            bg={token.colorWarningBg}
            caption={leaderboard[0] ? fmtVnd(leaderboard[0].amount) : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <KpiCard
            icon={<TableOutlined />}
            label="Đã nhập tháng này"
            value={`${enteredCount}/${accounts.length}`}
            color={token.colorInfo}
            bg={token.colorInfoBg}
          />
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <DatePicker.RangePicker
            picker="month"
            value={monthRange}
            allowClear={false}
            onChange={(v) => {
              if (v && v[0] && v[1]) setMonthRange([v[0], v[1]]);
            }}
          />
          <Button icon={<DownloadOutlined />} onClick={exportAll}>
            Xuất toàn bộ
          </Button>
        </Space>
      </Card>

      <Card
        title={
          <Space size={8}>
            <BarChartOutlined /> Xu hướng chi phí theo tháng
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {chartData.some((d) => d.value > 0) ? (
          <Column
            data={chartData}
            xField="label"
            yField="value"
            colorField="account"
            height={300}
            color={ACCOUNT_COLORS}
            stack={true}
            axis={{ x: { labelAutoRotate: true } }}
          />
        ) : (
          <Empty description="Chưa có dữ liệu chi phí trong khoảng thời gian này" />
        )}
      </Card>

      <Card
        title={
          <Space size={8}>
            <TableOutlined /> Chi tiết theo tài khoản × tháng
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Bấm vào 1 ô để nhập hoặc sửa chi phí tháng đó.
        </Text>
        <Table
          rowKey="key"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          scroll={{ x: 'max-content' }}
          onRow={(row: any) => (row.key === '__total__' ? { style: { background: token.colorFillAlter } } : {})}
        />
      </Card>

      <Modal
        title={editTarget ? `${editTarget.accountLabel} — ${monthLabel(editTarget.month)}` : ''}
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        confirmLoading={saving}
        onOk={saveEdit}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            {editTarget && byAccountMonth[editTarget.accountLabel]?.[editTarget.month] && (
              <Button danger onClick={clearEdit} loading={saving}>
                Xóa
              </Button>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="amount_vnd"
            label="Số tiền (VNĐ)"
            rules={[{ required: true, message: 'Nhập số tiền' }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={100000} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const v = form.getFieldValue('amount_vnd');
              return typeof v === 'number' && v > 0 ? (
                <Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 12 }}>
                  {v.toLocaleString('vi-VN')} đ
                </Text>
              ) : null;
            }}
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} placeholder="Không bắt buộc" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default CostReport;
