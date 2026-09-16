import { JOB_STATUS_COLORS, JOB_STATUS_LABELS } from '@/utils/jobConstants';
import { Tag, theme } from 'antd';
import React, { useEffect, useRef } from 'react';

const JobLogPanel: React.FC<{ job?: API.JobDetail }> = ({ job }) => {
  const { token } = theme.useToken();
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.log]);

  if (!job) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <Tag color={JOB_STATUS_COLORS[job.status]}>{JOB_STATUS_LABELS[job.status] || job.status}</Tag>
        <span style={{ color: token.colorTextTertiary }}>Job #{job.id}</span>
      </div>
      <pre
        ref={logRef}
        style={{
          background: '#000',
          color: '#0f0',
          padding: 12,
          borderRadius: 6,
          maxHeight: 260,
          overflowY: 'auto',
          fontSize: 12,
          margin: 0,
        }}
      >
        {job.log || '...'}
      </pre>
    </div>
  );
};

export default JobLogPanel;
