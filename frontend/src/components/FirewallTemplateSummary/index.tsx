import { countryLabel } from '@/utils/countries';
import { CheckCircleFilled, CloseCircleFilled, GlobalOutlined, LinkOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
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

/** Những điểm cần cảnh báo trong phần "rule nền" - không còn là 3 bool bật/
 * tắt, mà là nội dung thật (skip_paths/skip_asns/allowed_ports/
 * allowed_ua_substrings là list, skip_verified_bot/skip_whitelist_ip là
 * bool nhị phân thật sự không có "giá trị" để sửa thêm). Rỗng/tắt ở đây
 * đồng nghĩa rule tương ứng không còn áp dụng - đáng cảnh báo giống nhau. */
const dangerFlags = (tpl: API.CfFirewallTemplateItem): string[] => {
  const flags: string[] = [];
  const hasAnySkip = tpl.skip_whitelist_ip || tpl.skip_verified_bot || tpl.skip_paths.length > 0 || tpl.skip_asns.length > 0;
  if (!hasAnySkip) flags.push('Không có skip rule nào - mọi IP đều bị áp rule chặn');
  if (!tpl.skip_whitelist_ip) flags.push('Không bỏ qua IP whitelist');
  if (!tpl.skip_verified_bot) flags.push('Không bỏ qua bot đã xác minh');
  if (!tpl.allowed_ports.length) flags.push('Không chặn port lạ');
  if (!tpl.allowed_ua_substrings.length) flags.push('Không chặn UA giả browser');
  return flags;
};

/** Read-only, tối giản summary của 1 Firewall template - dùng chung giữa
 * card ở trang Template Firewall và preview/confirm dialog ở trang
 * Firewall. Chỉ hiện những gì cần chú ý: rule nền nào đang KHÔNG áp dụng
 * (nếu có), danh sách chặn được rút gọn, Bot Fight Mode chỉ hiện khi đang
 * BẬT - mặc định "mọi thứ bình thường" thì card gần như trống. */
const FirewallTemplateSummary: React.FC<{ tpl: API.CfFirewallTemplateItem }> = ({ tpl }) => {
  const flags = dangerFlags(tpl);

  return (
    <Space direction="vertical" size={6} style={{ maxWidth: 480 }}>
      {flags.length === 0 ? (
        <Tooltip title="Skip-list an toàn, chặn port lạ, và chặn UA giả browser đều đang áp dụng">
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

      <CompactTagRow icon={<GlobalOutlined />} color="red" items={tpl.countries_blocked} render={countryLabel} />
      <CompactTagRow icon={<RobotOutlined />} color="volcano" items={tpl.blocked_user_agents} />
      <CompactTagRow icon={<LinkOutlined />} color="orange" items={tpl.blocked_paths} />

      {tpl.bot_fight_mode && (
        <Tag icon={<ThunderboltOutlined />} color="success">
          Bot Fight Mode
        </Tag>
      )}
    </Space>
  );
};

export default FirewallTemplateSummary;
