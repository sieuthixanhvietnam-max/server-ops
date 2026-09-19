import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import JobProgressBar from '@/components/JobProgressBar';
import VerifyBadge from '@/components/VerifyBadge';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listDomains, listServers, triggerMigrateWpsite, triggerRemoveWpsite } from '@/services/serverOps/api';
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS } from '@/utils/jobConstants';
import { RESULT_STATUS_COLORS } from '@/utils/resultStatus';
import { MinusCircleOutlined, PlusOutlined, WarningFilled } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Checkbox, Segmented, Select, Space, Spin, Table, Tag } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

type Row = { domain: string; sourceServer?: string; destServer?: string };
type ServerOption = { server_name: string; server_ip: string };
type MigrateMode = 'single' | 'list' | 'whole';

const STATUS_LABELS: Record<string, string> = {
  OK: 'Thành công',
  PARTIAL: 'Chưa xác minh xong',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
};

const emptyRow = (): Row => ({ domain: '' });

/** Nút "Xoá nguồn" cho 1 dòng kết quả - tách hoàn toàn khỏi job migrate,
 * tự trigger + tự poll job remove-wpsite của riêng nó (tái dùng nguyên
 * endpoint/luồng đã có ở trang Xoá WordPress Site). Nếu domain này vừa được
 * xoá qua nút "Xoá tất cả nguồn" hàng loạt (bulkResult), hiện thẳng kết quả
 * đó thay vì vẽ lại nút - tránh xoá trùng domain đã xong. */
const RemoveSourceCell: React.FC<{
  domain: string;
  sourceIp: string;
  sourceServer?: string;
  bulkResult?: API.RemoveWpsiteResult;
}> = ({ domain, sourceIp, sourceServer, bulkResult }) => {
  const { message } = App.useApp();
  const [jobId, setJobId] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  if (jobId) {
    const isBusy = job?.status === 'running' || job?.status === 'pending';
    if (isBusy) return <Tag color="processing">Đang xoá...</Tag>;
    const result = ((job?.result as API.RemoveWpsiteResult[] | undefined) || [])[0];
    if (job?.status === 'success' && result?.status === 'OK') {
      return <Tag color="green">Đã xoá nguồn</Tag>;
    }
    if (job?.status === 'success') {
      return <Tag color="red">Lỗi: {result?.note || 'không rõ'}</Tag>;
    }
    if (job?.status === 'failed') return <Tag color="red">Job thất bại</Tag>;
  }

  if (bulkResult) {
    if (bulkResult.status === 'OK') return <Tag color="green">Đã xoá nguồn</Tag>;
    if (bulkResult.status === 'SKIP') return <Tag color="gold">Không tìm thấy site (đã xoá?)</Tag>;
    return <Tag color="red">Lỗi: {bulkResult.note || 'không rõ'}</Tag>;
  }

  return (
    <DangerPopconfirm
      title="Xác nhận Xoá site nguồn"
      targets={[`${domain} (${sourceIp})`]}
      loading={running}
      onConfirm={async () => {
        setRunning(true);
        try {
          const res = await triggerRemoveWpsite([domain], false, sourceServer ? { [domain]: sourceServer } : undefined);
          setJobId(res.job_id);
        } catch (err: any) {
          message.error(`Lỗi khi xoá nguồn: ${err?.message || err}`);
        } finally {
          setRunning(false);
        }
      }}
    >
      <Button danger type="primary" size="small" loading={running}>
        Xoá nguồn
      </Button>
    </DangerPopconfirm>
  );
};

/** Xoá đồng loạt site nguồn cho mọi domain migrate thành công (status=OK) -
 * 1 job remove-wpsite duy nhất thay vì bấm "Xoá nguồn" từng dòng, quan
 * trọng nhất với mode "Toàn bộ 1 server"/"Danh sách" vì có thể lên tới
 * hàng trăm domain trong 1 lần migrate. Chỉ hiện khi có >1 domain OK - với
 * 1 dòng thì nút "Xoá nguồn" riêng của dòng đó là đủ. */
const BulkRemoveSourcePanel: React.FC<{
  rows: { domain: string; sourceServer?: string }[];
  onDone: (results: API.RemoveWpsiteResult[]) => void;
}> = ({ rows, onDone }) => {
  const { message } = App.useApp();
  const [jobId, setJobId] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (job?.status === 'success' && !notifiedRef.current) {
      notifiedRef.current = true;
      onDone((job.result as API.RemoveWpsiteResult[] | undefined) || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  if (rows.length <= 1) return null;
  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const serverNames = Object.fromEntries(rows.filter((r) => r.sourceServer).map((r) => [r.domain, r.sourceServer!]));

  const trigger = async () => {
    setRunning(true);
    try {
      const res = await triggerRemoveWpsite(
        rows.map((r) => r.domain),
        false,
        Object.keys(serverNames).length ? serverNames : undefined,
      );
      setJobId(res.job_id);
    } catch (err: any) {
      message.error(`Lỗi khi xoá nguồn hàng loạt: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      {!jobId ? (
        <DangerPopconfirm
          title="Xác nhận Xoá tất cả site nguồn"
          targets={rows.map((r) => r.domain)}
          onConfirm={trigger}
          loading={running}
        >
          <Button danger type="primary" loading={running}>
            Xoá tất cả nguồn ({rows.length} domain, status=OK)
          </Button>
        </DangerPopconfirm>
      ) : (
        <>
          {isBusy && (
            <Tag color="processing" style={{ marginBottom: 8 }}>
              Đang xoá {rows.length} site nguồn...
            </Tag>
          )}
          <JobLogPanel job={job} />
          {(job?.status === 'success' || job?.status === 'failed') && (
            <Table<API.RemoveWpsiteResult>
              size="small"
              style={{ marginTop: 8 }}
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
                    <Tag color={v === 'OK' ? 'green' : v === 'SKIP' ? 'gold' : v === 'DRYRUN' ? 'blue' : 'red'}>{v}</Tag>
                  ),
                },
                { title: 'Ghi chú', dataIndex: 'note' },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
};

const MigrateWpsite: React.FC = () => {
  const { message } = App.useApp();
  const [mode, setMode] = usePersistedState<MigrateMode>('migrate-wpsite:mode', 'single');
  const [rows, setRows] = usePersistedState<Row[]>('migrate-wpsite:rows', [emptyRow()]);
  const [jobId, setJobId] = usePersistedState<number | undefined>('migrate-wpsite:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  const [serverOptions, setServerOptions] = useState<API.ServerItem[]>([]);
  // Domain nguồn tồn tại trên >1 server (VD template WP trắng) thì phải chọn
  // rõ server nguồn - cùng lý do như clone-wpsite.
  const [sourceServersMap, setSourceServersMap] = useState<Record<string, ServerOption[]>>({});

  // Mode "list"/"whole" - 1 server nguồn + 1 server đích áp dụng cho nhiều
  // domain cùng lúc, khỏi phải gõ/chọn từng dòng như mode "single".
  const [bulkSourceServer, setBulkSourceServer] = usePersistedState<string | undefined>(
    'migrate-wpsite:bulkSourceServer',
    undefined,
  );
  const [bulkDestServer, setBulkDestServer] = usePersistedState<string | undefined>(
    'migrate-wpsite:bulkDestServer',
    undefined,
  );
  // Chỉ có ý nghĩa ở mode "list" (mode "whole" luôn dùng toàn bộ bulkDomains,
  // không quan tâm lựa chọn này) - tách riêng để không phải đồng bộ 2 chiều
  // giữa 2 mode.
  const [bulkSelectedDomains, setBulkSelectedDomains] = usePersistedState<string[]>(
    'migrate-wpsite:bulkSelectedDomains',
    [],
  );
  // Kết quả của lần "Xoá tất cả nguồn" hàng loạt gần nhất, theo domain - để
  // các ô "Xoá nguồn" từng dòng phía dưới hiện đúng trạng thái thay vì vẽ
  // lại nút cho domain đã xoá xong.
  const [bulkRemoveResults, setBulkRemoveResults] = useState<Record<string, API.RemoveWpsiteResult>>({});

  const [bulkDomains, setBulkDomains] = useState<string[]>([]);
  // Tổng số domain thật khớp server_name theo backend (trước khi cắt bởi
  // pageSize) - so với bulkDomains.length để phát hiện bị cắt bớt, vì
  // listDomains giới hạn 1 trang duy nhất (pageSize cố định bên dưới).
  const [bulkDomainsTotal, setBulkDomainsTotal] = useState(0);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | undefined>(undefined);

  useEffect(() => {
    listServers({ pageSize: 500, current: 1 }).then((res) => setServerOptions(res.data || []));
  }, []);

  useEffect(() => {
    if (mode !== 'single') return;
    const domains = Array.from(
      new Set(rows.map((r) => r.domain.trim().toLowerCase()).filter(Boolean)),
    ).filter((d) => !(d in sourceServersMap));
    if (!domains.length) return;
    Promise.all(
      domains.map(async (domain) => {
        const res = await listDomains({ domain, pageSize: 50, current: 1 });
        const servers = (res.data || [])
          .filter((d: API.DomainItem) => d.domain === domain)
          .map((d: API.DomainItem) => ({ server_name: d.server_name, server_ip: d.server_ip }));
        return [domain, servers] as const;
      }),
    ).then((entries) => {
      setSourceServersMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rows]);

  // Danh sách domain thật của server nguồn đã chọn ở mode "list"/"whole" -
  // dùng listDomains({server_name}) vì đây là chọn cả server, không phải
  // tìm 1 domain cụ thể như DomainSelect.
  useEffect(() => {
    if (mode === 'single' || !bulkSourceServer) {
      setBulkDomains([]);
      setBulkDomainsTotal(0);
      setBulkError(undefined);
      return;
    }
    setBulkLoading(true);
    setBulkError(undefined);
    listDomains({ server_name: bulkSourceServer, pageSize: 1000, current: 1 })
      .then((res) => {
        const domains = Array.from(new Set((res.data || []).map((d) => d.domain))).sort();
        setBulkDomains(domains);
        setBulkDomainsTotal(res.total ?? domains.length);
        setBulkSelectedDomains((prev) => prev.filter((d) => domains.includes(d)));
      })
      .catch((err: any) => {
        setBulkDomains([]);
        setBulkDomainsTotal(0);
        setBulkError(err?.message || String(err));
      })
      .finally(() => setBulkLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bulkSourceServer]);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const isSourceAmbiguous = (domain: string) => (sourceServersMap[domain]?.length || 0) > 1;

  const singleEntries = rows
    .map((r) => ({ domain: r.domain.trim().toLowerCase(), sourceServer: r.sourceServer, destServer: r.destServer }))
    .filter((r) => r.domain && r.destServer && (!isSourceAmbiguous(r.domain) || r.sourceServer));

  const bulkEntries =
    bulkSourceServer && bulkDestServer && bulkSourceServer !== bulkDestServer
      ? (mode === 'whole' ? bulkDomains : bulkSelectedDomains).map((domain) => ({
          domain,
          sourceServer: bulkSourceServer,
          destServer: bulkDestServer,
        }))
      : [];

  const entries = mode === 'single' ? singleEntries : bulkEntries;

  const needsSourceServerCount = rows.filter(
    (r) => r.domain.trim() && isSourceAmbiguous(r.domain.trim().toLowerCase()) && !r.sourceServer,
  ).length;
  const missingDestCount = rows.filter((r) => r.domain.trim() && !r.destServer).length;

  const clearCache = () => {
    setMode('single');
    setRows([emptyRow()]);
    setJobId(undefined);
    setSourceServersMap({});
    setBulkSourceServer(undefined);
    setBulkDestServer(undefined);
    setBulkSelectedDomains([]);
    setBulkDomains([]);
    setBulkRemoveResults({});
    ['mode', 'rows', 'jobId', 'bulkSourceServer', 'bulkDestServer', 'bulkSelectedDomains'].forEach((k) =>
      clearPersistedState(`migrate-wpsite:${k}`),
    );
  };

  const run = async (dryRun: boolean) => {
    if (!entries.length) {
      message.warning('Chưa có dòng nào sẵn sàng (cần domain nguồn + server đích hợp lệ)');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerMigrateWpsite(
        entries.map((e) => ({ domain: e.domain, source_server: e.sourceServer, dest_server: e.destServer! })),
        dryRun,
      );
      // Job mới - kết quả xoá nguồn hàng loạt của job trước (nếu có) không
      // còn liên quan, và nếu domain trùng tên với job này thì giữ lại sẽ
      // hiện sai "Đã xoá nguồn" cho 1 domain vừa migrate lại chưa hề xoá.
      setBulkRemoveResults({});
      setJobId(res.job_id);
      if (!dryRun) {
        if (mode === 'single') {
          setRows([emptyRow()]);
          clearPersistedState('migrate-wpsite:rows');
        } else {
          setBulkSourceServer(undefined);
          setBulkDestServer(undefined);
          setBulkSelectedDomains([]);
          ['bulkSourceServer', 'bulkDestServer', 'bulkSelectedDomains'].forEach((k) =>
            clearPersistedState(`migrate-wpsite:${k}`),
          );
        }
      }
    } catch (err: any) {
      message.error(`Lỗi khi chạy Migrate: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';
  const tableData = rows.map((r, idx) => ({ ...r, idx }));

  return (
    <PageContainer title="Di chuyển WordPress Site" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Di chuyển toàn bộ file + database sang server khác, rồi trỏ lại DNS Cloudflare."
          description="Server nguồn tự xác định từ domain đã đồng bộ (chọn thêm nếu domain tồn tại trên nhiều server). Server đích PHẢI chọn thủ công. Nếu đích là server GCP có cấu hình firewall riêng, hệ thống tự mở/đóng port 22 cho IP nguồn trong lúc chạy. Sau khi migrate xong và đã tự kiểm tra site mới hoạt động tốt, bấm 'Xoá nguồn' ở bảng kết quả bên dưới để xoá site cũ - đây là bước RIÊNG, không tự động."
        />

        <Segmented
          value={mode}
          onChange={(v) => setMode(v as MigrateMode)}
          style={{ marginBottom: 12 }}
          options={[
            { label: 'Domain đơn', value: 'single' },
            { label: 'Danh sách domain trên 1 server', value: 'list' },
            { label: 'Toàn bộ 1 server', value: 'whole' },
          ]}
        />

        {mode !== 'single' && (
          <div style={{ marginBottom: 12 }}>
            <Space style={{ marginBottom: 8 }} wrap>
              <Select
                size="small"
                style={{ width: 320 }}
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="Chọn server nguồn..."
                value={bulkSourceServer}
                onChange={(v) => setBulkSourceServer(v)}
                options={serverOptions.map((s) => ({
                  value: s.server_name,
                  label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
                }))}
              />
              <span>→</span>
              <Select
                size="small"
                style={{ width: 320 }}
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="Chọn server đích..."
                value={bulkDestServer}
                onChange={(v) => setBulkDestServer(v)}
                options={serverOptions.map((s) => ({
                  value: s.server_name,
                  label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
                }))}
              />
            </Space>

            {!!bulkSourceServer && !!bulkDestServer && bulkSourceServer === bulkDestServer && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                message="Server nguồn và đích không thể là cùng 1 server."
              />
            )}

            {bulkLoading ? (
              <Spin size="small" />
            ) : bulkError ? (
              <Alert type="error" showIcon message={`Lỗi khi tải danh sách domain: ${bulkError}`} />
            ) : !bulkSourceServer ? (
              <span style={{ color: '#999' }}>Chọn server nguồn để xem danh sách domain.</span>
            ) : bulkDomains.length === 0 ? (
              <Alert type="warning" showIcon message="Server này không có domain nào đã đồng bộ." />
            ) : (
              <>
                {bulkDomainsTotal > bulkDomains.length && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 8 }}
                    message={`Chỉ tải được ${bulkDomains.length}/${bulkDomainsTotal} domain của server này - danh sách bị cắt bớt. KHÔNG chạy mode này cho tới khi xử lý (báo lại để tăng giới hạn tải).`}
                  />
                )}
                {mode === 'whole' ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`Sẽ migrate toàn bộ ${bulkDomains.length} domain của ${bulkSourceServer}`}
                    description={
                      <div style={{ maxHeight: 160, overflow: 'auto' }}>{bulkDomains.join(', ')}</div>
                    }
                  />
                ) : (
                  <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #d9d9d9', borderRadius: 6, padding: 8 }}>
                    <Space style={{ marginBottom: 8 }}>
                      <Button size="small" onClick={() => setBulkSelectedDomains(bulkDomains)}>
                        Chọn tất cả ({bulkDomains.length})
                      </Button>
                      <Button size="small" onClick={() => setBulkSelectedDomains([])}>
                        Bỏ chọn hết
                      </Button>
                    </Space>
                    <Checkbox.Group
                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                      value={bulkSelectedDomains}
                      onChange={(v) => setBulkSelectedDomains(v as string[])}
                      options={bulkDomains.map((d) => ({ label: d, value: d }))}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode === 'single' && (
        <>
        <Table
          size="small"
          pagination={false}
          rowKey="idx"
          dataSource={tableData}
          style={{ marginBottom: 12 }}
          columns={[
            { title: '#', width: 40, render: (_, __, i) => i + 1 },
            {
              title: 'Domain nguồn',
              render: (_, r) => {
                const domain = r.domain.trim().toLowerCase();
                const servers = sourceServersMap[domain];
                return (
                  <div>
                    <DomainSelect
                      mode="single"
                      value={r.domain ? [r.domain] : []}
                      onChange={(v) => updateRow(r.idx, { domain: v[0] || '', sourceServer: undefined })}
                      placeholder="Domain nguồn (đã đồng bộ)..."
                    />
                    {servers && servers.length > 1 && (
                      <Select
                        style={{ width: '100%', marginTop: 4 }}
                        size="small"
                        showSearch
                        optionFilterProp="label"
                        status={r.sourceServer ? undefined : 'error'}
                        placeholder={`⚠ Mơ hồ - chọn 1 trong ${servers.length} server nguồn`}
                        value={r.sourceServer}
                        onChange={(v) => updateRow(r.idx, { sourceServer: v })}
                        options={servers.map((s) => ({
                          value: s.server_name,
                          label: `${s.server_name} (${s.server_ip})`,
                        }))}
                      />
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Server đích',
              render: (_, r) => (
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Chọn server đích..."
                  value={r.destServer}
                  onChange={(v) => updateRow(r.idx, { destServer: v })}
                  options={serverOptions.map((s) => ({
                    value: s.server_name,
                    label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
                  }))}
                />
              ),
            },
            {
              title: '',
              width: 48,
              render: (_, r) => (
                <Button
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeRow(r.idx)}
                  disabled={rows.length <= 1}
                  danger
                  type="text"
                />
              ),
            },
          ]}
        />
        <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, emptyRow()])} style={{ marginBottom: 12 }}>
          Thêm dòng
        </Button>
        </>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button loading={running || isBusy} onClick={() => run(true)} disabled={!entries.length}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Di chuyển WordPress Site"
            targets={entries.map((e) => `${e.domain} -> ${e.destServer}`)}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!entries.length}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
          <Space wrap>
            {entries.length > 0 && <Tag color="success">{entries.length} sẵn sàng</Tag>}
            {mode === 'single' && needsSourceServerCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {needsSourceServerCount} cần chọn server nguồn (domain mơ hồ)
              </Tag>
            )}
            {mode === 'single' && missingDestCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {missingDestCount} thiếu server đích
              </Tag>
            )}
          </Space>
        </div>

        <JobLogPanel job={job} />
        <JobProgressBar job={job} />

        {(job?.status === 'running' || job?.status === 'pending') && !!job?.targets?.length && (
          <Table
            style={{ marginTop: 16 }}
            size="small"
            rowKey="id"
            dataSource={job.targets}
            pagination={job.targets.length > 20 ? { defaultPageSize: 20, showSizeChanger: true } : false}
            columns={[
              { title: 'Domain', dataIndex: 'target_label' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v: API.JobTargetStatus) => <Tag color={JOB_STATUS_COLORS[v]}>{JOB_STATUS_LABELS[v] || v}</Tag>,
              },
              { title: 'Ghi chú', dataIndex: 'note', render: (v: string) => v || '-' },
            ]}
          />
        )}

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
            <BulkRemoveSourcePanel
              rows={((job.result as API.MigrateWpsiteResult[] | undefined) || [])
                .filter((r) => r.status === 'OK')
                .map((r) => ({ domain: r.domain, sourceServer: r.source_server }))}
              onDone={(results) =>
                setBulkRemoveResults((prev) => ({
                  ...prev,
                  ...Object.fromEntries(results.map((r) => [r.domain, r])),
                }))
              }
            />
            <Table<API.MigrateWpsiteResult>
              style={{ marginTop: 16 }}
              size="small"
              rowKey="domain"
              dataSource={job.result}
              pagination={false}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                { title: 'Server nguồn', dataIndex: 'source_ip' },
                { title: 'Server đích', dataIndex: 'dest_ip' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
                },
                { title: 'DNS (Cloudflare)', dataIndex: 'cf_dns' },
                {
                  title: 'Xác minh',
                  dataIndex: 'verify',
                  render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
                },
                { title: 'Ghi chú', dataIndex: 'note' },
                {
                  title: 'Xoá nguồn',
                  width: 130,
                  render: (_, r) =>
                    r.status === 'OK' ? (
                      <RemoveSourceCell
                        domain={r.domain}
                        sourceIp={r.source_ip}
                        sourceServer={r.source_server}
                        bulkResult={bulkRemoveResults[r.domain]}
                      />
                    ) : (
                      '-'
                    ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </PageContainer>
  );
};

export default MigrateWpsite;
