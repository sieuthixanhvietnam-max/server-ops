import KpiCard from '@/components/KpiCard';
import DomainChangesTrend from '@/pages/domain-changes/Trend';
import {
  getCfZonesSummary,
  getDashboardSummary,
  getPicUnassigned,
  getSyncStatus,
  listCfAccounts,
  listDomains,
  listJobs,
  listServers,
} from '@/services/serverOps/api';
import { DATETIME_FORMAT } from '@/utils/dateFormat';
import { HEALTH_STATUS_LABELS } from '@/utils/healthStatus';
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS, JOB_TYPE_COLORS, JOB_TYPE_LABELS } from '@/utils/jobConstants';
import {
  ArrowRightOutlined,
  BookOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CloudOutlined,
  CloudServerOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DeleteOutlined,
  FieldTimeOutlined,
  FileAddOutlined,
  FireOutlined,
  GlobalOutlined,
  HeartOutlined,
  HistoryOutlined,
  IdcardOutlined,
  KeyOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  RiseOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  SmileOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  TeamOutlined,
  UndoOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { history, useAccess, useModel } from '@umijs/max';
import { Alert, Badge, Button, Card, Col, Progress, Row, Space, Table, Tag, theme, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';
import React, { useEffect, useState } from 'react';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const REFRESH_MS = 45_000;
// Cloudflare's brand orange - a fixed brand identity color, not a semantic
// status color, so it's intentionally not sourced from theme tokens (same
// reasoning as showing any other partner logo in its real brand color
// regardless of light/dark mode).
const CLOUDFLARE_ORANGE = '#F6821F';

const ago = (v: string | null | undefined) => (v ? dayjs(v).fromNow() : 'chưa từng');
const exact = (v: string | null | undefined) => (v ? dayjs(v).format(DATETIME_FORMAT) : '');

const HEALTH_ORDER = ['OK', 'WARN', 'CRIT', 'FAIL', 'unknown'] as const;

// Every route in config/routes.ts is reachable from here - a full sitemap,
// not just a curated few - grouped to match the app's real menu structure
// (Dữ liệu/Server Tasks/Cloudflare Tasks/Monitor+Docs+Settings) so it also
// works as a "map of the whole app" for anyone landing on the dashboard.
const QUICK_LINK_GROUPS: {
  key: string;
  title: string;
  links: { label: string; path: string; icon: React.ReactNode }[];
}[] = [
  {
    key: 'data',
    title: 'Dữ liệu',
    links: [
      { label: 'Domains', path: '/data/domains', icon: <GlobalOutlined /> },
      { label: 'Servers', path: '/data/servers', icon: <CloudServerOutlined /> },
      { label: 'PIC', path: '/data/pics', icon: <TeamOutlined /> },
      { label: 'CF Accounts', path: '/data/cf-accounts', icon: <IdcardOutlined /> },
      { label: 'CF Domains', path: '/data/cf-domains', icon: <CloudOutlined /> },
      { label: 'IP Whitelist', path: '/data/cf-whitelist', icon: <SafetyCertificateOutlined /> },
    ],
  },
  {
    key: 'server',
    title: 'Server',
    links: [
      { label: 'Clone WordPress', path: '/server-task/clone-wpsite', icon: <CopyOutlined /> },
      { label: 'Tạo WordPress mới', path: '/server-task/create-wpsite', icon: <FileAddOutlined /> },
      { label: 'Quản lý Plugin', path: '/server-task/plugin-manager', icon: <RocketOutlined /> },
      { label: 'Bảo trì WordPress', path: '/server-task/wp-maintenance', icon: <ToolOutlined /> },
      { label: 'Kiểm tra sức khoẻ', path: '/server-task/check-health', icon: <HeartOutlined /> },
      { label: 'Đổi mật khẩu WP', path: '/server-task/change-wppass', icon: <KeyOutlined /> },
      { label: 'Khôi phục WordPress', path: '/server-task/restore-wpsite', icon: <UndoOutlined /> },
      { label: 'Xoá WordPress', path: '/server-task/remove-wpsite', icon: <DeleteOutlined /> },
    ],
  },
  {
    key: 'cloudflare',
    title: 'Cloudflare',
    links: [
      { label: 'Thêm Domain', path: '/cf-task/cf-add', icon: <PlusOutlined /> },
      { label: 'Công cụ Zone', path: '/cf-task/zone-tools', icon: <ThunderboltOutlined /> },
      { label: 'Redirect 301', path: '/cf-task/cf-redirect', icon: <SwapOutlined /> },
      { label: 'Kiểm tra Redirect', path: '/cf-task/cf-redirect-audit', icon: <SearchOutlined /> },
      { label: 'Ép Index', path: '/cf-task/force-index', icon: <RiseOutlined /> },
      { label: 'Firewall', path: '/cf-task/cf-firewall', icon: <FireOutlined /> },
      { label: 'Xoá Redirect', path: '/cf-task/cf-redirect-remove', icon: <DeleteOutlined /> },
      { label: 'Xoá Domain CF', path: '/cf-task/cf-remove', icon: <DeleteOutlined /> },
    ],
  },
  {
    key: 'other',
    title: 'Khác',
    links: [
      { label: 'Lịch sử thay đổi Domain', path: '/monitor/domain-changes', icon: <HistoryOutlined /> },
      { label: 'Lịch sử Job', path: '/monitor/job-history', icon: <FieldTimeOutlined /> },
      { label: 'Tài liệu', path: '/docs', icon: <BookOutlined /> },
    ],
  },
];

const greeting = () => {
  const h = dayjs().hour();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 13) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
};

/** One row in the "Cần chú ý" panel - a colored left bar instead of a full
 * card border keeps N of these stackable without turning the page into a
 * wall of red/amber boxes, and every row stays clickable through to the
 * page that actually resolves it. */
const AttentionRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  count: number;
  severity: 'error' | 'warning';
  onClick: () => void;
}> = ({ icon, label, count, severity, onClick }) => {
  const { token } = theme.useToken();
  const color = severity === 'error' ? token.colorError : token.colorWarning;
  const bg = severity === 'error' ? token.colorErrorBg : token.colorWarningBg;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: token.borderRadiusLG,
        background: bg,
        cursor: 'pointer',
        marginBottom: 8,
      }}
    >
      <span style={{ color, fontSize: 16 }}>{icon}</span>
      <span style={{ flex: 1, color: token.colorText }}>{label}</span>
      <Tag color={severity === 'error' ? 'error' : 'warning'} style={{ marginInlineEnd: 0 }}>
        {count}
      </Tag>
      <ArrowRightOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { token } = theme.useToken();
  const access = useAccess();
  const { initialState } = useModel('@@initialState');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<API.DashboardSummary>();
  const [domainTotal, setDomainTotal] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [cfAccountTotal, setCfAccountTotal] = useState(0);
  const [cfZones, setCfZones] = useState<API.CfZonesSummary>();
  const [picUnassigned, setPicUnassigned] = useState<API.PicUnassigned>();
  const [syncStatus, setSyncStatus] = useState<API.SyncStatus>();
  const [recentJobs, setRecentJobs] = useState<API.JobDetail[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>();

  const loadAll = async () => {
    const [summaryRes, domainsRes, serversRes, cfAccountsRes, cfZonesRes, picRes, syncRes, jobsRes] = await Promise.all([
      getDashboardSummary(),
      listDomains({ pageSize: 1, current: 1 }),
      listServers({ pageSize: 1, current: 1 }),
      listCfAccounts({ pageSize: 1, current: 1 }),
      getCfZonesSummary(),
      getPicUnassigned(),
      getSyncStatus(),
      listJobs({ pageSize: 8, current: 1 }),
    ]);
    setSummary(summaryRes.data);
    setDomainTotal(domainsRes.total || 0);
    setServerTotal(serversRes.total || 0);
    setCfAccountTotal(cfAccountsRes.total || 0);
    setCfZones(cfZonesRes);
    setPicUnassigned(picRes);
    setSyncStatus(syncRes);
    setRecentJobs(jobsRes.data || []);
    setLastRefreshed(new Date());
  };

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
    // KPI/alert widgets refresh quietly in the background - a dashboard is
    // typically left open on a screen, not reloaded by hand each time.
    const timer = setInterval(() => {
      getDashboardSummary().then((res) => {
        setSummary(res.data);
        setLastRefreshed(new Date());
      });
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const health = summary?.health;
  const healthTotal = health ? Object.values(health).reduce((a, b) => a + b, 0) : 0;
  const healthIssues = health ? health.WARN + health.CRIT + health.FAIL : 0;
  const healthOkPct = healthTotal ? Math.round(((health?.OK ?? 0) / healthTotal) * 100) : 0;
  const picUnassignedCount = picUnassigned ? picUnassigned.servers.length + picUnassigned.accounts.length : 0;

  const attentionItems = [
    {
      key: 'jobs',
      icon: <WarningFilled />,
      label: 'Job lỗi trong 24h qua',
      count: summary?.jobs_failed_24h ?? 0,
      severity: 'error' as const,
      onClick: () => history.push('/monitor/job-history'),
    },
    {
      key: 'cf-zone',
      icon: <SafetyCertificateOutlined />,
      label: 'Domain chưa có CF zone',
      count: cfZones?.server_only ?? 0,
      severity: 'warning' as const,
      onClick: () => history.push('/cf-task/zone-tools'),
    },
    {
      key: 'pic',
      icon: <TeamOutlined />,
      label: 'Server/Account chưa gán PIC',
      count: picUnassignedCount,
      severity: 'warning' as const,
      onClick: () => history.push('/data/pics'),
    },
  ].filter((item) => item.count > 0);

  const healthColor = (key: string) =>
    (
      {
        OK: token.colorSuccess,
        WARN: token.colorWarning,
        CRIT: token.colorError,
        FAIL: token.colorError,
        unknown: token.colorTextQuaternary,
      } as Record<string, string>
    )[key] || token.colorTextQuaternary;

  // Reuses the exact same 4 color/bg pairs already on the KPI cards above
  // (primary blue, info blue, Cloudflare orange, neutral grey) instead of
  // inventing a new palette - keeps the shortcut icons visually tied to the
  // KPI card for the same subject (e.g. Cloudflare shortcuts use the same
  // orange as the "Tổng CF Account" card).
  const GROUP_ACCENT: Record<string, { color: string; bg: string }> = {
    data: { color: token.colorPrimary, bg: token.colorPrimaryBg },
    server: { color: token.colorInfo, bg: token.colorInfoBg },
    cloudflare: { color: CLOUDFLARE_ORANGE, bg: 'rgba(246, 130, 31, 0.12)' },
    other: { color: token.colorTextTertiary, bg: token.colorFillTertiary },
  };

  const visibleQuickLinkGroups = QUICK_LINK_GROUPS.map((g) =>
    g.key === 'other' && access.canAdmin
      ? {
          ...g,
          links: [
            ...g.links,
            { label: 'Kiểm soát truy cập', path: '/monitor/access-control', icon: <LockOutlined /> },
            { label: 'Cài đặt', path: '/settings', icon: <SettingOutlined /> },
          ],
        }
      : g,
  );

  return (
    <PageContainer title={false} loading={loading}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {greeting()}
            {initialState?.currentUser?.name ? `, ${initialState.currentUser.name}` : ''}
          </Typography.Title>
          <Typography.Text type="secondary">
            {dayjs().format('dddd, DD/MM/YYYY')} · Tổng quan hệ thống server, domain và Cloudflare
          </Typography.Text>
        </div>
        <Space>
          {lastRefreshed && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Cập nhật lúc {dayjs(lastRefreshed).format('HH:mm:ss')}
            </Typography.Text>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setLoading(true);
              loadAll().finally(() => setLoading(false));
            }}
          >
            Làm mới
          </Button>
        </Space>
      </div>

      {syncStatus && !syncStatus.success && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Đồng bộ domain gần nhất thất bại: ${syncStatus.error_message || 'không rõ lý do'}`}
        />
      )}
      {summary && summary.cf_sync.error_count > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${summary.cf_sync.error_count} tài khoản Cloudflare đang lỗi đồng bộ`}
          action={
            <Button size="small" onClick={() => history.push('/data/cf-accounts')}>
              Xem
            </Button>
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={12} sm={8} md={access.canAdmin ? 4 : 6}>
          <KpiCard
            icon={<GlobalOutlined />}
            label="Tổng domain"
            value={domainTotal.toLocaleString('vi-VN')}
            color={token.colorPrimary}
            bg={token.colorPrimaryBg}
            onClick={() => history.push('/data/domains')}
          />
        </Col>
        <Col xs={12} sm={8} md={access.canAdmin ? 4 : 6}>
          <KpiCard
            icon={<CloudServerOutlined />}
            label="Tổng server"
            value={serverTotal.toLocaleString('vi-VN')}
            color={token.colorPrimary}
            bg={token.colorPrimaryBg}
            onClick={() => history.push('/data/servers')}
          />
        </Col>
        <Col xs={12} sm={8} md={access.canAdmin ? 4 : 6}>
          <Tooltip
            title={`Đồng bộ CF lần cuối: ${exact(summary?.cf_sync?.last_synced_at)} · Tiếp theo: ${exact(summary?.cf_sync?.next_at)}`}
          >
            <div>
              <KpiCard
                icon={<CloudOutlined />}
                label="Tổng CF Account"
                value={cfAccountTotal.toLocaleString('vi-VN')}
                color={CLOUDFLARE_ORANGE}
                bg="rgba(246, 130, 31, 0.12)"
                onClick={() => history.push('/data/cf-accounts')}
                caption={`Đồng bộ tiếp theo: ${ago(summary?.cf_sync?.next_at)}`}
              />
            </div>
          </Tooltip>
        </Col>
        <Col xs={12} sm={8} md={access.canAdmin ? 4 : 6}>
          <Tooltip
            title={`Lần cuối: ${exact(syncStatus?.synced_at)} · Tiếp theo: ${exact(syncStatus?.next_synced_at)}`}
          >
            <div>
              <KpiCard
                icon={<CloudSyncOutlined />}
                label="Đồng bộ domain"
                value={ago(syncStatus?.synced_at)}
                color={token.colorInfo}
                bg={token.colorInfoBg}
                caption={`Tiếp theo: ${ago(syncStatus?.next_synced_at)}`}
              />
            </div>
          </Tooltip>
        </Col>
        {access.canAdmin && summary?.admin && (
          <>
            <Col xs={12} sm={8} md={4}>
              <KpiCard
                icon={<TeamOutlined />}
                label="User hoạt động"
                value={summary.admin.active_users}
                color={token.colorPrimary}
                bg={token.colorPrimaryBg}
                onClick={() => history.push('/monitor/access-control')}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <KpiCard
                icon={summary.admin.ip_allowlist_enforced ? <CheckCircleFilled /> : <CloseCircleFilled />}
                label="IP allowlist"
                value={summary.admin.ip_allowlist_enforced ? 'Đang bật' : 'Đang tắt'}
                color={summary.admin.ip_allowlist_enforced ? token.colorSuccess : token.colorTextTertiary}
                bg={summary.admin.ip_allowlist_enforced ? token.colorSuccessBg : token.colorFillTertiary}
                onClick={() => history.push('/monitor/access-control')}
              />
            </Col>
          </>
        )}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }} align="stretch">
        <Col xs={24} md={10}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined /> Cần chú ý
              </Space>
            }
            style={{ height: '100%' }}
          >
            {attentionItems.length ? (
              attentionItems.map((item) => (
                <AttentionRow
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  count={item.count}
                  severity={item.severity}
                  onClick={item.onClick}
                />
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: token.colorTextSecondary }}>
                <SmileOutlined style={{ fontSize: 28, color: token.colorSuccess, marginBottom: 8, display: 'block' }} />
                Không có gì cần chú ý - hệ thống ổn định
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <HeartOutlined /> Sức khoẻ server
              </Space>
            }
            extra={
              <Space>
                <Tooltip
                  title={`Cập nhật lần cuối: ${exact(summary?.health_checked_at)} · Tiếp theo: ${exact(summary?.health_next_at)}`}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Cập nhật {ago(summary?.health_checked_at)} · Tiếp theo {ago(summary?.health_next_at)}
                  </Typography.Text>
                </Tooltip>
                <Button size="small" onClick={() => history.push('/server-task/check-health')}>
                  Chi tiết
                </Button>
              </Space>
            }
            style={{ height: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <Progress
                type="dashboard"
                percent={healthOkPct}
                size={120}
                status={healthIssues > 0 ? 'exception' : 'success'}
                format={() => (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>{health?.OK ?? 0}</div>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary }}>/ {healthTotal} bình thường</div>
                  </div>
                )}
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {HEALTH_ORDER.filter((k) => (health?.[k] ?? 0) > 0).map((key) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Badge color={healthColor(key)} />
                    <span style={{ flex: 1, color: token.colorTextSecondary, fontSize: 13 }}>
                      {HEALTH_STATUS_LABELS[key]}
                    </span>
                    <Typography.Text strong>{health?.[key] ?? 0}</Typography.Text>
                  </div>
                ))}
              </div>
            </div>
            {healthIssues > 0 && (
              <Alert
                style={{ marginTop: 16 }}
                type="warning"
                showIcon
                message={`${healthIssues} server đang ở trạng thái cảnh báo/lỗi`}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card
            title="Hoạt động gần đây"
            extra={
              <Button size="small" onClick={() => history.push('/monitor/job-history')}>
                Xem tất cả
              </Button>
            }
          >
            <Table<API.JobDetail>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={recentJobs}
              columns={[
                {
                  title: 'Loại job',
                  dataIndex: 'job_type',
                  render: (v: string) => <Tag color={JOB_TYPE_COLORS[v] || 'blue'}>{JOB_TYPE_LABELS[v] || v}</Tag>,
                },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (v: string) => <Tag color={JOB_STATUS_COLORS[v]}>{JOB_STATUS_LABELS[v] || v}</Tag>,
                },
                { title: 'Người chạy', dataIndex: 'created_by' },
                {
                  title: 'Thời gian',
                  dataIndex: 'created_at',
                  render: (v: string) => (
                    <Tooltip title={exact(v)}>
                      <span>{ago(v)}</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card title="Lối tắt" styles={{ body: { paddingTop: 12 } }}>
            {visibleQuickLinkGroups.map((group, idx) => {
              const accent = GROUP_ACCENT[group.key];
              return (
                <div key={group.key} style={{ marginTop: idx === 0 ? 0 : 20 }}>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
                  >
                    {group.title}
                  </Typography.Text>
                  <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
                    {group.links.map((q) => (
                      <Col key={q.path} xs={12} sm={8} md={6} lg={4}>
                        <Card
                          hoverable
                          size="small"
                          onClick={() => history.push(q.path)}
                          styles={{ body: { padding: '14px 10px', textAlign: 'center' } }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 10,
                              background: accent.bg,
                              color: accent.color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 16,
                              margin: '0 auto 8px',
                            }}
                          >
                            {q.icon}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: token.colorText,
                              lineHeight: 1.3,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {q.label}
                          </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </div>
              );
            })}
          </Card>
        </Col>
      </Row>

      <DomainChangesTrend />
    </PageContainer>
  );
};

export default Dashboard;
