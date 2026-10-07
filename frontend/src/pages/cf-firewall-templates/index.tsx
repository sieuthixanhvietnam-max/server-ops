import FirewallTemplateSummary from '@/components/FirewallTemplateSummary';
import {
  createCfFirewallTemplate,
  deleteCfFirewallTemplate,
  listCfFirewallTemplates,
  updateCfFirewallTemplate,
} from '@/services/serverOps/api';
import { COMMON_BOT_PRESETS } from '@/utils/firewallBots';
import { countryOptions } from '@/utils/countries';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
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
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';

type TemplateFormValues = {
  name: string;
  countries_blocked: string[];
  blocked_user_agents: string[];
  blocked_paths: string[];
  bot_fight_mode: boolean;
};

const TemplateFormFields: React.FC = () => (
  <>
    <Form.Item name="name" label="Tên template" rules={[{ required: true, message: 'Nhập tên template' }]}>
      <Input placeholder="VD: Khắt khe cho niche cờ bạc" />
    </Form.Item>
    <Form.Item
      name="countries_blocked"
      label="Chặn quốc gia"
      tooltip="Không giới hạn - port 80/443, chặn UA không giống browser thật, và skip-list an toàn (whitelist IP/bot xác minh/Google/wp-json) luôn cố định cho mọi template, không nằm ở đây."
    >
      <Select
        mode="multiple"
        showSearch
        optionFilterProp="label"
        placeholder="Chọn quốc gia cần chặn..."
        options={countryOptions()}
      />
    </Form.Item>
    <Form.Item
      name="blocked_user_agents"
      label="Chặn bot theo tên (user-agent)"
      tooltip='Khớp theo chuỗi con trong User-Agent (không phân biệt hoa/thường). Bot như AhrefsBot tự nhận UA chứa "Mozilla" nên rule chặn UA-không-giống-browser không bắt được, cần chặn riêng ở đây.'
    >
      <Select mode="tags" placeholder="Nhập hoặc chọn nhanh bot phổ biến bên dưới..." tokenSeparators={[',']} />
    </Form.Item>
    <Form.Item label=" " colon={false}>
      <Space wrap>
        {COMMON_BOT_PRESETS.map((b) => (
          <AddPresetButton key={b.value} label={b.label} value={b.value} />
        ))}
      </Space>
    </Form.Item>
    <Form.Item name="blocked_paths" label="Chặn path (URL chứa chuỗi này)">
      <Select mode="tags" placeholder="VD: xmlrpc.php" tokenSeparators={[',']} />
    </Form.Item>
    <Form.Item
      name="bot_fight_mode"
      label="Bot Fight Mode"
      valuePropName="checked"
      tooltip="Setting riêng của Cloudflare ở cấp zone (khác hẳn các rule ở trên) - tự động chặn/challenge traffic giống bot mà Cloudflare tự nhận diện."
    >
      <Switch />
    </Form.Item>
  </>
);

/** 1 nút bấm nhanh thêm 1 bot preset vào field "blocked_user_agents" của
 * form cha - đọc/ghi qua Form.useFormInstance() vì nằm trong cùng Form
 * nhưng không phải 1 Form.Item trực tiếp điều khiển field đó. */
const AddPresetButton: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const form = Form.useFormInstance();
  return (
    <Button
      size="small"
      onClick={() => {
        const current: string[] = form.getFieldValue('blocked_user_agents') || [];
        if (!current.includes(value)) {
          form.setFieldValue('blocked_user_agents', [...current, value]);
        }
      }}
    >
      + {label}
    </Button>
  );
};

const CfFirewallTemplatesBody: React.FC = () => {
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<API.CfFirewallTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm<TemplateFormValues>();
  const [editRow, setEditRow] = useState<API.CfFirewallTemplateItem>();
  const [editForm] = Form.useForm<TemplateFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const res = await listCfFirewallTemplates();
      setTemplates(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (values: TemplateFormValues) => {
    await createCfFirewallTemplate(values);
    message.success('Đã tạo template');
    setAddOpen(false);
    addForm.resetFields();
    load();
  };

  const handleEdit = async (values: TemplateFormValues) => {
    if (!editRow) return;
    await updateCfFirewallTemplate(editRow.id, values);
    message.success('Đã cập nhật');
    setEditRow(undefined);
    load();
  };

  const handleDelete = async (row: API.CfFirewallTemplateItem) => {
    try {
      await deleteCfFirewallTemplate(row.id);
      message.success('Đã xoá');
      load();
    } catch (e: any) {
      message.error(e?.message || 'Không xoá được');
    }
  };

  return (
    <PageContainer title="Template Firewall">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Mỗi template định nghĩa phần có thể tuỳ biến của bộ rule Firewall - chọn template cần dùng ngay tại trang 'Firewall' (Tác vụ Cloudflare) khi áp dụng cho domain."
        description={`Template "${templates.find((t) => t.is_default)?.name || 'Mặc định'}" không xoá được - luôn có 1 lựa chọn an toàn để quay lại nếu 1 template tuỳ chỉnh có vấn đề.`}
      />

      <Card>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Thêm template
          </Button>
        </div>
        <Table<API.CfFirewallTemplateItem>
          rowKey="id"
          loading={loading}
          dataSource={templates}
          pagination={false}
          columns={[
            {
              title: 'Tên',
              dataIndex: 'name',
              render: (v, r) => (
                <Space>
                  <Typography.Text strong>{v}</Typography.Text>
                  {r.is_default && <Tag color="blue">Mặc định</Tag>}
                </Space>
              ),
            },
            { title: 'Nội dung', render: (_, r) => <FirewallTemplateSummary tpl={r} /> },
            { title: 'Người tạo', dataIndex: 'created_by' },
            {
              title: 'Ngày tạo',
              dataIndex: 'created_at',
              render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            {
              title: 'Hành động',
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditRow(r);
                      editForm.setFieldsValue({
                        name: r.name,
                        countries_blocked: r.countries_blocked,
                        blocked_user_agents: r.blocked_user_agents,
                        blocked_paths: r.blocked_paths,
                        bot_fight_mode: r.bot_fight_mode,
                      });
                    }}
                  >
                    Sửa
                  </Button>
                  <Popconfirm
                    title={`Xoá template "${r.name}"?`}
                    disabled={r.is_default}
                    onConfirm={() => handleDelete(r)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} disabled={r.is_default}>
                      Xoá
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Thêm template Firewall"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        width={640}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <TemplateFormFields />
        </Form>
      </Modal>

      <Modal
        title={`Sửa template "${editRow?.name}"`}
        open={!!editRow}
        onCancel={() => setEditRow(undefined)}
        onOk={() => editForm.submit()}
        width={640}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <TemplateFormFields />
        </Form>
      </Modal>
    </PageContainer>
  );
};

const CfFirewallTemplates: React.FC = () => {
  const access = useAccess();
  if (!access.canAdmin) {
    return (
      <PageContainer title="Template Firewall">
        <Result status="403" title="Không có quyền truy cập" subTitle="Chỉ admin mới sửa được template Firewall." />
      </PageContainer>
    );
  }
  return <CfFirewallTemplatesBody />;
};

export default CfFirewallTemplates;
