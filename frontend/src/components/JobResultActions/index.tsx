import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';
import React from 'react';

// Same quoting rule as exportToCsv, but triggered by '\t' (the column
// separator here) instead of ',' - a value that itself contains a tab or
// newline (e.g. a note copied from elsewhere) would otherwise fracture the
// paste into extra columns/rows in Google Sheets/Excel.
const escapeTsvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /["\t\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Drop-in "Xuất CSV" + "Copy (dán Sheet)" pair for any job result table.
 * Callers pass the exact headers/rows they already render on screen (as
 * display text, not raw status codes - what a human reading the pasted
 * Sheet expects to see matches what they saw in the UI). Renders nothing
 * when there's no data yet, so it's safe to mount unconditionally. */
const JobResultActions: React.FC<{
  headers: string[];
  rows: (string | number)[][];
  filename: string;
}> = ({ headers, rows, filename }) => {
  if (!rows.length) return null;

  const handleCopy = () => {
    const tsv = [headers, ...rows].map((row) => row.map(escapeTsvCell).join('\t')).join('\n');
    copyText(tsv, `Đã copy ${rows.length} dòng - dán vào Google Sheet`);
  };

  return (
    <Space size="small" style={{ marginBottom: 8 }}>
      <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToCsv(filename, headers, rows)}>
        Xuất CSV
      </Button>
      <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
        Copy (dán Sheet)
      </Button>
    </Space>
  );
};

export default JobResultActions;
