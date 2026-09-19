import { JOB_STATUS_COLORS, JOB_STATUS_LABELS } from '@/utils/jobConstants';
import { SUMMARY_KEY_LABELS, isErrorLikeStatus } from '@/utils/jobResult';
import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Result, Statistic, Table, Tag, theme, Typography } from 'antd';
import React from 'react';

// Dedicated states for job.fail_reason codes that have a better UI than the
// generic empty/table fallback below - keyed by the same string the backend
// writes to Job.fail_reason (see job_service.py). Falls through to the
// generic display for any other/unset reason.
const FAIL_REASON_VIEWS: Record<string, { icon: React.ReactNode; title: string; subTitle: string }> = {
  no_internet: {
    icon: <DisconnectOutlined />,
    title: 'Mất kết nối Internet',
    subTitle:
      'Máy chủ backend không truy cập được Internet tại thời điểm chạy, tác vụ đã bị huỷ ngay để tránh chờ vô ích. Không có domain nào bị xử lý dở dang.',
  },
};

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
const JobResultPanel: React.FC<{ job?: API.JobDetail; onRetry?: () => void }> = ({ job, onRetry }) => {
  const { token } = theme.useToken();
  if (!job) return null;

  // While still running, `job.result` is empty (only written once at the
  // very end - see job_service.py's run_job) but job_targets rows (see
  // JobProgressBar) already carry per-target outcome as it happens. Render
  // a lighter table from those instead of the empty-state fallback below -
  // coarser than the final table (no cf_dns/verify detail, which only
  // exists once a target actually finishes), that's expected, not a bug.
  if (job.status === 'running' || job.status === 'pending') {
    if (!job.targets?.length) return null;
    return (
      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">{job.targets.length} mục - kết quả đang cập nhật...</Typography.Text>
        <Table
          size="small"
          rowKey="id"
          dataSource={job.targets}
          pagination={job.targets.length > 20 ? { defaultPageSize: 20, showSizeChanger: true } : false}
          style={{ marginTop: 8 }}
          columns={[
            { title: 'Mục tiêu', dataIndex: 'target_label' },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              render: (v: API.JobTargetStatus) => <Tag color={JOB_STATUS_COLORS[v]}>{JOB_STATUS_LABELS[v] || v}</Tag>,
            },
            {
              title: 'Ghi chú',
              dataIndex: 'note',
              render: (v: string) => v || <span style={{ color: token.colorTextQuaternary }}>-</span>,
            },
          ]}
        />
      </div>
    );
  }

  if (job.status !== 'success' && job.status !== 'failed') return null;

  if (job.status === 'failed' && job.fail_reason && FAIL_REASON_VIEWS[job.fail_reason]) {
    const view = FAIL_REASON_VIEWS[job.fail_reason];
    return (
      <Result
        status="warning"
        icon={view.icon}
        title={view.title}
        subTitle={view.subTitle}
        style={{ padding: '32px 0' }}
        extra={
          onRetry ? (
            <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
              Thử lại
            </Button>
          ) : undefined
        }
      />
    );
  }

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
