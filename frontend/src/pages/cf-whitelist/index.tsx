import {
  createCfWhitelistIp,
  deleteCfWhitelistIp,
  listCfWhitelistIps,
  updateCfWhitelistIp,
} from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { CopyOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Space, Switch } from 'antd';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';

const CfWhitelist: React.FC = () => {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [editRow, setEditRow] = useState<API.CfWhitelistIpItem>();
  const [editForm] = Form.useForm();
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchAllMatchingFilter = async () => {
    const currentParams = formRef.current?.getFieldsValue() || {};
    const res = await listCfWhitelistIps({ ...currentParams, current: 1, pageSize: 5000 });
    return res.data || [];
  };

  const handleCopyIps = async () => {
    setCopying(true);
    try {
      const data = await fetchAllMatchingFilter();
      if (!data.length) {
        message.warning('Không có IP nào để copy');
        return;
      }
      copyText(data.map((r) => r.ip).join('\n'), `Đã copy ${data.length} IP`);
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
        `cf-whitelist-${dayjs().format('YYYY-MM-DD')}.csv`,
        ['Tên', 'IP', 'Đang bật', 'Ghi chú', 'Ngày thêm'],
        data.map((r) => [
          r.label,
          r.ip,
          r.is_active ? 'Có' : 'Không',
          r.note,
          dayjs(r.created_at).format('YYYY-MM-DD HH:mm:ss'),
        ]),
      );
      message.success(`Đã xuất ${data.length} dòng`);
    } finally {
      setExporting(false);
    }
  };

  const handleAdd = async (values: any) => {
    await createCfWhitelistIp(values);
    message.success('Đã thêm IP');
    setAddOpen(false);
    addForm.resetFields();
    actionRef.current?.reload();
  };

  const handleEdit = async (values: any) => {
    if (!editRow) return;
    await updateCfWhitelistIp(editRow.id, values);
    message.success('Đã cập nhật');
    setEditRow(undefined);
    actionRef.current?.reload();
  };

  const handleToggleActive = async (row: API.CfWhitelistIpItem, is_active: boolean) => {
    try {
      await updateCfWhitelistIp(row.id, { is_active });
      message.success(is_active ? `Đã bật lại "${row.ip}"` : `Đã tắt "${row.ip}"`);
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(e?.message || 'Không cập nhật được');
    }
  };

  const handleDelete = async (row: API.CfWhitelistIpItem) => {
    await deleteCfWhitelistIp(row.id);
    message.success('Đã xoá');
    actionRef.current?.reload();
  };

  const columns: ProColumns<API.CfWhitelistIpItem>[] = [
    { title: 'Tên', dataIndex: 'label', copyable: true },
    { title: 'IP', dataIndex: 'ip', copyable: true, render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    {
      title: 'Đang bật',
      dataIndex: 'is_active',
      search: false,
      render: (_, r) => (
        <Switch checked={r.is_active} onChange={(checked) => handleToggleActive(r, checked)} />
      ),
    },
    { title: 'Ghi chú', dataIndex: 'note', search: false, ellipsis: true },
    { title: 'Ngày thêm', dataIndex: 'created_at', search: false, valueType: 'dateTime' },
    {
      title: 'Hành động',
      search: false,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditRow(r);
              editForm.setFieldsValue(r);
            }}
          >
            Sửa
          </Button>
          <Popconfirm title={`Xoá IP "${r.ip}"?`} onConfirm={() => handleDelete(r)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xoá
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="Whitelist IP (Firewall)">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Danh sách IP được bỏ qua bởi Firewall rule chuẩn áp dụng cho mọi domain (bot/office IP, không bị chặn theo country/UA/xmlrpc)."
        description="Sửa danh sách này KHÔNG tự áp dụng ngay lên các zone đang có - cần chạy task 'Firewall' (CloudFlare Task) sau khi sửa để áp lại rule mới lên các domain cần cập nhật."
      />

      <ProTable<API.CfWhitelistIpItem>
        headerTitle="Danh sách IP whitelist"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        pagination={DEFAULT_PAGINATION}
        search={{ labelWidth: 100 }}
        toolBarRender={() => [
          <Button key="add" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Thêm IP
          </Button>,
          <Button key="copy" icon={<CopyOutlined />} loading={copying} onClick={handleCopyIps}>
            Copy danh sách
          </Button>,
          <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportCsv}>
            Xuất CSV
          </Button>,
        ]}
        request={async (params) => listCfWhitelistIps(params)}
        columns={columns}
      />

      <Modal
        title="Thêm IP whitelist"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="label" label="Tên (tuỳ chọn)">
            <Input placeholder="VD: Văn phòng HN" />
          </Form.Item>
          <Form.Item name="ip" label="IP" rules={[{ required: true }]}>
            <Input placeholder="VD: 192.177.71.221" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú (tuỳ chọn)">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Sửa IP "${editRow?.ip}"`}
        open={!!editRow}
        onCancel={() => setEditRow(undefined)}
        onOk={() => editForm.submit()}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="label" label="Tên">
            <Input />
          </Form.Item>
          <Form.Item name="ip" label="IP" rules={[{ required: true }]}>
            <Input style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default CfWhitelist;
