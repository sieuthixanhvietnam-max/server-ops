import BatchListFilter from '@/components/BatchListFilter';
import PicEditor from '@/components/PicEditor';
import { listPics, listServerProfiles, listServers, triggerSync } from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { toPicFilterOptions } from '@/utils/picOptions';
import { PROVIDER_COLORS } from '@/utils/providerColors';
import { toSortParams } from '@/utils/tableSort';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { CopyOutlined, DownloadOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { App, Button, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';

const ServerList: React.FC = () => {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);
  const [picFilterOptions, setPicFilterOptions] = useState<{ label: string; value: string }[]>([]);
  const [profileOptions, setProfileOptions] = useState<{ label: string; value: string }[]>([]);
  const [serverNamesFilter, setServerNamesFilter] = useState('');

  const fetchAllMatchingFilter = async () => {
    const currentParams = formRef.current?.getFieldsValue() || {};
    const res = await listServers({
      ...currentParams,
      server_names: serverNamesFilter || undefined,
      current: 1,
      pageSize: 5000,
    });
    return res.data || [];
  };

  const handleCopyServers = async () => {
    setCopying(true);
    try {
      const data = await fetchAllMatchingFilter();
      if (!data.length) {
        message.warning('Không có server nào để copy');
        return;
      }
      copyText(data.map((s) => s.server_name).join('\n'), `Đã copy ${data.length} server`);
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
        `servers-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Server', 'IP', 'Provider', 'Profile', 'Số domains', 'PIC', 'Team', 'Cập nhật (nguồn)'],
        data.map((s) => [
          s.server_name,
          s.ip,
          s.provider,
          s.profile,
          s.domains_count,
          (s.pics || []).join('; '),
          (s.teams || []).join('; '),
          s.source_updated ? dayjs(s.source_updated).format('YYYY-MM-DD HH:mm:ss') : '',
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    listPics().then((res) => {
      setPicOptions((res.data || []).map((p) => ({ label: p.code, value: p.code })));
      setPicFilterOptions(toPicFilterOptions(res.data || []));
    });
    listServerProfiles().then((res) => {
      setProfileOptions((res.data || []).map((p) => ({ label: p, value: p })));
    });
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

  const columns: ProColumns<API.ServerItem>[] = [
    {
      title: 'Server',
      dataIndex: 'server_name',
      copyable: true,
      sorter: true,
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      copyable: true,
      sorter: true,
    },
    {
      title: 'SSH',
      dataIndex: 'ssh_user',
      search: false,
      render: (_, r) =>
        r.ssh_user && r.ssh_key_path ? (
          <Tooltip title={`ssh -i ${r.ssh_key_path} ${r.ssh_user}@${r.ip}`}>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyText(`ssh -i ${r.ssh_key_path} ${r.ssh_user}@${r.ip}`, 'Đã copy lệnh SSH')}
            />
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      valueType: 'select',
      fieldProps: { options: [{ label: 'GCP', value: 'GCP' }, { label: 'Ali', value: 'Ali' }, { label: 'DO', value: 'DO' }] },
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
      title: 'Số domains',
      dataIndex: 'domains_count',
      search: false,
      sorter: true,
    },
    {
      title: 'Cập nhật (nguồn)',
      dataIndex: 'source_updated',
      search: false,
      sorter: true,
      render: (_, record) => (record.source_updated ? dayjs(record.source_updated).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: 'PIC',
      dataIndex: 'pics',
      search: false,
      render: (_, r) => (
        <PicEditor
          value={r.pics}
          options={picOptions}
          target={{ type: 'server', server_name: r.server_name }}
          onSaved={() => actionRef.current?.reload()}
        />
      ),
    },
    {
      title: 'PIC',
      dataIndex: 'pic',
      valueType: 'select',
      fieldProps: { options: picFilterOptions },
      hideInTable: true,
    },
    {
      title: 'Team',
      dataIndex: 'teams',
      search: false,
      render: (_, r) =>
        (r.teams || []).map((t) => (
          <Tag key={t} color="geekblue">
            {t}
          </Tag>
        )),
    },
  ];

  return (
    <PageContainer title="Servers">
      <ProTable<API.ServerItem>
        headerTitle="Danh sách Server"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        search={{ labelWidth: 100 }}
        pagination={DEFAULT_PAGINATION}
        toolBarRender={() => [
          <BatchListFilter
            key="batch-filter"
            label="Lọc theo danh sách server"
            placeholder={'gcp-server-01\nali-server-02'}
            value={serverNamesFilter}
            onChange={(v) => {
              setServerNamesFilter(v);
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
          <Button key="copy" icon={<CopyOutlined />} loading={copying} onClick={handleCopyServers}>
            Copy danh sách
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
            Xuất CSV
          </Button>,
        ]}
        request={async (params, sort) => {
          const res = await listServers({
            ...params,
            ...toSortParams(sort),
            server_names: serverNamesFilter || undefined,
          });
          return res;
        }}
        columns={columns}
      />
    </PageContainer>
  );
};

export default ServerList;
