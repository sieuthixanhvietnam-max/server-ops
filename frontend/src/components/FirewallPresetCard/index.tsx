import { countryLabel } from '@/utils/countries';
import { formatDateTimeShort } from '@/utils/dateFormat';
import {
  ApiOutlined,
  CrownOutlined,
  DesktopOutlined,
  GlobalOutlined,
  LinkOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Card, Divider, Space, Tag, Tooltip, Typography } from 'antd';
import React from 'react';

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

/** Toàn bộ thông số của 1 preset, chia 2 nhóm "Chặn thêm" / "Rule nền" - mỗi
 * chiều luôn có 1 chip, kể cả khi rỗng/tắt, nên card cho thấy đầy đủ thông
 * tin thay vì chỉ phần "có vấn đề". Dùng chung giữa card quản lý preset và
 * card chọn preset ở trang Firewall - FirewallPresetSummary (khác file) vẫn
 * giữ bản tối giản riêng cho chỗ cần glance nhanh trong popconfirm. */
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

/** true nếu không có rule nền nào bị rỗng/tắt - dùng để tô màu chấm trạng
 * thái trên tên preset (chi tiết từng chiều đã có màu riêng trong
 * PresetStats, chấm này chỉ là tín hiệu liếc nhanh khi lướt qua nhiều card).
 * Nguồn sự thật DUY NHẤT cho "preset này an toàn chưa" - FirewallPresetSummary
 * phải import đúng hàm này, không được tự định nghĩa lại (trước đây 2 nơi
 * từng lệch nhau: bản cũ ở đây OR whitelist_ips vào 1 điều kiện `hasAnySkip`
 * bị `skip_verified_bot` làm cho luôn đúng, nên whitelist_ips rỗng vẫn báo
 * "an toàn" - sai với ý định ban đầu là whitelist_ips rỗng phải tính là rủi
 * ro, đúng như FirewallPresetSummary vẫn luôn cảnh báo). */
export const isPresetSafe = (p: API.FirewallPresetItem): boolean =>
  p.whitelist_ips.length > 0 &&
  p.skip_verified_bot &&
  p.allowed_ports.length > 0 &&
  p.allowed_ua_substrings.length > 0;

/** Card hiện đầy đủ thông tin 1 Firewall Preset - dùng chung giữa trang
 * quản lý ("Firewall Preset", có `actions` sửa/clone/xoá) và trang chạy
 * job ("Firewall", không có `actions`, click cả card để chọn - `selected`
 * tô viền xanh + chấm check). Cùng 1 UI ở cả 2 nơi để admin nhận ra ngay
 * đây là preset nào khi chọn, không cần học lại 1 kiểu card khác. */
const FirewallPresetCard: React.FC<{
  preset: API.FirewallPresetItem;
  actions?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}> = ({ preset, actions, selected, onClick }) => (
  <Card
    hoverable
    onClick={onClick}
    style={
      onClick
        ? {
            cursor: 'pointer',
            borderColor: selected ? '#52c41a' : undefined,
            boxShadow: selected ? '0 0 0 1px #52c41a' : undefined,
          }
        : undefined
    }
    title={
      <Space>
        {onClick ? (
          <Badge status={selected ? 'success' : 'default'} />
        ) : (
          <Badge status={isPresetSafe(preset) ? 'success' : 'error'} />
        )}
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
    extra={actions}
  >
    <PresetStats preset={preset} />
    <Divider style={{ margin: '10px 0' }} />
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      <UserOutlined /> {preset.created_by} · {formatDateTimeShort(preset.created_at)}
    </Typography.Text>
  </Card>
);

export default FirewallPresetCard;
