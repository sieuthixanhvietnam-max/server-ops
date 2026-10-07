import { countryLabel } from '@/utils/countries';
import { CheckCircleFilled, CloseCircleFilled, GlobalOutlined, LinkOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Space, Tag, Tooltip } from 'antd';
import React from 'react';

const BASE_RULES: {
  key: 'skip_safety_enabled' | 'block_bad_ports_enabled' | 'block_bad_ua_enabled';
  label: string;
  tooltip: string;
}[] = [
  {
    key: 'skip_safety_enabled',
    label: 'Skip-list an toàn',
    tooltip:
      'Bỏ qua mọi rule chặn bên dưới nếu: path chứa /wp-json/, HOẶC là bot đã xác minh, HOẶC IP nằm trong Whitelist IP, HOẶC ASN là Google.',
  },
  {
    key: 'block_bad_ports_enabled',
    label: 'Chặn port lạ',
    tooltip: 'Chặn mọi request không vào qua port 80/443.',
  },
  {
    key: 'block_bad_ua_enabled',
    label: 'Chặn UA giả browser',
    tooltip: 'Chặn User-Agent rỗng, hoặc không chứa "mozilla"/"opera".',
  },
];

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

/** Read-only, tối giản summary của 1 Firewall template - dùng chung giữa
 * card ở trang Template Firewall và preview/confirm dialog ở trang
 * Firewall. Chỉ hiện những gì cần chú ý: rule nền đang TẮT (nếu có), danh
 * sách chặn được rút gọn, Bot Fight Mode chỉ hiện khi đang BẬT - mặc định
 * "mọi thứ bình thường" thì card gần như trống, đúng tinh thần tối giản. */
const FirewallTemplateSummary: React.FC<{ tpl: API.CfFirewallTemplateItem }> = ({ tpl }) => {
  const offRules = BASE_RULES.filter((rule) => !tpl[rule.key]);

  return (
    <Space direction="vertical" size={6} style={{ maxWidth: 480 }}>
      {offRules.length === 0 ? (
        <Tooltip title="Skip-list an toàn, chặn port lạ, và chặn UA giả browser đều đang bật">
          <Tag icon={<CheckCircleFilled />} color="success">
            Đủ rule nền an toàn
          </Tag>
        </Tooltip>
      ) : (
        <Space size={6} wrap>
          {offRules.map((rule) => (
            <Tooltip key={rule.key} title={rule.tooltip}>
              <Tag icon={<CloseCircleFilled />} color="error">
                {rule.label}: TẮT
              </Tag>
            </Tooltip>
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
