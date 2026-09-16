import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import VerifyBadge from '@/components/VerifyBadge';
import JobLogPanel from '@/components/JobLogPanel';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { useJobPolling } from '@/hooks/useJobPolling';
import { listDomains, triggerCfRedirect } from '@/services/serverOps/api';
import { flattenSheetPasteRows, parseSheetPasteRows } from '@/utils/sheetPaste';
import { PageContainer } from '@ant-design/pro-components';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from '@umijs/max';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Segmented,
  Space,
  Table,
  Tag,
  theme,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type Mode = 'url_to_url' | 'url_to_homepage';
type Row = { domain: string; target: string };

const STATUS_LABELS: Record<string, string> = {
  created: 'Đã tạo',
  updated: 'Đã cập nhật',
  unchanged: 'Không đổi',
  DRYRUN: 'Dry-run',
  error: 'Lỗi',
};

const emptyRow = (): Row => ({ domain: '', target: '' });

// Shared by both modes below - stated once here instead of repeated inside
// each mode's alert text, so the two copies can't drift out of sync.
const WWW_NOTE =
  'Mỗi dòng chỉ áp dụng cho đúng domain đã nhập. Cần redirect cả www và không-www thì nhập 2 dòng riêng (VD: nguon.com và www.nguon.com).';

const MODE_INFO: Record<Mode, { label: string; alert: string; targetPlaceholder: string }> = {
  url_to_url: {
    label: 'URL → URL (giữ nguyên path)',
    alert:
      'Chỉ cần nhập domain nguồn + domain đích - mọi path trên domain nguồn tự động giữ nguyên khi sang domain đích. VD: nguon.com → dich.com thì nguon.com/tin-tuc sẽ redirect sang dich.com/tin-tuc.',
    targetPlaceholder: 'Domain đích (VD: dich.com)',
  },
  url_to_homepage: {
    label: 'URL → Homepage (toàn domain → 1 URL cố định)',
    alert:
      'Mọi trang trên domain nguồn (toàn bộ path) sẽ redirect về đúng 1 URL cố định bạn nhập, không giữ path. VD: nguon.com → dich.com/trang-dich thì bất kỳ trang nào trên nguon.com đều đổ về dich.com/trang-dich.',
    targetPlaceholder: 'URL đích cố định (VD: dich.com hoặc dich.com/trang-dich)',
  },
};

const DomainAutoComplete: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({
  value,
  onChange,
  placeholder,
}) => {
  const [options, setOptions] = useState<{ value: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await listDomains({ domain: text.trim(), pageSize: 10, current: 1 });
      const uniq = Array.from(new Set((res.data || []).map((d) => d.domain)));
      setOptions(uniq.map((d) => ({ value: d })));
    }, 300);
  };

  return (
    <AutoComplete
      value={value}
      options={options}
      onSearch={handleSearch}
      onChange={onChange}
      style={{ width: '100%' }}
      placeholder={placeholder}
    />
  );
};

const BulkImportModal: React.FC<{
  open: boolean;
  mode: Mode;
  onCancel: () => void;
  onImport: (rows: Row[]) => void;
}> = ({ open, mode, onCancel, onImport }) => {
  const { token } = theme.useToken();
  const [text, setText] = useState('');

  const parsedRows = useMemo(() => (text.trim() ? parseSheetPasteRows(text) : []), [text]);
  const validRows = parsedRows.filter((r) => r.valid);
  const invalidCount = parsedRows.length - validRows.length;
  const totalDomains = validRows.reduce((sum, r) => sum + r.domains.length, 0);

  const reset = () => setText('');

  return (
    <Modal
      title={`Nhập hàng loạt - ${MODE_INFO[mode].label}`}
      open={open}
      onCancel={() => {
        reset();
        onCancel();
      }}
      width={820}
      footer={[
        <Button
          key="cancel"
          onClick={() => {
            reset();
            onCancel();
          }}
        >
          Huỷ
        </Button>,
        <Button
          key="import"
          type="primary"
          disabled={!totalDomains}
          onClick={() => {
            onImport(flattenSheetPasteRows(parsedRows));
            reset();
          }}
        >
          Nhập {totalDomains ? `(${totalDomains} domain, ${validRows.length} dòng)` : ''}
        </Button>,
      ]}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Chọn 2 cột (domain nguồn | {mode === 'url_to_url' ? 'domain đích' : 'URL đích'}) trên Google Sheet,
        copy rồi dán nguyên khối vào đây - 1 lần dán duy nhất, không cần tách 2 cột ra 2 chỗ. Nếu 1 ô domain
        nguồn có nhiều dòng (nhiều domain gộp chung 1 ô, dùng chung 1 đích), hệ thống tự tách từng domain và
        áp cùng 1 đích cho tất cả.
      </Typography.Paragraph>
      <Input.TextArea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'nguon1.com\tdich1.com\nnguon2.com\tdich2.com'}
        style={{ fontFamily: 'monospace' }}
      />

      {parsedRows.length > 0 && (
        <>
          <Space style={{ marginTop: 16, marginBottom: 8 }}>
            <Tag icon={<CheckCircleFilled />} color="success" style={{ fontSize: 13, padding: '2px 10px' }}>
              {validRows.length} dòng hợp lệ - {totalDomains} domain
            </Tag>
            {invalidCount > 0 && (
              <Tag icon={<CloseCircleFilled />} color="error" style={{ fontSize: 13, padding: '2px 10px' }}>
                {invalidCount} dòng lỗi - sẽ bỏ qua
              </Tag>
            )}
          </Space>
          <Table
            size="small"
            pagination={false}
            scroll={{ y: 300 }}
            rowKey="key"
            dataSource={parsedRows}
            rowClassName={(r) => (r.valid ? '' : 'cf-redirect-import-row-invalid')}
            columns={[
              { title: '#', dataIndex: 'key', width: 44, render: (v: number) => v + 1 },
              {
                title: 'Domain nguồn',
                dataIndex: 'domains',
                render: (v: string[]) => (
                  <div style={{ fontFamily: 'monospace', fontSize: 12, maxHeight: 90, overflowY: 'auto' }}>
                    {v.length > 1 && (
                      <Tag color="purple" style={{ marginBottom: 2 }}>
                        {v.length} domain
                      </Tag>
                    )}
                    {v.length ? v.map((d) => <div key={d}>{d}</div>) : '(trống)'}
                  </div>
                ),
              },
              { title: '', width: 28, render: () => <span style={{ color: token.colorTextQuaternary }}>→</span> },
              {
                title: mode === 'url_to_url' ? 'Domain đích' : 'URL đích',
                dataIndex: 'target',
                render: (v) => <span style={{ fontFamily: 'monospace' }}>{v || '(trống)'}</span>,
              },
              {
                title: 'Trạng thái',
                width: 110,
                render: (_, r) =>
                  r.valid ? (
                    <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 16 }} />
                  ) : (
                    <CloseCircleFilled style={{ color: token.colorError, fontSize: 16 }} />
                  ),
              },
            ]}
          />
          <style>{`.cf-redirect-import-row-invalid { background: ${token.colorErrorBg}; }`}</style>
        </>
      )}
    </Modal>
  );
};

const CfRedirect: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = usePersistedState<Mode>('cf-redirect:mode', 'url_to_url');
  const [rows, setRows] = usePersistedState<Row[]>('cf-redirect:rows', [emptyRow()]);
  const [crawlSitemap, setCrawlSitemap] = usePersistedState('cf-redirect:crawlSitemap', false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-redirect:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setRows(preset.map((d) => ({ domain: d, target: '' })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const mappings = rows
    .map((r) => ({ domain: r.domain.trim().toLowerCase(), target: r.target.trim() }))
    .filter((r) => r.domain && r.target);

  // Gathers every unique TARGET domain from this job's result that has a
  // usable sitemap crawl, so "Ép index" sends the whole batch to Force
  // Index in one shot instead of forcing a click per domain. Deduped by
  // target domain, not by source row - multiple source domains commonly
  // redirect to the same target (many old/burned domains funneled into one
  // live site), and each of those rows carries the same target's
  // sitemap_check, so mapping row-by-row would count/send that one target
  // domain N times over.
  const indexableEntries = useMemo(() => {
    const byTargetDomain = new Map<string, { domain: string; urls: string[] }>();
    ((job?.result as API.CfRedirectResult[] | undefined) || [])
      .filter((r) => r.sitemap_check && r.sitemap_check.url_count > 0)
      .forEach((r) => {
        const check = r.sitemap_check!;
        if (!byTargetDomain.has(check.domain)) {
          byTargetDomain.set(check.domain, { domain: check.domain, urls: check.urls });
        }
      });
    return Array.from(byTargetDomain.values());
  }, [job?.result]);

  const run = async (dryRun: boolean) => {
    if (!mappings.length) {
      message.warning('Nhập domain và đích cho ít nhất 1 dòng');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfRedirect(
        mappings.map((m) => ({ domain: m.domain, target_url: m.target, mode })),
        dryRun,
        crawlSitemap,
      );
      setJobId(res.job_id);
      if (!dryRun) {
        setRows([emptyRow()]);
        clearPersistedState('cf-redirect:rows');
      }
    } catch (e: any) {
      message.error(e?.message || 'Không chạy được task');
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  return (
    <PageContainer
      title="Redirect 301 (Cloudflare Page Rule)"
      extra={
        <ClearCacheButton
          onClear={() => {
            setMode('url_to_url');
            setRows([emptyRow()]);
            setCrawlSitemap(false);
            setJobId(undefined);
            ['mode', 'rows', 'crawlSitemap', 'jobId'].forEach((k) => clearPersistedState(`cf-redirect:${k}`));
          }}
        />
      }
    >
      <Card>
        <Segmented
          options={[
            { label: MODE_INFO.url_to_url.label, value: 'url_to_url' },
            { label: MODE_INFO.url_to_homepage.label, value: 'url_to_homepage' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          block
          style={{ marginBottom: 12 }}
        />
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={MODE_INFO[mode].alert}
          description={WWW_NOTE}
        />

        {rows.map((row, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <DomainAutoComplete
                value={row.domain}
                onChange={(v) => updateRow(idx, { domain: v })}
                placeholder="Domain nguồn"
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                placeholder={MODE_INFO[mode].targetPlaceholder}
                value={row.target}
                onChange={(e) => updateRow(idx, { target: e.target.value })}
              />
            </div>
            <Button
              icon={<MinusCircleOutlined />}
              onClick={() => removeRow(idx)}
              disabled={rows.length <= 1}
              danger
              type="text"
            />
          </div>
        ))}
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, emptyRow()])}>
            Thêm dòng
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setBulkOpen(true)}>
            Nhập hàng loạt
          </Button>
        </Space>

        <div style={{ marginBottom: 12 }}>
          <Checkbox checked={crawlSitemap} onChange={(e) => setCrawlSitemap(e.target.checked)}>
            Crawl sitemap domain đích sau khi redirect (để ép index)
          </Checkbox>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button loading={running || isBusy} onClick={() => run(true)}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Cập nhật Redirect 301"
            targets={mappings.map((m) => `${m.domain} -> ${m.target}`)}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!mappings.length}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <>
            {indexableEntries.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  onClick={() =>
                    navigate('/cf-task/force-index', { state: { entries: indexableEntries } })
                  }
                >
                  Ép index tất cả ({indexableEntries.length} domain,{' '}
                  {indexableEntries.reduce((sum, e) => sum + e.urls.length, 0)} URL)
                </Button>
              </div>
            )}
            <Table<API.CfRedirectResult>
              style={{ marginTop: 16 }}
              rowKey="domain"
              dataSource={job.result}
              pagination={false}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                {
                  title: 'Chế độ',
                  dataIndex: 'mode',
                  render: (v) => (
                    <Tag color={v === 'url_to_url' ? 'purple' : 'geekblue'}>
                      {v === 'url_to_url' ? 'URL → URL' : 'URL → Homepage'}
                    </Tag>
                  ),
                },
                { title: 'Target rule (Cloudflare)', dataIndex: 'target_url' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v) => (
                    <Tag
                      color={
                        v === 'created' || v === 'updated'
                          ? 'green'
                          : v === 'DRYRUN'
                            ? 'blue'
                            : v === 'unchanged'
                              ? 'gold'
                              : 'red'
                      }
                    >
                      {STATUS_LABELS[v] || v}
                    </Tag>
                  ),
                },
                { title: 'Ghi chú', dataIndex: 'note' },
                {
                  title: 'Redirect thật',
                  dataIndex: 'verify',
                  render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
                },
                {
                  title: 'Sitemap đích',
                  dataIndex: 'sitemap_check',
                  render: (check: API.SitemapCheck | undefined) => {
                    if (!check) return '-';
                    if (check.error) return <Typography.Text type="secondary">{check.error}</Typography.Text>;
                    return `${check.url_count} URL`;
                  },
                },
              ]}
            />
          </>
        )}
      </Card>

      <BulkImportModal
        open={bulkOpen}
        mode={mode}
        onCancel={() => setBulkOpen(false)}
        onImport={(imported) => {
          setRows((prev) => [...prev.filter((r) => r.domain || r.target), ...imported]);
          setBulkOpen(false);
        }}
      />

    </PageContainer>
  );
};

export default CfRedirect;
