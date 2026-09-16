import { copyText } from '@/utils/clipboard';
import { buildNsClusters, type NsCluster } from '@/utils/nsClusters';
import {
  CheckCircleFilled,
  CopyOutlined,
  ExclamationCircleFilled,
  QuestionCircleFilled,
  WarningFilled,
} from '@ant-design/icons';
import { Alert, Button, Card, Space, Table, Tag, theme, Tooltip, Typography } from 'antd';
import React from 'react';

const STATUS_COLORS: Record<string, string> = {
  added: 'success',
  reconfigured: 'cyan',
  existing: 'gold',
  error: 'error',
  DRYRUN: 'blue',
};

const STATUS_LABELS: Record<string, string> = {
  added: 'Đã thêm',
  reconfigured: 'Đã cấu hình lại',
  existing: 'Đã có sẵn',
  error: 'Lỗi',
  DRYRUN: 'Dry-run',
};

const DnsStatusIcon: React.FC<{ status?: API.CfAddResult['dns_status'] }> = ({ status }) => {
  const { token } = theme.useToken();
  if (status === 'mismatch') {
    return (
      <Tooltip title="DNS đang trỏ IP khác - bật 'Ép áp lại cấu hình' để sửa">
        <WarningFilled style={{ color: token.colorWarning, marginLeft: 4 }} />
      </Tooltip>
    );
  }
  if (status === 'unknown') {
    return (
      <Tooltip title="Không tìm thấy A record">
        <QuestionCircleFilled style={{ color: token.colorTextQuaternary, marginLeft: 4 }} />
      </Tooltip>
    );
  }
  return null;
};

// Wrapping the domain list in double quotes is standard CSV/TSV escaping -
// Sheets/Excel then keep the embedded newlines inside that ONE cell instead
// of starting new rows, so each cluster pastes as 1 row: domains
// (multi-line) | NS1 | NS2.
const clusterToRow = (cluster: NsCluster) => {
  const domainsCell = `"${cluster.rows.map((r) => r.domain).join('\n')}"`;
  return [domainsCell, ...cluster.ns].join('\t');
};

const DomainTag: React.FC<{ row: API.CfAddResult }> = ({ row }) => (
  <Tooltip
    title={
      <div>
        <div>Trạng thái: {STATUS_LABELS[row.status] || row.status}</div>
        {row.account_label && <div>Account: {row.account_label}</div>}
        {row.zone_id && <div>Zone ID: {row.zone_id}</div>}
        {row.note && <div>Ghi chú: {row.note}</div>}
      </div>
    }
  >
    <Tag color={STATUS_COLORS[row.status] || 'default'} style={{ marginBottom: 4 }}>
      {row.domain}
      <DnsStatusIcon status={row.dns_status} />
    </Tag>
  </Tooltip>
);

const CfAddResultPanel: React.FC<{ result: API.CfAddResult[] }> = ({ result }) => {
  const { token } = theme.useToken();
  if (!result?.length) return null;

  const isDryRun = result.some((r) => r.status === 'DRYRUN');

  if (isDryRun) {
    return (
      <Table<API.CfAddResult>
        style={{ marginTop: 16 }}
        size="small"
        rowKey="domain"
        dataSource={result}
        pagination={false}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'IP', dataIndex: 'ip' },
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
          },
          { title: 'Ghi chú', dataIndex: 'note' },
        ]}
      />
    );
  }

  const counts = result.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const clusters = buildNsClusters(result);
  const pending = result.filter(
    (r) => (r.status === 'added' || r.status === 'reconfigured') && !r.nameservers?.length,
  );
  const errors = result.filter((r) => r.status === 'error');

  return (
    <div style={{ marginTop: 16 }}>
      <Space wrap style={{ marginBottom: 12 }}>
        {counts.added > 0 && <Tag color="success">{counts.added} đã thêm</Tag>}
        {counts.reconfigured > 0 && <Tag color="cyan">{counts.reconfigured} đã cấu hình lại</Tag>}
        {counts.existing > 0 && <Tag color="gold">{counts.existing} đã có sẵn</Tag>}
        {errors.length > 0 && <Tag color="error">{errors.length} lỗi</Tag>}
        {pending.length > 0 && <Tag>{pending.length} chưa có NS</Tag>}
        {clusters.length > 0 && (
          <Button
            size="small"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() =>
              copyText(
                clusters.map(clusterToRow).join('\n'),
                `Đã copy tất cả (${clusters.length} cụm) - dán vào Sheet ra cả bảng`,
              )
            }
          >
            Copy tất cả ({clusters.length} cụm)
          </Button>
        )}
      </Space>

      {clusters.map((cluster) => (
        <Card key={cluster.key} size="small" style={{ marginBottom: 12, background: token.colorFillAlter }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <Space wrap style={{ marginBottom: 6 }}>
                {cluster.ns.map((ns) => (
                  <Tag key={ns} icon={<CheckCircleFilled />} color="processing" style={{ fontFamily: 'monospace' }}>
                    {ns}
                  </Tag>
                ))}
                <Typography.Text type="secondary">{cluster.rows.length} domain</Typography.Text>
              </Space>
              <div>
                {cluster.rows.map((r) => (
                  <DomainTag key={r.domain} row={r} />
                ))}
              </div>
            </div>
            <Space direction="vertical">
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyText(cluster.ns.join('\t'), 'Đã copy NS (dán vào Sheet ra 2 cột)')}
              >
                Copy NS
              </Button>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() =>
                  copyText(
                    clusterToRow(cluster),
                    'Đã copy domain + NS (dán vào Sheet ra 1 hàng, domain xuống dòng trong 1 ô)',
                  )
                }
              >
                Copy domain + NS
              </Button>
            </Space>
          </div>
        </Card>
      ))}

      {pending.length > 0 && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          icon={<ExclamationCircleFilled />}
          message={`${pending.length} domain đã tạo xong nhưng Cloudflare chưa trả nameserver kịp - kiểm tra lại trên dashboard sau`}
          description={pending.map((r) => r.domain).join(', ')}
        />
      )}

      {errors.length > 0 && (
        <Table<API.CfAddResult>
          size="small"
          rowKey="domain"
          dataSource={errors}
          pagination={false}
          columns={[
            { title: 'Domain', dataIndex: 'domain' },
            { title: 'Lỗi', dataIndex: 'note' },
          ]}
        />
      )}
    </div>
  );
};

export default CfAddResultPanel;
