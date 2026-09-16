import ClearCacheButton from '@/components/ClearCacheButton';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerCfAuditRedirects, triggerCfRedirectInventory } from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { DownloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Empty, Segmented, Space, Table, Tag, Typography } from 'antd';
import React, { useMemo, useState } from 'react';

type Mode = 'anomalies' | 'full';

const CfRedirectAudit: React.FC = () => {
  const { message } = App.useApp();
  const [mode, setMode] = usePersistedState<Mode>('cf-redirect-audit:mode', 'anomalies');
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-redirect-audit:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';

  const run = async () => {
    setRunning(true);
    try {
      const res = mode === 'anomalies' ? await triggerCfAuditRedirects() : await triggerCfRedirectInventory();
      setJobId(res.job_id);
    } catch (err: any) {
      message.error(`Lỗi: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const inventoryRows =
    (mode === 'full' ? (job?.result as API.CfRedirectInventoryRow[] | undefined) : undefined) || [];

  const targetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    inventoryRows.forEach((r) => counts.set(r.target_domain, (counts.get(r.target_domain) || 0) + 1));
    return counts;
  }, [inventoryRows]);

  const topTargets = useMemo(
    () => Array.from(targetCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
    [targetCounts],
  );

  // Grouped by target domain, biggest chain first - so the domains most
  // worth trimming (many sources funneled into one target, adding load) are
  // immediately visible at the top instead of scattered across the table.
  const sortedInventoryRows = useMemo(
    () =>
      [...inventoryRows].sort((a, b) => {
        const diff = (targetCounts.get(b.target_domain) || 0) - (targetCounts.get(a.target_domain) || 0);
        if (diff !== 0) return diff;
        if (a.target_domain !== b.target_domain) return a.target_domain.localeCompare(b.target_domain);
        return a.domain.localeCompare(b.domain);
      }),
    [inventoryRows, targetCounts],
  );

  const exportInventory = () => {
    exportToCsv(
      `cf-redirects-${new Date().toISOString().slice(0, 10)}.csv`,
      ['domain', 'target', 'target_domain', 'code', 'zone_id'],
      sortedInventoryRows.map((r) => [r.domain, r.target, r.target_domain, r.code, r.zone_id]),
    );
  };

  const clearCache = () => {
    setMode('anomalies');
    setJobId(undefined);
    ['mode', 'jobId'].forEach((k) => clearPersistedState(`cf-redirect-audit:${k}`));
  };

  return (
    <PageContainer title="Kiểm tra Redirect 301" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Segmented
          options={[
            { label: 'Chỉ bất thường', value: 'anomalies' },
            { label: 'Toàn bộ danh sách', value: 'full' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          block
          style={{ marginBottom: 12 }}
        />

        {mode === 'anomalies' ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Quét toàn bộ zone (master token) tìm redirect rule bất thường: nhiều rule trùng nhau trên cùng zone, hoặc pattern không đúng chuẩn hệ thống tạo ra."
            description={
              <>
                Chỉ báo zone có vấn đề thật sự - zone không có redirect nào sẽ không xuất hiện. Xây dựng
                sau khi phát hiện <Typography.Text code>sports-online.biz</Typography.Text> và{' '}
                <Typography.Text code>keonhacai365.app</Typography.Text> từng có 2 redirect rule trùng
                nhau cùng lúc, khiến Cloudflare chỉ áp dụng ngẫu nhiên 1 rule. Quét toàn bộ account có thể
                mất 30-60 phút do quy mô lớn - không cần chờ, có thể xem lại ở Job History.
              </>
            }
          />
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Xuất toàn bộ redirect hiện có của mọi domain đang quản lý trên server - không lọc bất thường, dùng để báo cáo/kiểm tra tổng thể."
            description="Chỉ quét domain đang thực sự host trên server (không phải mọi zone trong account Cloudflare) - tra zone_id từ dữ liệu đã đồng bộ sẵn trong hệ thống, không cần gọi thêm API Cloudflare cho bước này."
          />
        )}

        <Button type="primary" loading={isBusy} onClick={run}>
          Chạy kiểm tra
        </Button>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') &&
          mode === 'anomalies' &&
          (job.result?.length ? (
            <>
              <Typography.Text type="secondary">{job.result.length} zone có vấn đề</Typography.Text>
              <Table<API.CfAuditRedirectFinding>
                style={{ marginTop: 8 }}
                size="small"
                rowKey="domain"
                dataSource={job.result}
                pagination={DEFAULT_PAGINATION}
                columns={[
                  { title: 'Domain', dataIndex: 'domain' },
                  {
                    title: 'Số rule redirect',
                    dataIndex: 'rule_count',
                    render: (v) => <Tag color={v > 1 ? 'red' : 'gold'}>{v}</Tag>,
                  },
                  { title: 'Vấn đề', dataIndex: 'issues' },
                  { title: 'Target (Cloudflare)', dataIndex: 'targets', ellipsis: true },
                ]}
              />
            </>
          ) : (
            <Empty style={{ marginTop: 16 }} description="Không tìm thấy zone nào có redirect rule bất thường" />
          ))}

        {(job?.status === 'success' || job?.status === 'failed') &&
          mode === 'full' &&
          (inventoryRows.length ? (
            <>
              <div
                style={{
                  marginTop: 16,
                  marginBottom: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography.Text type="secondary">{inventoryRows.length} redirect rule</Typography.Text>
                <Button icon={<DownloadOutlined />} onClick={exportInventory}>
                  Xuất CSV
                </Button>
              </div>

              {topTargets.length > 0 && (
                <Card size="small" title="Top domain đích nhận nhiều redirect nhất" style={{ marginBottom: 12 }}>
                  <Space wrap>
                    {topTargets.map(([domain, count]) => (
                      <Tag key={domain} color="blue">
                        {domain}: {count}
                      </Tag>
                    ))}
                  </Space>
                </Card>
              )}

              <Table<API.CfRedirectInventoryRow>
                size="small"
                rowKey={(r, idx) => `${r.domain}-${idx}`}
                dataSource={sortedInventoryRows}
                pagination={DEFAULT_PAGINATION}
                columns={[
                  {
                    title: 'Domain đích',
                    dataIndex: 'target_domain',
                    sorter: (a, b) => a.target_domain.localeCompare(b.target_domain),
                  },
                  {
                    title: 'Số domain trỏ vào',
                    key: 'target_count',
                    sorter: (a, b) =>
                      (targetCounts.get(a.target_domain) || 0) - (targetCounts.get(b.target_domain) || 0),
                    defaultSortOrder: 'descend',
                    render: (_, r) => {
                      const count = targetCounts.get(r.target_domain) || 0;
                      return <Tag color={count >= 5 ? 'red' : count >= 2 ? 'gold' : 'default'}>{count}</Tag>;
                    },
                  },
                  { title: 'Domain nguồn', dataIndex: 'domain', sorter: (a, b) => a.domain.localeCompare(b.domain) },
                  { title: 'Target', dataIndex: 'target', ellipsis: true },
                  { title: 'Mã redirect', dataIndex: 'code' },
                ]}
              />
            </>
          ) : (
            <Empty style={{ marginTop: 16 }} description="Không tìm thấy redirect rule nào" />
          ))}
      </Card>
    </PageContainer>
  );
};

export default CfRedirectAudit;
