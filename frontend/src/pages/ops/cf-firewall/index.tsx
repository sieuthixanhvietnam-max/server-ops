import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerCfFirewallUpdate } from '@/services/serverOps/api';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Input, Segmented, Table, Tag, Typography } from 'antd';
import React, { useState } from 'react';

const { TextArea } = Input;

type Mode = 'domains' | 'all_zones';

const STATUS_LABELS: Record<string, string> = {
  ok: 'Đã áp dụng',
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

const ALL_ZONES_LABEL = 'TOÀN BỘ ZONE TRONG ACCOUNT (quét lúc chạy job, có thể tới hàng chục nghìn zone)';

const CfFirewall: React.FC = () => {
  const { message } = App.useApp();
  const [mode, setMode] = usePersistedState<Mode>('cf-firewall:mode', 'domains');
  const [text, setText] = usePersistedState('cf-firewall:text', '');
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-firewall:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  const domains = parseDomains(text);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';
  const canRun = mode === 'all_zones' || domains.length > 0;

  const changeMode = (next: Mode) => {
    setMode(next);
    setJobId(undefined);
  };

  const run = async (dryRun: boolean) => {
    if (mode === 'domains' && !domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfFirewallUpdate(mode, mode === 'domains' ? domains : [], dryRun);
      setJobId(res.job_id);
      if (!dryRun && mode === 'domains') {
        setText('');
        clearPersistedState('cf-firewall:text');
      }
    } catch (err: any) {
      message.error(`Lỗi: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const clearCache = () => {
    setMode('domains');
    setText('');
    setJobId(undefined);
    ['mode', 'text', 'jobId'].forEach((k) => clearPersistedState(`cf-firewall:${k}`));
  };

  return (
    <PageContainer title="Firewall" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Áp lại bộ Firewall rule chuẩn (whitelist bot/office IP, chặn country/UA/xmlrpc bất thường) lên zone."
          description="Whitelist IP lấy từ trang 'Whitelist IP (Firewall)' tại thời điểm chạy - sửa danh sách đó xong thì quay lại đây chạy để áp dụng, việc sửa không tự động áp lên zone đang có."
        />

        <Segmented
          options={[
            { label: 'Domain cụ thể', value: 'domains' },
            { label: 'Toàn bộ zone trong account', value: 'all_zones' },
          ]}
          value={mode}
          onChange={(v) => changeMode(v as Mode)}
          block
          style={{ marginBottom: 12 }}
        />

        {mode === 'domains' ? (
          <TextArea
            rows={8}
            placeholder="Nhập danh sách domain, mỗi dòng 1 domain..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            message="Sẽ quét và áp dụng cho MỌI zone mà master token nhìn thấy - không giới hạn domain đang quản lý trong hệ thống này."
            description="Job chạy theo batch 100 zone + nghỉ 10s giữa các batch để tránh rate limit Cloudflare - có thể mất 30-60 phút với quy mô lớn. Không cần chờ, có thể theo dõi lại ở Job History."
          />
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button loading={isBusy} onClick={() => run(true)} disabled={!canRun}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Áp dụng Firewall"
            targets={mode === 'domains' ? domains : [ALL_ZONES_LABEL]}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={isBusy} disabled={!canRun}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
            <Typography.Text type="secondary">{job.result?.length || 0} dòng kết quả</Typography.Text>
            <Table<API.CfFirewallUpdateResult>
              size="small"
              style={{ marginTop: 8 }}
              rowKey="domain"
              dataSource={job.result}
              pagination={DEFAULT_PAGINATION}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v) => (
                    <Tag color={v === 'ok' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                      {STATUS_LABELS[v] || v}
                    </Tag>
                  ),
                },
                { title: 'Ghi chú', dataIndex: 'note' },
              ]}
            />
          </>
        )}
      </Card>
    </PageContainer>
  );
};

export default CfFirewall;
