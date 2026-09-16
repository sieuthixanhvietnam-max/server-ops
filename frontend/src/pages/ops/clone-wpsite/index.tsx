import CfAddResultPanel from '@/components/CfAddResultPanel';
import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import VerifyBadge from '@/components/VerifyBadge';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import {
  checkCfZonesBatch,
  checkDomainsExistBatch,
  listCfAccountOptions,
  listDomains,
  listServers,
  suggestCfAccount,
  triggerCfAddBatch,
  triggerCloneWpsite,
} from '@/services/serverOps/api';
import { buildAccountSelectOptions } from '@/utils/cfAccountOptions';
import { PageContainer } from '@ant-design/pro-components';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleFilled,
  MinusCircleOutlined,
  PlusOutlined,
  QuestionCircleFilled,
  SwapOutlined,
  UploadOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { useLocation, useNavigate } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type Row = { source: string; target: string; sourceServer?: string };
type ServerOption = { server_name: string; server_ip: string };

const CLONE_STATUS_LABELS: Record<string, string> = {
  OK: 'Thành công',
  DRYRUN: 'Dry-run',
  FAIL: 'Thất bại',
};

const DNS_STATUS_LABELS: Record<string, string> = {
  updated: 'Đã cập nhật',
  unchanged: 'Không đổi',
  error: 'Lỗi',
};

const emptyRow = (): Row => ({ source: '', target: '' });

type ZoneStatusMap = Record<string, API.CfZoneCheckResult | undefined>;

type PicGroup = {
  key: string;
  pics: string[];
  targets: string[];
  selectedAccountId?: number;
  reason: string;
};

const splitLines = (text: string) => text.split(/\r?\n/);

const ZoneTag: React.FC<{ status?: API.CfZoneCheckResult }> = ({ status }) => {
  if (!status) return <Tag>Chưa kiểm tra</Tag>;
  return status.has_zone ? (
    <Tag icon={<CheckCircleFilled />} color="success">
      Có zone
    </Tag>
  ) : (
    <Tag icon={<CloseCircleFilled />} color="warning">
      Chưa có trên CF
    </Tag>
  );
};

const NsTag: React.FC<{ status?: API.CfZoneCheckResult }> = ({ status }) => {
  const { token } = theme.useToken();
  if (!status || !status.has_zone) return <span style={{ color: token.colorTextQuaternary }}>-</span>;

  const label =
    status.ns_status === 'active' ? (
      <Tag icon={<CheckCircleFilled />} color="success">
        NS Active
      </Tag>
    ) : status.ns_status === 'pending' ? (
      <Tag icon={<ClockCircleFilled />} color="gold">
        NS Pending
      </Tag>
    ) : (
      <Tag icon={<QuestionCircleFilled />} color="default">
        NS ?
      </Tag>
    );

  if (!status.ns_cf.length) return label;

  // Chỉ hiển thị để xem nhanh - nút Copy để ở card "NS mới" bên dưới (đã gộp
  // nhóm theo NS chung, không lặp lại 2 chỗ copy cho cùng 1 dữ liệu).
  return (
    <div>
      {label}
      <Tooltip title={status.ns_cf.map((ns) => <div key={ns}>{ns}</div>)}>
        <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 11, color: token.colorTextTertiary, cursor: 'default' }}>
          {status.ns_cf.map((ns) => (
            <div key={ns}>{ns}</div>
          ))}
        </div>
      </Tooltip>
    </div>
  );
};

const BulkImportModal: React.FC<{
  open: boolean;
  onCancel: () => void;
  onImport: (pairs: Row[]) => void;
}> = ({ open, onCancel, onImport }) => {
  const { token } = theme.useToken();
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');

  const sourceLines = sourceText ? splitLines(sourceText) : [];
  const targetLines = targetText ? splitLines(targetText) : [];
  const countMismatch =
    sourceText.trim() !== '' && targetText.trim() !== '' && sourceLines.length !== targetLines.length;

  const preview = useMemo(() => {
    if (countMismatch || !sourceLines.length) return [];
    return sourceLines.map((s, idx) => {
      const source = (s || '').trim().toLowerCase();
      const target = (targetLines[idx] || '').trim().toLowerCase();
      const valid = !!source && !!target;
      return { key: idx, source, target, valid };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText, targetText, countMismatch]);

  const validPairs = preview.filter((p) => p.valid);
  const invalidCount = preview.length - validPairs.length;

  const reset = () => {
    setSourceText('');
    setTargetText('');
  };

  return (
    <Modal
      title="Nhập hàng loạt"
      open={open}
      onCancel={() => {
        reset();
        onCancel();
      }}
      width={780}
      footer={[
        <Button
          key="cancel"
          onClick={() => {
            reset();
            onCancel();
          }}
        >
          Huỷ
        </Button>,
        <Button
          key="import"
          type="primary"
          disabled={countMismatch || !validPairs.length}
          onClick={() => {
            onImport(validPairs.map((p) => ({ source: p.source, target: p.target })));
            reset();
          }}
        >
          Nhập {validPairs.length ? `(${validPairs.length} cặp)` : ''}
        </Button>,
      ]}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Dán danh sách domain nguồn vào ô trái, domain đích vào ô phải - mỗi dòng 1 domain. Ghép cặp theo
        đúng số thứ tự dòng (dòng 1 với dòng 1, dòng 2 với dòng 2...).
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Typography.Text strong>Domain nguồn ({sourceLines.filter(Boolean).length} dòng)</Typography.Text>
          <Input.TextArea
            rows={8}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder={'source1.example.com\nsource2.example.com'}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Typography.Text strong>Domain đích ({targetLines.filter(Boolean).length} dòng)</Typography.Text>
          <Input.TextArea
            rows={8}
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            placeholder={'target1.example.com\ntarget2.example.com'}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
      </div>

      {countMismatch && (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          message={`Số dòng không khớp: nguồn ${sourceLines.length} dòng, đích ${targetLines.length} dòng. Sửa lại cho khớp trước khi nhập.`}
        />
      )}

      {!countMismatch && preview.length > 0 && (
        <>
          <Space style={{ marginTop: 16, marginBottom: 8 }}>
            <Tag icon={<CheckCircleFilled />} color="success" style={{ fontSize: 13, padding: '2px 10px' }}>
              {validPairs.length} hợp lệ
            </Tag>
            {invalidCount > 0 && (
              <Tag icon={<CloseCircleFilled />} color="error" style={{ fontSize: 13, padding: '2px 10px' }}>
                {invalidCount} dòng trống - sẽ bỏ qua
              </Tag>
            )}
          </Space>
          <Table
            size="small"
            pagination={false}
            scroll={{ y: 260 }}
            rowKey="key"
            dataSource={preview}
            rowClassName={(r) => (r.valid ? '' : 'clone-import-row-invalid')}
            columns={[
              { title: '#', dataIndex: 'key', width: 44, render: (v: number) => v + 1 },
              {
                title: 'Domain nguồn',
                dataIndex: 'source',
                render: (v) => <span style={{ fontFamily: 'monospace' }}>{v || '(trống)'}</span>,
              },
              { title: '', width: 28, render: () => <span style={{ color: token.colorTextQuaternary }}>→</span> },
              {
                title: 'Domain đích',
                dataIndex: 'target',
                render: (v) => <span style={{ fontFamily: 'monospace' }}>{v || '(trống)'}</span>,
              },
              {
                title: 'Trạng thái',
                width: 110,
                render: (_, r) =>
                  r.valid ? (
                    <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 16 }} />
                  ) : (
                    <CloseCircleFilled style={{ color: token.colorError, fontSize: 16 }} />
                  ),
              },
            ]}
          />
          <style>{`.clone-import-row-invalid { background: ${token.colorErrorBg}; }`}</style>
        </>
      )}
    </Modal>
  );
};

/** Polls + renders one CF Add job's log. Kept as its own component so a
 * variable-length list of jobs (one per PIC/IP group) doesn't violate hooks
 * rules - each list item mounts its own instance. */
const CfAddJobPanel: React.FC<{ jobId: number; label: React.ReactNode; onSuccess: () => void }> = ({
  jobId,
  label,
  onSuccess,
}) => {
  const job = useJobPolling(jobId);
  // Defense in depth: onSuccess must fire at most once per job, even if this
  // panel ever gets unmounted/remounted again for some other reason (a
  // fresh mount re-polls and immediately re-observes an already-'success'
  // job, which without this guard fires onSuccess again).
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (job?.status === 'success' && !notifiedRef.current) {
      notifiedRef.current = true;
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <JobLogPanel job={job} />
      {(job?.status === 'success' || job?.status === 'failed') && <CfAddResultPanel result={job.result} />}
    </div>
  );
};

const CloneWpsite: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = usePersistedState<Row[]>('clone-wpsite:rows', [emptyRow()]);
  const [jobId, setJobId] = usePersistedState<number | undefined>('clone-wpsite:jobId', undefined);
  const [running, setRunning] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const job = useJobPolling(jobId);

  const [zoneStatus, setZoneStatus] = useState<ZoneStatusMap>({});
  const [existingTargets, setExistingTargets] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);

  const [placeholderIp, setPlaceholderIp] = usePersistedState('clone-wpsite:placeholderIp', '');
  const [useRealIp, setUseRealIp] = usePersistedState('clone-wpsite:useRealIp', false);
  const [forceReconfigure, setForceReconfigure] = usePersistedState('clone-wpsite:forceReconfigure', false);
  const [addRunning, setAddRunning] = useState(false);
  const [addJob, setAddJob] = useState<{ jobId: number; label: React.ReactNode } | undefined>(undefined);

  const [groups, setGroups] = useState<PicGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [targetToSourceMap, setTargetToSourceMap] = useState<Record<string, string>>({});
  const [sourceIpMap, setSourceIpMap] = useState<Record<string, string | null>>({});
  const [accountOptions, setAccountOptions] = useState<API.CfAccountOption[]>([]);

  // Which server(s) each typed source domain actually sits on - a domain
  // like a blank WP template deployed identically on every box (see
  // site-trang.com) resolves to many rows here. Clone always runs
  // same-server, so an ambiguous source needs the user to pick which
  // server's copy to clone from before it can run.
  const [sourceServersMap, setSourceServersMap] = useState<Record<string, ServerOption[]>>({});
  // server_name -> số domain đang chạy trên đó (từ trang Servers) - hiển thị
  // kèm mỗi lựa chọn server nguồn để chọn được server "rảnh" nhất khi cài
  // WordPress mới, thay vì chọn ngẫu nhiên trong danh sách mơ hồ.
  const [serverDomainsCount, setServerDomainsCount] = useState<Record<string, number>>({});

  useEffect(() => {
    const preset = (location.state as { domains?: string[] } | undefined)?.domains;
    if (preset?.length) {
      setRows(preset.map((d) => ({ source: d, target: '' })));
    }
    listCfAccountOptions().then((res) => setAccountOptions(res.data || []));
    listServers({ pageSize: 500, current: 1 }).then((res) => {
      setServerDomainsCount(
        Object.fromEntries((res.data || []).map((s) => [s.server_name, s.domains_count])),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sources = Array.from(
      new Set(rows.map((r) => r.source.trim().toLowerCase()).filter(Boolean)),
    ).filter((s) => !(s in sourceServersMap));
    if (!sources.length) return;
    Promise.all(
      sources.map(async (source) => {
        const res = await listDomains({ domain: source, pageSize: 50, current: 1 });
        const servers = (res.data || [])
          .filter((d) => d.domain === source)
          .map((d) => ({ server_name: d.server_name, server_ip: d.server_ip }));
        return [source, servers] as const;
      }),
    ).then((entries) => {
      setSourceServersMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const isSourceAmbiguous = (source: string) => (sourceServersMap[source]?.length || 0) > 1;

  const pairs = rows
    .map((r) => ({
      source: r.source.trim().toLowerCase(),
      target: r.target.trim().toLowerCase(),
      sourceServer: r.sourceServer,
    }))
    .filter((r) => r.source && r.target);

  const uniqueTargets = Array.from(new Set(pairs.map((p) => p.target)));
  const missingTargets = uniqueTargets.filter((t) => zoneStatus[t] && !zoneStatus[t]!.has_zone);
  const needsSourceServerCount = pairs.filter((p) => isSourceAmbiguous(p.source) && !p.sourceServer).length;
  const readyPairs = pairs.filter(
    (p) => zoneStatus[p.target]?.has_zone === true && (!isSourceAmbiguous(p.source) || p.sourceServer),
  );
  const notCheckedCount = pairs.length - pairs.filter((p) => zoneStatus[p.target] !== undefined).length;
  const existingTargetCount = pairs.filter((p) => existingTargets[p.target]).length;

  const resolveGroups = async (targets: string[]) => {
    if (!targets.length) {
      setGroups([]);
      return;
    }
    setGroupsLoading(true);
    try {
      // Keyed by source+sourceServer, not just source - a domain deployed on
      // >1 server (see isSourceAmbiguous) needs the explicit server choice
      // to resolve a single IP, same as the actual clone call does.
      const sourceKey = (source: string, sourceServer?: string) => `${source}::${sourceServer || ''}`;

      const targetToSource: Record<string, string> = {};
      pairs.forEach((p) => {
        if (targets.includes(p.target) && !targetToSource[p.target]) {
          targetToSource[p.target] = sourceKey(p.source, p.sourceServer);
        }
      });
      const uniqueSourceEntries = Array.from(
        new Map(pairs.filter((p) => targets.includes(p.target)).map((p) => [sourceKey(p.source, p.sourceServer), p])).values(),
      );
      const ipEntries = await Promise.all(
        uniqueSourceEntries.map(async (p) => {
          const res = await listDomains({ domain: p.source, pageSize: 50, current: 1 });
          const matches = (res.data || []).filter((d) => d.domain === p.source);
          const ip = p.sourceServer
            ? matches.find((d) => d.server_name === p.sourceServer)?.server_ip || null
            : (() => {
                const uniqueIps = new Set(matches.map((d) => d.server_ip));
                return uniqueIps.size === 1 ? matches[0].server_ip : null;
              })();
          return [sourceKey(p.source, p.sourceServer), ip] as const;
        }),
      );
      const sourceIp: Record<string, string | null> = Object.fromEntries(ipEntries);
      setSourceIpMap(sourceIp);
      setTargetToSourceMap(targetToSource);

      const uniqueIps = Array.from(new Set(Object.values(sourceIp).filter(Boolean))) as string[];
      const suggestionEntries = await Promise.all(
        uniqueIps.map(async (ip) => [ip, await suggestCfAccount(ip)] as const),
      );
      const suggestionByIp = new Map(suggestionEntries);

      const groupMap = new Map<string, PicGroup>();
      targets.forEach((target) => {
        const source = targetToSource[target];
        const sourceLabel = source?.split('::')[0];
        const ip = source ? sourceIp[source] : null;
        const suggestion = ip ? suggestionByIp.get(ip) : undefined;
        const pics = suggestion?.pics || [];
        const key = pics.length ? [...pics].sort().join(',') : 'unmatched';
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            key,
            pics,
            targets: [],
            selectedAccountId: suggestion?.suggested_account_id || undefined,
            reason: !source
              ? 'Không xác định được domain nguồn'
              : !ip
                ? `Server nguồn (${sourceLabel}) mơ hồ - chưa chọn server ở bảng trên, hoặc chưa đồng bộ`
                : !pics.length
                  ? `Server ${suggestion?.matched_server || sourceLabel} chưa gán PIC - dùng account mặc định (.env)`
                  : `Theo PIC ${pics.join(', ')} (server ${suggestion?.matched_server})`,
          });
        }
        groupMap.get(key)!.targets.push(target);
      });
      setGroups(Array.from(groupMap.values()));
    } catch (err: any) {
      message.error(`Lỗi khi phân tích nhóm PIC: ${err?.message || err}`);
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleCheck = async () => {
    if (!uniqueTargets.length) return;
    setChecking(true);
    try {
      const [zoneRes, existsRes] = await Promise.all([
        checkCfZonesBatch(uniqueTargets),
        checkDomainsExistBatch(uniqueTargets),
      ]);
      setZoneStatus((prev) => ({ ...prev, ...zoneRes.data }));
      setExistingTargets((prev) => ({ ...prev, ...existsRes.data }));
      const freshMissing = uniqueTargets.filter((t) => zoneRes.data[t] && !zoneRes.data[t].has_zone);
      await resolveGroups(freshMissing);
    } catch (err: any) {
      message.error(`Lỗi khi kiểm tra trạng thái Cloudflare: ${err?.message || err}`);
    } finally {
      setChecking(false);
    }
  };

  // "Thêm vào Cloudflare" can dispatch several jobs at once - one per PIC
  // group (seen in production: 5 groups -> 5 jobs created within ~100ms of
  // each other). Each CfAddJobPanel calls onSuccess independently, so N
  // jobs finishing around the same time used to fire N full handleCheck()
  // passes back to back - each one redoing check-batch/exists-batch/
  // resolveGroups for the WHOLE target list, piling up into the request
  // queue and making the page look like it's stuck refreshing. Debounced so
  // a burst of completions collapses into exactly one recheck, run shortly
  // after the last job in the burst settles.
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleRecheck = () => {
    if (recheckTimerRef.current) clearTimeout(recheckTimerRef.current);
    recheckTimerRef.current = setTimeout(handleCheck, 500);
  };

  useEffect(() => {
    return () => clearTimeout(recheckTimerRef.current);
  }, []);

  const handleResetAll = () => {
    clearTimeout(recheckTimerRef.current);
    setRows([emptyRow()]);
    setZoneStatus({});
    setExistingTargets({});
    setGroups([]);
    setAddJob(undefined);
    setTargetToSourceMap({});
    setSourceIpMap({});
  };

  const clearCache = () => {
    handleResetAll();
    setJobId(undefined);
    setPlaceholderIp('');
    setUseRealIp(false);
    setForceReconfigure(false);
    ['rows', 'jobId', 'placeholderIp', 'useRealIp', 'forceReconfigure'].forEach((k) =>
      clearPersistedState(`clone-wpsite:${k}`),
    );
  };

  const run = async (dryRun: boolean) => {
    if (!readyPairs.length) {
      message.warning('Chưa có cặp domain nào sẵn sàng (đã kiểm tra CF và có zone) để chạy');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCloneWpsite(
        readyPairs.map((p) => ({ source: p.source, target: p.target, source_server: p.sourceServer })),
        dryRun,
      );
      setJobId(res.job_id);
      if (!dryRun) {
        // Input has been submitted for real - clear the draft so the next
        // visit starts blank instead of showing already-acted-upon rows.
        setRows([emptyRow()]);
        clearPersistedState('clone-wpsite:rows');
      }
    } catch (err: any) {
      message.error(`Lỗi khi chạy Clone: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  // Builds one (domains, ip, cf_account_id) sub-group per PIC group (or per
  // PIC-group×source-IP when useRealIp splits a group further) - sent as a
  // single triggerCfAddBatch call instead of one triggerCfAdd per group, so
  // the whole run is 1 job with 1 combined result table instead of N jobs
  // each needing their own copy.
  const buildAddSubGroups = () => {
    const subGroups: { domains: string[]; ip: string; cf_account_id?: number }[] = [];
    const unresolved: string[] = [];

    if (!useRealIp) {
      groups.forEach((group) => {
        subGroups.push({ domains: group.targets, ip: placeholderIp.trim(), cf_account_id: group.selectedAccountId });
      });
      return { subGroups, unresolved };
    }

    groups.forEach((group) => {
      const byIp = new Map<string, string[]>();
      group.targets.forEach((t) => {
        const source = targetToSourceMap[t];
        const ip = source ? sourceIpMap[source] : null;
        if (!ip) {
          unresolved.push(t);
          return;
        }
        byIp.set(ip, [...(byIp.get(ip) || []), t]);
      });
      byIp.forEach((targets, ip) => {
        subGroups.push({ domains: targets, ip, cf_account_id: group.selectedAccountId });
      });
    });
    return { subGroups, unresolved };
  };

  const runAddMissing = async (dryRun: boolean) => {
    if (!groups.length) return;
    if (!useRealIp && !placeholderIp.trim()) {
      message.warning('Nhập IP giữ chỗ');
      return;
    }

    const { subGroups, unresolved } = buildAddSubGroups();
    if (unresolved.length) {
      message.warning(`${unresolved.length} domain không xác định IP server nguồn - bỏ qua: ${unresolved.join(', ')}`);
    }
    if (!subGroups.length) {
      message.warning('Không có domain nào sẵn sàng để thêm vào Cloudflare');
      return;
    }

    setAddRunning(true);
    try {
      const res = await triggerCfAddBatch(subGroups, dryRun, forceReconfigure);
      const total = subGroups.reduce((sum, g) => sum + g.domains.length, 0);
      setAddJob({
        jobId: res.job_id,
        label: `${total} domain (${subGroups.length} nhóm IP/account)`,
      });
    } catch (err: any) {
      message.error(`Lỗi khi thêm domain vào Cloudflare: ${err?.message || err}`);
    } finally {
      setAddRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const tableData = rows.map((r, idx) => ({ ...r, idx }));

  const hasClonedOk = ((job?.result as API.CloneWpsiteResult[] | undefined) || []).some(
    (r) => r.status === 'OK',
  );

  return (
    <PageContainer title="Clone WordPress Site" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Mỗi dòng: chọn/nhập domain nguồn (đã đồng bộ) và domain đích. Domain đích PHẢI có zone trên Cloudflare trước khi clone."
          description="Server được tự động xác định từ domain nguồn, và clone luôn chạy trên CÙNG server đó (không chuyển qua server khác). Nếu domain nguồn tồn tại trên nhiều server (VD: 1 template WP trắng có sẵn trên mọi server), hệ thống sẽ hiện thêm ô chọn server nguồn - phải chọn đúng server trước khi chạy. Nếu domain đích đã tồn tại, site cũ sẽ bị XOÁ trước khi clone đè lên. Dùng nút 'Kiểm tra trạng thái Cloudflare' bên dưới để xem domain nào còn thiếu zone. NS đang pending không chặn clone, chỉ là domain chưa phân giải công khai."
        />

        <Space style={{ marginBottom: 12 }}>
          <Button icon={<UploadOutlined />} onClick={() => setBulkOpen(true)}>
            Nhập hàng loạt
          </Button>
          <Popconfirm
            title="Xoá toàn bộ danh sách?"
            description="Toàn bộ dòng, kết quả kiểm tra CF và nhóm PIC hiện tại sẽ bị xoá."
            onConfirm={handleResetAll}
            okText="Xoá tất cả"
            okButtonProps={{ danger: true }}
          >
            <Button danger>Xoá tất cả</Button>
          </Popconfirm>
        </Space>

        <Table
          size="small"
          pagination={false}
          rowKey="idx"
          dataSource={tableData}
          style={{ marginBottom: 12 }}
          columns={[
            { title: '#', width: 40, render: (_, __, i) => i + 1 },
            {
              title: 'Domain nguồn',
              width: '32%',
              render: (_, r) => {
                const source = r.source.trim().toLowerCase();
                const servers = sourceServersMap[source];
                return (
                  <div>
                    <DomainSelect
                      mode="single"
                      value={r.source ? [r.source] : []}
                      onChange={(v) => updateRow(r.idx, { source: v[0] || '', sourceServer: undefined })}
                      placeholder="Domain nguồn (đã đồng bộ)..."
                    />
                    {servers && servers.length > 1 && (
                      <Select
                        style={{ width: '100%', marginTop: 4 }}
                        size="small"
                        showSearch
                        optionFilterProp="label"
                        status={r.sourceServer ? undefined : 'error'}
                        placeholder={`⚠ Mơ hồ - chọn 1 trong ${servers.length} server nguồn`}
                        value={r.sourceServer}
                        onChange={(v) => updateRow(r.idx, { sourceServer: v })}
                        options={[...servers]
                          .sort((a, b) => (serverDomainsCount[a.server_name] ?? Infinity) - (serverDomainsCount[b.server_name] ?? Infinity))
                          .map((s) => {
                            const count = serverDomainsCount[s.server_name];
                            return {
                              value: s.server_name,
                              label: `${s.server_name} (${s.server_ip}) — ${count ?? '?'} domain`,
                            };
                          })}
                      />
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Domain đích',
              width: '32%',
              render: (_, r) => (
                <div>
                  <Input
                    placeholder="Domain đích (VD: newsite.example.com)"
                    value={r.target}
                    onChange={(e) => updateRow(r.idx, { target: e.target.value })}
                  />
                  {existingTargets[r.target.trim().toLowerCase()] && (
                    <Tag icon={<WarningFilled />} color="error" style={{ marginTop: 4 }}>
                      Đã có site đang chạy - sẽ bị XOÁ khi clone đè lên
                    </Tag>
                  )}
                </div>
              ),
            },
            {
              title: 'Zone CF',
              width: 140,
              render: (_, r) => <ZoneTag status={zoneStatus[r.target.trim().toLowerCase()]} />,
            },
            {
              title: 'NS',
              width: 230,
              render: (_, r) => <NsTag status={zoneStatus[r.target.trim().toLowerCase()]} />,
            },
            {
              title: '',
              width: 48,
              render: (_, r) => (
                <Button
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeRow(r.idx)}
                  disabled={rows.length <= 1}
                  danger
                  type="text"
                />
              ),
            },
          ]}
        />
        <Button icon={<PlusOutlined />} onClick={() => setRows((prev) => [...prev, emptyRow()])} style={{ marginBottom: 12 }}>
          Thêm dòng
        </Button>

        <div>
          <Button loading={checking} onClick={handleCheck} disabled={!uniqueTargets.length}>
            Kiểm tra trạng thái Cloudflare ({uniqueTargets.length} domain đích)
          </Button>
        </div>

        {missingTargets.length > 0 && (
          <Card
            size="small"
            type="inner"
            title={`${missingTargets.length} domain đích chưa có trên Cloudflare`}
            style={{ marginTop: 16, borderColor: token.colorWarning }}
            loading={groupsLoading}
          >
            <Checkbox checked={useRealIp} onChange={(e) => setUseRealIp(e.target.checked)}>
              Dùng đúng IP server nguồn tương ứng (thay vì 1 IP giữ chỗ dùng chung)
            </Checkbox>
            <br />
            <Checkbox checked={forceReconfigure} onChange={(e) => setForceReconfigure(e.target.checked)}>
              Ép áp lại cấu hình chuẩn (DNS/SSL/HTTPS/Firewall) kể cả khi zone đã tồn tại
            </Checkbox>
            {!useRealIp && (
              <div style={{ marginTop: 8 }}>
                <Input
                  style={{ width: 260 }}
                  placeholder="IP giữ chỗ (VD: 34.21.249.153)"
                  value={placeholderIp}
                  onChange={(e) => setPlaceholderIp(e.target.value)}
                />
              </div>
            )}

            {groups.map((group) => (
              <Card key={group.key} size="small" style={{ marginTop: 12, background: token.colorFillAlter }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <Space wrap>
                      {group.pics.length ? (
                        group.pics.map((p) => (
                          <Tag key={p} color="blue">
                            {p}
                          </Tag>
                        ))
                      ) : (
                        <Tag>Không xác định PIC</Tag>
                      )}
                      <Typography.Text type="secondary">{group.targets.length} domain</Typography.Text>
                    </Space>
                    <div style={{ marginTop: 4, fontSize: 12, color: token.colorTextTertiary }}>{group.reason}</div>
                    <div style={{ marginTop: 4, fontSize: 12, fontFamily: 'monospace', color: token.colorTextSecondary }}>
                      {group.targets.join(', ')}
                    </div>
                  </div>
                  <Select
                    style={{ width: 340 }}
                    placeholder="Account CF đích (để trống = mặc định .env)"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={buildAccountSelectOptions(accountOptions, group.pics)}
                    value={group.selectedAccountId}
                    onChange={(value) =>
                      setGroups((prev) => prev.map((g) => (g.key === group.key ? { ...g, selectedAccountId: value } : g)))
                    }
                  />
                </div>
              </Card>
            ))}

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Button loading={addRunning} onClick={() => runAddMissing(true)} disabled={!groups.length}>
                Xem trước (dry-run)
              </Button>
              <DangerPopconfirm
                title="Xác nhận Thêm Domain vào Cloudflare"
                targets={missingTargets}
                onConfirm={() => runAddMissing(false)}
                loading={addRunning}
              >
                <Button
                  type="primary"
                  loading={addRunning}
                  disabled={!groups.length || (!useRealIp && !placeholderIp.trim())}
                >
                  Thêm vào Cloudflare
                </Button>
              </DangerPopconfirm>
            </div>
          </Card>
        )}

        {/* Rendered outside the missingTargets>0 gate above on purpose: that
            gate flips back and forth as handleCheck() re-runs (a target
            leaving "missing" hides it, a new/still-flaky one re-shows it) -
            with CfAddJobPanel nested inside it, every flip unmounted then
            remounted already-finished panels, and a fresh mount always
            re-observes 'success' on an already-successful job and re-fires
            onSuccess - which schedules another recheck, which can flip the
            gate again, forever. Keeping panels here means they mount once
            and stay mounted regardless of what missingTargets does later. */}
        {addJob && <CfAddJobPanel key={addJob.jobId} jobId={addJob.jobId} label={addJob.label} onSuccess={scheduleRecheck} />}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button loading={running || isBusy} onClick={() => run(true)} disabled={!readyPairs.length}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Clone WordPress Site"
            targets={readyPairs.map((p) => `${p.source} -> ${p.target}`)}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!readyPairs.length}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
          <Space wrap>
            {readyPairs.length > 0 && <Tag color="success">{readyPairs.length} sẵn sàng</Tag>}
            {missingTargets.length > 0 && <Tag color="warning">{missingTargets.length} thiếu CF</Tag>}
            {notCheckedCount > 0 && <Tag>{notCheckedCount} chưa kiểm tra</Tag>}
            {needsSourceServerCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {needsSourceServerCount} cần chọn server nguồn (domain mơ hồ)
              </Tag>
            )}
            {existingTargetCount > 0 && (
              <Tag icon={<WarningFilled />} color="error">
                {existingTargetCount} đích đã có site (sẽ bị xoá)
              </Tag>
            )}
          </Space>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && (
          <Table<API.CloneWpsiteResult>
            style={{ marginTop: 16 }}
            rowKey={(r) => `${r.source}-${r.target}`}
            dataSource={job.result}
            pagination={false}
            columns={[
              { title: 'Source', dataIndex: 'source' },
              { title: 'Target', dataIndex: 'target' },
              { title: 'Server IP', dataIndex: 'ip' },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (v) => (
                  <Tag color={v === 'OK' ? 'green' : v === 'DRYRUN' ? 'blue' : 'red'}>
                    {CLONE_STATUS_LABELS[v] || v}
                  </Tag>
                ),
              },
              {
                title: 'DNS (Cloudflare)',
                dataIndex: 'dns_status',
                render: (v) =>
                  v ? (
                    <Tag color={v === 'error' ? 'red' : v === 'unchanged' ? 'gold' : 'green'}>
                      {DNS_STATUS_LABELS[v] || v}
                    </Tag>
                  ) : (
                    '-'
                  ),
              },
              {
                title: 'Xác minh',
                dataIndex: 'verify',
                render: (v: API.VerifyInfo | undefined) => <VerifyBadge verify={v} />,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        )}

        {job?.status === 'success' && hasClonedOk && (
          <Button
            style={{ marginTop: 12 }}
            icon={<SwapOutlined />}
            onClick={() => navigate('/cf-task/cf-redirect')}
          >
            Chuyển sang Redirect 301
          </Button>
        )}
      </Card>

      <BulkImportModal
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onImport={(imported) => {
          setRows((prev) => [...prev.filter((r) => r.source || r.target), ...imported]);
          setBulkOpen(false);
          message.success(`Đã nhập ${imported.length} cặp domain`);
        }}
      />

    </PageContainer>
  );
};

export default CloneWpsite;

