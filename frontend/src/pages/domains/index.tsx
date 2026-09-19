import BatchListFilter from '@/components/BatchListFilter';
import SiteCredentialCell from '@/components/SiteCredentialCell';
import {
  listDomainProfiles,
  listDomainProviders,
  listDomains,
  listPics,
  listSiteCredentials,
  triggerSync,
} from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { toPicFilterOptions } from '@/utils/picOptions';
import { PROVIDER_COLORS } from '@/utils/providerColors';
import { toSortParams } from '@/utils/tableSort';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { CopyOutlined, DownloadOutlined, DownOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { App, Button, Dropdown, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';

const DomainList: React.FC = () => {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [providerOptions, setProviderOptions] = useState<{ label: string; value: string }[]>([]);
  const [profileOptions, setProfileOptions] = useState<{ label: string; value: string }[]>([]);
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [domainsFilter, setDomainsFilter] = useState('');
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [credentialMap, setCredentialMap] = useState<Record<string, API.SiteCredential>>({});

  // Small side table, fetched whole (not per-row) - keyed by "domain::server"
  // so each row's SiteCredentialCell can look itself up without an API call.
  const loadCredentials = () => {
    listSiteCredentials().then((res) => {
      setCredentialMap(Object.fromEntries((res.data || []).map((c) => [`${c.domain}::${c.server_name}`, c])));
    });
  };

  // Both actions re-fetch with the SAME filters currently applied on the
  // table (search form + BatchListFilter), but pageSize 5000 to bypass
  // pagination - "copy/export what I'm looking at", not just the current page.
  const fetchAllMatchingFilter = async () => {
    const currentParams = formRef.current?.getFieldsValue() || {};
    const res = await listDomains({
      ...currentParams,
      domains: domainsFilter || undefined,
      duplicates_only: duplicatesOnly || undefined,
      current: 1,
      pageSize: 5000,
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
        `domains-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Domain', 'Provider', 'Profile', 'Server', 'Server IP', 'Cập nhật (nguồn)'],
        data.map((d) => [
          d.domain,
          d.provider,
          d.profile,
          d.server_name,
          d.server_ip,
          d.source_updated ? dayjs(d.source_updated).format('YYYY-MM-DD HH:mm:ss') : '',
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExporting(false);
    }
  };

  const goToOps = (path: string) => {
    const domains = Array.from(new Set(selectedDomains));
    history.push(path, { domains });
  };

  useEffect(() => {
    listDomainProviders().then((res) => {
      setProviderOptions((res.data || []).map((p) => ({ label: p, value: p })));
    });
    listDomainProfiles().then((res) => {
      setProfileOptions((res.data || []).map((p) => ({ label: p, value: p })));
    });
    listPics().then((res) => setPicOptions(toPicFilterOptions(res.data || [])));
    loadCredentials();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const status = await triggerSync();
      if (status.success) {
        message.success(`Đồng bộ thành công: ${status.total_domains} domains, ${status.total_servers} servers`);
        actionRef.current?.reload();
      } else {
        message.error(`Đồng bộ thất bại: ${status.error_message}`);
      }
    } finally {
      setSyncing(false);
    }
  };

  const columns: ProColumns<API.DomainItem>[] = [
    {
      title: 'Domain',
      dataIndex: 'domain',
      copyable: true,
      sorter: true,
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      valueType: 'select',
      fieldProps: { options: providerOptions },
      sorter: true,
      render: (_, record) => (
        <Tag color={PROVIDER_COLORS[record.provider] || 'default'}>{record.provider}</Tag>
      ),
    },
    {
      title: 'Profile',
      dataIndex: 'profile',
      valueType: 'select',
      fieldProps: { options: profileOptions },
      sorter: true,
    },
    {
      title: 'Server',
      dataIndex: 'server_name',
      copyable: true,
      sorter: true,
    },
    {
      title: 'Server IP',
      dataIndex: 'server_ip',
      search: false,
      copyable: true,
      sorter: true,
    },
    {
      title: 'Đăng nhập',
      search: false,
      width: 70,
      render: (_, r) => (
        <SiteCredentialCell
          domain={r.domain}
          serverName={r.server_name}
          credential={credentialMap[`${r.domain}::${r.server_name}`]}
          onSaved={loadCredentials}
        />
      ),
    },
    {
      title: 'PIC',
      dataIndex: 'pic',
      valueType: 'select',
      fieldProps: { options: picOptions, placeholder: 'Lọc theo PIC (của server)' },
      hideInTable: true,
    },
    {
      title: 'Cập nhật (nguồn)',
      dataIndex: 'source_updated',
      search: false,
      sorter: true,
      render: (_, record) => (record.source_updated ? dayjs(record.source_updated).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
  ];

  return (
    <PageContainer title="Domains">
      <ProTable<API.DomainItem>
        headerTitle="Danh sách Domain"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        search={{ labelWidth: 100 }}
        rowSelection={{
          onChange: (_keys, rows) => setSelectedDomains(rows.map((r) => r.domain)),
        }}
        tableAlertOptionRender={() => (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'remove', label: 'Xoá site' },
                { key: 'changepass', label: 'Đổi mật khẩu' },
                { key: 'clone', label: 'Clone tới...' },
              ],
              onClick: ({ key }) => {
                if (key === 'remove') goToOps('/server-task/remove-wpsite');
                if (key === 'changepass') goToOps('/server-task/change-wppass');
                if (key === 'clone') goToOps('/server-task/clone-wpsite');
              },
            }}
          >
            <Button size="small" type="link">
              Hành động <DownOutlined />
            </Button>
          </Dropdown>
        )}
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
          <Button
            key="sync"
            icon={syncing ? <SyncOutlined spin /> : <ReloadOutlined />}
            onClick={handleSync}
            loading={syncing}
          >
            Đồng bộ ngay
          </Button>,
          <Button key="copy" icon={<CopyOutlined />} loading={copying} onClick={handleCopyDomains}>
            Copy danh sách
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
            Xuất CSV
          </Button>,
          <Button
            key="duplicates"
            danger={duplicatesOnly}
            type={duplicatesOnly ? 'primary' : 'default'}
            onClick={() => {
              setDuplicatesOnly((v) => !v);
              actionRef.current?.reload();
            }}
          >
            ⚠ Chỉ hiện domain trùng server
          </Button>,
        ]}
        request={async (params, sort) => {
          const res = await listDomains({
            ...params,
            ...toSortParams(sort),
            domains: domainsFilter || undefined,
            duplicates_only: duplicatesOnly || undefined,
          });
          return res;
        }}
        columns={columns}
      />
    </PageContainer>
  );
};

export default DomainList;
