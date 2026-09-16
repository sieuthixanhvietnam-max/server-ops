import PicEditor from '@/components/PicEditor';
import {
  getPicMismatchedDomains,
  getPicSummary,
  getPicUnassigned,
  listPics,
  suggestPics,
} from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { CopyOutlined, DownloadOutlined, SyncOutlined } from '@ant-design/icons';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Table, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';

const PicsPage: React.FC = () => {
  const { message } = App.useApp();
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);
  const [summary, setSummary] = useState<API.PicSummaryItem[]>([]);
  const [unassigned, setUnassigned] = useState<API.PicUnassigned>();
  const [suggesting, setSuggesting] = useState(false);
  const [mismatchedVersion, setMismatchedVersion] = useState(0);
  const [copyingMismatched, setCopyingMismatched] = useState(false);
  const [exportingMismatched, setExportingMismatched] = useState(false);

  const loadAll = () => {
    listPics().then((res) => setPicOptions((res.data || []).map((p) => ({ label: p.code, value: p.code }))));
    getPicSummary().then((res) => setSummary(res.data || []));
    getPicUnassigned().then(setUnassigned);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const res = await suggestPics();
      message.success(`Đã gợi ý thêm ${res.new_server_links} server, ${res.new_account_links} account`);
      loadAll();
      setMismatchedVersion((v) => v + 1);
    } finally {
      setSuggesting(false);
    }
  };

  const refreshAfterEdit = () => {
    loadAll();
    setMismatchedVersion((v) => v + 1);
  };

  const handleCopyMismatched = async () => {
    setCopyingMismatched(true);
    try {
      const res = await getPicMismatchedDomains({ current: 1, pageSize: 5000 });
      const data = res.data || [];
      if (!data.length) {
        message.warning('Không có domain lệch PIC nào để copy');
        return;
      }
      copyText(data.map((d) => d.domain).join('\n'), `Đã copy ${data.length} domain`);
    } finally {
      setCopyingMismatched(false);
    }
  };

  const handleExportMismatchedCsv = async () => {
    setExportingMismatched(true);
    try {
      const res = await getPicMismatchedDomains({ current: 1, pageSize: 5000 });
      const data = res.data || [];
      if (!data.length) {
        message.warning('Không có dữ liệu để xuất');
        return;
      }
      exportToCsv(
        `pic-mismatched-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Domain', 'Server', 'PIC server', 'CF Account', 'PIC account'],
        data.map((d) => [
          d.domain,
          d.server_name,
          d.server_pics.join('; '),
          d.cf_account_label || '',
          d.cf_account_pics.join('; '),
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExportingMismatched(false);
    }
  };

  return (
    <PageContainer title="Quy hoạch theo PIC">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="PIC (người/nhóm phụ trách) là cách tổ chức server và tài khoản CF."
        description="1 server/tài khoản có thể thuộc nhiều PIC (dùng chung). Bấm 'Gợi ý tự động' để tự nhận diện PIC qua tên server/tài khoản chưa gán - không ghi đè PIC đã gán thủ công."
      />

      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<SyncOutlined spin={suggesting} />} loading={suggesting} onClick={handleSuggest}>
          Gợi ý tự động
        </Button>
      </div>

      <Tabs
        items={[
          {
            key: 'summary',
            label: 'Tổng quan',
            children: (
              <Card>
                <Table
                  size="small"
                  rowKey="pic"
                  dataSource={summary}
                  pagination={false}
                  columns={[
                    { title: 'PIC', dataIndex: 'pic', render: (v) => <Tag color="blue">{v}</Tag> },
                    { title: 'Số server', dataIndex: 'server_count' },
                    { title: 'Số domain', dataIndex: 'domain_count' },
                    { title: 'Số CF account', dataIndex: 'cf_account_count' },
                    { title: 'Số zone CF', dataIndex: 'zone_count' },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'unassigned',
            label: `Chưa gán PIC${unassigned ? ` (${unassigned.servers.length + unassigned.accounts.length})` : ''}`,
            children: (
              <>
                <Card title="Server chưa gán" style={{ marginBottom: 16 }}>
                  <Table
                    size="small"
                    rowKey="server_name"
                    dataSource={unassigned?.servers || []}
                    pagination={false}
                    columns={[
                      { title: 'Server', dataIndex: 'server_name' },
                      { title: 'IP', dataIndex: 'ip' },
                      {
                        title: 'Gán PIC',
                        render: (_, r) => (
                          <PicEditor
                            value={[]}
                            options={picOptions}
                            target={{ type: 'server', server_name: r.server_name }}
                            onSaved={refreshAfterEdit}
                          />
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="CF Account chưa gán">
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={unassigned?.accounts || []}
                    pagination={DEFAULT_PAGINATION}
                    columns={[
                      { title: 'Label', dataIndex: 'label' },
                      { title: 'Email', dataIndex: 'email' },
                      {
                        title: 'Gán PIC',
                        render: (_, r) => (
                          <PicEditor
                            value={[]}
                            options={picOptions}
                            target={{ type: 'account', account_id: r.id }}
                            onSaved={refreshAfterEdit}
                          />
                        ),
                      },
                    ]}
                  />
                </Card>
              </>
            ),
          },
          {
            key: 'mismatched',
            label: 'Domain lệch PIC',
            children: (
              <ProTable<API.PicMismatchedDomain>
                key={mismatchedVersion}
                headerTitle="Domain host ở server 1 PIC nhưng zone CF nằm ở account PIC khác"
                rowKey="domain"
                search={false}
                toolBarRender={() => [
                  <Button key="copy" icon={<CopyOutlined />} loading={copyingMismatched} onClick={handleCopyMismatched}>
                    Copy danh sách
                  </Button>,
                  <Button
                    key="export"
                    icon={<DownloadOutlined />}
                    loading={exportingMismatched}
                    onClick={handleExportMismatchedCsv}
                  >
                    Xuất CSV
                  </Button>,
                ]}
                request={async (params) => getPicMismatchedDomains(params)}
                columns={[
                  { title: 'Domain', dataIndex: 'domain', copyable: true },
                  { title: 'Server', dataIndex: 'server_name' },
                  {
                    title: 'PIC server',
                    dataIndex: 'server_pics',
                    render: (_, r) => r.server_pics.map((p) => <Tag key={p} color="blue">{p}</Tag>),
                  },
                  { title: 'CF Account', dataIndex: 'cf_account_label' },
                  {
                    title: 'PIC account',
                    dataIndex: 'cf_account_pics',
                    render: (_, r) => r.cf_account_pics.map((p) => <Tag key={p} color="orange">{p}</Tag>),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
};

export default PicsPage;
