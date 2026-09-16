import BatchListFilter from '@/components/BatchListFilter';
import { getCfZonesSummary, listCfAccountOptions, listCfZones, listPics } from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { toPicFilterOptions } from '@/utils/picOptions';
import { toSortParams } from '@/utils/tableSort';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { App, Button, Statistic, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';

const MATCH_LABELS: Record<string, string> = {
  both: 'Cả hai',
  cf_only: 'Chỉ có trên CF',
  server_only: 'Chỉ có trên server',
};
const MATCH_COLORS: Record<string, string> = {
  both: 'green',
  cf_only: 'orange',
  server_only: 'red',
};

const CfDomains: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [summary, setSummary] = useState<API.CfZonesSummary>();
  const [accountOptions, setAccountOptions] = useState<{ label: string; value: number }[]>([]);
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);
  const [domainsFilter, setDomainsFilter] = useState('');
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadSummary = () => {
    getCfZonesSummary().then(setSummary);
  };

  const fetchAllMatchingFilter = async () => {
    const currentParams = formRef.current?.getFieldsValue() || {};
    const res = await listCfZones({
      ...currentParams,
      domains: domainsFilter || undefined,
      current: 1,
      // Higher than the other pages' 5000 - this merged view runs well past
      // 20k rows unfiltered (see cf_zones.py's pageSize ceiling).
      pageSize: 50000,
    });
    return res.data || [];
  };

  const handleCopyDomains = async () => {
    setCopying(true);
    try {
      const data = await fetchAllMatchingFilter();
      if (!data.length) {
        message.warning('Không có domain nào để copy');
        return;
      }
      copyText(data.map((d) => d.domain).join('\n'), `Đã copy ${data.length} domain`);
    } finally {
      setCopying(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const data = await fetchAllMatchingFilter();
      if (!data.length) {
        message.warning('Không có dữ liệu để xuất');
        return;
      }
      exportToCsv(
        `cf-domains-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Domain', 'Trạng thái khớp', 'CF Account', 'Trạng thái Zone (CF)', 'Plan', 'Server', 'Server IP'],
        data.map((d) => [
          d.domain,
          MATCH_LABELS[d.match_status] || d.match_status,
          d.cf_account_label || '',
          d.zone_status || '',
          d.plan || '',
          d.server_name || '',
          d.server_ip || '',
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadSummary();
    listCfAccountOptions().then((res) => {
      setAccountOptions((res.data || []).map((a) => ({ label: a.label, value: a.id })));
    });
    listPics().then((res) => setPicOptions(toPicFilterOptions(res.data || [])));
  }, []);

  const columns: ProColumns<API.CfZoneItem>[] = [
    { title: 'Domain', dataIndex: 'domain', copyable: true, sorter: true },
    {
      title: 'Trạng thái khớp',
      dataIndex: 'match_status',
      valueType: 'select',
      sorter: true,
      fieldProps: {
        options: [
          { label: 'Cả hai', value: 'both' },
          { label: 'Chỉ có trên CF', value: 'cf_only' },
          { label: 'Chỉ có trên server', value: 'server_only' },
        ],
      },
      render: (_, r) => (
        <Tag color={MATCH_COLORS[r.match_status]}>
          {MATCH_LABELS[r.match_status]}
          {r.zone_count_on_domain > 1 ? ` ⚠ ${r.zone_count_on_domain} zone` : ''}
        </Tag>
      ),
    },
    {
      title: 'CF Account',
      dataIndex: 'cf_account_label',
      sorter: true,
      search: false,
    },
    {
      title: 'CF Account',
      dataIndex: 'account_id',
      valueType: 'select',
      fieldProps: {
        options: accountOptions,
        showSearch: true,
        filterOption: (input: string, option: any) =>
          (option?.label ?? '').toLowerCase().includes(input.toLowerCase()),
      },
      hideInTable: true,
    },
    { title: 'Trạng thái Zone (CF)', dataIndex: 'zone_status', sorter: true },
    { title: 'Plan', dataIndex: 'plan', sorter: true },
    { title: 'Server', dataIndex: 'server_name', search: false, sorter: true },
    { title: 'Server IP', dataIndex: 'server_ip', search: false, sorter: true },
    {
      title: 'PIC',
      dataIndex: 'pic',
      valueType: 'select',
      fieldProps: { options: picOptions, placeholder: 'Lọc theo PIC (server hoặc account)' },
      hideInTable: true,
    },
  ];

  return (
    <PageContainer title="Cloudflare Domains">
      <ProTable<API.CfZoneItem>
        headerTitle="So khớp Domain: Cloudflare vs Server"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="domain"
        pagination={DEFAULT_PAGINATION}
        search={{ labelWidth: 100 }}
        toolBarRender={() => [
          <BatchListFilter
            key="batch-filter"
            label="Lọc theo danh sách domain"
            placeholder={'domain1.com\ndomain2.com'}
            value={domainsFilter}
            onChange={(v) => {
              setDomainsFilter(v);
              actionRef.current?.reload();
            }}
          />,
          <Statistic key="both" title="Cả hai" value={summary?.both ?? '-'} valueStyle={{ fontSize: 16, color: token.colorSuccess }} />,
          <Statistic key="cf_only" title="Chỉ trên CF" value={summary?.cf_only ?? '-'} valueStyle={{ fontSize: 16, color: token.colorWarning }} />,
          <Statistic key="server_only" title="Chỉ trên server" value={summary?.server_only ?? '-'} valueStyle={{ fontSize: 16, color: token.colorError }} />,
          <Button key="copy" icon={<CopyOutlined />} loading={copying} onClick={handleCopyDomains}>
            Copy danh sách
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
            Xuất CSV
          </Button>,
        ]}
        request={async (params, sort) => {
          const res = await listCfZones({ ...params, ...toSortParams(sort), domains: domainsFilter || undefined });
          loadSummary();
          return res;
        }}
        columns={columns}
      />
    </PageContainer>
  );
};

export default CfDomains;
