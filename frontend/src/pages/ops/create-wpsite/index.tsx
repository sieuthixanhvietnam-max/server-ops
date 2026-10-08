import CfAddResultPanel from '@/components/CfAddResultPanel';
import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import VerifyBadge from '@/components/VerifyBadge';
import JobLogPanel from '@/components/JobLogPanel';
import JobResultActions from '@/components/JobResultActions';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import {
  checkCfZonesBatch,
  checkDomainsExistBatch,
  checkDomainsHttpBatch,
  getTemplateInfoBatch,
  listCfAccountOptions,
  listDomains,
  listPics,
  suggestCfAccount,
  triggerCfAdd,
  triggerCreateWpsite,
} from '@/services/serverOps/api';
import { buildAccountSelectOptions } from '@/utils/cfAccountOptions';
import { PageContainer } from '@ant-design/pro-components';
import {
  CheckCircleFilled,
  ClockCircleFilled,
  PlusOutlined,
  QuestionCircleFilled,
  WarningFilled,
} from '@ant-design/icons';
import { Alert, App, Button, Card, Input, Select, Space, Table, Tag, theme, Tooltip, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { TextArea } = Input;

type ServerOption = { server_name: string; server_ip: string };

type Row = {
  domain: string;
  hasZone?: boolean;
  nsStatus?: string;
  exists?: boolean;
};

const CREATE_STATUS_LABELS: Record<string, string> = {
  OK: 'Đã tạo',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
};

const DNS_STATUS_LABELS: Record<string, string> = {
  updated: 'Đã cập nhật',
  unchanged: 'Không đổi',
  error: 'Lỗi',
};

const verifyToText = (v?: API.VerifyInfo): string => {
  if (!v) return '';
  const parts = [`HTTP ${v.http_status}`, v.ok ? 'OK' : v.gone ? 'GONE' : 'FAIL'];
  if (v.note) parts.push(v.note);
  return parts.join(' - ');
};

const parseDomains = (text: string) =>
  Array.from(new Set(text.split(/\r?\n/).map((d) => d.trim().toLowerCase()).filter(Boolean)));

/** Most-common non-empty value in a list - used to flag whichever template
 * disagrees with the rest (WP core / PHP version / theme), not to judge
 * which value is "correct". */
const majorityValue = (values: (string | undefined)[]): string | undefined => {
  const counts = new Map<string, number>();
  values.forEach((v) => {
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  });
  let best: string | undefined;
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
};

const NsTag: React.FC<{ status?: string }> = ({ status }) => {
  if (status === 'active')
    return (
      <Tag icon={<CheckCircleFilled />} color="success">
        NS Active
      </Tag>
    );
  if (status === 'pending')
    return (
      <Tag icon={<ClockCircleFilled />} color="gold">
        NS Pending
      </Tag>
    );
  return (
    <Tag icon={<QuestionCircleFilled />} color="default">
      NS ?
    </Tag>
  );
};

const CreateWpsite: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [source, setSource] = usePersistedState('create-wpsite:source', '');
  const [sourceServers, setSourceServers] = useState<ServerOption[]>([]);
  const [destServer, setDestServer] = usePersistedState<string | undefined>('create-wpsite:destServer', undefined);

  const [pics, setPics] = useState<API.PicItem[]>([]);
  const [selectedPic, setSelectedPic] = usePersistedState<string | undefined>('create-wpsite:pic', undefined);
  const [templateOptions, setTemplateOptions] = useState<API.DomainItem[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, API.DomainHealthResult>>({});
  const [healthChecking, setHealthChecking] = useState(false);
  const [infoMap, setInfoMap] = useState<Record<string, API.TemplateInfoResult>>({});
  const [infoChecking, setInfoChecking] = useState(false);

  const [domainsText, setDomainsText] = usePersistedState('create-wpsite:domainsText', '');
  const [rows, setRows] = usePersistedState<Row[]>('create-wpsite:rows', []);
  const [checking, setChecking] = useState(false);

  const [accountOptions, setAccountOptions] = useState<API.CfAccountOption[]>([]);
  const [cfAccountId, setCfAccountId] = usePersistedState<number | undefined>('create-wpsite:cfAccountId', undefined);
  const [cfPics, setCfPics] = useState<string[]>([]);
  const [cfReason, setCfReason] = useState('');
  const [cfSuggesting, setCfSuggesting] = useState(false);
  const [cfRunning, setCfRunning] = useState(false);
  const [cfJobId, setCfJobId] = usePersistedState<number | undefined>('create-wpsite:cfJobId', undefined);
  const cfJob = useJobPolling(cfJobId);

  const [jobId, setJobId] = usePersistedState<number | undefined>('create-wpsite:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';

  useEffect(() => {
    listCfAccountOptions().then((res) => setAccountOptions(res.data || []));
    listPics().then((res) => setPics(res.data || []));
  }, []);

  useEffect(() => {
    setTemplateLoading(true);
    setHealthMap({});
    setInfoMap({});
    listDomains({ domain: 'wp-template.site', pic: selectedPic, pageSize: 100 })
      .then((res) => setTemplateOptions(res.data || []))
      .finally(() => setTemplateLoading(false));
  }, [selectedPic]);

  const runHealthCheck = async () => {
    if (!templateOptions.length) return;
    setHealthChecking(true);
    try {
      const res = await checkDomainsHttpBatch(templateOptions.map((d) => d.domain));
      setHealthMap(res.data || {});
    } finally {
      setHealthChecking(false);
    }
  };

  const runInfoCheck = async () => {
    if (!templateOptions.length) return;
    setInfoChecking(true);
    try {
      const res = await getTemplateInfoBatch(templateOptions.map((d) => d.domain));
      setInfoMap(res.data || {});
    } finally {
      setInfoChecking(false);
    }
  };

  useEffect(() => {
    if (cfJob?.status === 'success') handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfJob?.status]);

  const destIp = sourceServers.find((s) => s.server_name === destServer)?.server_ip;
  const missingZoneTargets = rows.filter((r) => r.hasZone === false).map((r) => r.domain);
  const readyTargets = rows.filter((r) => r.hasZone === true).map((r) => r.domain);
  const existingCount = rows.filter((r) => r.exists).length;
  const notCheckedCount = rows.filter((r) => r.hasZone === undefined).length;

  const handleTemplateSelect = (domain: string) => {
    const opt = templateOptions.find((d) => d.domain === domain);
    setSource(domain);
    setDestServer(opt?.server_name);
    setSourceServers(opt ? [{ server_name: opt.server_name, server_ip: opt.server_ip }] : []);
  };

  const addDomains = () => {
    const parsed = parseDomains(domainsText).filter((d) => d !== source);
    if (!parsed.length) return;
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.domain));
      const fresh = parsed.filter((d) => !existing.has(d)).map((domain) => ({ domain }));
      return [...prev, ...fresh];
    });
    setDomainsText('');
  };

  const removeRow = (domain: string) => setRows((prev) => prev.filter((r) => r.domain !== domain));

  const handleCheck = async () => {
    if (!rows.length) return;
    setChecking(true);
    try {
      const targets = rows.map((r) => r.domain);
      const [zoneRes, existsRes] = await Promise.all([
        checkCfZonesBatch(targets),
        checkDomainsExistBatch(targets),
      ]);
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          hasZone: zoneRes.data[r.domain]?.has_zone,
          nsStatus: zoneRes.data[r.domain]?.ns_status,
          exists: existsRes.data[r.domain],
        })),
      );
      const missing = targets.filter((t) => zoneRes.data[t] && !zoneRes.data[t].has_zone);
      if (missing.length && destIp) {
        setCfSuggesting(true);
        try {
          const suggestion = await suggestCfAccount(destIp);
          setCfPics(suggestion.pics || []);
          setCfAccountId(suggestion.suggested_account_id || undefined);
          setCfReason(
            suggestion.pics.length
              ? `Theo PIC ${suggestion.pics.join(', ')} (server ${suggestion.matched_server})`
              : `Server ${suggestion.matched_server || destServer} chưa gán PIC - dùng account mặc định (.env)`,
          );
        } finally {
          setCfSuggesting(false);
        }
      }
    } finally {
      setChecking(false);
    }
  };

  const runCfAdd = async (dryRun: boolean) => {
    if (!destIp) return;
    setCfRunning(true);
    try {
      const res = await triggerCfAdd(missingZoneTargets, destIp, dryRun, cfAccountId);
      setCfJobId(res.job_id);
    } finally {
      setCfRunning(false);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!source || !destServer) {
      message.warning('Chọn domain nguồn và server đích');
      return;
    }
    if (!readyTargets.length) {
      message.warning('Chưa có domain mới nào sẵn sàng (đã kiểm tra CF và có zone)');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCreateWpsite(source, destServer, readyTargets, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setDomainsText('');
        setRows([]);
        clearPersistedState('create-wpsite:domainsText');
        clearPersistedState('create-wpsite:rows');
      }
    } finally {
      setRunning(false);
    }
  };

  const clearCache = () => {
    setSource('');
    setDestServer(undefined);
    setSelectedPic(undefined);
    setHealthMap({});
    setInfoMap({});
    setDomainsText('');
    setRows([]);
    setCfAccountId(undefined);
    setJobId(undefined);
    setCfJobId(undefined);
    ['source', 'destServer', 'pic', 'domainsText', 'rows', 'cfAccountId', 'jobId', 'cfJobId'].forEach((k) =>
      clearPersistedState(`create-wpsite:${k}`),
    );
  };

  const infoRows = templateOptions.map((d) => infoMap[d.domain]).filter(Boolean) as API.TemplateInfoResult[];
  const majorityCore = majorityValue(infoRows.map((r) => r.core_version));
  const majorityPhp = majorityValue(infoRows.map((r) => r.php_version));
  const majorityTheme = majorityValue(infoRows.map((r) => r.theme));

  const renderDriftCell = (value: string | undefined, majority: string | undefined) => {
    if (!value) return <span style={{ color: token.colorTextQuaternary }}>-</span>;
    if (majority && value !== majority) {
      return (
        <Tooltip title={`Khác với đa số template (${majority})`}>
          <Tag color="warning">{value}</Tag>
        </Tooltip>
      );
    }
    return <span>{value}</span>;
  };

  return (
    <PageContainer title="Tạo WordPress mới" extra={<ClearCacheButton onClear={clearCache} />}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Tạo hàng loạt domain mới từ 1 template theo PIC, trên cùng 1 server."
        description="Chọn PIC rồi chọn template tương ứng - domain nguồn và server đích tự khớp theo template đó, không cần chọn tay. Nếu domain đích đã có site đang chạy, site cũ sẽ bị GHI ĐÈ khi chạy thật (hệ thống tự chặn nếu domain đích chính là 1 template khác). Domain đích PHẢI có zone trên Cloudflare trước khi tạo - dùng khối 'Thêm vào Cloudflare' bên dưới nếu còn thiếu."
      />

      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 240, flexShrink: 0 }}>
              <Typography.Text strong>PIC</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                allowClear
                showSearch
                placeholder="Tất cả PIC"
                value={selectedPic}
                onChange={(v) => {
                  setSelectedPic(v);
                  setSource('');
                  setDestServer(undefined);
                  setSourceServers([]);
                }}
                options={pics.map((p) => ({ value: p.code, label: p.code }))}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong>Template (domain nguồn, server đích tự khớp)</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                loading={templateLoading}
                showSearch
                optionFilterProp="label"
                placeholder="Chọn template..."
                value={source || undefined}
                onChange={handleTemplateSelect}
                notFoundContent={templateLoading ? 'Đang tìm...' : 'Không có template cho PIC này'}
                options={[...templateOptions]
                  .sort((a, b) => a.server_name.localeCompare(b.server_name))
                  .map((d) => ({
                    value: d.domain,
                    label: `${d.server_name} (${d.server_ip}) — ${d.domain}`,
                  }))}
              />
            </div>
          </div>

          {source && destServer && (
            <Alert type="success" showIcon message={`Server đích: ${destServer} (${destIp || '?'})`} />
          )}
        </Space>
      </Card>

      {templateOptions.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={`Tình trạng & chi tiết template (${templateOptions.length}${selectedPic ? ` - PIC ${selectedPic}` : ''})`}
          extra={
            <Space>
              <Button size="small" loading={healthChecking} onClick={runHealthCheck}>
                Kiểm tra tình trạng
              </Button>
              <Button size="small" loading={infoChecking} onClick={runInfoCheck}>
                Kiểm tra chi tiết (đồng nhất)
              </Button>
            </Space>
          }
        >
          <Table<API.DomainItem>
            size="small"
            rowKey="domain"
            dataSource={templateOptions}
            pagination={false}
            expandable={{
              rowExpandable: (r) => !!infoMap[r.domain]?.plugins?.length,
              expandedRowRender: (r) => (
                <Table
                  size="small"
                  rowKey="name"
                  dataSource={infoMap[r.domain]?.plugins || []}
                  pagination={false}
                  columns={[
                    { title: 'Plugin', dataIndex: 'name' },
                    {
                      title: 'Trạng thái',
                      dataIndex: 'status',
                      render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag>,
                    },
                    { title: 'Phiên bản', dataIndex: 'version' },
                  ]}
                />
              ),
            }}
            columns={[
              { title: 'Server', dataIndex: 'server_name' },
              {
                title: 'Domain',
                dataIndex: 'domain',
                render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
              },
              {
                title: 'Tình trạng',
                render: (_, r) => {
                  const h = healthMap[r.domain];
                  if (!h) return <Tag>Chưa kiểm tra</Tag>;
                  return (
                    <Tag color={h.ok ? 'success' : 'error'}>{h.ok ? `OK (HTTP ${h.http_status})` : h.note}</Tag>
                  );
                },
              },
              { title: 'WP Core', render: (_, r) => renderDriftCell(infoMap[r.domain]?.core_version, majorityCore) },
              { title: 'PHP', render: (_, r) => renderDriftCell(infoMap[r.domain]?.php_version, majorityPhp) },
              { title: 'Theme', render: (_, r) => renderDriftCell(infoMap[r.domain]?.theme, majorityTheme) },
              {
                title: 'Username',
                render: (_, r) =>
                  infoMap[r.domain]?.username || <span style={{ color: token.colorTextQuaternary }}>-</span>,
              },
              {
                title: 'Plugin',
                render: (_, r) =>
                  infoMap[r.domain] ? infoMap[r.domain].plugins.length : <span style={{ color: token.colorTextQuaternary }}>-</span>,
              },
              {
                title: '',
                width: 90,
                render: (_, r) => (
                  <Button
                    size="small"
                    type={source === r.domain ? 'primary' : 'default'}
                    onClick={() => handleTemplateSelect(r.domain)}
                  >
                    Chọn
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <Typography.Text strong>Danh sách domain mới cần tạo</Typography.Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <TextArea
            rows={3}
            placeholder={'Dán danh sách domain mới, mỗi dòng 1 domain\nVD: newsite1.com\nnewsite2.com'}
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
          <Button icon={<PlusOutlined />} onClick={addDomains} disabled={!domainsText.trim()}>
            Thêm
          </Button>
        </div>

        {rows.length > 0 && (
          <>
            <Table<Row>
              style={{ marginTop: 16 }}
              size="small"
              rowKey="domain"
              dataSource={rows}
              pagination={false}
              columns={[
                {
                  title: 'Domain mới',
                  dataIndex: 'domain',
                  render: (v, r) => (
                    <Space>
                      <span style={{ fontFamily: 'monospace' }}>{v}</span>
                      {r.exists && (
                        <Tooltip title="Đã có site đang chạy trên hệ thống - sẽ bị GHI ĐÈ khi chạy thật">
                          <Tag icon={<WarningFilled />} color="error">
                            đã tồn tại
                          </Tag>
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
                {
                  title: 'Zone CF',
                  width: 140,
                  render: (_, r) =>
                    r.hasZone === undefined ? (
                      <Tag>Chưa kiểm tra</Tag>
                    ) : r.hasZone ? (
                      <Tag icon={<CheckCircleFilled />} color="success">
                        Có zone
                      </Tag>
                    ) : (
                      <Tag icon={<QuestionCircleFilled />} color="warning">
                        Chưa có trên CF
                      </Tag>
                    ),
                },
                {
                  title: 'NS',
                  width: 130,
                  render: (_, r) => (r.hasZone ? <NsTag status={r.nsStatus} /> : <span style={{ color: token.colorTextQuaternary }}>-</span>),
                },
                {
                  title: '',
                  width: 48,
                  render: (_, r) => (
                    <Button size="small" danger type="text" onClick={() => removeRow(r.domain)}>
                      Xoá
                    </Button>
                  ),
                },
              ]}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Button size="small" onClick={() => setRows([])}>
                Xoá tất cả
              </Button>
              <Button size="small" loading={checking} onClick={handleCheck}>
                Kiểm tra trạng thái Cloudflare ({rows.length} domain)
              </Button>
            </div>
          </>
        )}
      </Card>

      {missingZoneTargets.length > 0 && (
        <Card
          size="small"
          type="inner"
          title={`${missingZoneTargets.length} domain chưa có trên Cloudflare`}
          style={{ marginBottom: 16, borderColor: token.colorWarning }}
          loading={cfSuggesting}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <Space wrap>
                {cfPics.length ? (
                  cfPics.map((p) => (
                    <Tag key={p} color="blue">
                      {p}
                    </Tag>
                  ))
                ) : (
                  <Tag>Không xác định PIC</Tag>
                )}
                <Typography.Text type="secondary">
                  Sẽ trỏ về đúng IP server đích ({destIp || '?'})
                </Typography.Text>
              </Space>
              <div style={{ marginTop: 4, fontSize: 12, color: token.colorTextTertiary }}>{cfReason}</div>
              <div style={{ marginTop: 4, fontSize: 12, fontFamily: 'monospace', color: token.colorTextSecondary }}>
                {missingZoneTargets.join(', ')}
              </div>
            </div>
            <Select
              style={{ width: 340 }}
              placeholder="Account CF đích (để trống = mặc định .env)"
              allowClear
              showSearch
              optionFilterProp="label"
              options={buildAccountSelectOptions(accountOptions, cfPics)}
              value={cfAccountId}
              onChange={setCfAccountId}
            />
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button loading={cfRunning} onClick={() => runCfAdd(true)} disabled={!destIp}>
              Xem trước (dry-run)
            </Button>
            <Button type="primary" loading={cfRunning} onClick={() => runCfAdd(false)} disabled={!destIp}>
              Thêm vào Cloudflare
            </Button>
          </div>
          {cfJobId !== undefined && (
            <div style={{ marginTop: 8 }}>
              <JobLogPanel job={cfJob} />
              {(cfJob?.status === 'success' || cfJob?.status === 'failed') && (
                <CfAddResultPanel result={cfJob.result} />
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button loading={isBusy} onClick={() => run(true)} disabled={!readyTargets.length || !destServer}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Tạo WordPress mới"
            targets={readyTargets.map((t) => `${source} -> ${t}`)}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={isBusy} disabled={!readyTargets.length || !destServer}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
          <Space wrap>
            {readyTargets.length > 0 && <Tag color="success">{readyTargets.length} sẵn sàng</Tag>}
            {missingZoneTargets.length > 0 && <Tag color="warning">{missingZoneTargets.length} thiếu CF</Tag>}
            {notCheckedCount > 0 && <Tag>{notCheckedCount} chưa kiểm tra</Tag>}
            {existingCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {existingCount} đích đã có site (sẽ bị ghi đè)
              </Tag>
            )}
          </Space>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
          <JobResultActions
            headers={['Source', 'Target', 'Server IP', 'Trạng thái', 'DNS (Cloudflare)', 'Xác minh', 'Ghi chú']}
            rows={(job.result as API.CloneWpsiteResult[]).map((r) => [
              r.source, r.target, r.ip,
              CREATE_STATUS_LABELS[r.status] || r.status,
              r.dns_status ? (DNS_STATUS_LABELS[r.dns_status] || r.dns_status) : '-',
              verifyToText(r.verify),
              r.note || '',
            ])}
            filename="create-wpsite-result.csv"
          />
          <Table<API.CloneWpsiteResult>
            style={{ marginTop: 16 }}
            rowKey="target"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Source', dataIndex: 'source' },
              { title: 'Target', dataIndex: 'target' },
              { title: 'Server IP', dataIndex: 'ip' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'OK' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                    {CREATE_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              {
                title: 'DNS (Cloudflare)',
                dataIndex: 'dns_status',
                render: (v) =>
                  v ? (
                    <Tag color={v === 'error' ? 'red' : v === 'unchanged' ? 'gold' : 'green'}>
                      {DNS_STATUS_LABELS[v] || v}
                    </Tag>
                  ) : (
                    '-'
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
          </>
        )}
      </Card>

    </PageContainer>
  );
};

export default CreateWpsite;
