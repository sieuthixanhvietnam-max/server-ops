import { UploadOutlined } from '@ant-design/icons';
import { Badge, Button, Input, Popover } from 'antd';
import React, { useState } from 'react';

const { TextArea } = Input;

/** Paste-a-list companion for ProTable list pages whose built-in QueryFilter
 * only supports single-value substring search - lets the user filter down
 * to an exact set of names pasted from elsewhere (a spreadsheet, a report),
 * instead of hand-searching each one. `value`/`onChange` hold the raw pasted
 * text verbatim; the caller passes it straight through as a query param (the
 * backend splits on newline/comma and matches exactly). */
const BatchListFilter: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}> = ({ value, onChange, label = 'Lọc theo danh sách', placeholder }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const count = value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
      title={label}
      content={
        <div style={{ width: 320 }}>
          <TextArea
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder || 'Mỗi dòng 1 giá trị...'}
            style={{ fontFamily: 'monospace' }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Button
              type="primary"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Áp dụng
            </Button>
            <Button
              onClick={() => {
                setDraft('');
                onChange('');
                setOpen(false);
              }}
            >
              Xoá lọc
            </Button>
          </div>
        </div>
      }
    >
      <Badge count={count} size="small" offset={[-4, 4]}>
        <Button icon={<UploadOutlined />}>{label}</Button>
      </Badge>
    </Popover>
  );
};

export default BatchListFilter;
