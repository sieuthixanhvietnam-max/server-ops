import { Popconfirm, Tag, Typography } from 'antd';
import React from 'react';

/** Lighter-weight replacement for the old ConfirmDangerModal (which required
 * typing "XACNHAN") - confirms in one click like every other Popconfirm in
 * the app. Just shows how many targets are affected, not the list itself
 * (the user already sees the exact list on the page before confirming).
 * Wrap the trigger button as `children` (co-located, unlike the old modal's
 * separate open/onCancel state). */
const DangerPopconfirm: React.FC<{
  title: string;
  targets: string[];
  onConfirm: () => void;
  loading?: boolean;
  children: React.ReactElement;
  /** Extra content rendered below the target-count line - e.g. the
   * Firewall page embeds a read-only summary of the selected template
   * here, so whoever confirms sees what's about to be applied at the one
   * moment they're guaranteed to look, instead of relying on them to have
   * reviewed it earlier (they usually haven't - confirmed with the user). */
  extra?: React.ReactNode;
}> = ({ title, targets, onConfirm, loading, children, extra }) => {
  return (
    <Popconfirm
      title={title}
      overlayStyle={{ maxWidth: 360 }}
      description={
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Không thể hoàn tác - sẽ áp dụng cho
            </Typography.Text>
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              {targets.length} mục
            </Tag>
          </div>
          {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
        </div>
      }
      onConfirm={onConfirm}
      okText="Chạy thật"
      okButtonProps={{ danger: true, loading }}
      cancelText="Huỷ"
    >
      {children}
    </Popconfirm>
  );
};

export default DangerPopconfirm;
