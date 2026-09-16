import {
  createAllowedIp,
  createUser,
  deleteAllowedIp,
  deleteUser,
  listAllowedIps,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateAllowedIp,
  updateUser,
  whoamiAllowedIp,
} from '@/services/serverOps/api';
import { copyText } from '@/utils/clipboard';
import { CopyOutlined, DeleteOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const IpAllowlistTab: React.FC = () => {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [editRow, setEditRow] = useState<API.AllowedIpItem>();
  const [editForm] = Form.useForm();
  const [enforced, setEnforced] = useState(false);
  const [whoami, setWhoami] = useState<{ ip: string; allowed: boolean }>();

  const refreshWhoami = () => {
    whoamiAllowedIp().then((res) => setWhoami({ ip: res.ip, allowed: res.allowed }));
  };

  useEffect(() => {
    refreshWhoami();
  }, []);

  const handleAdd = async (values: any) => {
    await createAllowedIp(values);
    message.success('Đã thêm IP');
    setAddOpen(false);
    addForm.resetFields();
    actionRef.current?.reload();
    refreshWhoami();
  };

  const handleEdit = async (values: any) => {
    if (!editRow) return;
    await updateAllowedIp(editRow.id, values);
    message.success('Đã cập nhật');
    setEditRow(undefined);
    actionRef.current?.reload();
    refreshWhoami();
  };

  const handleToggleActive = async (row: API.AllowedIpItem, is_active: boolean) => {
    try {
      await updateAllowedIp(row.id, { is_active });
      message.success(is_active ? `Đã bật lại "${row.label}"` : `Đã tắt "${row.label}"`);
      actionRef.current?.reload();
      refreshWhoami();
    } catch (e: any) {
      message.error(e?.message || 'Không cập nhật được');
    }
  };

  const handleDelete = async (row: API.AllowedIpItem) => {
    await deleteAllowedIp(row.id);
    message.success('Đã xoá');
    actionRef.current?.reload();
    refreshWhoami();
  };

  const columns: ProColumns<API.AllowedIpItem>[] = [
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
          <Popconfirm title={`Xoá "${r.label}" (${r.ip})?`} onConfirm={() => handleDelete(r)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xoá
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Alert
        type={enforced ? 'success' : 'warning'}
        showIcon
        style={{ marginBottom: 12 }}
        message={
          enforced
            ? 'Đang BẬT - chỉ IP đang bật trong danh sách dưới đây mới truy cập được toàn bộ hệ thống (kể cả trang đăng nhập).'
            : 'Đang TẮT - mọi IP vẫn truy cập bình thường, danh sách dưới đây chỉ để chuẩn bị trước khi bật.'
        }
        description={
          enforced
            ? undefined
            : 'Bật qua biến IP_ALLOWLIST_ENFORCED trong .env (cần restart server) sau khi đã kiểm tra kỹ danh sách.'
        }
      />
      {whoami && (
        <Alert
          type={whoami.allowed ? 'info' : 'error'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            whoami.allowed
              ? `IP hiện tại của bạn là ${whoami.ip} - đã có trong danh sách và đang bật.`
              : `IP hiện tại của bạn là ${whoami.ip} - CHƯA có trong danh sách (hoặc đang tắt). Thêm IP này trước khi bật enforcement, nếu không bạn sẽ tự khoá chính mình.`
          }
        />
      )}

      <ProTable<API.AllowedIpItem>
        headerTitle="Danh sách IP được phép"
        actionRef={actionRef}
        rowKey="id"
        search={{ labelWidth: 100 }}
        toolBarRender={() => [
          <Button key="add" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Thêm IP
          </Button>,
        ]}
        request={async (params) => {
          const res = await listAllowedIps(params);
          setEnforced(res.enforced);
          return res;
        }}
        columns={columns}
      />

      <Modal
        title="Thêm IP được phép"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="label" label="Tên" rules={[{ required: true }]}>
            <Input placeholder="VD: TODD" />
          </Form.Item>
          <Form.Item name="ip" label="IP" rules={[{ required: true }]}>
            <Input placeholder="VD: 192.177.71.221" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú (tuỳ chọn)">
            <Input placeholder="VD: VPN văn phòng" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Sửa "${editRow?.label}"`}
        open={!!editRow}
        onCancel={() => setEditRow(undefined)}
        onOk={() => editForm.submit()}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="label" label="Tên" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="ip" label="IP" rules={[{ required: true }]}>
            <Input style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú (tuỳ chọn)">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

/** Shown right after creating a user or resetting a password - the backend
 * never stores or re-displays plaintext, so this is the only chance to see
 * (and hand off) the value. */
const RevealedPasswordModal: React.FC<{
  info?: { username: string; password: string };
  onClose: () => void;
}> = ({ info, onClose }) => (
  <Modal title="Mật khẩu mới" open={!!info} onCancel={onClose} footer={[<Button key="ok" type="primary" onClick={onClose}>Đã lưu, đóng lại</Button>]} destroyOnHidden>
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message="Chỉ hiển thị 1 lần duy nhất - hãy copy và gửi cho người dùng ngay."
    />
    <Space direction="vertical" style={{ width: '100%' }}>
      <div>
        Tài khoản: <Typography.Text strong>{info?.username}</Typography.Text>
      </div>
      <Input.Group compact style={{ display: 'flex' }}>
        <Input value={info?.password} readOnly style={{ fontFamily: 'monospace' }} />
        <Button icon={<CopyOutlined />} onClick={() => info && copyText(info.password, 'Đã copy mật khẩu')}>
          Copy
        </Button>
      </Input.Group>
    </Space>
  </Modal>
);

const UsersTab: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = useState<API.UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [editRow, setEditRow] = useState<API.UserItem>();
  const [editForm] = Form.useForm();
  const [revealed, setRevealed] = useState<{ username: string; password: string }>();

  const refresh = () => {
    setLoading(true);
    listUsers()
      .then((res) => setRows(res.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = async (values: { username: string; display_name?: string; is_admin?: boolean; password?: string }) => {
    try {
      const res = await createUser({
        username: values.username.trim().toLowerCase(),
        display_name: values.display_name?.trim() || '',
        is_admin: !!values.is_admin,
        password: values.password?.trim() || undefined,
      });
      message.success(`Đã tạo tài khoản "${res.user.username}"`);
      setAddOpen(false);
      addForm.resetFields();
      refresh();
      setRevealed({ username: res.user.username, password: res.password });
    } catch (e: any) {
      message.error(e?.message || 'Không tạo được tài khoản');
    }
  };

  const handleResetPassword = async (row: API.UserItem) => {
    try {
      const res = await resetUserPassword(row.id, undefined);
      setRevealed({ username: row.username, password: res.password });
    } catch (e: any) {
      message.error(e?.message || 'Không đặt lại được mật khẩu');
    }
  };

  const handleToggleActive = async (row: API.UserItem, is_active: boolean) => {
    try {
      await setUserActive(row.id, is_active);
      message.success(is_active ? `Đã mở khoá "${row.username}"` : `Đã khoá "${row.username}"`);
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không cập nhật được');
    }
  };

  const handleEdit = async (values: { display_name?: string }) => {
    if (!editRow) return;
    try {
      await updateUser(editRow.id, values.display_name?.trim() || '');
      message.success('Đã cập nhật');
      setEditRow(undefined);
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không cập nhật được');
    }
  };

  const handleDelete = async (row: API.UserItem) => {
    try {
      await deleteUser(row.id);
      message.success(`Đã xoá "${row.username}"`);
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không xoá được');
    }
  };

  const columns = [
    {
      title: 'Tên đăng nhập',
      dataIndex: 'username',
      render: (v: string, r: API.UserItem) => (
        <Space>
          <span style={{ fontFamily: 'monospace' }}>{v}</span>
          {r.is_admin && <Tag color="gold">Admin</Tag>}
        </Space>
      ),
    },
    { title: 'Tên hiển thị', dataIndex: 'display_name', render: (v: string) => v || '-' },
    {
      title: 'Hoạt động',
      dataIndex: 'is_active',
      render: (v: boolean, r: API.UserItem) => (
        <Switch checked={v} onChange={(checked) => handleToggleActive(r, checked)} />
      ),
    },
    {
      title: 'Ngày tạo',
      dataIndex: 'created_at',
      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
    },
    {
      title: 'Đăng nhập gần nhất',
      dataIndex: 'last_login_at',
      render: (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : 'Chưa đăng nhập'),
    },
    {
      title: 'Hành động',
      render: (_: unknown, r: API.UserItem) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditRow(r);
              editForm.setFieldsValue({ display_name: r.display_name });
            }}
          >
            Sửa
          </Button>
          <Popconfirm title={`Đặt lại mật khẩu cho "${r.username}"?`} onConfirm={() => handleResetPassword(r)}>
            <Button size="small" icon={<KeyOutlined />}>
              Đặt lại mật khẩu
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`Xoá vĩnh viễn "${r.username}"?`}
            description="Không thể hoàn tác. Job History cũ vẫn giữ nguyên tên tài khoản này."
            onConfirm={() => handleDelete(r)}
            okText="Xoá"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xoá
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Mỗi thành viên dùng 1 tài khoản riêng. Chỉ admin tạo tài khoản và đặt/reset mật khẩu - user không tự đổi được mật khẩu của mình."
      />
      <div style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          Tạo tài khoản mới
        </Button>
      </div>
      <Table<API.UserItem>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={columns}
      />

      <Modal
        title="Tạo tài khoản mới"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true }]}>
            <Input placeholder="VD: nguyenvana" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="display_name" label="Tên hiển thị (tuỳ chọn)">
            <Input placeholder="VD: Nguyễn Văn A" />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu (để trống = tự sinh ngẫu nhiên)">
            <Input style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="is_admin" valuePropName="checked">
            <Checkbox>Cấp quyền admin (tạo user khác, đặt lại mật khẩu người khác)</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Sửa "${editRow?.username}"`}
        open={!!editRow}
        onCancel={() => setEditRow(undefined)}
        onOk={() => editForm.submit()}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item label="Tên đăng nhập">
            <Input value={editRow?.username} disabled style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="display_name" label="Tên hiển thị">
            <Input placeholder="VD: Nguyễn Văn A" />
          </Form.Item>
        </Form>
      </Modal>

      <RevealedPasswordModal info={revealed} onClose={() => setRevealed(undefined)} />
    </>
  );
};

const AccessControl: React.FC = () => {
  const access = useAccess();

  const items = [
    { key: 'ip', label: 'IP Allowlist', children: <IpAllowlistTab /> },
    ...(access.canAdmin ? [{ key: 'users', label: 'Người dùng', children: <UsersTab /> }] : []),
  ];

  return (
    <PageContainer title="Kiểm soát truy cập">
      <Tabs items={items} />
    </PageContainer>
  );
};

export default AccessControl;
