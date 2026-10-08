import { isPresetSafe } from '@/components/FirewallPresetCard';
import { countryLabel } from '@/utils/countries';
import { CheckCircleFilled, CloseCircleFilled, GlobalOutlined, LinkOutlined, RobotOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Space, Tag, Tooltip } from 'antd';
import React from 'react';

const MAX_VISIBLE_TAGS = 3;

/** 1 dòng "icon + vài tag đầu + (+N)" - giữ nội dung gọn trên card, đầy đủ
 * danh sách vẫn xem được qua tooltip hover vào tag "+N" thay vì liệt kê hết
 * ra màn hình. */
const CompactTagRow: React.FC<{ icon: React.ReactNode; color: string; items: string[]; render?: (v: string) => string }> = ({
  icon,
  color,
  items,
  render,
}) => {
  if (!items.length) return null;
  const label = render || ((v: string) => v);
  const visible = items.slice(0, MAX_VISIBLE_TAGS);
  const rest = items.slice(MAX_VISIBLE_TAGS);
  return (
    <Space size={4} wrap align="start">
      <span style={{ color: '#8c8c8c' }}>{icon}</span>
      {visible.map((v) => (
        <Tag key={v} color={color}>
          {label(v)}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map(label).join(', ')}>
          <Tag>+{rest.length}</Tag>
        </Tooltip>
      )}
    </Space>
  );
};

/** Giống CompactTagRow, nhưng cho whitelist_ips - mỗi tag là 1 IP, hover vào
 * hiện tên/ghi chú riêng của IP đó (label) thay vì chỉ 1 tooltip chung cho
 * cả nhóm, vì mỗi IP có "chủ" khác nhau, không phải chỉ 1 danh sách đồng
 * nhất như quốc gia/bot/path. */
const CompactWhitelistRow: React.FC<{ items: API.WhitelistIpEntry[] }> = ({ items }) => {
  if (!items.length) return null;
  const visible = items.slice(0, MAX_VISIBLE_TAGS);
  const rest = items.slice(MAX_VISIBLE_TAGS);
  return (
    <Space size={4} wrap align="start">
      <span style={{ color: '#8c8c8c' }}>
        <SafetyCertificateOutlined />
      </span>
      {visible.map((e) => (
        <Tooltip key={e.ip} title={e.label || 'Chưa đặt tên'}>
          <Tag color="blue">{e.ip}</Tag>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((e) => (e.label ? `${e.ip} (${e.label})` : e.ip)).join(', ')}>
          <Tag>+{rest.length}</Tag>
        </Tooltip>
      )}
    </Space>
  );
};

/** Những điểm cần cảnh báo trong phần "rule nền" - đúng 4 điều kiện mà
 * `isPresetSafe` (FirewallPresetCard) dùng để tính "an toàn", chỉ khác là
 * liệt kê ra TỪNG điều kiện đang fail thay vì trả về 1 boolean, nên
 * `flags.length === 0` luôn tương đương `isPresetSafe(p)` - không được tự
 * thêm/bớt điều kiện ở đây mà không sửa `isPresetSafe` theo, 2 nơi từng lệch
 * nhau (bug thật, đã xảy ra) vì mỗi nơi tự định nghĩa "an toàn" riêng. */
const dangerFlags = (p: API.FirewallPresetItem): string[] => {
  const flags: string[] = [];
  if (!p.whitelist_ips.length) flags.push('Chưa có IP whitelist nào');
  if (!p.skip_verified_bot) flags.push('Không bỏ qua bot đã xác minh');
  if (!p.allowed_ports.length) flags.push('Không chặn port lạ');
  if (!p.allowed_ua_substrings.length) flags.push('Không chặn UA giả browser');
  return flags;
};

/** Read-only, tối giản summary của 1 Firewall Preset - dùng chung giữa
 * card ở trang Firewall Preset và preview/confirm dialog ở trang Firewall.
 * Chỉ hiện những gì cần chú ý: rule nền nào đang KHÔNG áp dụng (nếu có),
 * danh sách chặn được rút gọn, Bot Fight Mode chỉ hiện khi đang BẬT - mặc
 * định "mọi thứ bình thường" thì card gần như trống. */
const FirewallPresetSummary: React.FC<{ preset: API.FirewallPresetItem }> = ({ preset }) => {
  const flags = dangerFlags(preset);

  return (
    <Space direction="vertical" size={6} style={{ maxWidth: 480 }}>
      {isPresetSafe(preset) ? (
        <Tooltip title="Có IP whitelist, bỏ qua bot đã xác minh, chặn port lạ, và chặn UA giả browser đều đang áp dụng">
          <Tag icon={<CheckCircleFilled />} color="success">
            Đủ rule nền an toàn
          </Tag>
        </Tooltip>
      ) : (
        <Space size={6} wrap>
          {flags.map((f) => (
            <Tag key={f} icon={<CloseCircleFilled />} color="error">
              {f}
            </Tag>
          ))}
        </Space>
      )}

      <CompactWhitelistRow items={preset.whitelist_ips} />
      <CompactTagRow icon={<GlobalOutlined />} color="red" items={preset.countries_blocked} render={countryLabel} />
      <CompactTagRow icon={<RobotOutlined />} color="volcano" items={preset.blocked_user_agents} />
      <CompactTagRow icon={<LinkOutlined />} color="orange" items={preset.blocked_paths} />

      {preset.bot_fight_mode && (
        <Tag icon={<ThunderboltOutlined />} color="success">
          Bot Fight Mode
        </Tag>
      )}
    </Space>
  );
};

export default FirewallPresetSummary;
