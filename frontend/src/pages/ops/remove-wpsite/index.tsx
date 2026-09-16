import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import VerifyBadge from '@/components/VerifyBadge';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerRemoveWpsite } from '@/services/serverOps/api';
import { CloudOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation, useNavigate } from '@umijs/max';
import { Alert, App, Button, Card, Input, Segmented, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

const STATUS_LABELS: Record<string, string> = {
  OK: 'Đã xoá',
  DRYRUN: 'Dry-run',
  SKIP: 'Không tìm thấy site',
  FAIL: 'Thất bại',
};

const parseDomains = (text: string) =>
  Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const RemoveWpsite: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = usePersistedState<'select' | 'paste'>('remove-wpsite:mode', 'select');
  const [selected, setSelected] = usePersistedState<string[]>('remove-wpsite:selected', []);
  const [text, setText] = usePersistedState('remove-wpsite:text', '');
  const [jobId, setJobId] = usePersistedState<number | undefined>('remove-wpsite:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setSelected(preset);
      setMode('select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domains = mode === 'select' ? selected : parseDomains(text);

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Chọn hoặc nhập ít nhất 1 domain');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerRemoveWpsite(domains, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setSelected([]);
        setText('');
        clearPersistedState('remove-wpsite:selected');
        clearPersistedState('remove-wpsite:text');
      }
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const hasRemovedOk = ((job?.result as API.RemoveWpsiteResult[] | undefined) || []).some(
    (r) => r.status === 'OK',
  );

  const clearCache = () => {
    setMode('select');
    setSelected([]);
    setText('');
    setJobId(undefined);
    ['mode', 'selected', 'text', 'jobId'].forEach((k) => clearPersistedState(`remove-wpsite:${k}`));
  };

  return (
    <PageContainer title="Xoá WordPress Site" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Thao tác này xoá vĩnh viễn database, file, cron, SSL của domain. Server được tự động xác định từ domain đã đồng bộ - nếu domain gắn với nhiều server, sẽ báo lỗi thay vì đoán."
        />

        <Segmented
          style={{ marginBottom: 12 }}
          value={mode}
          onChange={(v) => setMode(v as 'select' | 'paste')}
          options={[
            { label: 'Chọn từ danh sách', value: 'select' },
            { label: 'Dán danh sách', value: 'paste' },
          ]}
        />

        {mode === 'select' ? (
          <DomainSelect value={selected} onChange={setSelected} />
        ) : (
          <TextArea
            rows={6}
            placeholder="Nhập danh sách domain cần xoá, mỗi dòng 1 domain..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button loading={running || isBusy} onClick={() => run(true)}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Xoá WordPress Site"
            targets={domains}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!domains.length}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <Table<API.RemoveWpsiteResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Server IP', dataIndex: 'ip' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag
                    color={
                      v === 'OK' ? 'green' : v === 'DRYRUN' ? 'blue' : v === 'SKIP' ? 'gold' : 'red'
                    }
                  >
                    {STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              {
                title: 'Xác minh',
                dataIndex: 'verify',
                render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {job?.status === 'success' && hasRemovedOk && (
          <Button
            style={{ marginTop: 12 }}
            icon={<CloudOutlined />}
            onClick={() => navigate('/cf-task/cf-remove')}
          >
            Chuyển sang Xoá khỏi Cloudflare
          </Button>
        )}
      </Card>
    </PageContainer>
  );
};

export default RemoveWpsite;
