import ClearCacheButton from '@/components/ClearCacheButton';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listServers, triggerCheckHealth } from '@/services/serverOps/api';
import { HEALTH_STATUS_LABELS, HEALTH_STATUS_TAG_COLORS } from '@/utils/healthStatus';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Select, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const CheckHealth: React.FC = () => {
  const { message } = App.useApp();
  const [servers, setServers] = useState<API.ServerItem[]>([]);
  const [selected, setSelected] = usePersistedState<string[]>('check-health:selected', []);
  const [jobId, setJobId] = usePersistedState<number | undefined>('check-health:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  useEffect(() => {
    listServers({ current: 1, pageSize: 200 }).then((res) => setServers(res.data));
  }, []);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await triggerCheckHealth(selected.length ? selected : undefined);
      setJobId(res.job_id);
    } catch (e) {
      message.error('Không thể chạy kiểm tra');
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const clearCache = () => {
    setSelected([]);
    setJobId(undefined);
    ['selected', 'jobId'].forEach((k) => clearPersistedState(`check-health:${k}`));
  };

  return (
    <PageContainer title="Kiểm tra sức khoẻ Server (SSH)" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Kiểm tra qua SSH (uptime, CPU, RAM, disk, OLS, MariaDB) - chỉ đọc, không thay đổi gì trên server nên an toàn khi chạy nhiều lần."
        />
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          placeholder="Để trống = kiểm tra tất cả server"
          value={selected}
          onChange={setSelected}
          options={servers.map((s) => ({
            label: `${s.server_name}  (${s.provider} · ${s.ip})`,
            value: s.server_name,
          }))}
          optionFilterProp="label"
          showSearch
        />
        <Button
          type="primary"
          style={{ marginTop: 12 }}
          loading={running || isBusy}
          onClick={handleRun}
        >
          Chạy kiểm tra
        </Button>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <Table<API.CheckHealthResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="server_name"
            dataSource={job.result}
            pagination={false}
            scroll={{ x: true }}
            columns={[
              { title: 'Server', dataIndex: 'server_name' },
              { title: 'IP', dataIndex: 'ip' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={HEALTH_STATUS_TAG_COLORS[v] || 'default'}>{HEALTH_STATUS_LABELS[v] || v}</Tag>
                ),
              },
              { title: 'CPU', dataIndex: 'cpu', render: (v) => (v ? `${v}%` : '-') },
              { title: 'RAM', dataIndex: 'ram_pct', render: (v) => (v ? `${v}%` : '-') },
              { title: 'Disk', dataIndex: 'disk_pct', render: (v) => (v ? `${v}%` : '-') },
              { title: 'Domains', dataIndex: 'domains' },
              { title: 'Uptime', dataIndex: 'uptime' },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default CheckHealth;
