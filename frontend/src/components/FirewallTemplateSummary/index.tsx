import { countryLabel } from '@/utils/countries';
import { Space, Tag, Typography } from 'antd';
import React from 'react';

/** Read-only tag summary of 1 Firewall template - shared by the template
 * CRUD table's own "Nội dung" column AND the Firewall page's template
 * picker/confirm dialog, so the exact same glance-check content shows up
 * everywhere instead of only inside the template editor (design intent:
 * whoever runs the Firewall job sees this without having opened that page
 * first - see models.CfFirewallTemplate's docstring for why). */
const FirewallTemplateSummary: React.FC<{ tpl: API.CfFirewallTemplateItem }> = ({ tpl }) => (
  <Space direction="vertical" size={4} style={{ maxWidth: 480 }}>
    {tpl.countries_blocked.length > 0 && (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Chặn quốc gia:{' '}
        </Typography.Text>
        {tpl.countries_blocked.map((c) => (
          <Tag key={c} color="red">
            {countryLabel(c)}
          </Tag>
        ))}
      </div>
    )}
    {tpl.blocked_user_agents.length > 0 && (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Chặn bot:{' '}
        </Typography.Text>
        {tpl.blocked_user_agents.map((ua) => (
          <Tag key={ua} color="volcano">
            {ua}
          </Tag>
        ))}
      </div>
    )}
    {tpl.blocked_paths.length > 0 && (
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Chặn path:{' '}
        </Typography.Text>
        {tpl.blocked_paths.map((p) => (
          <Tag key={p} color="orange">
            {p}
          </Tag>
        ))}
      </div>
    )}
    <Tag color={tpl.bot_fight_mode ? 'green' : 'default'}>
      Bot Fight Mode: {tpl.bot_fight_mode ? 'BẬT' : 'TẮT'}
    </Tag>
    {!tpl.countries_blocked.length && !tpl.blocked_user_agents.length && !tpl.blocked_paths.length && (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Không chặn thêm gì ngoài 3 rule nền (port, UA không giống browser, skip-list an toàn).
      </Typography.Text>
    )}
  </Space>
);

export default FirewallTemplateSummary;
