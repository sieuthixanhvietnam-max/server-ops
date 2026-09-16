import { checkDomainsExistBatch } from '@/services/serverOps/api';
import { UploadOutlined } from '@ant-design/icons';
import { App, Button, Input, Popover } from 'antd';
import React, { useState } from 'react';

const { TextArea } = Input;

const parseDomains = (text: string) =>
  Array.from(new Set(text.split(/\r?\n/).map((d) => d.trim().toLowerCase()).filter(Boolean)));

/** Paste-many-at-once companion to DomainSelect's search-one-at-a-time UI -
 * validates each pasted line against the synced domain inventory before
 * adding (same safety property DomainSelect gives - only real, synced
 * domains get through), without forcing a search+click per domain when the
 * caller already has a full list in hand (pasted from a spreadsheet etc). */
const BatchDomainPaste: React.FC<{ onAdd: (domains: string[]) => void }> = ({ onAdd }) => {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);

  const handleAdd = async () => {
    const domains = parseDomains(text);
    if (!domains.length) return;
    setChecking(true);
    try {
      const res = await checkDomainsExistBatch(domains);
      const matched = domains.filter((d) => res.data[d]);
      const unmatched = domains.filter((d) => !res.data[d]);
      if (matched.length) {
        onAdd(matched);
        message.success(`Đã thêm ${matched.length} domain`);
      }
      if (unmatched.length) {
        message.warning(
          `${unmatched.length} domain không có trong dữ liệu đã đồng bộ - bỏ qua: ${unmatched.join(', ')}`,
        );
      }
      setText('');
      setOpen(false);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title="Dán danh sách domain (mỗi dòng 1 domain)"
      content={
        <div style={{ width: 320 }}>
          <TextArea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'domain1.com\ndomain2.com'}
            style={{ fontFamily: 'monospace' }}
          />
          <Button
            type="primary"
            block
            style={{ marginTop: 8 }}
            loading={checking}
            disabled={!text.trim()}
            onClick={handleAdd}
          >
            Kiểm tra & thêm
          </Button>
        </div>
      }
    >
      <Button icon={<UploadOutlined />}>Dán danh sách</Button>
    </Popover>
  );
};

export default BatchDomainPaste;
