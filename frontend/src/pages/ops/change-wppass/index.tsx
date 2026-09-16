import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import DomainSelect from '@/components/DomainSelect';
import VerifyBadge from '@/components/VerifyBadge';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listDomains, triggerChangeWppass } from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { CopyOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, App, Button, Card, Checkbox, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

const STATUS_LABELS: Record<string, string> = {
  OK: 'Đã đổi',
  DRYRUN: 'Dry-run',
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

const ChangeWppass: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const [mode, setMode] = usePersistedState<'select' | 'paste'>('change-wppass:mode', 'select');
  const [selected, setSelected] = usePersistedState<string[]>('change-wppass:selected', []);
  const [text, setText] = usePersistedState('change-wppass:text', '');
  const [useCustom, setUseCustom] = usePersistedState('change-wppass:useCustom', false);
  // Plaintext password - intentionally a plain useState, never persisted.
  const [customPassword, setCustomPassword] = useState('');
  const [jobId, setJobId] = usePersistedState<number | undefined>('change-wppass:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  // domain -> matching server rows, from our synced inventory - a domain
  // like a blank WP template deployed identically on every server (e.g.
  // site-trang.com) resolves to more than one, and each is an independent
  // WP install with its own credentials, so the user must pick which one.
  const [domainServersMap, setDomainServersMap] = useState<Record<string, { server_name: string; server_ip: string }[]>>({});
  const [domainServerChoice, setDomainServerChoice] = useState<Record<string, string>>({});

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setSelected(preset);
      setMode('select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domains = mode === 'select' ? selected : parseDomains(text);

  // Depends on the stable mode/selected/text state, not the freshly-derived
  // `domains` array above (a new array reference every render would refire
  // this on every render instead of only when the input actually changes).
  useEffect(() => {
    const list = mode === 'select' ? selected : parseDomains(text);
    const toFetch = list.filter((d) => !(d in domainServersMap));
    if (!toFetch.length) return;
    Promise.all(
      toFetch.map(async (d) => {
        const res = await listDomains({ domain: d, pageSize: 50, current: 1 });
        const servers = (res.data || [])
          .filter((row) => row.domain === d)
          .map((row) => ({ server_name: row.server_name, server_ip: row.server_ip }));
        return [d, servers] as const;
      }),
    ).then((entries) => {
      setDomainServersMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected, text]);

  const isAmbiguous = (d: string) => (domainServersMap[d]?.length || 0) > 1;
  const needsServerChoice = domains.filter((d) => isAmbiguous(d) && !domainServerChoice[d]);

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Chọn hoặc nhập ít nhất 1 domain');
      return;
    }
    if (needsServerChoice.length) {
      message.warning(`${needsServerChoice.length} domain mơ hồ chưa chọn server: ${needsServerChoice.join(', ')}`);
      return;
    }
    if (useCustom && !customPassword) {
      message.warning('Nhập mật khẩu tuỳ chỉnh hoặc bỏ tick để tự sinh ngẫu nhiên');
      return;
    }
    setRunning(true);
    try {
      const entries = domains.map((d) => ({
        domain: d,
        server_name: isAmbiguous(d) ? domainServerChoice[d] : undefined,
      }));
      const res = await triggerChangeWppass(entries, useCustom ? customPassword : undefined, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setSelected([]);
        setText('');
        setCustomPassword('');
        setDomainServerChoice({});
        clearPersistedState('change-wppass:selected');
        clearPersistedState('change-wppass:text');
      }
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  // Tab-separated (not comma) so pasting into Google Sheets/Excel lands as
  // real columns instead of one blob per row - same convention as every
  // other bulk-copy in this app (see utils/clipboard.ts).
  const handleCopyResults = () => {
    const rows = (job?.result as API.ChangeWppassResult[] | undefined) || [];
    if (!rows.length) return;
    const header = ['Domain', 'Server', 'Admin user', 'Trạng thái', 'Mật khẩu mới', 'Ghi chú'];
    const lines = [header, ...rows.map((r) => [
      r.domain,
      r.server_name,
      r.admin,
      STATUS_LABELS[r.status] || r.status,
      r.new_password || '',
      r.note,
    ])]
      .map((cols) => cols.join('\t'))
      .join('\n');
    copyText(lines, `Đã copy ${rows.length} dòng kết quả`);
  };

  const clearCache = () => {
    setMode('select');
    setSelected([]);
    setText('');
    setUseCustom(false);
    setCustomPassword('');
    setJobId(undefined);
    ['mode', 'selected', 'text', 'useCustom', 'jobId'].forEach((k) => clearPersistedState(`change-wppass:${k}`));
  };

  return (
    <PageContainer title="Đổi mật khẩu Admin WordPress" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Mặc định mỗi domain sẽ được sinh 1 mật khẩu ngẫu nhiên riêng (an toàn hơn dùng chung 1 mật khẩu cho mọi site). Có thể bật tuỳ chọn để đặt 1 mật khẩu cố định cho tất cả."
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
            placeholder="Nhập danh sách domain, mỗi dòng 1 domain..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}

        {domains.length > 0 && domains.some((d) => isAmbiguous(d)) && (
          <Table<{ domain: string }>
            size="small"
            style={{ marginTop: 12 }}
            pagination={false}
            rowKey="domain"
            dataSource={domains.map((d) => ({ domain: d }))}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Server',
                render: (_, r) => {
                  const servers = domainServersMap[r.domain];
                  if (!servers) return <Typography.Text type="secondary">Đang tải...</Typography.Text>;
                  if (servers.length <= 1) return servers[0]?.server_name || '-';
                  return (
                    <Select
                      size="small"
                      style={{ width: 280 }}
                      status={domainServerChoice[r.domain] ? undefined : 'error'}
                      placeholder={`⚠ Mơ hồ - chọn 1 trong ${servers.length} server`}
                      value={domainServerChoice[r.domain]}
                      onChange={(v) => setDomainServerChoice((prev) => ({ ...prev, [r.domain]: v }))}
                      options={servers.map((s) => ({
                        value: s.server_name,
                        label: `${s.server_name} (${s.server_ip})`,
                      }))}
                    />
                  );
                },
              },
            ]}
          />
        )}

        <div style={{ marginTop: 12 }}>
          <Checkbox checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)}>
            Dùng mật khẩu tuỳ chỉnh (áp dụng cho tất cả domain ở trên)
          </Checkbox>
          {useCustom && (
            <Input.Password
              style={{ marginTop: 8, maxWidth: 320 }}
              placeholder="Mật khẩu mới"
              value={customPassword}
              onChange={(e) => setCustomPassword(e.target.value)}
            />
          )}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button
            loading={running || isBusy}
            onClick={() => run(true)}
            disabled={!domains.length || needsServerChoice.length > 0}
          >
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Đổi mật khẩu Admin"
            targets={domains}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button
              danger
              type="primary"
              loading={running || isBusy}
              disabled={!domains.length || needsServerChoice.length > 0}
            >
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
            <Space style={{ marginTop: 16 }}>
              <Button icon={<CopyOutlined />} onClick={handleCopyResults}>
                Copy kết quả
              </Button>
            </Space>
            <Table<API.ChangeWppassResult>
              style={{ marginTop: 8 }}
              rowKey="domain"
              dataSource={job.result}
              pagination={false}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                { title: 'Server', dataIndex: 'server_name' },
                { title: 'Admin user', dataIndex: 'admin' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v) => (
                    <Tag color={v === 'OK' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                      {STATUS_LABELS[v] || v}
                    </Tag>
                  ),
                },
                {
                  title: 'Mật khẩu mới',
                  dataIndex: 'new_password',
                  render: (v) => (v ? <Typography.Text copyable>{v}</Typography.Text> : '-'),
                },
                {
                  title: 'Xác minh',
                  dataIndex: 'verify',
                  render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
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

export default ChangeWppass;
