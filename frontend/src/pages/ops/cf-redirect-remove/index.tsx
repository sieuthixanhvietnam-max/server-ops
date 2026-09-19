import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerCfRedirectRemove } from '@/services/serverOps/api';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, App, Button, Card, Input, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

const STATUS_LABELS: Record<string, string> = {
  removed: 'Đã xoá',
  none: 'Không có redirect',
  DRYRUN: 'Dry-run',
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

const CfRedirectRemove: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const [text, setText] = usePersistedState('cf-redirect-remove:text', '');
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-redirect-remove:jobId', undefined);
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
      const res = await triggerCfRedirectRemove(domains, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setText('');
        clearPersistedState('cf-redirect-remove:text');
      }
    } catch (err: any) {
      message.error(`Lỗi khi xoá redirect: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const clearCache = () => {
    setText('');
    setJobId(undefined);
    ['text', 'jobId'].forEach((k) => clearPersistedState(`cf-redirect-remove:${k}`));
  };

  return (
    <PageContainer title="Xoá Redirect 301" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Xoá TOÀN BỘ Page Rule redirect (301) đang có trên domain - không thể hoàn tác."
          description="Domain trở lại phục vụ nội dung trên server bình thường thay vì chuyển hướng. Domain không có redirect rule nào sẽ được bỏ qua. Không đụng tới các Page Rule khác (nếu có) không phải loại forwarding_url."
        />
        <TextArea
          rows={8}
          placeholder="Nhập danh sách domain cần xoá redirect, mỗi dòng 1 domain..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button loading={running || isBusy} onClick={() => run(true)}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Xoá Redirect 301"
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
          <Table<API.CfRedirectRemoveResult>
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
                          : v === 'none'
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

export default CfRedirectRemove;
