import { Card, theme } from 'antd';
import React from 'react';

/** House-style KPI tile: icon chip + label + value (+ optional caption) -
 * originally the Dashboard's own local component, extracted here so any
 * page presenting a small set of headline numbers looks and behaves the
 * same way instead of every page growing its own variant.
 *
 * Fixed height + a single-line value (ellipsized rather than wrapped) so a
 * short label like "Tổng domain" and a longer one like "Đồng bộ domain"
 * always render the same box size in the same row - antd's Row already
 * stretches Col height evenly, but Card only fills that space when told to
 * (height: 100%), otherwise it just hugs its own content and the tiles end
 * up visibly uneven despite the equal-height grid under them. */
const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  color: string;
  bg: string;
  onClick?: () => void;
  // Small secondary line below value - e.g. "Tiếp theo: 12 phút tới" for the
  // sync-status cards. Wrap the whole card in a Tooltip yourself if it needs
  // an exact-timestamp hover.
  caption?: React.ReactNode;
}> = ({ icon, label, value, color, bg, onClick, caption }) => {
  const { token } = theme.useToken();
  return (
    <Card
      hoverable={!!onClick}
      onClick={onClick}
      style={{ height: '100%' }}
      styles={{ body: { padding: '16px 18px', height: '100%' } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 44 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 20,
            color,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12.5,
              color: token.colorTextSecondary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 21,
              fontWeight: 600,
              color: token.colorText,
              lineHeight: 1.35,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value}
          </div>
        </div>
      </div>
      {caption && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: token.colorTextTertiary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {caption}
        </div>
      )}
    </Card>
  );
};

export default KpiCard;
