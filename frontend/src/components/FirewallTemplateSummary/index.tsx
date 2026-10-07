import { countryLabel } from '@/utils/countries';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  GlobalOutlined,
  LinkOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Space, Tag, Tooltip, Typography } from 'antd';
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

/** Read-only summary of 1 Firewall template - shared by the template CRUD
 * page's cards AND the Firewall page's template picker/confirm dialog, so
 * the exact same glance-check content shows up everywhere instead of only
 * inside the template editor (whoever runs the Firewall job sees this
 * without having opened that page first - see models.CfFirewallTemplate's
 * docstring for why).
 *
 * The 3 base rules render FIRST, as status pills, not last as plain text -
 * they're the one thing that can quietly let a block rule below catch a
 * whitelisted IP or Googlebot, so they're the first thing a glance should
 * catch, not something found by reading to the end. */
const FirewallTemplateSummary: React.FC<{ tpl: API.CfFirewallTemplateItem }> = ({ tpl }) => {
  const hasExtraRules =
    tpl.countries_blocked.length > 0 || tpl.blocked_user_agents.length > 0 || tpl.blocked_paths.length > 0;

  return (
    <Space direction="vertical" size={8} style={{ maxWidth: 480 }}>
      <Space wrap size={6}>
        {BASE_RULES.map((rule) => {
          const on = tpl[rule.key];
          return (
            <Tooltip key={rule.key} title={rule.tooltip}>
              <Tag icon={on ? <CheckCircleFilled /> : <CloseCircleFilled />} color={on ? 'success' : 'error'}>
                {rule.label}
              </Tag>
            </Tooltip>
          );
        })}
      </Space>

      {hasExtraRules ? (
        <Space direction="vertical" size={4}>
          {tpl.countries_blocked.length > 0 && (
            <Space size={4} wrap align="start">
              <GlobalOutlined style={{ color: '#8c8c8c' }} />
              {tpl.countries_blocked.map((c) => (
                <Tag key={c} color="red">
                  {countryLabel(c)}
                </Tag>
              ))}
            </Space>
          )}
          {tpl.blocked_user_agents.length > 0 && (
            <Space size={4} wrap align="start">
              <RobotOutlined style={{ color: '#8c8c8c' }} />
              {tpl.blocked_user_agents.map((ua) => (
                <Tag key={ua} color="volcano">
                  {ua}
                </Tag>
              ))}
            </Space>
          )}
          {tpl.blocked_paths.length > 0 && (
            <Space size={4} wrap align="start">
              <LinkOutlined style={{ color: '#8c8c8c' }} />
              {tpl.blocked_paths.map((p) => (
                <Tag key={p} color="orange">
                  {p}
                </Tag>
              ))}
            </Space>
          )}
        </Space>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Không chặn thêm gì ngoài rule nền phía trên.
        </Typography.Text>
      )}

      <Tag icon={<ThunderboltOutlined />} color={tpl.bot_fight_mode ? 'success' : 'default'}>
        Bot Fight Mode: {tpl.bot_fight_mode ? 'BẬT' : 'TẮT'}
      </Tag>
    </Space>
  );
};

export default FirewallTemplateSummary;
