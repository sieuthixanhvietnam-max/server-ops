import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import VerifyBadge from '@/components/VerifyBadge';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listDomains, listServers, triggerMigrateWpsite, triggerRemoveWpsite } from '@/services/serverOps/api';
import { RESULT_STATUS_COLORS } from '@/utils/resultStatus';
import { MinusCircleOutlined, PlusOutlined, WarningFilled } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Select, Space, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

type Row = { domain: string; sourceServer?: string; destServer?: string };
type ServerOption = { server_name: string; server_ip: string };

const STATUS_LABELS: Record<string, string> = {
  OK: 'Thành công',
  PARTIAL: 'Chưa xác minh xong',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
};

const emptyRow = (): Row => ({ domain: '' });

/** Nút "Xoá nguồn" cho 1 dòng kết quả - tách hoàn toàn khỏi job migrate,
 * tự trigger + tự poll job remove-wpsite của riêng nó (tái dùng nguyên
 * endpoint/luồng đã có ở trang Xoá WordPress Site). */
const RemoveSourceCell: React.FC<{ domain: string; sourceIp: string; sourceServer?: string }> = ({
  domain,
  sourceIp,
  sourceServer,
}) => {
  const { message } = App.useApp();
  const [jobId, setJobId] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  if (jobId) {
    const isBusy = job?.status === 'running' || job?.status === 'pending';
    if (isBusy) return <Tag color="processing">Đang xoá...</Tag>;
    const result = ((job?.result as API.RemoveWpsiteResult[] | undefined) || [])[0];
    if (job?.status === 'success' && result?.status === 'OK') {
      return <Tag color="green">Đã xoá nguồn</Tag>;
    }
    if (job?.status === 'success') {
      return <Tag color="red">Lỗi: {result?.note || 'không rõ'}</Tag>;
    }
    if (job?.status === 'failed') return <Tag color="red">Job thất bại</Tag>;
  }

  return (
    <DangerPopconfirm
      title="Xác nhận Xoá site nguồn"
      targets={[`${domain} (${sourceIp})`]}
      loading={running}
      onConfirm={async () => {
        setRunning(true);
        try {
          const res = await triggerRemoveWpsite([domain], false, sourceServer ? { [domain]: sourceServer } : undefined);
          setJobId(res.job_id);
        } catch (err: any) {
          message.error(`Lỗi khi xoá nguồn: ${err?.message || err}`);
        } finally {
          setRunning(false);
        }
      }}
    >
      <Button danger type="primary" size="small" loading={running}>
        Xoá nguồn
      </Button>
    </DangerPopconfirm>
  );
};

const MigrateWpsite: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = usePersistedState<Row[]>('migrate-wpsite:rows', [emptyRow()]);
  const [jobId, setJobId] = usePersistedState<number | undefined>('migrate-wpsite:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  const [serverOptions, setServerOptions] = useState<API.ServerItem[]>([]);
  // Domain nguồn tồn tại trên >1 server (VD template WP trắng) thì phải chọn
  // rõ server nguồn - cùng lý do như clone-wpsite.
  const [sourceServersMap, setSourceServersMap] = useState<Record<string, ServerOption[]>>({});

  useEffect(() => {
    listServers({ pageSize: 500, current: 1 }).then((res) => setServerOptions(res.data || []));
  }, []);

  useEffect(() => {
    const domains = Array.from(
      new Set(rows.map((r) => r.domain.trim().toLowerCase()).filter(Boolean)),
    ).filter((d) => !(d in sourceServersMap));
    if (!domains.length) return;
    Promise.all(
      domains.map(async (domain) => {
        const res = await listDomains({ domain, pageSize: 50, current: 1 });
        const servers = (res.data || [])
          .filter((d: API.DomainItem) => d.domain === domain)
          .map((d: API.DomainItem) => ({ server_name: d.server_name, server_ip: d.server_ip }));
        return [domain, servers] as const;
      }),
    ).then((entries) => {
      setSourceServersMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const isSourceAmbiguous = (domain: string) => (sourceServersMap[domain]?.length || 0) > 1;

  const entries = rows
    .map((r) => ({ domain: r.domain.trim().toLowerCase(), sourceServer: r.sourceServer, destServer: r.destServer }))
    .filter((r) => r.domain && r.destServer && (!isSourceAmbiguous(r.domain) || r.sourceServer));

  const needsSourceServerCount = rows.filter(
    (r) => r.domain.trim() && isSourceAmbiguous(r.domain.trim().toLowerCase()) && !r.sourceServer,
  ).length;
  const missingDestCount = rows.filter((r) => r.domain.trim() && !r.destServer).length;

  const clearCache = () => {
    setRows([emptyRow()]);
    setJobId(undefined);
    setSourceServersMap({});
    ['rows', 'jobId'].forEach((k) => clearPersistedState(`migrate-wpsite:${k}`));
  };

  const run = async (dryRun: boolean) => {
    if (!entries.length) {
      message.warning('Chưa có dòng nào sẵn sàng (cần domain nguồn + server đích hợp lệ)');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerMigrateWpsite(
        entries.map((e) => ({ domain: e.domain, source_server: e.sourceServer, dest_server: e.destServer! })),
        dryRun,
      );
      setJobId(res.job_id);
      if (!dryRun) {
        setRows([emptyRow()]);
        clearPersistedState('migrate-wpsite:rows');
      }
    } catch (err: any) {
      message.error(`Lỗi khi chạy Migrate: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';
  const tableData = rows.map((r, idx) => ({ ...r, idx }));

  return (
    <PageContainer title="Di chuyển WordPress Site" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Di chuyển toàn bộ file + database sang server khác, rồi trỏ lại DNS Cloudflare."
          description="Server nguồn tự xác định từ domain đã đồng bộ (chọn thêm nếu domain tồn tại trên nhiều server). Server đích PHẢI chọn thủ công. Nếu đích là server GCP có cấu hình firewall riêng, hệ thống tự mở/đóng port 22 cho IP nguồn trong lúc chạy. Sau khi migrate xong và đã tự kiểm tra site mới hoạt động tốt, bấm 'Xoá nguồn' ở bảng kết quả bên dưới để xoá site cũ - đây là bước RIÊNG, không tự động."
        />

        <Table
          size="small"
          pagination={false}
          rowKey="idx"
          dataSource={tableData}
          style={{ marginBottom: 12 }}
          columns={[
            { title: '#', width: 40, render: (_, __, i) => i + 1 },
            {
              title: 'Domain nguồn',
              width: '38%',
              render: (_, r) => {
                const domain = r.domain.trim().toLowerCase();
                const servers = sourceServersMap[domain];
                return (
                  <div>
                    <DomainSelect
                      mode="single"
                      value={r.domain ? [r.domain] : []}
                      onChange={(v) => updateRow(r.idx, { domain: v[0] || '', sourceServer: undefined })}
                      placeholder="Domain nguồn (đã đồng bộ)..."
                    />
                    {servers && servers.length > 1 && (
                      <Select
                        style={{ width: '100%', marginTop: 4 }}
                        size="small"
                        showSearch
                        optionFilterProp="label"
                        status={r.sourceServer ? undefined : 'error'}
                        placeholder={`⚠ Mơ hồ - chọn 1 trong ${servers.length} server nguồn`}
                        value={r.sourceServer}
                        onChange={(v) => updateRow(r.idx, { sourceServer: v })}
                        options={servers.map((s) => ({
                          value: s.server_name,
                          label: `${s.server_name} (${s.server_ip})`,
                        }))}
                      />
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Server đích',
              width: '38%',
              render: (_, r) => (
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Chọn server đích..."
                  value={r.destServer}
                  onChange={(v) => updateRow(r.idx, { destServer: v })}
                  options={serverOptions.map((s) => ({
                    value: s.server_name,
                    label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
                  }))}
                />
              ),
            },
            {
              title: '',
              width: 48,
              render: (_, r) => (
                <Button
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeRow(r.idx)}
                  disabled={rows.length <= 1}
                  danger
                  type="text"
                />
              ),
            },
          ]}
        />
        <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, emptyRow()])} style={{ marginBottom: 12 }}>
          Thêm dòng
        </Button>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button loading={running || isBusy} onClick={() => run(true)} disabled={!entries.length}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Di chuyển WordPress Site"
            targets={entries.map((e) => `${e.domain} -> ${e.destServer}`)}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!entries.length}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
          <Space wrap>
            {entries.length > 0 && <Tag color="success">{entries.length} sẵn sàng</Tag>}
            {needsSourceServerCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {needsSourceServerCount} cần chọn server nguồn (domain mơ hồ)
              </Tag>
            )}
            {missingDestCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {missingDestCount} thiếu server đích
              </Tag>
            )}
          </Space>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <Table<API.MigrateWpsiteResult>
            style={{ marginTop: 16 }}
            size="small"
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server nguồn', dataIndex: 'source_ip' },
              { title: 'Server đích', dataIndex: 'dest_ip' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
              },
              { title: 'DNS (Cloudflare)', dataIndex: 'cf_dns' },
              {
                title: 'Xác minh',
                dataIndex: 'verify',
                render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
              {
                title: 'Xoá nguồn',
                width: 130,
                render: (_, r) =>
                  r.status === 'OK' ? (
                    <RemoveSourceCell domain={r.domain} sourceIp={r.source_ip} sourceServer={r.source_server} />
                  ) : (
                    '-'
                  ),
              },
            ]}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default MigrateWpsite;
