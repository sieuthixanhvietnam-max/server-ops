import JobLogPanel from '@/components/JobLogPanel';
import JobResultPanel from '@/components/JobResultPanel';
import PicEditor from '@/components/PicEditor';
import { useJobPolling } from '@/hooks/useJobPolling';
import {
  bulkImportCfAccounts,
  createCfAccount,
  deleteCfAccount,
  listCfAccounts,
  listPics,
  testCfAccount,
  triggerCfAccountsSync,
  triggerCfMasterDiscover,
} from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { summarizeJobResult } from '@/utils/jobResult';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { toPicFilterOptions } from '@/utils/picOptions';
import { toSortParams } from '@/utils/tableSort';
import {
  CloudOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';

const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = { never: 'default', ok: 'green', error: 'red' };
const STATUS_LABELS: Record<string, string> = {
  never: 'Chưa đồng bộ',
  ok: 'OK',
  error: 'Lỗi',
};

const parseBulkText = (text: string) => {
  const rows: { label: string; email: string; api_token: string; cf_account_id?: string }[] = [];
  const invalid: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(',').map((p) => p.trim());
      const [label, email, api_token, cf_account_id] = parts;
      if (email && api_token) {
        rows.push({ label: label || email, email, api_token, cf_account_id: cf_account_id || undefined });
      } else {
        invalid.push(line);
      }
    });
  return { rows, invalid };
};

const CfAccounts: React.FC = () => {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<number>();
  const [jobId, setJobId] = useState<number>();
  const job = useJobPolling(jobId);
  const [picOptions, setPicOptions] = useState<{ label: string; value: string }[]>([]);
  const [picFilterOptions, setPicFilterOptions] = useState<{ label: string; value: string }[]>([]);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchAllMatchingFilter = async () => {
    const currentParams = formRef.current?.getFieldsValue() || {};
    const res = await listCfAccounts({ ...currentParams, current: 1, pageSize: 5000 });
    return res.data || [];
  };

  const handleCopyAccounts = async () => {
    setCopying(true);
    try {
      const data = await fetchAllMatchingFilter();
      if (!data.length) {
        message.warning('Không có tài khoản nào để copy');
        return;
      }
      copyText(data.map((a) => a.label).join('\n'), `Đã copy ${data.length} tài khoản`);
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
        `cf-accounts-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Account Name', 'Account ID', 'Email', 'Nguồn', 'Số zone', 'Trạng thái đồng bộ', 'Lần đồng bộ cuối'],
        data.map((a) => [
          a.label,
          a.cf_account_id || '',
          a.email,
          a.source === 'master' ? 'Master Token' : 'Thủ công',
          a.zone_count,
          STATUS_LABELS[a.last_sync_status] || a.last_sync_status,
          a.last_synced_at ? dayjs(a.last_synced_at).format('YYYY-MM-DD HH:mm:ss') : '',
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
  }, []);

  const { rows: bulkRows, invalid: bulkInvalid } = parseBulkText(bulkText);

  useEffect(() => {
    if (job?.status === 'success') {
      actionRef.current?.reload();
      const summary = summarizeJobResult(job.result);
      message.success(summary ? `Hoàn tất: ${summary.text}` : 'Hoàn tất');
    } else if (job?.status === 'failed') {
      actionRef.current?.reload();
      message.error('Job thất bại - xem log bên dưới để biết chi tiết');
    }
  }, [job?.status]);

  const handleAdd = async (values: any) => {
    await createCfAccount(values);
    message.success('Đã thêm tài khoản');
    setAddOpen(false);
    addForm.resetFields();
    actionRef.current?.reload();
  };

  const handleBulkImport = async () => {
    if (!bulkRows.length) {
      message.warning('Chưa có dòng nào hợp lệ');
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await bulkImportCfAccounts(bulkRows);
      message.success(`Đã nhập ${res.created} tài khoản${res.errors.length ? `, ${res.errors.length} dòng lỗi` : ''}`);
      setBulkOpen(false);
      setBulkText('');
      actionRef.current?.reload();
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await testCfAccount(id);
      if (res.valid) {
        message.success(`Token hợp lệ (${res.note})`);
      } else {
        message.error(`Token không hợp lệ: ${res.note}`);
      }
    } finally {
      setTestingId(undefined);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteCfAccount(id);
    message.success('Đã xoá tài khoản');
    actionRef.current?.reload();
  };

  const handleSyncAll = async () => {
    const res = await triggerCfAccountsSync();
    setJobId(res.job_id);
  };

  const handleDiscoverMaster = async () => {
    const res = await triggerCfMasterDiscover();
    setJobId(res.job_id);
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const columns: ProColumns<API.CfAccountItem>[] = [
    { title: 'Account Name', dataIndex: 'label', sorter: true },
    { title: 'Account ID', dataIndex: 'cf_account_id', search: false, copyable: true, sorter: true },
    {
      title: 'Nguồn',
      dataIndex: 'source',
      valueType: 'select',
      fieldProps: {
        options: [
          { label: 'Master Token', value: 'master' },
          { label: 'Thủ công', value: 'manual' },
        ],
      },
      sorter: true,
      render: (_, r) => (
        <Tag color={r.source === 'master' ? 'purple' : 'default'}>
          {r.source === 'master' ? 'Master Token' : 'Thủ công'}
        </Tag>
      ),
    },
    {
      title: 'Đang hoạt động',
      dataIndex: 'is_active',
      valueType: 'select',
      fieldProps: {
        options: [
          { label: 'Có', value: 'true' },
          { label: 'Không', value: 'false' },
        ],
      },
      hideInTable: true,
    },
    { title: 'Số zone', dataIndex: 'zone_count', search: false, sorter: true },
    {
      title: 'Trạng thái đồng bộ',
      dataIndex: 'last_sync_status',
      valueType: 'select',
      fieldProps: {
        options: [
          { label: 'Chưa đồng bộ', value: 'never' },
          { label: 'OK', value: 'ok' },
          { label: 'Lỗi', value: 'error' },
        ],
      },
      sorter: true,
      render: (_, r) => <Tag color={STATUS_COLORS[r.last_sync_status]}>{STATUS_LABELS[r.last_sync_status]}</Tag>,
    },
    {
      title: 'Lần đồng bộ cuối',
      dataIndex: 'last_synced_at',
      search: false,
      sorter: true,
      render: (_, r) => (r.last_synced_at ? dayjs(r.last_synced_at).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    { title: 'Ghi chú lỗi', dataIndex: 'last_sync_error', search: false, ellipsis: true },
    {
      title: 'PIC',
      dataIndex: 'pics',
      search: false,
      render: (_, r) => (
        <PicEditor
          value={r.pics}
          options={picOptions}
          target={{ type: 'account', account_id: r.id }}
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
      title: 'Hành động',
      search: false,
      render: (_, r) => (
        <Space>
          <Button size="small" loading={testingId === r.id} onClick={() => handleTest(r.id)}>
            Test
          </Button>
          <Popconfirm title={`Xoá tài khoản "${r.label}"?`} onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xoá
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="Cloudflare Accounts">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Dữ liệu được tự động đồng bộ từ CF_API_TOKEN (master token, phạm vi 'All accounts')."
        description="'Khám phá qua Master Token' liệt kê toàn bộ tài khoản con + zone dưới token này, không cần nhập tay. Chỉ dùng 'Thêm tài khoản' / 'Nhập hàng loạt' cho tài khoản Cloudflare nằm ngoài phạm vi token này. API token được mã hoá khi lưu, không bao giờ hiển thị lại."
      />

      <ProTable<API.CfAccountItem>
        headerTitle="Danh sách CF Account"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        pagination={DEFAULT_PAGINATION}
        search={{ labelWidth: 100 }}
        toolBarRender={() => [
          <Button
            key="discover"
            type="primary"
            icon={<CloudOutlined />}
            loading={isBusy}
            onClick={handleDiscoverMaster}
          >
            Khám phá qua Master Token
          </Button>,
          <Button key="add" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Thêm tài khoản
          </Button>,
          <Button key="bulk" icon={<UploadOutlined />} onClick={() => setBulkOpen(true)}>
            Nhập hàng loạt
          </Button>,
          <Button
            key="sync"
            icon={isBusy ? <SyncOutlined spin /> : <ReloadOutlined />}
            loading={isBusy}
            onClick={handleSyncAll}
          >
            Đồng bộ ngay
          </Button>,
          <Button key="copy" icon={<CopyOutlined />} loading={copying} onClick={handleCopyAccounts}>
            Copy danh sách
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
            Xuất CSV
          </Button>,
        ]}
        request={async (params, sort) => listCfAccounts({ ...params, ...toSortParams(sort) })}
        columns={columns}
      />

      {jobId && (
        <>
          <JobLogPanel job={job} />
          <JobResultPanel job={job} />
        </>
      )}

      <Modal
        title="Thêm CF Account"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="label" label="Account Name">
            <Input placeholder="VD: Sub 001" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true }]}>
            <Input placeholder="sub001@example.com" />
          </Form.Item>
          <Form.Item name="api_token" label="API Token" rules={[{ required: true }]}>
            <Input.Password placeholder="Cloudflare API Token (Bearer)" />
          </Form.Item>
          <Form.Item name="cf_account_id" label="Account ID (tuỳ chọn)">
            <Input placeholder="Chỉ để tham khảo, không bắt buộc" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Nhập hàng loạt CF Accounts"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={handleBulkImport}
        confirmLoading={bulkSubmitting}
        okButtonProps={{ disabled: !bulkRows.length }}
        width={640}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Mỗi dòng: <code>label,email,api_token[,cf_account_id]</code>
        </Typography.Paragraph>
        <TextArea
          rows={10}
          placeholder={'Sub 001,sub001@example.com,abcdef123...\nSub 002,sub002@example.com,ghijkl456...'}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <Tag color="blue">{bulkRows.length} dòng hợp lệ</Tag>
          {bulkInvalid.length > 0 && <Tag color="red">{bulkInvalid.length} dòng sai định dạng</Tag>}
        </div>
      </Modal>
    </PageContainer>
  );
};

export default CfAccounts;
