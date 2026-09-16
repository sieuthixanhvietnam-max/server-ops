import { SUMMARY_KEY_LABELS, isErrorLikeStatus } from '@/utils/jobResult';
import { Empty, Statistic, Table, Tag, theme, Typography } from 'antd';
import React from 'react';

// Ranks known columns first (status, then everything else, note last) so the
// most useful info reads left-to-right without per-job-type configuration.
const columnRank = (key: string) => {
  if (key === 'status') return 0;
  if (key === 'note') return 99;
  return 50;
};

// Plain factory (not a hook) so it can be called from inside the component
// with a hook-resolved color, instead of hardcoding hex at module scope.
const buildColumns = (rows: Record<string, any>[], emptyColor: string) => {
  const keys: string[] = [];
  rows.forEach((row) => {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((k) => {
        if (!keys.includes(k)) keys.push(k);
      });
    }
  });
  keys.sort((a, b) => columnRank(a) - columnRank(b));

  return keys.map((key) => ({
    title: key,
    dataIndex: key,
    key,
    ellipsis: true,
    render: (value: any) => {
      if (value === null || value === undefined || value === '') {
        return <span style={{ color: emptyColor }}>-</span>;
      }
      if (key === 'status') {
        return <Tag color={isErrorLikeStatus(value) ? 'red' : 'green'}>{String(value)}</Tag>;
      }
      if (typeof value === 'object') {
        return <span style={{ fontFamily: 'monospace' }}>{JSON.stringify(value)}</span>;
      }
      return String(value);
    },
  }));
};

/** Generic "what did this job actually produce" panel, shared by every page
 * that triggers a job plus the Job History detail drawer - handles the two
 * shapes Job.result comes in (see backend/app/routers/jobs.py): list[dict]
 * (one row per target, most job types) renders as a table; a single summary
 * dict (currently only cf_master_discover: {discovered, zones}) renders as
 * Statistic cards. Renders nothing while the job is still running/pending -
 * there's nothing to summarize yet, the live log covers that state. */
const JobResultPanel: React.FC<{ job?: API.JobDetail }> = ({ job }) => {
  const { token } = theme.useToken();
  if (!job || (job.status !== 'success' && job.status !== 'failed')) return null;

  const result = job.result;

  if (Array.isArray(result)) {
    if (!result.length) {
      return <Empty description="Không có dữ liệu kết quả" style={{ margin: '16px 0' }} />;
    }
    return (
      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">{result.length} dòng kết quả</Typography.Text>
        <Table
          size="small"
          rowKey={(_, idx) => String(idx)}
          dataSource={result}
          columns={buildColumns(result, token.colorTextQuaternary)}
          pagination={result.length > 20 ? { defaultPageSize: 20, showSizeChanger: true } : false}
          scroll={{ x: true }}
          style={{ marginTop: 8 }}
        />
      </div>
    );
  }

  if (result && typeof result === 'object' && Object.keys(result).length) {
    return (
      <div style={{ marginTop: 16, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {Object.entries(result).map(([key, value]) => (
          <Statistic key={key} title={SUMMARY_KEY_LABELS[key] || key} value={value as any} />
        ))}
      </div>
    );
  }

  return <Empty description="Không có dữ liệu kết quả" style={{ margin: '16px 0' }} />;
};

export default JobResultPanel;
