import {
  deleteIndexerCredential,
  listIndexerCredentials,
  setIndexerCredential,
} from '@/services/serverOps/api';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';

const SERVICE_LABELS: Record<API.IndexerService, string> = {
  speedyindex: 'SpeedyIndex',
  instantindexer: 'InstantIndexer',
  linksindexer: 'LinksIndexer',
  ralfyindex: 'RalfyIndex',
};

const IndexerCredentialsCard: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = useState<API.IndexerCredentialItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editService, setEditService] = useState<API.IndexerService>();
  const [form] = Form.useForm();

  const refresh = () => {
    setLoading(true);
    listIndexerCredentials()
      .then((res) => setRows(res.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = async (values: { api_key: string }) => {
    if (!editService) return;
    try {
      await setIndexerCredential(editService, values.api_key.trim());
      message.success(`Đã lưu API key cho ${SERVICE_LABELS[editService]}`);
      setEditService(undefined);
      form.resetFields();
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không lưu được API key');
    }
  };

  const handleDelete = async (service: API.IndexerService) => {
    try {
      await deleteIndexerCredential(service);
      message.success(`Đã xoá API key ${SERVICE_LABELS[service]}`);
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không xoá được');
    }
  };

  return (
    <Card
      title="API key dịch vụ ép Index"
      extra={<Typography.Text type="secondary">Dùng cho page Ép Index</Typography.Text>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Key được mã hoá khi lưu vào hệ thống, không hiển thị lại sau khi lưu. Cập nhật key ở đây không cần restart server - áp dụng ngay cho lần chạy tiếp theo."
      />
      <Table<API.IndexerCredentialItem>
        size="small"
        rowKey="service"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Dịch vụ', dataIndex: 'service', render: (v: API.IndexerService) => SERVICE_LABELS[v] },
          {
            title: 'Trạng thái',
            dataIndex: 'configured',
            render: (v: boolean) => (v ? <Tag color="green">Đã cấu hình</Tag> : <Tag>Chưa cấu hình</Tag>),
          },
          {
            title: 'Cập nhật lần cuối',
            dataIndex: 'updated_at',
            render: (v: string | null, r) => (v ? `${new Date(v).toLocaleString('vi-VN')} bởi ${r.updated_by}` : '-'),
          },
          {
            title: 'Hành động',
            key: 'action',
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setEditService(r.service)}>
                  {r.configured ? 'Cập nhật key' : 'Thêm key'}
                </Button>
                {r.configured && (
                  <Popconfirm title="Xoá API key này?" onConfirm={() => handleDelete(r.service)}>
                    <Button size="small" danger>
                      Xoá
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editService ? `Cập nhật key ${SERVICE_LABELS[editService]}` : ''}
        open={!!editService}
        onCancel={() => {
          setEditService(undefined);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Lưu"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="api_key"
            label="API key"
            rules={[{ required: true, message: 'Nhập API key' }]}
          >
            <Input.Password placeholder="Dán API key..." autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

const SettingsPage: React.FC = () => {
  const access = useAccess();

  if (!access.canAdmin) {
    return (
      <PageContainer title="Cài đặt hệ thống">
        <Result status="403" title="Không có quyền truy cập" subTitle="Chỉ admin mới xem được trang này." />
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Cài đặt hệ thống">
      <IndexerCredentialsCard />
    </PageContainer>
  );
};

export default SettingsPage;
