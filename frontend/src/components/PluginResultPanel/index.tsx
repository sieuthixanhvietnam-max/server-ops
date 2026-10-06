import JobResultActions from '@/components/JobResultActions';
import VerifyBadge from '@/components/VerifyBadge';
import { Table, Tag, theme, Typography } from 'antd';
import React from 'react';

const STATUS_COLORS: Record<string, string> = {
  OK: 'green',
  PARTIAL: 'gold',
  ROLLBACK: 'red',
  ROLLBACK_FAILED: 'red',
  SKIP: 'gold',
  FAIL: 'red',
  DRYRUN: 'blue',
};

const StatusTag: React.FC<{ status: string }> = ({ status }) => (
  <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>
);

// Flattens one VerifyInfo into the same short text across every export/copy
// below - mirrors what VerifyBadge shows (status + ok/fail) without the tag
// styling, which doesn't survive a CSV cell anyway.
const verifyToText = (v?: API.VerifyInfo): string => {
  if (!v) return '';
  const parts = [`HTTP ${v.http_status}`, v.ok ? 'OK' : v.gone ? 'GONE' : 'FAIL'];
  if (v.note) parts.push(v.note);
  return parts.join(' - ');
};

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
    const rows = job.result as API.PluginCheckResult[];
    return (
      <div style={{ marginTop: 16 }}>
      <JobResultActions
        headers={['Domain', 'Server IP', 'Trạng thái', 'Số plugin', 'Plugin', 'Ghi chú']}
        rows={rows.map((r) => [
          r.domain,
          r.ip,
          r.status,
          r.plugins.length,
          r.plugins.map((p) => `${p.name} (${p.status}${p.version ? `, ${p.version}` : ''})`).join('; '),
          r.note || '',
        ])}
        filename="plugin-check-result.csv"
      />
      <Table<API.PluginCheckResult>
        style={{ marginTop: 8 }}
        rowKey="domain"
        dataSource={rows}
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
      </div>
    );
  }

  if (
    ['plugin_deactivate', 'plugin_activate', 'plugin_install_wp', 'plugin_install_zip', 'theme_install_zip'].includes(
      job.job_type,
    )
  ) {
    const rows = job.result as API.PluginToggleResult[];
    return (
      <div style={{ marginTop: 16 }}>
      <JobResultActions
        headers={['Domain', 'Server IP', 'Trạng thái', 'Thành công', 'Thất bại', 'Xác minh', 'Ghi chú']}
        rows={rows.map((r) => [
          r.domain,
          r.ip,
          r.status,
          (r.ok || []).join(', '),
          (r.fail || []).join(', '),
          verifyToText(r.verify),
          r.note || '',
        ])}
        filename="plugin-toggle-result.csv"
      />
      <Table<API.PluginToggleResult>
        style={{ marginTop: 8 }}
        rowKey="domain"
        dataSource={rows}
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
      </div>
    );
  }

  if (job.job_type === 'plugin_update') {
    const rows = job.result as API.PluginUpdateResult[];
    return (
      <div style={{ marginTop: 16 }}>
      <JobResultActions
        headers={[
          'Domain',
          'Server IP',
          'Trạng thái',
          'HTTP trước',
          'HTTP sau',
          'Rollback',
          'Plugin',
          'WP Core',
          'Core version',
          'Ghi chú',
        ]}
        rows={rows.map((r) => [
          r.domain,
          r.ip,
          r.status,
          r.http_before ?? '',
          r.http_after ?? '',
          r.status === 'ROLLBACK' ? (r.rolled_back ? 'Đã rollback' : 'Rollback thất bại') : '',
          r.plugin_summary || '',
          r.core_summary || '',
          r.core_version || '',
          r.note || '',
        ])}
        filename="plugin-update-result.csv"
      />
      <Table<API.PluginUpdateResult>
        style={{ marginTop: 8 }}
        rowKey="domain"
        dataSource={rows}
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
      </div>
    );
  }

  if (job.job_type === 'mu_plugin_install') {
    const rows = job.result as API.MuPluginInstallResult[];
    const anyUserCheck = rows.some((r) => r.target_user_exists !== null);
    return (
      <div style={{ marginTop: 16 }}>
      <JobResultActions
        headers={[
          'Domain',
          'Server IP',
          'Trạng thái',
          ...(anyUserCheck ? ['User tồn tại?'] : []),
          'Ghi chú',
        ]}
        rows={rows.map((r) => [
          r.domain,
          r.ip,
          r.status,
          ...(anyUserCheck ? [r.target_user_exists === null ? '' : r.target_user_exists ? 'Có' : 'Không'] : []),
          r.note || '',
        ])}
        filename="mu-plugin-install-result.csv"
      />
      <Table<API.MuPluginInstallResult>
        style={{ marginTop: 8 }}
        rowKey="domain"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'Server IP', dataIndex: 'ip' },
          { title: 'Trạng thái', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          ...(anyUserCheck
            ? [
                {
                  title: 'User tồn tại?',
                  dataIndex: 'target_user_exists',
                  render: (v: boolean | null) =>
                    v === null ? (
                      <span style={{ color: '#999' }}>-</span>
                    ) : (
                      <Tag color={v ? 'green' : 'default'}>{v ? 'Có' : 'Không'}</Tag>
                    ),
                },
              ]
            : []),
          { title: 'Ghi chú', dataIndex: 'note' },
        ]}
      />
      </div>
    );
  }

  return <Typography.Text type="secondary">Không có kết quả để hiển thị</Typography.Text>;
};

export default PluginResultPanel;
