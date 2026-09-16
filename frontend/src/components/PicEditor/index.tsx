import { setAccountPics, setServerPics } from '@/services/serverOps/api';
import { App, Select } from 'antd';
import React, { useState } from 'react';

type Target = { type: 'server'; server_name: string } | { type: 'account'; account_id: number };

type Props = {
  value: string[];
  options: { label: string; value: string }[];
  target: Target;
  onSaved?: (codes: string[]) => void;
};

const PicEditor: React.FC<Props> = ({ value, options, target, onSaved }) => {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);

  const handleChange = async (codes: string[]) => {
    setSaving(true);
    try {
      if (target.type === 'server') {
        await setServerPics(target.server_name, codes);
      } else {
        await setAccountPics(target.account_id, codes);
      }
      message.success('Đã lưu PIC');
      onSaved?.(codes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select
      mode="multiple"
      value={value}
      options={options}
      loading={saving}
      disabled={saving}
      style={{ minWidth: 160 }}
      onChange={handleChange}
      placeholder="Chưa gán"
      size="small"
      allowClear
    />
  );
};

export default PicEditor;
