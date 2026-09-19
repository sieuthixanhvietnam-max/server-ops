import { Progress, Typography } from 'antd';
import React from 'react';

/** Live X/N progress for a batch job - only renders once the job has
 * populated `targets` (see backend/app/models.py: JobTarget). Job types
 * that haven't adopted this yet simply have targets: [], so this renders
 * nothing for them - no per-page wiring needed beyond dropping
 * <JobProgressBar job={job} /> next to <JobLogPanel job={job} />. */
const JobProgressBar: React.FC<{ job?: API.JobDetail }> = ({ job }) => {
  if (!job || !job.targets?.length) return null;

  const total = job.targets.length;
  const done = job.targets.filter((t) => t.status === 'success' || t.status === 'failed').length;
  const failed = job.targets.filter((t) => t.status === 'failed').length;
  const current = job.targets.find((t) => t.status === 'running');
  const percent = Math.round((done / total) * 100);

  return (
    <div style={{ marginTop: 16 }}>
      <Progress percent={percent} status={job.status === 'failed' ? 'exception' : undefined} />
      <Typography.Text type="secondary">
        {current ? `Đang xử lý: ${current.target_label} — ` : ''}
        {done}/{total} xong{failed > 0 ? `, ${failed} lỗi` : ''}
      </Typography.Text>
    </div>
  );
};

export default JobProgressBar;
