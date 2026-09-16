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
}> = ({ title, targets, onConfirm, loading, children }) => {
  return (
    <Popconfirm
      title={title}
      overlayStyle={{ maxWidth: 320 }}
      description={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Không thể hoàn tác - sẽ áp dụng cho
          </Typography.Text>
          <Tag color="red" style={{ marginInlineEnd: 0 }}>
            {targets.length} mục
          </Tag>
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
