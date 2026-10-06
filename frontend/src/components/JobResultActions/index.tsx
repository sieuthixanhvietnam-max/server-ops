import { copyText } from '@/utils/clipboard';
import { exportToCsv } from '@/utils/exportCsv';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Typography, theme } from 'antd';
import React from 'react';

// Same quoting rule as exportToCsv, but triggered by '\t' (the column
// separator here) instead of ',' - a value that itself contains a tab or
// newline (e.g. a note copied from elsewhere) would otherwise fracture the
// paste into extra columns/rows in Google Sheets/Excel.
const escapeTsvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /["\t\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Drop-in "Xuất CSV" + "Copy (dán Sheet)" toolbar for any job result table -
 * a single bordered strip with the row count on the left (the exact text a
 * page wants, defaulting to a generic "N dòng kết quả") and both actions
 * grouped as one joined control on the right, so every result table in the
 * app gets the same look instead of each page inventing its own row-count
 * label + loose buttons. Callers pass the exact headers/rows they already
 * render on screen (as display text, not raw status codes - what a human
 * reading the pasted Sheet expects to see matches what they saw in the UI).
 * Renders nothing when there's no data yet, so it's safe to mount
 * unconditionally. */
const JobResultActions: React.FC<{
  headers: string[];
  rows: (string | number)[][];
  filename: string;
  countLabel?: string;
}> = ({ headers, rows, filename, countLabel }) => {
  const { token } = theme.useToken();
  if (!rows.length) return null;

  const handleCopy = () => {
    const tsv = [headers, ...rows].map((row) => row.map(escapeTsvCell).join('\t')).join('\n');
    copyText(tsv, `Đã copy ${rows.length} dòng - dán vào Google Sheet`);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        padding: '6px 6px 6px 12px',
        marginBottom: 12,
        background: token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {countLabel ?? `${rows.length} dòng kết quả`}
      </Typography.Text>
      <div style={{ display: 'flex' }}>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          style={{ borderEndEndRadius: 0, borderStartEndRadius: 0 }}
          onClick={() => exportToCsv(filename, headers, rows)}
        >
          Xuất CSV
        </Button>
        <Button
          size="small"
          icon={<CopyOutlined />}
          style={{ borderEndStartRadius: 0, borderStartStartRadius: 0, marginInlineStart: -1 }}
          onClick={handleCopy}
        >
          Copy (dán Sheet)
        </Button>
      </div>
    </div>
  );
};

export default JobResultActions;
