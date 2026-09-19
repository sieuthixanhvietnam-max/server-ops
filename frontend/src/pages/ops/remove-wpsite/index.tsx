import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import VerifyBadge from '@/components/VerifyBadge';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listDomains, triggerRemoveWpsite } from '@/services/serverOps/api';
import { CloudOutlined, DisconnectOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation, useNavigate } from '@umijs/max';
import { Alert, App, Button, Card, Input, Segmented, Select, Table, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

type ServerOption = { server_name: string; server_ip: string };

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

  // Domain tồn tại trên >1 server (VD ngay sau khi migrate, domain còn ở cả
  // nguồn lẫn đích) - _resolve_domain_server ở backend từ chối đoán, nên cần
  // cho user chọn rõ server nào trước khi xoá. Cùng pattern với migrate-wpsite.
  const [domainServersMap, setDomainServersMap] = useState<Record<string, ServerOption[]>>({});
  const [serverChoices, setServerChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setSelected(preset);
      setMode('select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domains = mode === 'select' ? selected : parseDomains(text);

  useEffect(() => {
    const toFetch = domains.filter((d) => !(d in domainServersMap));
    if (!toFetch.length) return;
    Promise.all(
      toFetch.map(async (domain) => {
        const res = await listDomains({ domain, pageSize: 50, current: 1 });
        const servers = (res.data || [])
          .filter((d: API.DomainItem) => d.domain === domain)
          .map((d: API.DomainItem) => ({ server_name: d.server_name, server_ip: d.server_ip }));
        return [domain, servers] as const;
      }),
    ).then((entries) => {
      setDomainServersMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains.join('|')]);

  const ambiguousDomains = domains.filter((d) => (domainServersMap[d]?.length || 0) > 1);
  const unresolvedAmbiguousDomains = ambiguousDomains.filter((d) => !serverChoices[d]);
  const serverNames = Object.fromEntries(
    ambiguousDomains.filter((d) => serverChoices[d]).map((d) => [d, serverChoices[d]]),
  );

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Chọn hoặc nhập ít nhất 1 domain');
      return;
    }
    if (unresolvedAmbiguousDomains.length) {
      message.warning(
        `Còn ${unresolvedAmbiguousDomains.length} domain tồn tại trên nhiều server chưa chọn server cần xoá: ${unresolvedAmbiguousDomains.join(', ')}`,
      );
      return;
    }
    setRunning(true);
    try {
      const res = await triggerRemoveWpsite(
        domains,
        dryRun,
        Object.keys(serverNames).length ? serverNames : undefined,
      );
      setJobId(res.job_id);
      if (!dryRun) {
        setSelected([]);
        setText('');
        setDomainServersMap({});
        setServerChoices({});
        clearPersistedState('remove-wpsite:selected');
        clearPersistedState('remove-wpsite:text');
      }
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const okDomains = ((job?.result as API.RemoveWpsiteResult[] | undefined) || [])
    .filter((r) => r.status === 'OK')
    .map((r) => r.domain);
  const hasRemovedOk = okDomains.length > 0;

  const clearCache = () => {
    setMode('select');
    setSelected([]);
    setText('');
    setJobId(undefined);
    setDomainServersMap({});
    setServerChoices({});
    ['mode', 'selected', 'text', 'jobId'].forEach((k) => clearPersistedState(`remove-wpsite:${k}`));
  };

  return (
    <PageContainer title="Xoá WordPress Site" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Thao tác này xoá vĩnh viễn database, file, cron, SSL của domain. Server được tự động xác định từ domain đã đồng bộ - nếu domain gắn với nhiều server, hệ thống sẽ yêu cầu chọn rõ server cần xoá (không tự đoán)."
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

        {ambiguousDomains.length > 0 && (
          <Card
            size="small"
            style={{ marginTop: 12 }}
            title={`⚠ ${ambiguousDomains.length} domain tồn tại trên nhiều server - chọn server cần xoá`}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ambiguousDomains.map((domain) => {
                const servers = domainServersMap[domain] || [];
                return (
                  <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ minWidth: 200 }}>{domain}</span>
                    <Select
                      style={{ flex: 1 }}
                      size="small"
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      status={serverChoices[domain] ? undefined : 'error'}
                      placeholder={`Chọn 1 trong ${servers.length} server - bỏ qua sẽ báo lỗi domain này khi chạy`}
                      value={serverChoices[domain]}
                      onChange={(v) =>
                        setServerChoices((prev) => {
                          const next = { ...prev };
                          if (v) next[domain] = v;
                          else delete next[domain];
                          return next;
                        })
                      }
                      options={servers.map((s) => ({
                        value: s.server_name,
                        label: `${s.server_name} (${s.server_ip})`,
                      }))}
                    />
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button
            loading={running || isBusy}
            disabled={!domains.length || unresolvedAmbiguousDomains.length > 0}
            onClick={() => run(true)}
          >
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Xoá WordPress Site"
            targets={domains}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button
              danger
              type="primary"
              loading={running || isBusy}
              disabled={!domains.length || unresolvedAmbiguousDomains.length > 0}
            >
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
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button
              icon={<CloudOutlined />}
              onClick={() => navigate('/cf-task/cf-remove', { state: { domains: okDomains } })}
            >
              Chuyển sang Xoá khỏi Cloudflare
            </Button>
            <Button
              icon={<DisconnectOutlined />}
              onClick={() => navigate('/cf-task/cf-redirect-remove', { state: { domains: okDomains } })}
            >
              Chuyển sang Xoá Redirect 301
            </Button>
          </div>
        )}
      </Card>
    </PageContainer>
  );
};

export default RemoveWpsite;
