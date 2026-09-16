import VerifyBadge from '@/components/VerifyBadge';
import { Table, Tag, theme, Typography } from 'antd';
import React from 'react';

const STATUS_COLORS: Record<string, string> = {
  OK: 'green',
  PARTIAL: 'gold',
  ROLLBACK: 'red',
  SKIP: 'gold',
  FAIL: 'red',
  DRYRUN: 'blue',
};

const StatusTag: React.FC<{ status: string }> = ({ status }) => (
  <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>
);

const PluginListCell: React.FC<{ items: string[]; color: string }> = ({ items, color }) => {
  const { token } = theme.useToken();
  if (!items.length) return <span style={{ color: token.colorTextQuaternary }}>-</span>;
  return (
    <>
      {items.map((item) => (
        <Tag key={item} color={color} style={{ marginBottom: 2 }}>
          {item}
        </Tag>
      ))}
    </>
  );
};

/**
 * Renders job.result for every plugin-manager job type. Each type has a
 * different result shape (nested plugin list for check, ok/fail lists for
 * toggle/install-wp, rollback fields for update), so this can't reuse the
 * generic JobResultPanel - see wp_plugin_ops.py's return shapes.
 */
const PluginResultPanel: React.FC<{ job?: API.JobDetail }> = ({ job }) => {
  if (!job || (job.status !== 'success' && job.status !== 'failed')) return null;

  if (job.job_type === 'plugin_check') {
    return (
      <Table<API.PluginCheckResult>
        style={{ marginTop: 16 }}
        rowKey="domain"
        dataSource={job.result}
        pagination={false}
        expandable={{
          rowExpandable: (r) => r.plugins.length > 0,
          expandedRowRender: (r) => (
            <Table
              size="small"
              rowKey="name"
              dataSource={r.plugins}
              pagination={false}
              columns={[
                { title: 'Plugin', dataIndex: 'name' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag>,
                },
                { title: 'Phiên bản', dataIndex: 'version' },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'Server IP', dataIndex: 'ip' },
          { title: 'Trạng thái', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          { title: 'Số plugin', render: (_, r) => r.plugins.length },
          { title: 'Ghi chú', dataIndex: 'note' },
        ]}
      />
    );
  }

  if (['plugin_deactivate', 'plugin_activate', 'plugin_install_wp', 'plugin_install_zip'].includes(job.job_type)) {
    return (
      <Table<API.PluginToggleResult>
        style={{ marginTop: 16 }}
        rowKey="domain"
        dataSource={job.result}
        pagination={false}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'Server IP', dataIndex: 'ip' },
          { title: 'Trạng thái', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          { title: 'Thành công', dataIndex: 'ok', render: (v) => <PluginListCell items={v} color="green" /> },
          { title: 'Thất bại', dataIndex: 'fail', render: (v) => <PluginListCell items={v} color="red" /> },
          { title: 'Xác minh', dataIndex: 'verify', render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} /> },
          { title: 'Ghi chú', dataIndex: 'note' },
        ]}
      />
    );
  }

  if (job.job_type === 'plugin_update') {
    return (
      <Table<API.PluginUpdateResult>
        style={{ marginTop: 16 }}
        rowKey="domain"
        dataSource={job.result}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'Server IP', dataIndex: 'ip' },
          { title: 'Trạng thái', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          {
            title: 'HTTP trước/sau',
            render: (_, r) => (
              <span>
                {r.http_before ?? '-'} → {r.http_after ?? '-'}
              </span>
            ),
          },
          {
            title: 'Rollback',
            dataIndex: 'rolled_back',
            render: (v, r) =>
              r.status === 'ROLLBACK' ? (
                <Tag color={v ? 'gold' : 'red'}>{v ? 'Đã rollback' : 'Rollback thất bại'}</Tag>
              ) : (
                '-'
              ),
          },
          { title: 'Plugin', dataIndex: 'plugin_summary' },
          { title: 'WP Core', dataIndex: 'core_summary' },
          { title: 'Core version', dataIndex: 'core_version', render: (v) => v || '-' },
          { title: 'Ghi chú', dataIndex: 'note' },
        ]}
      />
    );
  }

  return <Typography.Text type="secondary">Không có kết quả để hiển thị</Typography.Text>;
};

export default PluginResultPanel;
