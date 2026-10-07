import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import FirewallTemplateSummary from '@/components/FirewallTemplateSummary';
import JobLogPanel from '@/components/JobLogPanel';
import JobResultActions from '@/components/JobResultActions';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listCfFirewallTemplates, triggerCfFirewallUpdate } from '@/services/serverOps/api';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  FileSearchOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useNavigate } from '@umijs/max';
import { Alert, App, Button, Card, Col, Divider, Input, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

type Mode = 'domains' | 'all_zones';

const STATUS_LABELS: Record<string, string> = {
  ok: 'Đã áp dụng',
  DRYRUN: 'Dry-run',
  error: 'Lỗi',
};

const STATUS_COLORS: Record<string, string> = {
  ok: '#3f8600',
  DRYRUN: '#1890ff',
  error: '#cf1322',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  ok: <CheckCircleFilled />,
  DRYRUN: <FileSearchOutlined />,
  error: <CloseCircleFilled />,
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

/** A section Card with a numbered step badge in its title - the 3 sections
 * of this page always run in the same order (scope -> template -> apply),
 * so the number reinforces that without needing a heavier Steps widget. */
const StepCard: React.FC<{
  step: number;
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ step, icon, title, extra, children }) => (
  <Card
    title={
      <Space>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#1890ff',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {step}
        </span>
        {icon}
        <span>{title}</span>
      </Space>
    }
    extra={extra}
  >
    {children}
  </Card>
);

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
    (!selectedTemplate.skip_whitelist_ip ||
      !selectedTemplate.skip_verified_bot ||
      selectedTemplate.allowed_ports.length === 0 ||
      selectedTemplate.allowed_ua_substrings.length === 0 ||
      (selectedTemplate.skip_paths.length === 0 &&
        selectedTemplate.skip_asns.length === 0 &&
        !selectedTemplate.skip_whitelist_ip &&
        !selectedTemplate.skip_verified_bot));
  const domains = parseDomains(text);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';
  const canRun = (mode === 'all_zones' || domains.length > 0) && !!templateId;

  const results = (job?.result as API.CfFirewallUpdateResult[]) || [];
  const statusCounts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

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
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Chọn phạm vi domain, chọn Template rồi áp dụng Firewall."
        description="Whitelist IP lấy từ trang 'Whitelist IP (Firewall)' tại thời điểm chạy - sửa xong quay lại đây chạy lại để áp dụng, việc sửa không tự động áp lên zone đang có."
      />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <StepCard step={1} icon={<GlobalOutlined />} title="Phạm vi áp dụng">
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
        </StepCard>

        <StepCard
          step={2}
          icon={<SafetyCertificateOutlined />}
          title="Template Firewall"
          extra={
            <Button size="small" type="link" icon={<SettingOutlined />} onClick={() => navigate('/data/cf-firewall-templates')}>
              Quản lý template
            </Button>
          }
        >
          <Select
            style={{ minWidth: 320 }}
            value={templateId}
            onChange={setTemplateId}
            options={templates.map((t) => ({ value: t.id, label: t.is_default ? `${t.name} (mặc định)` : t.name }))}
            placeholder="Chọn template..."
          />
          {selectedTemplate && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderLeft: `4px solid ${baseRulesDisabled ? '#ff4d4f' : '#52c41a'}`,
              }}
            >
              <FirewallTemplateSummary tpl={selectedTemplate} />
            </div>
          )}
        </StepCard>

        <StepCard step={3} icon={<ThunderboltOutlined />} title="Áp dụng">
          <Space>
            <Button icon={<FileSearchOutlined />} loading={isBusy} onClick={() => run(true)} disabled={!canRun}>
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
              <Button danger type="primary" icon={<ThunderboltOutlined />} loading={isBusy} disabled={!canRun}>
                Chạy thật
              </Button>
            </DangerPopconfirm>
          </Space>

          <JobLogPanel job={job} />

          {(job?.status === 'success' || job?.status === 'failed') && (
            <>
              <Divider style={{ margin: '16px 0' }} />
              <Row gutter={32} style={{ marginBottom: 12 }}>
                <Col>
                  <Statistic title="Tổng" value={results.length} />
                </Col>
                {Object.entries(statusCounts).map(([status, count]) => (
                  <Col key={status}>
                    <Statistic
                      title={STATUS_LABELS[status] || status}
                      value={count}
                      valueStyle={{ color: STATUS_COLORS[status] }}
                      prefix={STATUS_ICONS[status]}
                    />
                  </Col>
                ))}
              </Row>
              <JobResultActions
                headers={['Domain', 'Template', 'Trạng thái', 'Ghi chú']}
                rows={results.map((r) => [r.domain, r.template || '', STATUS_LABELS[r.status] || r.status, r.note || ''])}
                filename="cf-firewall-update-result.csv"
                countLabel={`${results.length} dòng kết quả`}
              />
              <Table<API.CfFirewallUpdateResult>
                size="small"
                style={{ marginTop: 8 }}
                rowKey="domain"
                dataSource={job?.result}
                pagination={DEFAULT_PAGINATION}
                columns={[
                  { title: 'Domain', dataIndex: 'domain' },
                  { title: 'Template', dataIndex: 'template' },
                  {
                    title: 'Trạng thái',
                    dataIndex: 'status',
                    render: (v) => <Tag color={v === 'ok' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>{STATUS_LABELS[v] || v}</Tag>,
                  },
                  { title: 'Ghi chú', dataIndex: 'note' },
                ]}
              />
            </>
          )}
        </StepCard>
      </Space>
    </PageContainer>
  );
};

export default CfFirewall;
