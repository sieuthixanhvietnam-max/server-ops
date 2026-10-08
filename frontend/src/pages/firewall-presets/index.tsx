import {
  createFirewallPreset,
  deleteFirewallPreset,
  listFirewallPresets,
  updateFirewallPreset,
} from '@/services/serverOps/api';
import { COMMON_BOT_PRESETS } from '@/utils/firewallBots';
import { countryLabel, countryOptions } from '@/utils/countries';
import {
  ApiOutlined,
  CrownOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownOutlined,
  EditOutlined,
  FilterOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TagOutlined,
  ThunderboltOutlined,
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
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
import React, { useEffect, useRef, useState } from 'react';

type PresetFormValues = {
  name: string;
  countries_blocked: string[];
  blocked_user_agents: string[];
  blocked_paths: string[];
  bot_fight_mode: boolean;
  whitelist_ips: API.WhitelistIpEntry[];
  skip_paths: string[];
  skip_verified_bot: boolean;
  skip_asns: string[];
  allowed_ports: string[];
  allowed_ua_substrings: string[];
};

const DEFAULT_FORM_VALUES: PresetFormValues = {
  name: '',
  countries_blocked: [],
  blocked_user_agents: [],
  blocked_paths: [],
  bot_fight_mode: false,
  whitelist_ips: [],
  skip_paths: ['/wp-json/'],
  skip_verified_bot: true,
  skip_asns: ['15169'],
  allowed_ports: ['80', '443'],
  allowed_ua_substrings: ['mozilla', 'opera'],
};

/** 1 settings-style row cho field chỉ có 2 trạng thái (dùng tín hiệu
 * Cloudflare hay không - không có "giá trị" nào khác để sửa) - icon +
 * title + description bên trái, Switch bên phải. */
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

/** Cùng kiểu hàng settings như ToggleRow, nhưng cho rule nền có NỘI DUNG
 * thật để sửa (danh sách IP/path/ASN/port/UA) - input tags thay cho Switch,
 * xoá hết danh sách = rule đó không còn áp dụng (giống hệt ngữ nghĩa
 * countries_blocked/blocked_paths/blocked_user_agents bên dưới). */
const ListRow: React.FC<{
  name: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  placeholder?: string;
}> = ({ name, icon, title, desc, placeholder }) => (
  <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fafafa', marginBottom: 8 }}>
    <Space align="start" style={{ marginBottom: 6 }}>
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
    <Form.Item name={name} noStyle>
      <Select mode="tags" style={{ width: '100%' }} placeholder={placeholder} tokenSeparators={[',']} />
    </Form.Item>
  </div>
);

/** Cùng kiểu header như ListRow, nhưng cho whitelist_ips - mỗi IP có thêm 1
 * ô "tên/ghi chú" đi kèm (hiện khi hover ở nơi khác), nên không thể dùng
 * Select tags (chỉ nhận string trơn) mà cần Form.List để sửa từng cặp
 * {ip, label} độc lập.
 *
 * Danh sách này có thể dài (36 IP cho preset Mặc định) - nếu luôn mở hết
 * thì riêng mục này đã dài hơn tất cả các mục khác cộng lại. Thu gọn mặc
 * định (chỉ hiện số lượng), mở ra thì cuộn trong khung cao cố định thay vì
 * kéo dài cả trang - giữ nút "Thêm IP" ngoài khung cuộn để luôn bấm được
 * ngay, không cần cuộn xuống cuối danh sách. */
const WhitelistIpField: React.FC = () => {
  const [open, setOpen] = useState(false);
  const whitelistIps: API.WhitelistIpEntry[] = Form.useWatch('whitelist_ips') || [];

  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fafafa', marginBottom: 8 }}>
      <div
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Space align="start">
          <span style={{ fontSize: 16, color: '#1890ff', marginTop: 2 }}>
            <SafetyCertificateOutlined />
          </span>
          <div>
            <Typography.Text strong>IP Whitelist</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                IP văn phòng/bot được bỏ qua mọi rule chặn, riêng cho preset này. Tên/ghi chú hiện khi hover vào IP.
              </Typography.Text>
            </div>
          </div>
        </Space>
        <Space>
          <Tag>{whitelistIps.length} IP</Tag>
          {open ? <UpOutlined /> : <DownOutlined />}
        </Space>
      </div>
      {open && (
        <Form.List name="whitelist_ips">
          {(fields, { add, remove }) => (
            <div style={{ marginTop: 10 }}>
              <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {fields.map((field) => (
                  <Space key={field.key} style={{ display: 'flex', marginBottom: 6 }} align="baseline">
                    <Form.Item
                      {...field}
                      name={[field.name, 'ip']}
                      rules={[{ required: true, message: 'Nhập IP' }]}
                      noStyle
                    >
                      <Input placeholder="VD: 192.177.71.221" size="small" style={{ width: 160, fontFamily: 'monospace' }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'label']} noStyle>
                      <Input placeholder="Tên/ghi chú (tuỳ chọn)" size="small" style={{ width: 160 }} />
                    </Form.Item>
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                  </Space>
                ))}
                {fields.length === 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Chưa có IP nào.
                  </Typography.Text>
                )}
              </div>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => add({ ip: '', label: '' })}
              >
                Thêm IP
              </Button>
            </div>
          )}
        </Form.List>
      )}
    </div>
  );
};

const PresetFormFields: React.FC<{ isDefault?: boolean }> = ({ isDefault }) => (
  <>
    <Form.Item name="name" label="Tên preset" rules={[{ required: true, message: 'Nhập tên preset' }]}>
      <Input placeholder="VD: Khắt khe cho niche cờ bạc" prefix={<TagOutlined style={{ color: '#bfbfbf' }} />} />
    </Form.Item>

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

    <Divider />

    <Typography.Title level={5} style={{ marginTop: 0 }}>
      <SafetyCertificateOutlined /> Rule nền &amp; an toàn
    </Typography.Title>
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message={
        isDefault
          ? 'Đây là preset mặc định - lựa chọn hay được dùng lại khi 1 preset khác có vấn đề. Xoá hết 1 danh sách hoặc tắt toggle dưới đây đồng nghĩa không còn preset nào được đảm bảo an toàn tuyệt đối nữa.'
          : 'Xoá hết 1 danh sách hoặc tắt toggle dưới đây đồng nghĩa rule đó không còn áp dụng - có thể khiến rule chặn quốc gia/bot/path phía trên bắt nhầm IP whitelist hoặc Googlebot.'
      }
    />
    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
      Request được "bỏ qua" (skip) nếu khớp BẤT KỲ điều kiện nào dưới đây - không bị áp các rule chặn phía trên.
    </Typography.Text>
    <WhitelistIpField />
    <ToggleRow
      name="skip_verified_bot"
      icon={<RobotOutlined />}
      title="Bỏ qua bot đã xác minh (Cloudflare)"
      desc="Dùng tín hiệu cf.client.bot do Cloudflare tự nhận diện."
    />
    <ListRow
      name="skip_asns"
      icon={<GlobalOutlined />}
      title="Bỏ qua theo ASN"
      desc="Mặc định 15169 (Google) - thêm/xoá ASN tuỳ ý."
      placeholder="VD: 15169"
    />
    <ListRow
      name="skip_paths"
      icon={<LinkOutlined />}
      title="Bỏ qua theo path"
      desc="Mặc định /wp-json/ - URL chứa 1 trong các chuỗi này sẽ được bỏ qua."
      placeholder="VD: /wp-json/"
    />
    <ListRow
      name="allowed_ports"
      icon={<ApiOutlined />}
      title="Port được phép"
      desc="Chặn mọi request không vào qua 1 trong các port này. Mặc định 80, 443."
      placeholder="VD: 80"
    />
    <ListRow
      name="allowed_ua_substrings"
      icon={<DesktopOutlined />}
      title="Chuỗi UA hợp lệ (browser thật)"
      desc='Chặn User-Agent không chứa bất kỳ chuỗi nào ở đây. Mặc định "mozilla", "opera".'
      placeholder="VD: mozilla"
    />
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

/** Rút gọn 1 danh sách dài thành chuỗi preview cho tooltip - hiện đủ nếu
 * ngắn, cắt + "và N khác" nếu dài (whitelist_ips có thể tới 36 phần tử,
 * in hết ra tooltip sẽ quá dài để đọc). */
const previewList = (items: string[], max = 8): string => {
  if (!items.length) return 'Không có';
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')}, và ${items.length - max} khác`;
};

/** 1 chip nhỏ "icon + nhãn + số lượng (hoặc BẬT/TẮT)" - đơn vị hiển thị
 * chuẩn cho mọi thông số của preset, để card luôn cho thấy ĐẦY ĐỦ các
 * chiều (quốc gia/bot/path/IP/ASN/port/UA...) thay vì chỉ liệt kê cái nào
 * có giá trị - 0/TẮT vẫn hiện, chỉ đổi màu khi đó là trạng thái rủi ro.
 * Tooltip mang nội dung chi tiết (danh sách thật) nên chip tự nó vẫn gọn. */
const StatChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number | boolean;
  tooltip: string;
  danger?: boolean;
}> = ({ icon, label, value, tooltip, danger }) => {
  const isDanger = danger ?? (typeof value === 'boolean' && !value);
  const display = typeof value === 'boolean' ? (value ? 'BẬT' : 'TẮT') : value;
  return (
    <Tooltip title={tooltip}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 12,
          background: isDanger ? '#fff1f0' : '#fafafa',
          border: `1px solid ${isDanger ? '#ffccc7' : '#f0f0f0'}`,
          color: isDanger ? '#cf1322' : '#595959',
        }}
      >
        <span style={{ fontSize: 13 }}>{icon}</span>
        {label}
        <Typography.Text strong style={{ fontSize: 12, color: isDanger ? '#cf1322' : '#262626' }}>
          {display}
        </Typography.Text>
      </span>
    </Tooltip>
  );
};

/** Toàn bộ thông số của 1 preset, chia đúng 2 nhóm như form sửa ("Chặn
 * thêm" / "Rule nền") - mỗi chiều luôn có 1 chip, kể cả khi rỗng/tắt, nên
 * card cho thấy đầy đủ thông tin thay vì chỉ phần "có vấn đề". Dùng riêng
 * cho card lưới ở trang này - FirewallPresetSummary (ở trang Firewall) vẫn
 * giữ bản tối giản cho chỗ cần glance nhanh trước khi chạy job. */
const PresetStats: React.FC<{ preset: API.FirewallPresetItem }> = ({ preset }) => {
  const whitelistLabels = preset.whitelist_ips.map((e) => (e.label ? `${e.ip} (${e.label})` : e.ip));
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.3 }}>
          CHẶN THÊM
        </Typography.Text>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <StatChip
            icon={<GlobalOutlined />}
            label="Quốc gia"
            value={preset.countries_blocked.length}
            tooltip={previewList(preset.countries_blocked.map(countryLabel))}
          />
          <StatChip
            icon={<RobotOutlined />}
            label="Bot"
            value={preset.blocked_user_agents.length}
            tooltip={previewList(preset.blocked_user_agents)}
          />
          <StatChip
            icon={<LinkOutlined />}
            label="Path"
            value={preset.blocked_paths.length}
            tooltip={previewList(preset.blocked_paths)}
          />
          <StatChip
            icon={<ThunderboltOutlined />}
            label="Bot Fight Mode"
            value={preset.bot_fight_mode}
            danger={false}
            tooltip="Setting riêng của Cloudflare ở cấp zone - tự động chặn/challenge traffic giống bot."
          />
        </div>
      </div>

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.3 }}>
          RULE NỀN
        </Typography.Text>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <StatChip
            icon={<SafetyCertificateOutlined />}
            label="Whitelist IP"
            value={preset.whitelist_ips.length}
            tooltip={previewList(whitelistLabels)}
          />
          <StatChip
            icon={<RobotOutlined />}
            label="Bot xác minh"
            value={preset.skip_verified_bot}
            tooltip="Bỏ qua mọi rule chặn nếu Cloudflare tự nhận diện là bot đã xác minh."
          />
          <StatChip
            icon={<GlobalOutlined />}
            label="ASN skip"
            value={preset.skip_asns.length}
            tooltip={previewList(preset.skip_asns)}
          />
          <StatChip
            icon={<LinkOutlined />}
            label="Path skip"
            value={preset.skip_paths.length}
            tooltip={previewList(preset.skip_paths)}
          />
          <StatChip
            icon={<ApiOutlined />}
            label="Port"
            value={preset.allowed_ports.length}
            tooltip={previewList(preset.allowed_ports)}
          />
          <StatChip
            icon={<DesktopOutlined />}
            label="UA hợp lệ"
            value={preset.allowed_ua_substrings.length}
            tooltip={previewList(preset.allowed_ua_substrings)}
          />
        </div>
      </div>
    </Space>
  );
};

/** true nếu không có rule nền nào bị rỗng/tắt - cùng logic rủi ro mà
 * FirewallPresetSummary dùng, chỉ để tô màu cái chấm trạng thái trên tên
 * preset (chi tiết từng chiều đã có màu riêng trong PresetStats rồi, chấm
 * này chỉ là tín hiệu liếc nhanh khi lướt qua nhiều card). */
const isPresetSafe = (p: API.FirewallPresetItem): boolean => {
  const hasAnySkip = p.whitelist_ips.length > 0 || p.skip_verified_bot || p.skip_paths.length > 0 || p.skip_asns.length > 0;
  return hasAnySkip && p.skip_verified_bot && p.allowed_ports.length > 0 && p.allowed_ua_substrings.length > 0;
};

const PresetCard: React.FC<{
  preset: API.FirewallPresetItem;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ preset, onEdit, onDelete }) => (
  <Card
    hoverable
    title={
      <Space>
        <Badge status={isPresetSafe(preset) ? 'success' : 'error'} />
        <Typography.Text strong style={{ fontSize: 15 }} ellipsis={{ tooltip: preset.name }}>
          {preset.name}
        </Typography.Text>
        {preset.is_default && (
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
        <Tooltip title={preset.is_default ? 'Không thể xoá preset mặc định' : 'Xoá'}>
          <Popconfirm title={`Xoá preset "${preset.name}"?`} disabled={preset.is_default} onConfirm={onDelete}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={preset.is_default} />
          </Popconfirm>
        </Tooltip>
      </Space>
    }
  >
    <PresetStats preset={preset} />
    <Divider style={{ margin: '10px 0' }} />
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      <UserOutlined /> {preset.created_by} · {dayjs(preset.created_at).format('DD/MM/YYYY HH:mm')}
    </Typography.Text>
  </Card>
);

const FirewallPresetsBody: React.FC = () => {
  const { message } = App.useApp();
  const [presets, setPresets] = useState<API.FirewallPresetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editingPreset, setEditingPreset] = useState<API.FirewallPresetItem>();
  const [form] = Form.useForm<PresetFormValues>();
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFirewallPresets();
      setPresets(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Form.useForm()'s instance only "connects" once its <Form> is actually
  // mounted - calling setFieldsValue in the same click handler that flips
  // formMode from null would race the Form's own mount, so it's done here
  // instead, after the panel (and its <Form>) has already committed.
  useEffect(() => {
    if (formMode === 'add') {
      form.resetFields();
      form.setFieldsValue(DEFAULT_FORM_VALUES);
    } else if (formMode === 'edit' && editingPreset) {
      form.setFieldsValue({
        name: editingPreset.name,
        countries_blocked: editingPreset.countries_blocked,
        blocked_user_agents: editingPreset.blocked_user_agents,
        blocked_paths: editingPreset.blocked_paths,
        bot_fight_mode: editingPreset.bot_fight_mode,
        whitelist_ips: editingPreset.whitelist_ips,
        skip_paths: editingPreset.skip_paths,
        skip_verified_bot: editingPreset.skip_verified_bot,
        skip_asns: editingPreset.skip_asns,
        allowed_ports: editingPreset.allowed_ports,
        allowed_ua_substrings: editingPreset.allowed_ua_substrings,
      });
    }
    if (formMode) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formMode, editingPreset]);

  const openAdd = () => {
    setEditingPreset(undefined);
    setFormMode('add');
  };

  const openEdit = (p: API.FirewallPresetItem) => {
    setEditingPreset(p);
    setFormMode('edit');
  };

  const closePanel = () => {
    setFormMode(null);
    setEditingPreset(undefined);
  };

  const handleSubmit = async (values: PresetFormValues) => {
    if (formMode === 'edit' && editingPreset) {
      await updateFirewallPreset(editingPreset.id, values);
      message.success('Đã cập nhật');
    } else {
      await createFirewallPreset(values);
      message.success('Đã tạo preset');
    }
    closePanel();
    load();
  };

  const handleDelete = async (row: API.FirewallPresetItem) => {
    try {
      await deleteFirewallPreset(row.id);
      message.success('Đã xoá');
      load();
    } catch (e: any) {
      message.error(e?.message || 'Không xoá được');
    }
  };

  const defaultName = presets.find((p) => p.is_default)?.name || 'Mặc định';

  return (
    <PageContainer
      title="Firewall Preset"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          Thêm Preset
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Mỗi preset là 1 bộ thiết lập Firewall đặt tên sẵn - chọn preset cần dùng ngay tại trang 'Firewall' (Tác vụ Cloudflare) khi áp dụng cho domain."
        description={`Preset "${defaultName}" không xoá được - luôn có 1 lựa chọn an toàn để quay lại nếu 1 preset tuỳ chỉnh có vấn đề.`}
      />

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          {presets.map((p) => (
            <Col key={p.id} xs={24} sm={12} lg={8}>
              <PresetCard preset={p} onEdit={() => openEdit(p)} onDelete={() => handleDelete(p)} />
            </Col>
          ))}
        </Row>
      </Spin>

      {formMode && (
        <div ref={panelRef}>
          <Card
            style={{ marginTop: 16 }}
            title={formMode === 'add' ? 'Thêm Preset mới' : `Sửa preset "${editingPreset?.name}"`}
          >
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
              <PresetFormFields isDefault={formMode === 'edit' && editingPreset?.is_default} />
              <Space>
                <Button type="primary" onClick={() => form.submit()}>
                  Lưu
                </Button>
                <Button onClick={closePanel}>Huỷ</Button>
              </Space>
            </Form>
          </Card>
        </div>
      )}
    </PageContainer>
  );
};

const FirewallPresets: React.FC = () => {
  const access = useAccess();
  if (!access.canAdmin) {
    return (
      <PageContainer title="Firewall Preset">
        <Result status="403" title="Không có quyền truy cập" subTitle="Chỉ admin mới sửa được Firewall Preset." />
      </PageContainer>
    );
  }
  return <FirewallPresetsBody />;
};

export default FirewallPresets;
