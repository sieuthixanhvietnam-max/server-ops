import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import {
  triggerCfChangeIp,
  triggerCfOriginPort,
  triggerCfPurgeCache,
  triggerCheckIp,
  triggerCheckNs,
} from '@/services/serverOps/api';
import { PageContainer } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import React, { useState } from 'react';

const { TextArea } = Input;

type Action = 'check_ip' | 'check_ns' | 'change_ip' | 'origin_port' | 'purge_cache';

const ACTION_OPTIONS: { label: string; value: Action }[] = [
  { label: 'Kiểm tra IP', value: 'check_ip' },
  { label: 'Kiểm tra NS', value: 'check_ns' },
  { label: 'Đổi IP', value: 'change_ip' },
  { label: 'Origin Port', value: 'origin_port' },
  { label: 'Xoá Cache', value: 'purge_cache' },
];

// Read-only actions run immediately with no confirmation; the rest mutate
// Cloudflare and go through dry-run + confirm like every other mutating CF
// task in this app.
const READONLY_ACTIONS: Action[] = ['check_ip', 'check_ns'];

const parseDomains = (text: string) =>
  Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const CHECK_IP_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  skip: 'Bỏ qua (không có A record)',
  error: 'Lỗi',
};

const CHECK_NS_STATUS_COLORS: Record<string, string> = {
  active: 'green',
  pending: 'gold',
  error: 'red',
};

const CHECK_NS_STATUS_LABELS: Record<string, string> = {
  active: 'Đã trỏ đúng CF',
  pending: 'Chưa trỏ',
  error: 'Lỗi kiểm tra',
};

const CHANGE_IP_STATUS_LABELS: Record<string, string> = {
  updated: 'Đã đổi',
  DRYRUN: 'Dry-run',
  error: 'Lỗi',
};

const ORIGIN_PORT_STATUS_LABELS: Record<string, string> = {
  ok: 'Thành công',
  DRYRUN: 'Dry-run',
  error: 'Lỗi',
};

const PURGE_CACHE_STATUS_LABELS: Record<string, string> = {
  ok: 'Đã xoá cache',
  DRYRUN: 'Dry-run',
  error: 'Lỗi',
};

const ZoneTools: React.FC = () => {
  const { message } = App.useApp();
  const [action, setAction] = usePersistedState<Action>('zone-tools:action', 'check_ip');
  const [text, setText] = usePersistedState('zone-tools:text', '');
  const [newIp, setNewIp] = usePersistedState('zone-tools:newIp', '');
  const [portAction, setPortAction] = usePersistedState<'set' | 'clear'>('zone-tools:portAction', 'set');
  const [port, setPort] = usePersistedState('zone-tools:port', 8888);
  const [jobId, setJobId] = usePersistedState<number | undefined>('zone-tools:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);

  const domains = parseDomains(text);
  const isReadonly = READONLY_ACTIONS.includes(action);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';

  const changeAction = (next: Action) => {
    setAction(next);
    setJobId(undefined);
  };

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    if (action === 'change_ip' && !newIp.trim()) {
      message.warning('Nhập IP mới');
      return;
    }
    setRunning(true);
    try {
      let res: { job_id: number };
      if (action === 'check_ip') {
        res = await triggerCheckIp(domains);
      } else if (action === 'check_ns') {
        res = await triggerCheckNs(domains);
      } else if (action === 'change_ip') {
        res = await triggerCfChangeIp(domains, newIp.trim(), dryRun);
      } else if (action === 'origin_port') {
        res = await triggerCfOriginPort(domains, portAction, port, dryRun);
      } else {
        res = await triggerCfPurgeCache(domains, dryRun);
      }
      setJobId(res.job_id);
    } catch (err: any) {
      message.error(`Lỗi: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <PageContainer
      title="Công cụ Zone"
      extra={
        <ClearCacheButton
          onClear={() => {
            setAction('check_ip');
            setText('');
            setNewIp('');
            setPortAction('set');
            setPort(8888);
            setJobId(undefined);
            ['action', 'text', 'newIp', 'portAction', 'port', 'jobId'].forEach((k) =>
              clearPersistedState(`zone-tools:${k}`),
            );
          }}
        />
      }
    >
      <Card>
        <Typography.Paragraph type="secondary">
          Danh sách domain dùng chung cho mọi thao tác bên dưới - dán 1 lần, chọn thao tác cần chạy.
        </Typography.Paragraph>
        <TextArea
          rows={8}
          placeholder="Nhập danh sách domain, mỗi dòng 1 domain..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <Segmented
          style={{ marginTop: 16 }}
          options={ACTION_OPTIONS}
          value={action}
          onChange={(v) => changeAction(v as Action)}
        />

        <div style={{ marginTop: 16 }}>
          {action === 'change_ip' && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Đổi toàn bộ A record hiện có của domain sang IP mới - có hiệu lực ngay."
                description="Dùng khi server đích đã phục vụ đúng những gì domain đang cần (di chuyển domain, không phải thêm mới). Không tạo/xoá record, chỉ trỏ lại record đã có."
              />
              <Space>
                <Typography.Text>IP mới:</Typography.Text>
                <Input
                  style={{ width: 200 }}
                  placeholder="VD: 34.142.183.60"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                />
              </Space>
            </>
          )}

          {action === 'origin_port' && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Ép Cloudflare kết nối tới origin qua port chỉ định thay vì 80/443."
                description="Nếu server không thực sự lắng nghe ở port này, site sẽ sập ngay lập tức. Chọn 'Xoá quy tắc' để đưa về mặc định 80/443."
              />
              <Space>
                <Segmented
                  options={[
                    { label: 'Đặt cổng', value: 'set' },
                    { label: 'Xoá quy tắc', value: 'clear' },
                  ]}
                  value={portAction}
                  onChange={(v) => setPortAction(v as 'set' | 'clear')}
                />
                {portAction === 'set' && (
                  <Space>
                    <Typography.Text>Port:</Typography.Text>
                    <InputNumber min={1} max={65535} value={port} onChange={(v) => setPort(v || 8888)} />
                  </Space>
                )}
              </Space>
            </>
          )}

          {action === 'purge_cache' && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Xoá toàn bộ cache Cloudflare đang lưu cho domain (purge everything)."
              description="An toàn, không ảnh hưởng routing - chỉ khiến vài request đầu sau khi xoá phải lấy lại từ server gốc. Dùng sau khi đổi theme/nội dung mà site vẫn hiện bản cũ."
            />
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {isReadonly ? (
              <Button type="primary" loading={isBusy} onClick={() => run(false)}>
                Chạy kiểm tra
              </Button>
            ) : (
              <>
                <Button loading={isBusy} onClick={() => run(true)}>
                  Xem trước (dry-run)
                </Button>
                <DangerPopconfirm
                  title={
                    action === 'change_ip'
                      ? 'Xác nhận Đổi IP'
                      : action === 'origin_port'
                        ? 'Xác nhận thay đổi Origin Port'
                        : 'Xác nhận Xoá Cache'
                  }
                  targets={domains}
                  onConfirm={() => run(false)}
                  loading={running}
                >
                  <Button danger type="primary" loading={isBusy} disabled={!domains.length}>
                    Chạy thật
                  </Button>
                </DangerPopconfirm>
              </>
            )}
          </div>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && action === 'check_ip' && (
          <Table<API.CheckIpResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              { title: 'IP', dataIndex: 'ip', render: (v) => v || '-' },
              {
                title: 'Proxy (CF)',
                dataIndex: 'proxied',
                render: (v) =>
                  v === null ? '-' : <Tag color={v ? 'orange' : 'default'}>{v ? 'Bật' : 'Tắt'}</Tag>,
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'ok' ? 'green' : v === 'skip' ? 'gold' : 'red'}>
                    {CHECK_IP_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {(job?.status === 'success' || job?.status === 'failed') && action === 'check_ns' && (
          <Table<API.CheckNsResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={CHECK_NS_STATUS_COLORS[v] || 'default'}>{CHECK_NS_STATUS_LABELS[v] || v}</Tag>
                ),
              },
              { title: 'NS Cloudflare', dataIndex: 'ns_cf', render: (v: string[]) => v?.join(', ') || '-' },
              {
                title: 'NS thực tế (DNS)',
                dataIndex: 'ns_live',
                render: (v: string[]) => v?.join(', ') || '-',
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {(job?.status === 'success' || job?.status === 'failed') && action === 'change_ip' && (
          <Table<API.CfChangeIpResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'updated' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                    {CHANGE_IP_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {(job?.status === 'success' || job?.status === 'failed') && action === 'origin_port' && (
          <Table<API.CfOriginPortResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'ok' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                    {ORIGIN_PORT_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {(job?.status === 'success' || job?.status === 'failed') && action === 'purge_cache' && (
          <Table<API.CfPurgeCacheResult>
            size="small"
            style={{ marginTop: 16 }}
            rowKey="domain"
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Domain', dataIndex: 'domain' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'ok' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                    {PURGE_CACHE_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}
      </Card>
    </PageContainer>
  );
};

export default ZoneTools;
