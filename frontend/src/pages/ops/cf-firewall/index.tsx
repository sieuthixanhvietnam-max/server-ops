import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import FirewallPresetCard, { isPresetSafe } from '@/components/FirewallPresetCard';
import FirewallPresetSummary from '@/components/FirewallPresetSummary';
import JobLogPanel from '@/components/JobLogPanel';
import JobResultActions from '@/components/JobResultActions';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listFirewallPresets, triggerCfFirewallUpdate } from '@/services/serverOps/api';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { FileSearchOutlined, SettingOutlined, WarningFilled } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useNavigate } from '@umijs/max';
import { Alert, App, Button, Card, Col, Divider, Input, Row, Segmented, Space, Table, Tag, Typography } from 'antd';
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

  const [presets, setPresets] = useState<API.FirewallPresetItem[]>([]);
  const [presetId, setPresetId] = usePersistedState<number | undefined>('cf-firewall:presetId', undefined);

  useEffect(() => {
    listFirewallPresets().then((res) => {
      const data = res.data || [];
      setPresets(data);
      // Lần đầu chưa chọn gì (hoặc preset đã chọn trước đó bị xoá) - về
      // preset mặc định cho an toàn, không để trống.
      if (!data.some((p) => p.id === presetId)) {
        setPresetId(data.find((p) => p.is_default)?.id ?? data[0]?.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPreset = presets.find((p) => p.id === presetId);
  const baseRulesDisabled = !!selectedPreset && !isPresetSafe(selectedPreset);
  const domains = parseDomains(text);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';
  const canRun = (mode === 'all_zones' || domains.length > 0) && !!presetId;

  const results = (job?.result as API.CfFirewallUpdateResult[]) || [];

  const changeMode = (next: Mode) => {
    setMode(next);
    setJobId(undefined);
  };

  const run = async (dryRun: boolean) => {
    if (mode === 'domains' && !domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    if (!presetId) {
      message.warning('Chọn 1 Firewall Preset trước');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfFirewallUpdate(mode, mode === 'domains' ? domains : [], dryRun, presetId);
      setJobId(res.job_id);
      if (!dryRun && mode === 'domains') {
        setText('');
        clearPersistedState('cf-firewall:text');
      }
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
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Chọn Firewall Preset, chọn phạm vi domain rồi áp dụng."
          description="Mỗi preset tự mang theo danh sách IP whitelist riêng - sửa ở trang 'Firewall Preset' xong quay lại đây chạy lại để áp dụng, việc sửa không tự động áp lên zone đang có."
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>Firewall Preset</Typography.Text>
          <Button size="small" type="link" icon={<SettingOutlined />} onClick={() => navigate('/data/firewall-presets')}>
            Quản lý preset
          </Button>
        </div>
        <Row gutter={[16, 16]}>
          {presets.map((p) => (
            <Col key={p.id} xs={24} sm={12} lg={8}>
              <FirewallPresetCard preset={p} selected={p.id === presetId} onClick={() => setPresetId(p.id)} />
            </Col>
          ))}
        </Row>

        <Divider />

        <Typography.Text strong>Phạm vi áp dụng</Typography.Text>
        <Segmented
          options={[
            { label: 'Domain cụ thể', value: 'domains' },
            { label: 'Toàn bộ zone trong account', value: 'all_zones' },
          ]}
          value={mode}
          onChange={(v) => changeMode(v as Mode)}
          block
          style={{ marginTop: 8, marginBottom: 12 }}
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

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <Button icon={<FileSearchOutlined />} loading={isBusy} onClick={() => run(true)} disabled={!canRun}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Áp dụng Firewall"
            targets={mode === 'domains' ? domains : [ALL_ZONES_LABEL]}
            onConfirm={() => run(false)}
            loading={running}
            extra={
              selectedPreset && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Preset "{selectedPreset.name}" sẽ áp dụng:
                  </Typography.Text>
                  <div style={{ marginTop: 4 }}>
                    <FirewallPresetSummary preset={selectedPreset} />
                  </div>
                  {baseRulesDisabled && (
                    <Alert
                      type="error"
                      showIcon
                      icon={<WarningFilled />}
                      style={{ marginTop: 8 }}
                      message="Preset này đã TẮT ít nhất 1 rule nền (xem tag màu đỏ phía trên) - rule chặn quốc gia/bot/path có thể tự chặn nhầm IP whitelist hoặc Googlebot. Kiểm tra lại kỹ trước khi tiếp tục."
                    />
                  )}
                  {mode === 'all_zones' && !selectedPreset.is_default && (
                    <Alert
                      type="error"
                      showIcon
                      icon={<WarningFilled />}
                      style={{ marginTop: 8 }}
                      message="Đang áp preset TUỲ CHỈNH cho TOÀN BỘ zone trong account - kiểm tra lại nội dung preset phía trên trước khi tiếp tục."
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
            <Divider style={{ margin: '16px 0' }} />
            <JobResultActions
              headers={['Domain', 'Preset', 'Trạng thái', 'Ghi chú']}
              rows={results.map((r) => [r.domain, r.preset || '', STATUS_LABELS[r.status] || r.status, r.note || ''])}
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
                { title: 'Preset', dataIndex: 'preset' },
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
      </Card>
    </PageContainer>
  );
};

export default CfFirewall;
