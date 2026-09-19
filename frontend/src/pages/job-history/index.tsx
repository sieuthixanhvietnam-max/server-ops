import JobLogPanel from '@/components/JobLogPanel';
import JobProgressBar from '@/components/JobProgressBar';
import JobResultPanel from '@/components/JobResultPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { listJobs } from '@/services/serverOps/api';
import {
  JOB_STATUS_COLORS,
  JOB_STATUS_LABELS,
  JOB_TYPE_COLORS,
  JOB_TYPE_LABELS,
  JOB_TYPE_OPTIONS,
} from '@/utils/jobConstants';
import { summarizeJobResult } from '@/utils/jobResult';
import { DEFAULT_PAGINATION } from '@/utils/pagination';
import { HistoryOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns, ProFormInstance } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Button, Descriptions, Drawer, Tag, theme, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';

const RESULT_TAG_COLORS: Record<string, string> = {
  success: 'green',
  warning: 'orange',
  error: 'red',
  info: 'default',
};

const ResultSummary: React.FC<{ result: unknown }> = ({ result }) => {
  const { token } = theme.useToken();
  const summary = summarizeJobResult(result);
  if (!summary) return <span style={{ color: token.colorTextQuaternary }}>-</span>;
  return <Tag color={RESULT_TAG_COLORS[summary.tone]}>{summary.text}</Tag>;
};

const JobHistory: React.FC = () => {
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [detailJobId, setDetailJobId] = useState<number>();
  // useJobPolling already stops polling once the job is success/failed, so
  // opening an already-finished job (the common case) costs one fetch just
  // like the old one-time getJob() call did - the only behavior change is a
  // still-`running` job now keeps updating live instead of showing whatever
  // it looked like the instant the Drawer opened.
  const detailJob = useJobPolling(detailJobId);
  const detailLoading = !!detailJobId && !detailJob;

  const applyLast24hFailedFilter = () => {
    formRef.current?.setFieldsValue({
      status: 'failed',
      created_at: [dayjs().subtract(24, 'hour'), dayjs()],
    });
    formRef.current?.submit();
  };

  const columns: ProColumns<API.JobDetail>[] = [
    { title: 'ID', dataIndex: 'id', search: false, width: 70 },
    {
      title: 'Loại job',
      dataIndex: 'job_type',
      valueType: 'select',
      fieldProps: { options: JOB_TYPE_OPTIONS },
      render: (_, r) => <Tag color={JOB_TYPE_COLORS[r.job_type] || 'blue'}>{JOB_TYPE_LABELS[r.job_type] || r.job_type}</Tag>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      valueType: 'select',
      fieldProps: {
        options: Object.entries(JOB_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      },
      render: (_, r) => <Tag color={JOB_STATUS_COLORS[r.status]}>{JOB_STATUS_LABELS[r.status] || r.status}</Tag>,
    },
    {
      title: 'Chế độ chạy',
      dataIndex: 'dry_run',
      search: false,
      render: (_, r) =>
        'dry_run' in (r.params || {}) ? (
          <Tag color={r.params.dry_run ? 'blue' : 'volcano'}>{r.params.dry_run ? 'Dry-run' : 'Thật'}</Tag>
        ) : (
          <span style={{ color: token.colorTextQuaternary }}>-</span>
        ),
    },
    { title: 'Người chạy', dataIndex: 'created_by', copyable: true },
    {
      title: 'IP',
      dataIndex: 'created_ip',
      copyable: true,
      render: (v) => <span style={{ fontFamily: 'monospace' }}>{(v as string) || '-'}</span>,
    },
    {
      title: 'Kết quả',
      dataIndex: 'result',
      search: false,
      render: (_, r) => <ResultSummary result={r.result} />,
    },
    {
      title: 'Thời gian tạo',
      dataIndex: 'created_at',
      valueType: 'dateRange',
      render: (_, r) => dayjs(r.created_at).format('YYYY-MM-DD HH:mm:ss'),
      search: {
        transform: (value: any) => ({
          date_from: value?.[0] ? dayjs(value[0]).startOf('day').toISOString() : undefined,
          date_to: value?.[1] ? dayjs(value[1]).endOf('day').toISOString() : undefined,
        }),
      },
    },
    {
      title: 'Hoàn tất lúc',
      dataIndex: 'finished_at',
      search: false,
      render: (_, r) => (r.finished_at ? dayjs(r.finished_at).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: 'Hành động',
      search: false,
      render: (_, r) => (
        <Button size="small" onClick={() => setDetailJobId(r.id)}>
          Xem chi tiết
        </Button>
      ),
    },
  ];

  return (
    <PageContainer title="Lịch sử Jobs">
      <ProTable<API.JobDetail>
        headerTitle="Danh sách Jobs đã chạy"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        pagination={DEFAULT_PAGINATION}
        search={{ labelWidth: 100 }}
        toolBarRender={() => [
          <Button key="failed24h" icon={<HistoryOutlined />} onClick={applyLast24hFailedFilter}>
            Lỗi trong 24h qua
          </Button>,
        ]}
        request={async (params) => listJobs(params)}
        columns={columns}
      />

      <Drawer
        title={detailJob ? `Job #${detailJob.id} - ${JOB_TYPE_LABELS[detailJob.job_type] || detailJob.job_type}` : ''}
        open={!!detailJobId}
        onClose={() => setDetailJobId(undefined)}
        width={720}
        loading={detailLoading}
        destroyOnHidden
      >
        {detailJob && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Người chạy">{detailJob.created_by}</Descriptions.Item>
              <Descriptions.Item label="IP">{detailJob.created_ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tạo lúc">
                {dayjs(detailJob.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="Hoàn tất lúc">
                {detailJob.finished_at ? dayjs(detailJob.finished_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>Tham số</Typography.Title>
            <pre
              style={{
                background: token.colorFillAlter,
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(detailJob.params, null, 2)}
            </pre>

            <Typography.Title level={5}>Log</Typography.Title>
            <JobLogPanel job={detailJob} />
            <JobProgressBar job={detailJob} />

            <Typography.Title level={5} style={{ marginTop: 16 }}>
              Kết quả
            </Typography.Title>
            <JobResultPanel job={detailJob} />
          </>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default JobHistory;
