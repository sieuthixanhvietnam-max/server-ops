import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import FirewallTemplateSummary from '@/components/FirewallTemplateSummary';
import JobLogPanel from '@/components/JobLogPanel';
import JobResultActions from '@/components/JobResultActions';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listCfFirewallTemplates, triggerCfFirewallUpdate } from '@/services/serverOps/api';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { WarningFilled } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useNavigate } from '@umijs/max';
import { Alert, App, Button, Card, Input, Segmented, Select, Table, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

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
  const navigate = useNavigate();
  const [mode, setMode] = usePersistedState<Mode>('cf-firewall:mode', 'domains');
  const [text, setText] = usePersistedState('cf-firewall:text', '');
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-firewall:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  const [templates, setTemplates] = useState<API.CfFirewallTemplateItem[]>([]);
  const [templateId, setTemplateId] = usePersistedState<number | undefined>('cf-firewall:templateId', undefined);

  useEffect(() => {
    listCfFirewallTemplates().then((res) => {
      const data = res.data || [];
      setTemplates(data);
      // Lần đầu chưa chọn gì (hoặc template đã chọn trước đó bị xoá) - về
      // template mặc định cho an toàn, không để trống.
      if (!data.some((t) => t.id === templateId)) {
        setTemplateId(data.find((t) => t.is_default)?.id ?? data[0]?.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const baseRulesDisabled =
    !!selectedTemplate &&
    (!selectedTemplate.skip_safety_enabled ||
      !selectedTemplate.block_bad_ports_enabled ||
      !selectedTemplate.block_bad_ua_enabled);
  const domains = parseDomains(text);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';
  const canRun = (mode === 'all_zones' || domains.length > 0) && !!templateId;

  const changeMode = (next: Mode) => {
    setMode(next);
    setJobId(undefined);
  };

  const run = async (dryRun: boolean) => {
    if (mode === 'domains' && !domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    if (!templateId) {
      message.warning('Chọn 1 template Firewall trước');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfFirewallUpdate(mode, mode === 'domains' ? domains : [], dryRun, templateId);
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
          message="Áp bộ Firewall rule lên zone - chọn template bên dưới cho phần chặn theo quốc gia/bot/path/Bot Fight Mode."
          description="Whitelist IP, chặn port lạ và chặn UA không giống browser thật luôn cố định cho mọi template (không đổi được tại đây). Whitelist IP lấy từ trang 'Whitelist IP (Firewall)' tại thời điểm chạy - sửa xong quay lại đây chạy lại để áp dụng, việc sửa không tự động áp lên zone đang có."
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

        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Typography.Text strong>Template Firewall:</Typography.Text>
          <Select
            style={{ minWidth: 280 }}
            value={templateId}
            onChange={setTemplateId}
            options={templates.map((t) => ({ value: t.id, label: t.is_default ? `${t.name} (mặc định)` : t.name }))}
            placeholder="Chọn template..."
          />
          <Button size="small" type="link" onClick={() => navigate('/data/cf-firewall-templates')}>
            Quản lý template
          </Button>
        </div>
        {selectedTemplate && (
          <Card size="small" style={{ marginBottom: 12 }}>
            <FirewallTemplateSummary tpl={selectedTemplate} />
          </Card>
        )}

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
            extra={
              selectedTemplate && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Template "{selectedTemplate.name}" sẽ áp dụng:
                  </Typography.Text>
                  <div style={{ marginTop: 4 }}>
                    <FirewallTemplateSummary tpl={selectedTemplate} />
                  </div>
                  {baseRulesDisabled && (
                    <Alert
                      type="error"
                      showIcon
                      icon={<WarningFilled />}
                      style={{ marginTop: 8 }}
                      message="Template này đã TẮT ít nhất 1 trong 3 rule nền (xem tag màu đỏ phía trên) - rule chặn quốc gia/bot/path có thể tự chặn nhầm IP whitelist hoặc Googlebot. Kiểm tra lại kỹ trước khi tiếp tục."
                    />
                  )}
                  {mode === 'all_zones' && !selectedTemplate.is_default && (
                    <Alert
                      type="error"
                      showIcon
                      icon={<WarningFilled />}
                      style={{ marginTop: 8 }}
                      message="Đang áp template TUỲ CHỈNH cho TOÀN BỘ zone trong account - kiểm tra lại nội dung template phía trên trước khi tiếp tục."
                    />
                  )}
                </div>
              )
            }
          >
            <Button danger type="primary" loading={isBusy} disabled={!canRun}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
            <JobResultActions
              headers={['Domain', 'Template', 'Trạng thái', 'Ghi chú']}
              rows={(job.result as API.CfFirewallUpdateResult[]).map((r) => [
                r.domain,
                r.template || '',
                STATUS_LABELS[r.status] || r.status,
                r.note || '',
              ])}
              filename="cf-firewall-update-result.csv"
              countLabel={`${job.result?.length || 0} dòng kết quả`}
            />
            <Table<API.CfFirewallUpdateResult>
              size="small"
              style={{ marginTop: 8 }}
              rowKey="domain"
              dataSource={job.result}
              pagination={DEFAULT_PAGINATION}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                { title: 'Template', dataIndex: 'template' },
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
