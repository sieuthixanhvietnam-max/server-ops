import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import VerifyBadge from '@/components/VerifyBadge';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listBackupCatalog, listServers, triggerRestoreWpsite } from '@/services/serverOps/api';
import { RESULT_STATUS_COLORS } from '@/utils/resultStatus';
import { ReloadOutlined, SearchOutlined, WarningFilled } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

const STATUS_LABELS: Record<string, string> = { OK: 'Đã restore', DRYRUN: 'Dry-run OK', FAIL: 'Thất bại' };

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

type Row = {
  key: string;
  domain: string;
  server_name: string;
  dates: { date: string; size_bytes: number }[];
  selectedDate: string;
  destinationServer?: string;
};

const buildRows = (catalog: API.BackupCatalogRow[], knownServerNames: Set<string>): Row[] => {
  const groups = new Map<string, Row>();
  for (const r of catalog) {
    const key = `${r.server_name}::${r.domain}`;
    const existing = groups.get(key);
    if (existing) {
      existing.dates.push({ date: r.date, size_bytes: r.size_bytes });
    } else {
      groups.set(key, {
        key, domain: r.domain, server_name: r.server_name,
        dates: [{ date: r.date, size_bytes: r.size_bytes }],
        selectedDate: r.date,
        destinationServer: knownServerNames.has(r.server_name) ? r.server_name : undefined,
      });
    }
  }
  const rows = Array.from(groups.values());
  for (const row of rows) {
    row.dates.sort((a, b) => (a.date > b.date ? -1 : 1));
    row.selectedDate = row.dates[0].date;
  }
  rows.sort((a, b) => (a.domain === b.domain ? a.server_name.localeCompare(b.server_name) : a.domain.localeCompare(b.domain)));
  return rows;
};

/** Renders 1 restore job's live log + result table - its own component (not
 * inlined in a .map) so useJobPolling's hook call stays valid per job id. */
const RestoreJobCard: React.FC<{ jobId: number }> = ({ jobId }) => {
  const job = useJobPolling(jobId);
  const results =
    job?.job_type === 'restore_wpsite' && (job.status === 'success' || job.status === 'failed')
      ? (job.result as API.RestoreWpsiteResult[])
      : undefined;

  return (
    <Card size="small" style={{ marginTop: 12 }}>
      <JobLogPanel job={job} />
      {results && (
        <Table<API.RestoreWpsiteResult>
          style={{ marginTop: 16 }}
          size="small"
          rowKey="domain"
          dataSource={results}
          pagination={false}
          columns={[
            { title: 'Domain', dataIndex: 'domain' },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
            },
            { title: 'Ngày backup', dataIndex: 'date_used', render: (v) => v || '-' },
            { title: 'Database', dataIndex: 'db_name', render: (v) => v || '-' },
            { title: 'Số bảng', dataIndex: 'table_count', render: (v) => v || '-' },
            { title: 'Site URL', dataIndex: 'siteurl', render: (v) => v || '-' },
            {
              title: 'Xác minh',
              dataIndex: 'verify',
              render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
            },
            { title: 'Ghi chú', dataIndex: 'note' },
          ]}
        />
      )}
    </Card>
  );
};

const RestoreWpsite: React.FC = () => {
  const { message } = App.useApp();
  const [catalog, setCatalog] = useState<API.BackupCatalogRow[]>();
  const [fetchedAt, setFetchedAt] = useState<string>();
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [servers, setServers] = useState<API.ServerItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [running, setRunning] = useState(false);
  const [jobIds, setJobIds] = usePersistedState<number[]>('backup-dashboard:jobIds', []);

  const knownServerNames = useMemo(() => new Set(servers.map((s) => s.server_name)), [servers]);

  const loadCatalog = async (refresh: boolean) => {
    setLoadingCatalog(true);
    try {
      const res = await listBackupCatalog(refresh);
      setCatalog(res.data || []);
      setFetchedAt(res.fetched_at);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    listServers({ current: 1, pageSize: 500 }).then((res) => setServers(res.data || []));
    loadCatalog(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (catalog) setRows(buildRows(catalog, knownServerNames));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, servers]);

  const serversWithoutBackup = useMemo(() => {
    if (!catalog) return [];
    const catalogServerNames = new Set(catalog.map((r) => r.server_name));
    return servers.filter((s) => !catalogServerNames.has(s.server_name)).map((s) => s.server_name);
  }, [catalog, servers]);

  const displayedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.domain.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const runRestore = async (targetRows: Row[], dryRun: boolean) => {
    const groups = new Map<string, Row[]>();
    let skipped = 0;
    for (const r of targetRows) {
      if (!r.destinationServer) {
        skipped += 1;
        continue;
      }
      const list = groups.get(r.destinationServer) || [];
      list.push(r);
      groups.set(r.destinationServer, list);
    }
    if (skipped) {
      message.warning(
        `${skipped} domain bị bỏ qua - chưa có server đích (server nguồn không còn trong danh sách quản lý, chọn tay server đích cho các domain đó).`,
      );
    }
    if (!groups.size) return;

    setRunning(true);
    try {
      const newJobIds: number[] = [];
      for (const [dest, groupRows] of groups) {
        const entries = groupRows.map((r) => ({ domain: r.domain, source_server: r.server_name, date: r.selectedDate }));
        const res = await triggerRestoreWpsite(dest, entries, dryRun);
        newJobIds.push(res.job_id);
      }
      setJobIds((prev) => [...newJobIds, ...prev]);
      if (!dryRun) setSelectedRowKeys([]);
    } finally {
      setRunning(false);
    }
  };

  const selectedRows = rows.filter((r) => selectedRowKeys.includes(r.key));

  return (
    <PageContainer
      title="Sao lưu & Khôi phục WordPress"
      subTitle="Danh mục backup đọc trực tiếp từ R2 - khôi phục ngay tại đây, không cần biết trước tên domain/server"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} loading={loadingCatalog} onClick={() => loadCatalog(true)}>
            Làm mới
          </Button>
          <ClearCacheButton
            onClear={() => {
              setJobIds([]);
              setSelectedRowKeys([]);
              clearPersistedState('backup-dashboard:jobIds');
            }}
          />
        </Space>
      }
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="Chạy thật sẽ DROP DATABASE và GHI ĐÈ toàn bộ file trên server đích cho từng domain - bất kể domain đó đang sống hay đã mất. Server đích phải đã có sẵn bộ công cụ WPTT (LiteSpeed, MariaDB, rclone, /etc/wptt/*). Nhiều domain cùng 1 server đích chạy tuần tự, tránh dồn tải."
      />

      {fetchedAt && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Cập nhật lúc {new Date(fetchedAt).toLocaleString('vi-VN')} · {rows.length} domain có backup
        </Typography.Text>
      )}

      {serversWithoutBackup.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8, marginBottom: 16 }}
          message={`${serversWithoutBackup.length} server chưa có backup nào trên R2: ${serversWithoutBackup.join(', ')}`}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Input
            allowClear
            placeholder="Tìm domain..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          {selectedRowKeys.length > 0 && (
            <>
              <Button loading={running} onClick={() => runRestore(selectedRows, true)}>
                Xem trước (dry-run) {selectedRowKeys.length} mục
              </Button>
              <DangerPopconfirm
                title="Xác nhận Khôi phục WordPress"
                targets={selectedRows.map((r) => `${r.domain} (${r.selectedDate}) -> ${r.destinationServer || '?'}`)}
                onConfirm={() => runRestore(selectedRows, false)}
                loading={running}
              >
                <Button danger type="primary" loading={running}>
                  Khôi phục {selectedRowKeys.length} mục đã chọn
                </Button>
              </DangerPopconfirm>
            </>
          )}
        </Space>

        <Table<Row>
          size="small"
          rowKey="key"
          loading={loadingCatalog}
          dataSource={displayedRows}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} domain` }}
          columns={[
            { title: 'Domain', dataIndex: 'domain' },
            {
              title: 'Server nguồn',
              dataIndex: 'server_name',
              render: (v) =>
                knownServerNames.has(v) ? (
                  <Tag>{v}</Tag>
                ) : (
                  <Tooltip title="Server này không còn trong danh sách quản lý - chọn tay server đích">
                    <Tag icon={<WarningFilled />} color="warning">
                      {v}
                    </Tag>
                  </Tooltip>
                ),
            },
            {
              title: 'Ngày backup',
              render: (_, r) => (
                <Select
                  size="small"
                  style={{ width: 170 }}
                  value={r.selectedDate}
                  onChange={(v) => updateRow(r.key, { selectedDate: v })}
                  options={r.dates.map((d, idx) => ({ value: d.date, label: idx === 0 ? `${d.date} (mới nhất)` : d.date }))}
                />
              ),
            },
            {
              title: 'Dung lượng',
              render: (_, r) => formatBytes(r.dates.find((d) => d.date === r.selectedDate)?.size_bytes || 0),
            },
            { title: 'Số bản', render: (_, r) => r.dates.length },
            {
              title: 'Server đích',
              render: (_, r) => (
                <Select
                  size="small"
                  style={{ width: 220 }}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Chọn server đích..."
                  value={r.destinationServer}
                  onChange={(v) => updateRow(r.key, { destinationServer: v })}
                  options={servers.map((s) => ({ value: s.server_name, label: `${s.server_name} (${s.provider} · ${s.ip})` }))}
                />
              ),
            },
            {
              title: '',
              width: 100,
              render: (_, r) => (
                <DangerPopconfirm
                  title="Xác nhận Khôi phục WordPress"
                  targets={[`${r.domain} (${r.selectedDate}) -> ${r.destinationServer || '?'}`]}
                  onConfirm={() => runRestore([r], false)}
                  loading={running}
                >
                  <Button size="small" danger type="primary" disabled={!r.destinationServer}>
                    Khôi phục
                  </Button>
                </DangerPopconfirm>
              ),
            },
          ]}
        />
      </Card>

      {jobIds.map((id) => (
        <RestoreJobCard key={id} jobId={id} />
      ))}
    </PageContainer>
  );
};

export default RestoreWpsite;
