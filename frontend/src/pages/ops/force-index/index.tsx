import ClearCacheButton from '@/components/ClearCacheButton';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { triggerCrawlSitemap, triggerForceIndex } from '@/services/serverOps/api';
import { RESULT_STATUS_COLORS } from '@/utils/resultStatus';
import { PageContainer } from '@ant-design/pro-components';
import { useLocation } from '@umijs/max';
import { Alert, App, Button, Card, Input, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

const { TextArea } = Input;

const SERVICE_OPTIONS: { label: string; value: API.IndexerService }[] = [
  { label: 'SpeedyIndex', value: 'speedyindex' },
  { label: 'InstantIndexer', value: 'instantindexer' },
  { label: 'LinksIndexer', value: 'linksindexer' },
  { label: 'RalfyIndex', value: 'ralfyindex' },
];
const SERVICE_LABELS: Record<string, string> = Object.fromEntries(
  SERVICE_OPTIONS.map((o) => [o.value, o.label]),
);

const STATUS_LABELS: Record<string, string> = {
  OK: 'Đã gửi',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
  SKIP: 'Bỏ qua',
};

const parseDomains = (text: string) =>
  Array.from(new Set(text.split(/\r?\n/).map((d) => d.trim().toLowerCase()).filter(Boolean)));

type PresetEntry = { domain: string; urls: string[] };

const ForceIndex: React.FC = () => {
  const { message } = App.useApp();
  const location = useLocation();
  const [fromPreset, setFromPreset] = useState(false);
  const [text, setText] = usePersistedState('force-index:text', '');
  const [crawlResults, setCrawlResults] = usePersistedState<API.SitemapCheck[] | undefined>(
    'force-index:crawlResults',
    undefined,
  );
  const [selectedDomains, setSelectedDomains] = usePersistedState<string[]>('force-index:selectedDomains', []);
  const [service, setService] = usePersistedState<API.IndexerService>('force-index:service', 'speedyindex');
  const [running, setRunning] = useState(false);

  const [crawlJobId, setCrawlJobId] = usePersistedState<number | undefined>('force-index:crawlJobId', undefined);
  const crawlJob = useJobPolling(crawlJobId);
  const crawlBusy = crawlJob?.status === 'running' || crawlJob?.status === 'pending';

  const [forceJobId, setForceJobId] = usePersistedState<number | undefined>('force-index:forceJobId', undefined);
  const forceJob = useJobPolling(forceJobId);
  const forceBusy = forceJob?.status === 'running' || forceJob?.status === 'pending';

  useEffect(() => {
    const preset = (location.state as { entries?: PresetEntry[] } | undefined)?.entries;
    if (preset?.length) {
      const results: API.SitemapCheck[] = preset.map((e) => ({
        domain: e.domain,
        sitemap_count: e.urls.length ? 1 : 0,
        url_count: e.urls.length,
        urls: e.urls,
        error: e.urls.length ? null : 'Không có URL từ bước redirect',
      }));
      setCrawlResults(results);
      setSelectedDomains(results.filter((r) => r.url_count > 0).map((r) => r.domain));
      setFromPreset(true);
      // Invalidate any crawl job left over from a previous manual crawl
      // earlier in this browser tab (crawlJobId survives navigation via
      // usePersistedState) - otherwise that job's still-in-flight polling
      // resolves a moment later and its "success" effect below overwrites
      // the preset's crawlResults with the old crawl's results, silently
      // wiping the domain list this page was just handed.
      setCrawlJobId(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (crawlJob?.status === 'success') {
      const results = (crawlJob.result as API.SitemapCheck[]) || [];
      setCrawlResults(results);
      setSelectedDomains(results.filter((r) => r.url_count > 0).map((r) => r.domain));
    }
  }, [crawlJob?.status]);

  const runCrawl = async () => {
    const domains = parseDomains(text);
    if (!domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    setCrawlResults(undefined);
    setSelectedDomains([]);
    const res = await triggerCrawlSitemap(domains);
    setCrawlJobId(res.job_id);
  };

  const resetToManual = () => {
    setFromPreset(false);
    setCrawlResults(undefined);
    setSelectedDomains([]);
  };

  const entries = useMemo(
    () =>
      (crawlResults || [])
        .filter((r) => selectedDomains.includes(r.domain))
        .map((r) => ({ domain: r.domain, urls: r.urls })),
    [crawlResults, selectedDomains],
  );

  const runSubmit = async (dryRun: boolean) => {
    if (!entries.length) {
      message.warning('Chọn ít nhất 1 domain đã crawl được sitemap');
      return;
    }
    setRunning(true);
    try {
      // Deliberately keeps crawlResults/selectedDomains around after a real
      // run (unlike other pages' post-submit resets) - clearing them here
      // used to unmount the results Card below (it's gated on `crawlResults`),
      // hiding the just-submitted job's progress/result behind a blank page.
      // Starting a fresh batch is still available via "Nhập domain khác" or
      // ClearCacheButton.
      const res = await triggerForceIndex(service, entries, dryRun);
      setForceJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  return (
    <PageContainer
      title="Ép Index"
      subTitle="Crawl sitemap domain đích và submit URL sang dịch vụ ép index"
      extra={
        <ClearCacheButton
          onClear={() => {
            setFromPreset(false);
            setText('');
            setCrawlResults(undefined);
            setSelectedDomains([]);
            setService('speedyindex');
            setCrawlJobId(undefined);
            setForceJobId(undefined);
            ['text', 'crawlResults', 'selectedDomains', 'service', 'crawlJobId', 'forceJobId'].forEach((k) =>
              clearPersistedState(`force-index:${k}`),
            );
          }}
        />
      }
    >
      <Card style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Thường dùng cho domain vừa được redirect 301 sang domain đích, giúp Google phát hiện & index nội dung domain đích nhanh hơn. Có thể dùng độc lập cho bất kỳ domain nào, bất cứ lúc nào - không bắt buộc làm ngay sau khi redirect."
        />
        {fromPreset ? (
          <Alert
            type="success"
            showIcon
            message={`Đã nhận ${crawlResults?.length || 0} domain từ tác vụ Redirect - sitemap đã crawl sẵn, không cần crawl lại.`}
            action={
              <Button size="small" onClick={resetToManual}>
                Nhập domain khác
              </Button>
            }
          />
        ) : (
          <>
            <TextArea
              rows={5}
              placeholder="Nhập domain đích cần crawl sitemap, mỗi dòng 1 domain..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ marginTop: 12 }}>
              <Button type="primary" loading={crawlBusy} onClick={runCrawl}>
                Crawl sitemap
              </Button>
            </div>
            <JobLogPanel job={crawlJob} />
          </>
        )}
      </Card>

      {crawlResults && (
        <Card title={`Kết quả crawl sitemap (${crawlResults.length} domain)`}>
          <Table<API.SitemapCheck>
            size="small"
            rowKey="domain"
            dataSource={crawlResults}
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedDomains,
              onChange: (keys) => setSelectedDomains(keys as string[]),
              getCheckboxProps: (r) => ({ disabled: r.url_count === 0 }),
            }}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'Số sitemap', dataIndex: 'sitemap_count' },
              { title: 'Số URL', dataIndex: 'url_count' },
              { title: 'Lỗi', dataIndex: 'error', render: (v: string | null) => v || '-' },
            ]}
          />

          <div style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text>Dịch vụ ép index:</Typography.Text>
              <Segmented options={SERVICE_OPTIONS} value={service} onChange={(v) => setService(v as API.IndexerService)} />
            </Space>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Button loading={running || forceBusy} onClick={() => runSubmit(true)}>
                Xem trước (dry-run)
              </Button>
              <Popconfirm
                title="Ép index thật?"
                description={`Sẽ gửi ${entries.length} domain qua ${SERVICE_LABELS[service]} - không thể hoàn tác.`}
                onConfirm={() => runSubmit(false)}
                okText="Ép index thật"
                okButtonProps={{ danger: true, loading: running || forceBusy }}
                disabled={!entries.length}
              >
                <Button danger type="primary" loading={running || forceBusy} disabled={!entries.length}>
                  Ép index thật ({entries.length} domain)
                </Button>
              </Popconfirm>
            </div>
          </div>

          <JobLogPanel job={forceJob} />

          {(forceJob?.status === 'success' || forceJob?.status === 'failed') && (
            <Table<API.ForceIndexResult>
              style={{ marginTop: 16 }}
              size="small"
              rowKey="domain"
              dataSource={forceJob.result}
              pagination={false}
              columns={[
                { title: 'Domain', dataIndex: 'domain' },
                { title: 'Số URL', dataIndex: 'url_count' },
                {
                  title: 'Nhà cung cấp',
                  dataIndex: 'service',
                  render: (v: string) => SERVICE_LABELS[v] || v,
                },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v: string) => <Tag color={RESULT_STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
                },
                { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
              ]}
            />
          )}
        </Card>
      )}
    </PageContainer>
  );
};

export default ForceIndex;
