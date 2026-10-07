import FirewallTemplateSummary from '@/components/FirewallTemplateSummary';
import {
  createCfFirewallTemplate,
  deleteCfFirewallTemplate,
  listCfFirewallTemplates,
  updateCfFirewallTemplate,
} from '@/services/serverOps/api';
import { COMMON_BOT_PRESETS } from '@/utils/firewallBots';
import { countryOptions } from '@/utils/countries';
import {
  ApiOutlined,
  CrownOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EditOutlined,
  FilterOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TagOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
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
  skip_safety_enabled: boolean;
  block_bad_ports_enabled: boolean;
  block_bad_ua_enabled: boolean;
};

/** 1 settings-style row inside the "Rule nền & an toàn" tab - icon + title +
 * description on the left, the actual Switch flush right. Plain div instead
 * of a Card so it reads as one list of toggles, not a stack of boxes. */
const ToggleRow: React.FC<{
  name: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}> = ({ name, icon, title, desc }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      padding: '10px 12px',
      borderRadius: 8,
      background: '#fafafa',
      marginBottom: 8,
    }}
  >
    <Space align="start">
      <span style={{ fontSize: 16, color: '#1890ff', marginTop: 2 }}>{icon}</span>
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {desc}
          </Typography.Text>
        </div>
      </div>
    </Space>
    <Form.Item name={name} valuePropName="checked" noStyle>
      <Switch />
    </Form.Item>
  </div>
);

const TemplateFormFields: React.FC<{ isDefault?: boolean }> = ({ isDefault }) => (
  <>
    <Form.Item name="name" label="Tên template" rules={[{ required: true, message: 'Nhập tên template' }]}>
      <Input placeholder="VD: Khắt khe cho niche cờ bạc" prefix={<TagOutlined style={{ color: '#bfbfbf' }} />} />
    </Form.Item>

    <Row gutter={24}>
      <Col span={12}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          <FilterOutlined /> Chặn theo điều kiện
        </Typography.Title>

        <Form.Item name="countries_blocked" label={<Space size={4}><GlobalOutlined />Chặn quốc gia</Space>}>
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
          label={<Space size={4}><RobotOutlined />Chặn bot theo tên (user-agent)</Space>}
          tooltip='Khớp theo chuỗi con trong User-Agent (không phân biệt hoa/thường). Bot như AhrefsBot tự nhận UA chứa "Mozilla" nên rule chặn UA-không-giống-browser không bắt được, cần chặn riêng ở đây.'
        >
          <Select mode="tags" placeholder="Nhập hoặc chọn nhanh bot phổ biến bên dưới..." tokenSeparators={[',']} />
        </Form.Item>
        <Form.Item label=" " colon={false} style={{ marginTop: -16 }}>
          <Space wrap>
            {COMMON_BOT_PRESETS.map((b) => (
              <AddPresetButton key={b.value} label={b.label} value={b.value} />
            ))}
          </Space>
        </Form.Item>
        <Form.Item name="blocked_paths" label={<Space size={4}><LinkOutlined />Chặn path (URL chứa chuỗi này)</Space>}>
          <Select mode="tags" placeholder="VD: xmlrpc.php" tokenSeparators={[',']} />
        </Form.Item>
        <Form.Item
          name="bot_fight_mode"
          label={<Space size={4}><ThunderboltOutlined />Bot Fight Mode</Space>}
          valuePropName="checked"
          tooltip="Setting riêng của Cloudflare ở cấp zone (khác hẳn các rule ở trên) - tự động chặn/challenge traffic giống bot mà Cloudflare tự nhận diện."
        >
          <Switch />
        </Form.Item>
      </Col>

      <Col span={12}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          <SafetyCertificateOutlined /> Rule nền &amp; an toàn
        </Typography.Title>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            isDefault
              ? 'Đây là template mặc định - lựa chọn hay được dùng lại khi 1 template khác có vấn đề. Tắt rule nền ở đây đồng nghĩa không còn template nào được đảm bảo an toàn tuyệt đối nữa.'
              : 'Tắt bất kỳ rule nào dưới đây có thể khiến rule chặn quốc gia/bot/path bên trái tự chặn nhầm IP whitelist hoặc Googlebot.'
          }
        />
        <ToggleRow
          name="skip_safety_enabled"
          icon={<SafetyCertificateOutlined />}
          title="Skip-list an toàn"
          desc="Bỏ qua mọi rule chặn nếu: path chứa /wp-json/, HOẶC là bot đã xác minh, HOẶC IP nằm trong Whitelist IP, HOẶC ASN là Google."
        />
        <ToggleRow
          name="block_bad_ports_enabled"
          icon={<ApiOutlined />}
          title="Chặn port khác 80/443"
          desc="Chặn mọi request không vào qua port 80/443."
        />
        <ToggleRow
          name="block_bad_ua_enabled"
          icon={<DesktopOutlined />}
          title="Chặn UA không giống browser thật"
          desc='Chặn User-Agent rỗng, hoặc không chứa "mozilla"/"opera".'
        />
      </Col>
    </Row>
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

const TemplateCard: React.FC<{
  tpl: API.CfFirewallTemplateItem;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ tpl, onEdit, onDelete }) => (
  <Card
    hoverable
    title={
      <Space>
        <Typography.Text strong style={{ fontSize: 15 }} ellipsis={{ tooltip: tpl.name }}>
          {tpl.name}
        </Typography.Text>
        {tpl.is_default && (
          <Tag color="gold" icon={<CrownOutlined />}>
            Mặc định
          </Tag>
        )}
      </Space>
    }
    extra={
      <Space size={4}>
        <Tooltip title="Sửa">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title={tpl.is_default ? 'Không thể xoá template mặc định' : 'Xoá'}>
          <Popconfirm title={`Xoá template "${tpl.name}"?`} disabled={tpl.is_default} onConfirm={onDelete}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={tpl.is_default} />
          </Popconfirm>
        </Tooltip>
      </Space>
    }
  >
    <FirewallTemplateSummary tpl={tpl} />
    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
      <UserOutlined /> {tpl.created_by} · {dayjs(tpl.created_at).format('DD/MM/YYYY HH:mm')}
    </Typography.Text>
  </Card>
);

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

  const defaultName = templates.find((t) => t.is_default)?.name || 'Mặc định';

  return (
    <PageContainer
      title="Template Firewall"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          Thêm template
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Chọn template cần dùng ngay tại trang 'Firewall' (Tác vụ Cloudflare) khi áp dụng cho domain."
        description={`Template "${defaultName}" không xoá được và luôn giữ đủ 3 rule nền - luôn có 1 lựa chọn an toàn để quay lại nếu 1 template tuỳ chỉnh có vấn đề.`}
      />

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          {templates.map((t) => (
            <Col key={t.id} xs={24} sm={12} lg={8}>
              <TemplateCard
                tpl={t}
                onEdit={() => {
                  setEditRow(t);
                  editForm.setFieldsValue({
                    name: t.name,
                    countries_blocked: t.countries_blocked,
                    blocked_user_agents: t.blocked_user_agents,
                    blocked_paths: t.blocked_paths,
                    bot_fight_mode: t.bot_fight_mode,
                    skip_safety_enabled: t.skip_safety_enabled,
                    block_bad_ports_enabled: t.block_bad_ports_enabled,
                    block_bad_ua_enabled: t.block_bad_ua_enabled,
                  });
                }}
                onDelete={() => handleDelete(t)}
              />
            </Col>
          ))}
        </Row>
      </Spin>

      <Modal
        title="Thêm template Firewall"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        width={760}
        destroyOnHidden
      >
        <Form
          form={addForm}
          layout="vertical"
          onFinish={handleAdd}
          initialValues={{ skip_safety_enabled: true, block_bad_ports_enabled: true, block_bad_ua_enabled: true }}
        >
          <TemplateFormFields />
        </Form>
      </Modal>

      <Modal
        title={`Sửa template "${editRow?.name}"`}
        open={!!editRow}
        onCancel={() => setEditRow(undefined)}
        onOk={() => editForm.submit()}
        width={760}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <TemplateFormFields isDefault={editRow?.is_default} />
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
