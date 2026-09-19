import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerCfRemove } from '@/services/serverOps/api';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, App, Button, Card, Input, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

const STATUS_LABELS: Record<string, string> = {
  removed: 'Đã xoá',
  DRYRUN: 'Dry-run',
  not_found: 'Không tìm thấy zone',
  error: 'Lỗi',
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

const CfRemove: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const [text, setText] = usePersistedState('cf-remove:text', '');
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-remove:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setText(preset.join('\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domains = parseDomains(text);

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfRemove(domains, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setText('');
        clearPersistedState('cf-remove:text');
      }
    } catch (err: any) {
      message.error(`Lỗi khi xoá domain khỏi Cloudflare: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const clearCache = () => {
    setText('');
    setJobId(undefined);
    ['text', 'jobId'].forEach((k) => clearPersistedState(`cf-remove:${k}`));
  };

  return (
    <PageContainer title="Xoá Domain khỏi Cloudflare" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Xoá VĨNH VIỄN toàn bộ zone Cloudflare của domain - không thể hoàn tác."
          description="Bao gồm DNS record, SSL, firewall, mọi cấu hình; phải thêm lại từ đầu nếu cần dùng lại. KHÔNG đụng tới site/database trên server - dùng 'Xoá WordPress Site' cho việc đó. Domain chưa có trên Cloudflare sẽ được bỏ qua."
        />
        <TextArea
          rows={8}
          placeholder="Nhập danh sách domain cần xoá khỏi Cloudflare, mỗi dòng 1 domain..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button loading={running || isBusy} onClick={() => run(true)}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Xoá Domain khỏi Cloudflare"
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
          <Table<API.CfRemoveResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag
                    color={
                      v === 'removed'
                        ? 'green'
                        : v === 'DRYRUN'
                          ? 'blue'
                          : v === 'not_found'
                            ? 'gold'
                            : 'red'
                    }
                  >
                    {STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default CfRemove;
