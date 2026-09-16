import {
  getDomainChangesSummary,
  listDomainChanges,
  listDomainProfiles,
  listDomainProviders,
  listPics,
} from '@/services/serverOps/api';
import { exportToCsv } from '@/utils/exportCsv';
import { EVENT_LABELS, EVENT_TAG_COLORS, useEventTextColors } from '@/utils/domainChangeEvent';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { toPicFilterOptions } from '@/utils/picOptions';
import { PROVIDER_COLORS } from '@/utils/providerColors';
import { toSortParams } from '@/utils/tableSort';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { DownloadOutlined, HistoryOutlined } from '@ant-design/icons';
import { App, Button, Statistic, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';
import DomainChangesHotspots from './Hotspots';
import DomainChangesTrend from './Trend';

const formatServerCell = (item: API.DomainChangeItem) =>
  item.event_type === 'moved' && item.from_server_name
    ? `${item.from_server_name} → ${item.server_name}`
    : item.server_name;

const DomainChanges: React.FC = () => {
  const { message } = App.useApp();
  const EVENT_TEXT_COLORS = useEventTextColors();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<API.DomainChangeSummary>();
  const [providerOptions, setProviderOptions] = useState<{ label: string; value: string }[]>([]);
  const [profileOptions, setProfileOptions] = useState<{ label: string; value: string }[]>([]);
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    listDomainProviders().then((res) => {
      setProviderOptions((res.data || []).map((p) => ({ label: p, value: p })));
    });
    listDomainProfiles().then((res) => {
      setProfileOptions((res.data || []).map((p) => ({ label: p, value: p })));
    });
    listPics().then((res) => setPicOptions(toPicFilterOptions(res.data || [])));
  }, []);

  const applyLastWeekRemovedFilter = () => {
    formRef.current?.setFieldsValue({
      event_type: 'removed',
      detected_at: [dayjs().subtract(7, 'day'), dayjs()],
    });
    formRef.current?.submit();
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const currentParams = formRef.current?.getFieldsValue() || {};
      const { data } = await listDomainChanges({
        ...currentParams,
        detected_at: undefined,
        date_from: currentParams.detected_at?.[0]
          ? dayjs(currentParams.detected_at[0]).startOf('day').toISOString()
          : undefined,
        date_to: currentParams.detected_at?.[1]
          ? dayjs(currentParams.detected_at[1]).endOf('day').toISOString()
          : undefined,
        current: 1,
        pageSize: 5000,
      });

      if (!data.length) {
        message.warning('Không có dữ liệu để xuất');
        return;
      }

      exportToCsv(
        `domain-changes-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Loại', 'Domain', 'Server', 'Provider', 'Profile', 'Thời gian phát hiện'],
        data.map((item) => [
          EVENT_LABELS[item.event_type] || item.event_type,
          item.domain,
          formatServerCell(item),
          item.provider,
          item.profile,
          dayjs(item.detected_at).format('YYYY-MM-DD HH:mm:ss'),
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExporting(false);
    }
  };

  const columns: ProColumns<API.DomainChangeItem>[] = [
    {
      title: 'Loại',
      dataIndex: 'event_type',
      valueType: 'select',
      fieldProps: {
        options: [
          { label: 'Đã thêm', value: 'added' },
          { label: 'Đã xoá', value: 'removed' },
          { label: 'Đã chuyển server', value: 'moved' },
        ],
      },
      sorter: true,
      render: (_, record) => (
        <Tag color={EVENT_TAG_COLORS[record.event_type]}>
          {EVENT_LABELS[record.event_type] || record.event_type}
        </Tag>
      ),
    },
    {
      title: 'Domain',
      dataIndex: 'domain',
      copyable: true,
      sorter: true,
    },
    {
      title: 'Server',
      dataIndex: 'server_name',
      copyable: true,
      sorter: true,
      render: (_, record) => formatServerCell(record),
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
      title: 'PIC',
      dataIndex: 'pic',
      valueType: 'select',
      fieldProps: { options: picOptions, placeholder: 'Lọc theo PIC (của server)' },
      hideInTable: true,
    },
    {
      title: 'Thời gian phát hiện',
      dataIndex: 'detected_at',
      valueType: 'dateRange',
      sorter: true,
      render: (_, record) => dayjs(record.detected_at).format('YYYY-MM-DD HH:mm:ss'),
      search: {
        transform: (value: any) => ({
          date_from: value?.[0] ? dayjs(value[0]).startOf('day').toISOString() : undefined,
          date_to: value?.[1] ? dayjs(value[1]).endOf('day').toISOString() : undefined,
        }),
      },
    },
  ];

  const historyTable = (
    <ProTable<API.DomainChangeItem>
      headerTitle="Lịch sử thay đổi Domain"
      actionRef={actionRef}
      formRef={formRef}
      rowKey="id"
      pagination={DEFAULT_PAGINATION}
      search={{ labelWidth: 100 }}
      toolBarRender={() => [
        ...(summary
          ? [
              <div key="summary" style={{ display: 'flex', gap: 32, marginRight: 16 }}>
                <Statistic
                  title="Đã thêm"
                  value={summary.added}
                  valueStyle={{ color: EVENT_TEXT_COLORS.added, fontSize: 16 }}
                />
                <Statistic
                  title="Đã xoá"
                  value={summary.removed}
                  valueStyle={{ color: EVENT_TEXT_COLORS.removed, fontSize: 16 }}
                />
                <Statistic
                  title="Đã chuyển server"
                  value={summary.moved}
                  valueStyle={{ color: EVENT_TEXT_COLORS.moved, fontSize: 16 }}
                />
                <Statistic
                  title="Thay đổi ròng"
                  value={summary.added - summary.removed}
                  prefix={summary.added - summary.removed > 0 ? '+' : undefined}
                  valueStyle={{
                    color:
                      summary.added - summary.removed > 0
                        ? EVENT_TEXT_COLORS.added
                        : summary.added - summary.removed < 0
                          ? EVENT_TEXT_COLORS.removed
                          : undefined,
                    fontSize: 16,
                  }}
                />
              </div>,
            ]
          : []),
        <Button key="weekly" icon={<HistoryOutlined />} onClick={applyLastWeekRemovedFilter}>
          7 ngày qua (đã xoá)
        </Button>,
        <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
          Xuất CSV
        </Button>,
      ]}
      request={async (params, sort) => {
        const res = await listDomainChanges({ ...params, ...toSortParams(sort) });
        getDomainChangesSummary({
          date_from: params.date_from,
          date_to: params.date_to,
        }).then(setSummary);
        return res;
      }}
      columns={columns}
    />
  );

  return (
    <PageContainer>
      <Tabs
        defaultActiveKey="history"
        items={[
          { key: 'history', label: 'Lịch sử chi tiết', children: historyTable },
          {
            key: 'trend',
            label: 'Thống kê theo thời gian',
            children: (
              <DomainChangesTrend
                providerOptions={providerOptions}
                profileOptions={profileOptions}
                picOptions={picOptions}
              />
            ),
          },
          {
            key: 'hotspots',
            label: 'Phân tích',
            children: <DomainChangesHotspots providerOptions={providerOptions} profileOptions={profileOptions} />,
          },
        ]}
      />
    </PageContainer>
  );
};

export default DomainChanges;
