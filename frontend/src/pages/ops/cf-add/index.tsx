import CfAddResultPanel from '@/components/CfAddResultPanel';
import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import JobLogPanel from '@/components/JobLogPanel';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import { listCfAccountOptions, listServers, suggestCfAccount, triggerCfAdd } from '@/services/serverOps/api';
import { buildAccountSelectOptions } from '@/utils/cfAccountOptions';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, App, Button, Card, Checkbox, Input, Select, theme } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const { TextArea } = Input;

const parseDomains = (text: string) =>
  Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const CfAdd: React.FC = () => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [text, setText] = usePersistedState('cf-add:text', '');
  const [ip, setIp] = usePersistedState('cf-add:ip', '');
  const [servers, setServers] = useState<API.ServerItem[]>([]);
  const [accountOptions, setAccountOptions] = useState<API.CfAccountOption[]>([]);
  const [suggestion, setSuggestion] = useState<API.PicSuggestCfAccount>();
  const [selectedAccountId, setSelectedAccountId] = usePersistedState<number | undefined>(
    'cf-add:selectedAccountId',
    undefined,
  );
  const [forceReconfigure, setForceReconfigure] = usePersistedState('cf-add:forceReconfigure', false);
  const [jobId, setJobId] = usePersistedState<number | undefined>('cf-add:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    listServers({ current: 1, pageSize: 200 }).then((res) => setServers(res.data));
    listCfAccountOptions().then((res) => setAccountOptions(res.data || []));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = ip.trim();
    if (!trimmed) {
      setSuggestion(undefined);
      setSelectedAccountId(undefined);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await suggestCfAccount(trimmed);
      setSuggestion(res);
      setSelectedAccountId(res.suggested_account_id || undefined);
    }, 400);
  }, [ip]);

  const domains = parseDomains(text);

  const run = async (dryRun: boolean) => {
    if (!domains.length) {
      message.warning('Nhập ít nhất 1 domain (mỗi dòng 1 domain)');
      return;
    }
    if (!ip.trim()) {
      message.warning('Nhập IP đích');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerCfAdd(domains, ip.trim(), dryRun, selectedAccountId, forceReconfigure);
      setJobId(res.job_id);
      if (!dryRun) {
        setText('');
        clearPersistedState('cf-add:text');
      }
    } catch (err: any) {
      message.error(`Lỗi khi thêm domain: ${err?.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const isBusy = job?.status === 'running' || job?.status === 'pending';

  const accountSelectOptions = buildAccountSelectOptions(accountOptions, suggestion?.pics || []);

  const clearCache = () => {
    setText('');
    setIp('');
    setSelectedAccountId(undefined);
    setForceReconfigure(false);
    setJobId(undefined);
    ['text', 'ip', 'selectedAccountId', 'forceReconfigure', 'jobId'].forEach((k) =>
      clearPersistedState(`cf-add:${k}`),
    );
  };

  return (
    <PageContainer title="Thêm Domain vào Cloudflare" extra={<ClearCacheButton onClear={clearCache} />}>
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Tạo zone Cloudflare mới + DNS A/CNAME + SSL flexible + Always HTTPS + firewall mặc định."
          description="Domain đã có sẵn trong Cloudflare sẽ được bỏ qua, không ghi đè cấu hình (trừ khi bật 'Ép áp lại cấu hình chuẩn' bên dưới - dùng khi biết chắc zone đó bị thiết lập dang dở). Tài khoản CF đích được tự gợi ý theo PIC của server sở hữu IP - có thể chọn tay tài khoản khác."
        />
        <TextArea
          rows={6}
          placeholder="Nhập danh sách domain cần thêm, mỗi dòng 1 domain..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            style={{ width: 320 }}
            placeholder="Chọn server có sẵn để lấy IP (tuỳ chọn)"
            allowClear
            showSearch
            optionFilterProp="label"
            options={servers.map((s) => ({ label: `${s.server_name} (${s.ip})`, value: s.ip }))}
            onChange={(v) => setIp(v || '')}
          />
          <Input
            style={{ width: 200 }}
            placeholder="IP đích (VD 34.21.249.153)"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
          />
        </div>

        {ip.trim() && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, color: token.colorTextTertiary, fontSize: 12 }}>
              {suggestion?.matched_server
                ? suggestion.suggested_account_id
                  ? `Gợi ý theo PIC ${suggestion.pics.join(', ')} (server ${suggestion.matched_server}) - có thể chọn account khác bên dưới`
                  : `Server ${suggestion.matched_server} chưa gán PIC - chọn tay account bên dưới hoặc để trống (dùng mặc định .env)`
                : `IP không khớp server nào đã đồng bộ - chọn tay account bên dưới hoặc để trống (dùng mặc định .env)`}
            </div>
            <Select
              style={{ width: 380 }}
              placeholder="Account CF đích (để trống = dùng mặc định .env)"
              allowClear
              showSearch
              optionFilterProp="label"
              options={accountSelectOptions}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
            />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <Checkbox checked={forceReconfigure} onChange={(e) => setForceReconfigure(e.target.checked)}>
            Ép áp lại cấu hình chuẩn (DNS/SSL/HTTPS/Firewall) kể cả khi zone đã tồn tại
          </Checkbox>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button loading={running || isBusy} onClick={() => run(true)}>
            Xem trước (dry-run)
          </Button>
          <DangerPopconfirm
            title="Xác nhận Thêm Domain vào Cloudflare"
            targets={domains}
            onConfirm={() => run(false)}
            loading={running}
          >
            <Button danger type="primary" loading={running || isBusy} disabled={!domains.length || !ip.trim()}>
              Chạy thật
            </Button>
          </DangerPopconfirm>
        </div>

        <JobLogPanel job={job} />

        {(job?.status === 'success' || job?.status === 'failed') && <CfAddResultPanel result={job.result} />}
      </Card>
    </PageContainer>
  );
};

export default CfAdd;
