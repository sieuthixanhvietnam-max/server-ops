import BatchDomainPaste from '@/components/BatchDomainPaste';
import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import VerifyBadge from '@/components/VerifyBadge';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import {
  listDomains,
  listServers,
  triggerMaintenanceCleanJunk,
  triggerMaintenanceClearCache,
  triggerMaintenanceClearComments,
  triggerMaintenanceFixPermissions,
} from '@/services/serverOps/api';
import { RESULT_STATUS_COLORS } from '@/utils/resultStatus';
import { PlusOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Checkbox, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const STATUS_LABELS: Record<string, string> = {
  OK: 'Thành công',
  PARTIAL: 'Còn sót',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
};

const formatKb = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);

const WpMaintenance: React.FC = () => {
  const { message } = App.useApp();
  const [servers, setServers] = useState<API.ServerItem[]>([]);
  const [serverPick, setServerPick] = useState<string>();
  const [addingServerDomains, setAddingServerDomains] = useState(false);
  const [domainPick, setDomainPick] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = usePersistedState<string[]>('wp-maintenance:selectedDomains', []);

  const [jobId, setJobId] = usePersistedState<number | undefined>('wp-maintenance:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';

  const [disableNewComments, setDisableNewComments] = usePersistedState('wp-maintenance:disableNewComments', true);

  useEffect(() => {
    listServers({ current: 1, pageSize: 500 }).then((res) => setServers(res.data || []));
  }, []);

  const addServerDomains = async () => {
    if (!serverPick) return;
    setAddingServerDomains(true);
    try {
      const res = await listDomains({ server_name: serverPick, pageSize: 500, current: 1 });
      const domains = (res.data || []).map((d) => d.domain);
      setSelectedDomains((prev) => Array.from(new Set([...prev, ...domains])));
      message.success(`Đã thêm ${domains.length} domain từ server ${serverPick}`);
    } finally {
      setAddingServerDomains(false);
    }
  };

  const addPickedDomains = () => {
    if (!domainPick.length) return;
    setSelectedDomains((prev) => Array.from(new Set([...prev, ...domainPick])));
    setDomainPick([]);
  };

  const requireDomains = () => {
    if (!selectedDomains.length) {
      message.warning('Chọn ít nhất 1 domain ở trên trước');
      return false;
    }
    return true;
  };

  const handleClearCache = async () => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerMaintenanceClearCache(selectedDomains);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const runClearComments = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerMaintenanceClearComments(selectedDomains, disableNewComments, dryRun);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const runFixPermissions = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerMaintenanceFixPermissions(selectedDomains, dryRun);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const runCleanJunk = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerMaintenanceCleanJunk(selectedDomains, dryRun);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const targetPicker = (
    <Card size="small" title={`Chọn domain đích (${selectedDomains.length} đã chọn)`} style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            style={{ flex: 1 }}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="Chọn 1 server - thêm toàn bộ domain trên server đó"
            value={serverPick}
            onChange={setServerPick}
            options={servers.map((s) => ({
              value: s.server_name,
              label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
            }))}
          />
          <Button icon={<PlusOutlined />} loading={addingServerDomains} disabled={!serverPick} onClick={addServerDomains}>
            Thêm domain của server
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <DomainSelect value={domainPick} onChange={setDomainPick} placeholder="Hoặc tìm và chọn từng domain..." />
          </div>
          <Button icon={<PlusOutlined />} disabled={!domainPick.length} onClick={addPickedDomains}>
            Thêm domain đã chọn
          </Button>
          <BatchDomainPaste
            onAdd={(domains) =>
              setSelectedDomains((prev) => Array.from(new Set([...prev, ...domains])))
            }
          />
        </div>

        {selectedDomains.length > 0 && (
          <div>
            <Space wrap>
              {selectedDomains.map((d) => (
                <Tag key={d} closable onClose={() => setSelectedDomains((prev) => prev.filter((x) => x !== d))}>
                  {d}
                </Tag>
              ))}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Button size="small" danger onClick={() => setSelectedDomains([])}>
                Xoá tất cả
              </Button>
            </div>
          </div>
        )}
      </Space>
    </Card>
  );

  const cacheResults =
    job?.job_type === 'maintenance_clear_cache' && (job.status === 'success' || job.status === 'failed')
      ? (job.result as API.MaintenanceClearCacheResult[])
      : undefined;
  const commentResults =
    job?.job_type === 'maintenance_clear_comments' && (job.status === 'success' || job.status === 'failed')
      ? (job.result as API.MaintenanceClearCommentsResult[])
      : undefined;
  const permissionResults =
    job?.job_type === 'maintenance_fix_permissions' && (job.status === 'success' || job.status === 'failed')
      ? (job.result as API.MaintenanceFixPermissionsResult[])
      : undefined;
  const junkResults =
    job?.job_type === 'maintenance_clean_junk' && (job.status === 'success' || job.status === 'failed')
      ? (job.result as API.MaintenanceCleanJunkResult[])
      : undefined;

  return (
    <PageContainer
      title="Bảo trì WordPress"
      extra={
        <ClearCacheButton
          onClear={() => {
            setSelectedDomains([]);
            setJobId(undefined);
            setDisableNewComments(true);
            ['selectedDomains', 'jobId', 'disableNewComments'].forEach((k) =>
              clearPersistedState(`wp-maintenance:${k}`),
            );
          }}
        />
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Chọn domain đích ở trên, sau đó chọn 1 hành động ở tab bên dưới. Mọi thao tác chạy song song trên nhiều domain qua SSH."
      />

      {targetPicker}

      <Card>
        <Tabs
          items={[
            {
              key: 'cache',
              label: 'Xoá Cache',
              children: (
                <div>
                  <Typography.Paragraph type="secondary">
                    Xoá toàn bộ cache của domain: cache trang (plugin LiteSpeed Cache), object cache của WordPress
                    (<code>wp cache flush</code>), và cache cấp OpenLiteSpeed server. Không xoá dữ liệu, an toàn.
                  </Typography.Paragraph>
                  <Button type="primary" loading={isBusy} onClick={handleClearCache}>
                    Xoá cache
                  </Button>
                </div>
              ),
            },
            {
              key: 'comments',
              label: 'Dọn Comment',
              children: (
                <div>
                  <Typography.Paragraph type="secondary">
                    Xoá toàn bộ comment trên domain đã chọn (thường dùng để dọn spam).
                  </Typography.Paragraph>
                  <Checkbox checked={disableNewComments} onChange={(e) => setDisableNewComments(e.target.checked)}>
                    Đồng thời tắt comment mới sau khi xoá
                  </Checkbox>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runClearComments(true)}>
                      Xem trước (đếm số comment)
                    </Button>
                    <DangerPopconfirm
                      title="Xác nhận Xoá Comment"
                      targets={selectedDomains}
                      onConfirm={() => runClearComments(false)}
                      loading={running}
                    >
                      <Button danger type="primary" loading={isBusy}>
                        Xoá thật
                      </Button>
                    </DangerPopconfirm>
                  </div>
                </div>
              ),
            },
            {
              key: 'permissions',
              label: 'Phân quyền (fix file sai chủ)',
              children: (
                <div>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Chạy wptt-phanquyen của server (đúng công cụ đã dùng fix cakhiatv.ch/gem88a.co.com và toàn hệ thống 20/08/2026) - đưa file/thư mục về đúng chủ user hệ thống của site. Dùng khi WP UI báo lỗi kiểu &quot;không chuyển được file tải lên&quot; khi upload media/thêm Theme/Plugin. An toàn để chạy lại nhiều lần, chạy tuần tự từng domain (thao tác nặng I/O)."
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runFixPermissions(true)}>
                      Kiểm tra (đếm file sai chủ)
                    </Button>
                    <DangerPopconfirm
                      title="Xác nhận Phân quyền lại"
                      targets={selectedDomains}
                      onConfirm={() => runFixPermissions(false)}
                      loading={running}
                    >
                      <Button danger type="primary" loading={isBusy}>
                        Chạy thật
                      </Button>
                    </DangerPopconfirm>
                  </div>
                </div>
              ),
            },
            {
              key: 'junk',
              label: 'Dọn rác',
              children: (
                <div>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Xoá rác tích luỹ từ clone site hàng loạt: wp-content/plugins-old, wp-content/ai1wm-backups (backup của plugin All-in-One WP Migration), và luucache. Mỗi lần clone site lại sinh ra rác này - nên chạy định kỳ (khuyến nghị hàng tháng) thay vì để tích luỹ đến khi ổ đĩa báo động. Không đụng vào WordPress đang chạy, không cần xác minh site sau khi chạy."
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runCleanJunk(true)}>
                      Kiểm tra (tính dung lượng rác)
                    </Button>
                    <DangerPopconfirm
                      title="Xác nhận Dọn rác"
                      targets={selectedDomains}
                      onConfirm={() => runCleanJunk(false)}
                      loading={running}
                    >
                      <Button danger type="primary" loading={isBusy}>
                        Xoá thật
                      </Button>
                    </DangerPopconfirm>
                  </div>
                </div>
              ),
            },
          ]}
        />

        <JobLogPanel job={job} />

        {cacheResults && (
          <Table<API.MaintenanceClearCacheResult>
            style={{ marginTop: 16 }}
            size="small"
            rowKey="domain"
            dataSource={cacheResults}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server IP', dataIndex: 'ip' },
              { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag> },
              {
                title: 'Xác minh',
                dataIndex: 'verify',
                render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {commentResults && (
          <Table<API.MaintenanceClearCommentsResult>
            style={{ marginTop: 16 }}
            size="small"
            rowKey="domain"
            dataSource={commentResults}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server IP', dataIndex: 'ip' },
              { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag> },
              { title: 'Số comment', dataIndex: 'comment_count' },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {permissionResults && (
          <Table<API.MaintenanceFixPermissionsResult>
            style={{ marginTop: 16 }}
            size="small"
            rowKey="domain"
            dataSource={permissionResults}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server IP', dataIndex: 'ip' },
              { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag> },
              { title: 'File sai chủ (trước)', dataIndex: 'before' },
              { title: 'File sai chủ (sau)', dataIndex: 'after' },
              {
                title: 'Xác minh',
                dataIndex: 'verify',
                render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {junkResults && (
          <Table<API.MaintenanceCleanJunkResult>
            style={{ marginTop: 16 }}
            size="small"
            rowKey="domain"
            dataSource={junkResults}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server IP', dataIndex: 'ip' },
              { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag> },
              {
                title: 'Dung lượng',
                dataIndex: 'freed_kb',
                render: (v: number, r) => `${formatKb(v)}${r.status === 'DRYRUN' ? ' sẽ được giải phóng' : ' đã giải phóng'}`,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default WpMaintenance;
