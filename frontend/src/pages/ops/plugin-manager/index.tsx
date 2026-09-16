import BatchDomainPaste from '@/components/BatchDomainPaste';
import ClearCacheButton from '@/components/ClearCacheButton';
import DangerPopconfirm from '@/components/DangerPopconfirm';
import DomainSelect from '@/components/DomainSelect';
import JobLogPanel from '@/components/JobLogPanel';
import PluginResultPanel from '@/components/PluginResultPanel';
import WpOrgPluginSelect from '@/components/WpOrgPluginSelect';
import { useJobPolling } from '@/hooks/useJobPolling';
import { clearPersistedState, usePersistedState } from '@/hooks/usePersistedState';
import {
  deleteMuPlugin,
  deletePluginZip,
  deleteThemeZip,
  listDomains,
  listMuPlugins,
  listPluginZips,
  listServers,
  listThemeZips,
  triggerMuPluginInstall,
  triggerPluginActivate,
  triggerPluginCheck,
  triggerPluginDeactivate,
  triggerPluginInstallWp,
  triggerPluginInstallZip,
  triggerPluginUpdate,
  triggerThemeInstallZip,
  uploadMuPlugin,
  uploadPluginZip,
  uploadThemeZip,
} from '@/services/serverOps/api';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const PluginManager: React.FC = () => {
  const { message } = App.useApp();
  const [servers, setServers] = useState<API.ServerItem[]>([]);
  const [serverPick, setServerPick] = useState<string>();
  const [addingServerDomains, setAddingServerDomains] = useState(false);
  const [domainPick, setDomainPick] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = usePersistedState<string[]>('plugin-manager:selectedDomains', []);

  const [jobId, setJobId] = usePersistedState<number | undefined>('plugin-manager:jobId', undefined);
  const [running, setRunning] = useState(false);
  const job = useJobPolling(jobId);
  const isBusy = running || job?.status === 'running' || job?.status === 'pending';

  // domain -> plugins đã biết thật (từ job "Kiểm tra plugin" gần nhất) - dùng
  // để gợi ý slug thật cho tab Bật/Tắt thay vì bắt user gõ tay đoán mò.
  const [pluginInventory, setPluginInventory] = useState<Record<string, API.PluginItem[]>>({});

  const [toggleAction, setToggleAction] = usePersistedState<'deactivate' | 'activate'>(
    'plugin-manager:toggleAction',
    'deactivate',
  );
  const [toggleList, setToggleList] = usePersistedState<string[]>('plugin-manager:toggleList', []);
  const [slugList, setSlugList] = usePersistedState<string[]>('plugin-manager:slugList', []);

  const [zipLibrary, setZipLibrary] = useState<API.PluginZipItem[]>([]);
  const [selectedZipIds, setSelectedZipIds] = usePersistedState<number[]>('plugin-manager:selectedZipIds', []);
  const [zipUploadOpen, setZipUploadOpen] = useState(false);
  const [zipUploadLabel, setZipUploadLabel] = useState('');
  const [zipUploadFileList, setZipUploadFileList] = useState<UploadFile[]>([]);
  const [zipUploading, setZipUploading] = useState(false);

  const refreshZipLibrary = () => listPluginZips().then((res) => setZipLibrary(res.data || []));

  const [themeZipLibrary, setThemeZipLibrary] = useState<API.ThemeZipItem[]>([]);
  const [selectedThemeZipIds, setSelectedThemeZipIds] = usePersistedState<number[]>(
    'plugin-manager:selectedThemeZipIds',
    [],
  );
  const [themeZipUploadOpen, setThemeZipUploadOpen] = useState(false);
  const [themeZipUploadLabel, setThemeZipUploadLabel] = useState('');
  const [themeZipUploadFileList, setThemeZipUploadFileList] = useState<UploadFile[]>([]);
  const [themeZipUploading, setThemeZipUploading] = useState(false);
  const refreshThemeZipLibrary = () => listThemeZips().then((res) => setThemeZipLibrary(res.data || []));

  const [muPluginLibrary, setMuPluginLibrary] = useState<API.MuPluginItem[]>([]);
  const [selectedMuPluginId, setSelectedMuPluginId] = usePersistedState<number | undefined>(
    'plugin-manager:selectedMuPluginId',
    undefined,
  );
  const [muPluginUploadOpen, setMuPluginUploadOpen] = useState(false);
  const [muPluginUploadLabel, setMuPluginUploadLabel] = useState('');
  const [muPluginUploadFileList, setMuPluginUploadFileList] = useState<UploadFile[]>([]);
  const [muPluginUploading, setMuPluginUploading] = useState(false);
  const refreshMuPluginLibrary = () => listMuPlugins().then((res) => setMuPluginLibrary(res.data || []));

  useEffect(() => {
    listServers({ current: 1, pageSize: 500 }).then((res) => setServers(res.data || []));
    refreshZipLibrary();
    refreshThemeZipLibrary();
    refreshMuPluginLibrary();
  }, []);

  useEffect(() => {
    if (job?.job_type === 'plugin_check' && job.status === 'success') {
      const inv: Record<string, API.PluginItem[]> = {};
      (job.result as API.PluginCheckResult[]).forEach((r) => {
        inv[r.domain] = r.plugins;
      });
      setPluginInventory((prev) => ({ ...prev, ...inv }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  const addServerDomains = async () => {
    if (!serverPick) return;
    setAddingServerDomains(true);
    try {
      const res = await listDomains({ server_name: serverPick, pageSize: 500, current: 1 });
      const domains = (res.data || []).map((d) => d.domain);
      setSelectedDomains((prev) => Array.from(new Set([...prev, ...domains])));
      message.success(`Đã thêm ${domains.length} domain từ server ${serverPick}`);
    } finally {
      setAddingServerDomains(false);
    }
  };

  const addPickedDomains = () => {
    if (!domainPick.length) return;
    setSelectedDomains((prev) => Array.from(new Set([...prev, ...domainPick])));
    setDomainPick([]);
  };

  const requireDomains = () => {
    if (!selectedDomains.length) {
      message.warning('Chọn ít nhất 1 domain ở trên trước');
      return false;
    }
    return true;
  };

  const handleCheck = async () => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerPluginCheck(selectedDomains);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const pluginSummary = useMemo(() => {
    const map = new Map<string, { active: number; inactive: number; total: number }>();
    selectedDomains.forEach((domain) => {
      (pluginInventory[domain] || []).forEach((p) => {
        const cur = map.get(p.name) || { active: 0, inactive: 0, total: 0 };
        cur.total += 1;
        if (p.status === 'active') cur.active += 1;
        else cur.inactive += 1;
        map.set(p.name, cur);
      });
    });
    return map;
  }, [pluginInventory, selectedDomains]);

  const checkedDomainCount = selectedDomains.filter((d) => pluginInventory[d]).length;
  const toggleOptions = Array.from(pluginSummary.entries()).map(([name, c]) => ({
    value: name,
    label: `${name} — đang bật ${c.active}/${c.total} domain đã kiểm tra`,
  }));

  const runToggle = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    if (!toggleList.length) {
      message.warning('Chọn ít nhất 1 plugin');
      return;
    }
    setRunning(true);
    try {
      const trigger = toggleAction === 'deactivate' ? triggerPluginDeactivate : triggerPluginActivate;
      const res = await trigger(selectedDomains, toggleList, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setToggleList([]);
        clearPersistedState('plugin-manager:toggleList');
      }
    } finally {
      setRunning(false);
    }
  };

  const runInstallWp = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    if (!slugList.length) {
      message.warning('Chọn ít nhất 1 plugin');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerPluginInstallWp(selectedDomains, slugList, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setSlugList([]);
        clearPersistedState('plugin-manager:slugList');
      }
    } finally {
      setRunning(false);
    }
  };

  const zipUploadFile = zipUploadFileList[0]?.originFileObj as File | undefined;

  const handleZipUpload = async () => {
    if (!zipUploadFile || !zipUploadLabel.trim()) {
      message.warning('Nhập nhãn và chọn file zip trước');
      return;
    }
    setZipUploading(true);
    try {
      const created = await uploadPluginZip(zipUploadLabel.trim(), zipUploadFile);
      message.success(`Đã thêm "${created.label}" vào thư viện`);
      await refreshZipLibrary();
      setSelectedZipIds((prev) => [...prev, created.id]);
      setZipUploadOpen(false);
      setZipUploadLabel('');
      setZipUploadFileList([]);
    } finally {
      setZipUploading(false);
    }
  };

  const handleZipDelete = async (id: number) => {
    await deletePluginZip(id);
    message.success('Đã xoá khỏi thư viện');
    setSelectedZipIds((prev) => prev.filter((x) => x !== id));
    refreshZipLibrary();
  };

  const runInstallZip = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    if (!selectedZipIds.length) {
      message.warning('Chọn ít nhất 1 plugin từ thư viện');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerPluginInstallZip(selectedDomains, selectedZipIds, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setSelectedZipIds([]);
        clearPersistedState('plugin-manager:selectedZipIds');
      }
    } finally {
      setRunning(false);
    }
  };

  const themeZipUploadFile = themeZipUploadFileList[0]?.originFileObj as File | undefined;

  const handleThemeZipUpload = async () => {
    if (!themeZipUploadFile || !themeZipUploadLabel.trim()) {
      message.warning('Nhập nhãn và chọn file zip trước');
      return;
    }
    setThemeZipUploading(true);
    try {
      const created = await uploadThemeZip(themeZipUploadLabel.trim(), themeZipUploadFile);
      message.success(`Đã thêm "${created.label}" vào thư viện`);
      await refreshThemeZipLibrary();
      setSelectedThemeZipIds((prev) => [...prev, created.id]);
      setThemeZipUploadOpen(false);
      setThemeZipUploadLabel('');
      setThemeZipUploadFileList([]);
    } finally {
      setThemeZipUploading(false);
    }
  };

  const handleThemeZipDelete = async (id: number) => {
    await deleteThemeZip(id);
    message.success('Đã xoá khỏi thư viện');
    setSelectedThemeZipIds((prev) => prev.filter((x) => x !== id));
    refreshThemeZipLibrary();
  };

  const runInstallThemeZip = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    if (!selectedThemeZipIds.length) {
      message.warning('Chọn ít nhất 1 theme từ thư viện');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerThemeInstallZip(selectedDomains, selectedThemeZipIds, dryRun);
      setJobId(res.job_id);
      if (!dryRun) {
        setSelectedThemeZipIds([]);
        clearPersistedState('plugin-manager:selectedThemeZipIds');
      }
    } finally {
      setRunning(false);
    }
  };

  const muPluginUploadFile = muPluginUploadFileList[0]?.originFileObj as File | undefined;

  const handleMuPluginUpload = async () => {
    if (!muPluginUploadFile || !muPluginUploadLabel.trim()) {
      message.warning('Nhập nhãn và chọn file .php trước');
      return;
    }
    setMuPluginUploading(true);
    try {
      const created = await uploadMuPlugin(muPluginUploadLabel.trim(), muPluginUploadFile);
      message.success(`Đã thêm "${created.label}" vào thư viện`);
      await refreshMuPluginLibrary();
      setSelectedMuPluginId(created.id);
      setMuPluginUploadOpen(false);
      setMuPluginUploadLabel('');
      setMuPluginUploadFileList([]);
    } finally {
      setMuPluginUploading(false);
    }
  };

  const handleMuPluginDelete = async (id: number) => {
    await deleteMuPlugin(id);
    message.success('Đã xoá khỏi thư viện');
    setSelectedMuPluginId((prev) => (prev === id ? undefined : prev));
    refreshMuPluginLibrary();
  };

  const runInstallMuPlugin = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    if (!selectedMuPluginId) {
      message.warning('Chọn 1 mu-plugin từ thư viện');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerMuPluginInstall(selectedDomains, selectedMuPluginId, dryRun);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const runUpdate = async (dryRun: boolean) => {
    if (!requireDomains()) return;
    setRunning(true);
    try {
      const res = await triggerPluginUpdate(selectedDomains, dryRun);
      setJobId(res.job_id);
    } finally {
      setRunning(false);
    }
  };

  const targetPicker = (
    <Card size="small" title={`Chọn domain đích (${selectedDomains.length} đã chọn)`} style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            style={{ flex: 1 }}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="Chọn 1 server - thêm toàn bộ domain trên server đó"
            value={serverPick}
            onChange={setServerPick}
            options={servers.map((s) => ({
              value: s.server_name,
              label: `${s.server_name} (${s.provider} · ${s.ip}) — ${s.domains_count} domain`,
            }))}
          />
          <Button icon={<PlusOutlined />} loading={addingServerDomains} disabled={!serverPick} onClick={addServerDomains}>
            Thêm domain của server
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <DomainSelect value={domainPick} onChange={setDomainPick} placeholder="Hoặc tìm và chọn từng domain..." />
          </div>
          <Button icon={<PlusOutlined />} disabled={!domainPick.length} onClick={addPickedDomains}>
            Thêm domain đã chọn
          </Button>
          <BatchDomainPaste
            onAdd={(domains) =>
              setSelectedDomains((prev) => Array.from(new Set([...prev, ...domains])))
            }
          />
        </div>

        {selectedDomains.length > 0 && (
          <div>
            <Space wrap>
              {selectedDomains.map((d) => (
                <Tag key={d} closable onClose={() => setSelectedDomains((prev) => prev.filter((x) => x !== d))}>
                  {d}
                </Tag>
              ))}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Button size="small" danger onClick={() => setSelectedDomains([])}>
                Xoá tất cả
              </Button>
            </div>
          </div>
        )}
      </Space>
    </Card>
  );

  return (
    <PageContainer
      title="Quản lý Plugin WordPress"
      extra={
        <ClearCacheButton
          onClear={() => {
            setSelectedDomains([]);
            setJobId(undefined);
            setToggleAction('deactivate');
            setToggleList([]);
            setSlugList([]);
            setSelectedZipIds([]);
            setSelectedThemeZipIds([]);
            setSelectedMuPluginId(undefined);
            [
              'selectedDomains',
              'jobId',
              'toggleAction',
              'toggleList',
              'slugList',
              'selectedZipIds',
              'selectedThemeZipIds',
              'selectedMuPluginId',
            ].forEach((k) => clearPersistedState(`plugin-manager:${k}`));
          }}
        />
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Chọn domain đích ở trên, sau đó chọn 1 hành động ở các tab bên dưới. Mọi thao tác chạy song song trên nhiều domain qua SSH, riêng 'Cài từ file zip' và 'Update' chạy tuần tự từng domain một để tránh dồn tải lên cùng 1 server."
      />

      {targetPicker}

      <Card>
        <Tabs
          items={[
            {
              key: 'check',
              label: 'Kiểm tra plugin',
              children: (
                <div>
                  <Typography.Paragraph type="secondary">
                    Liệt kê toàn bộ plugin (tên, trạng thái, phiên bản) trên từng domain đã chọn. Kết quả này cũng
                    được dùng để gợi ý plugin thật ở tab &quot;Bật / Tắt plugin&quot;.
                  </Typography.Paragraph>
                  <Button type="primary" loading={isBusy} onClick={handleCheck}>
                    Kiểm tra
                  </Button>
                </div>
              ),
            },
            {
              key: 'toggle',
              label: 'Bật / Tắt plugin',
              children: (
                <div>
                  <Radio.Group
                    value={toggleAction}
                    onChange={(e) => setToggleAction(e.target.value)}
                    style={{ marginBottom: 12 }}
                  >
                    <Radio.Button value="deactivate">Tắt plugin</Radio.Button>
                    <Radio.Button value="activate">Bật plugin</Radio.Button>
                  </Radio.Group>

                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button size="small" icon={<ReloadOutlined />} loading={isBusy} onClick={handleCheck}>
                      Tải danh sách plugin thật
                    </Button>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {checkedDomainCount > 0
                        ? `Đã có dữ liệu cho ${checkedDomainCount}/${selectedDomains.length} domain đã chọn`
                        : 'Chưa có dữ liệu - bấm nút trên để lấy danh sách plugin thật, hoặc gõ thẳng slug bên dưới'}
                    </Typography.Text>
                  </div>

                  <Select
                    mode="tags"
                    style={{ width: '100%' }}
                    placeholder="Chọn plugin từ danh sách thật, hoặc gõ slug rồi Enter"
                    value={toggleList}
                    onChange={setToggleList}
                    options={toggleOptions}
                  />

                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runToggle(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <Button danger type="primary" loading={isBusy} onClick={() => runToggle(false)}>
                      Chạy thật
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'install-wp',
              label: 'Cài từ WP.org',
              children: (
                <div>
                  <Typography.Paragraph type="secondary">
                    Tìm plugin theo tên (không cần biết slug) - dữ liệu lấy trực tiếp từ WordPress.org.
                  </Typography.Paragraph>
                  <WpOrgPluginSelect value={slugList} onChange={setSlugList} />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runInstallWp(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <Button danger type="primary" loading={isBusy} onClick={() => runInstallWp(false)}>
                      Chạy thật
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'install-zip',
              label: 'Cài từ file zip',
              children: (
                <div>
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Thư viện plugin đã upload - tick chọn để cài, không cần tải lại từ máy mỗi lần.
                    </Typography.Paragraph>
                    <Button icon={<UploadOutlined />} onClick={() => setZipUploadOpen(true)}>
                      Tải plugin mới lên thư viện
                    </Button>
                  </div>
                  <Table<API.PluginZipItem>
                    size="small"
                    rowKey="id"
                    dataSource={zipLibrary}
                    pagination={false}
                    rowSelection={{
                      selectedRowKeys: selectedZipIds,
                      onChange: (keys) => setSelectedZipIds(keys as number[]),
                    }}
                    columns={[
                      { title: 'Nhãn', dataIndex: 'label' },
                      { title: 'File', dataIndex: 'filename' },
                      { title: 'Dung lượng', dataIndex: 'size_bytes', render: (v) => formatSize(v) },
                      { title: 'Người tải lên', dataIndex: 'uploaded_by' },
                      { title: 'Ngày tải', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('vi-VN') },
                      {
                        title: '',
                        width: 48,
                        render: (_, r) => (
                          <Popconfirm title={`Xoá "${r.label}" khỏi thư viện?`} onConfirm={() => handleZipDelete(r.id)}>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runInstallZip(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <Button danger type="primary" loading={isBusy} onClick={() => runInstallZip(false)}>
                      Chạy thật
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'install-theme-zip',
              label: 'Theme (từ file zip)',
              children: (
                <div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Chỉ cài vào wp-content/themes, KHÔNG tự activate - site đang chạy giữ nguyên giao diện. Muốn dùng theme mới thì activate riêng sau."
                  />
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Thư viện theme đã upload - tick chọn để cài, không cần tải lại từ máy mỗi lần.
                    </Typography.Paragraph>
                    <Button icon={<UploadOutlined />} onClick={() => setThemeZipUploadOpen(true)}>
                      Tải theme mới lên thư viện
                    </Button>
                  </div>
                  <Table<API.ThemeZipItem>
                    size="small"
                    rowKey="id"
                    dataSource={themeZipLibrary}
                    pagination={false}
                    rowSelection={{
                      selectedRowKeys: selectedThemeZipIds,
                      onChange: (keys) => setSelectedThemeZipIds(keys as number[]),
                    }}
                    columns={[
                      { title: 'Nhãn', dataIndex: 'label' },
                      { title: 'File', dataIndex: 'filename' },
                      { title: 'Dung lượng', dataIndex: 'size_bytes', render: (v) => formatSize(v) },
                      { title: 'Người tải lên', dataIndex: 'uploaded_by' },
                      { title: 'Ngày tải', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('vi-VN') },
                      {
                        title: '',
                        width: 48,
                        render: (_, r) => (
                          <Popconfirm title={`Xoá "${r.label}" khỏi thư viện?`} onConfirm={() => handleThemeZipDelete(r.id)}>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runInstallThemeZip(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <Button danger type="primary" loading={isBusy} onClick={() => runInstallThemeZip(false)}>
                      Chạy thật
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'install-mu-plugin',
              label: 'mu-plugin',
              children: (
                <div>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="mu-plugin chạy ngay lập tức trên MỌI request, không có nút tắt như plugin thường. Hệ thống tự lint cú pháp trước khi đặt file, và tự động xoá lại nếu site sập ngay sau khi deploy - nhưng vẫn cẩn trọng khi dùng."
                  />
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      Thư viện mu-plugin (.php) đã upload - chọn 1 để triển khai.
                    </Typography.Paragraph>
                    <Button icon={<UploadOutlined />} onClick={() => setMuPluginUploadOpen(true)}>
                      Tải mu-plugin mới lên thư viện
                    </Button>
                  </div>
                  <Table<API.MuPluginItem>
                    size="small"
                    rowKey="id"
                    dataSource={muPluginLibrary}
                    pagination={false}
                    rowSelection={{
                      type: 'radio',
                      selectedRowKeys: selectedMuPluginId ? [selectedMuPluginId] : [],
                      onChange: (keys) => setSelectedMuPluginId(keys[0] as number | undefined),
                    }}
                    columns={[
                      { title: 'Nhãn', dataIndex: 'label' },
                      { title: 'File', dataIndex: 'filename' },
                      { title: 'Dung lượng', dataIndex: 'size_bytes', render: (v) => formatSize(v) },
                      { title: 'Người tải lên', dataIndex: 'uploaded_by' },
                      { title: 'Ngày tải', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('vi-VN') },
                      {
                        title: '',
                        width: 48,
                        render: (_, r) => (
                          <Popconfirm title={`Xoá "${r.label}" khỏi thư viện?`} onConfirm={() => handleMuPluginDelete(r.id)}>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runInstallMuPlugin(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <DangerPopconfirm
                      title="Xác nhận triển khai mu-plugin"
                      targets={selectedDomains}
                      onConfirm={() => runInstallMuPlugin(false)}
                      loading={running}
                    >
                      <Button danger type="primary" loading={isBusy} disabled={!selectedDomains.length || !selectedMuPluginId}>
                        Chạy thật
                      </Button>
                    </DangerPopconfirm>
                  </div>
                </div>
              ),
            },
            {
              key: 'update',
              label: 'Update tất cả (+ WP Core)',
              children: (
                <div>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Chạy 'wp plugin update --all' + 'wp core update' cho từng domain. Có kiểm tra HTTP trước/sau - nếu site lỗi sau update sẽ tự động rollback (tắt rồi bật lại toàn bộ plugin). Chạy tuần tự từng domain, không song song."
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button loading={isBusy} onClick={() => runUpdate(true)}>
                      Xem trước (dry-run)
                    </Button>
                    <DangerPopconfirm
                      title="Xác nhận Update Plugin + WP Core"
                      targets={selectedDomains}
                      onConfirm={() => runUpdate(false)}
                      loading={running}
                    >
                      <Button danger type="primary" loading={isBusy} disabled={!selectedDomains.length}>
                        Chạy thật
                      </Button>
                    </DangerPopconfirm>
                  </div>
                </div>
              ),
            },
          ]}
        />

        <JobLogPanel job={job} />
        <PluginResultPanel job={job} />
      </Card>


      <Modal
        title="Tải plugin mới lên thư viện"
        open={zipUploadOpen}
        onCancel={() => {
          setZipUploadOpen(false);
          setZipUploadLabel('');
          setZipUploadFileList([]);
        }}
        onOk={handleZipUpload}
        confirmLoading={zipUploading}
        okButtonProps={{ disabled: !zipUploadFile || !zipUploadLabel.trim() }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="Nhãn (VD: Rank Math Pro)"
            value={zipUploadLabel}
            onChange={(e) => setZipUploadLabel(e.target.value)}
          />
          <Upload.Dragger
            accept=".zip"
            maxCount={1}
            fileList={zipUploadFileList}
            beforeUpload={(f) => {
              if (!f.name.toLowerCase().endsWith('.zip')) {
                message.error('Chỉ chấp nhận file .zip');
                return Upload.LIST_IGNORE;
              }
              // Tự điền nhãn từ tên file nếu chưa gõ - bấm kéo-thả xong là đủ
              // điều kiện bấm "Đồng ý" ngay, không bắt buộc gõ tay trước.
              setZipUploadLabel((prev) => (prev.trim() ? prev : f.name.replace(/\.zip$/i, '')));
              return false;
            }}
            onChange={(info) => setZipUploadFileList(info.fileList.slice(-1))}
          >
            <p className="ant-upload-text">Kéo thả hoặc bấm để chọn file .zip</p>
          </Upload.Dragger>
        </Space>
      </Modal>

      <Modal
        title="Tải theme mới lên thư viện"
        open={themeZipUploadOpen}
        onCancel={() => {
          setThemeZipUploadOpen(false);
          setThemeZipUploadLabel('');
          setThemeZipUploadFileList([]);
        }}
        onOk={handleThemeZipUpload}
        confirmLoading={themeZipUploading}
        okButtonProps={{ disabled: !themeZipUploadFile || !themeZipUploadLabel.trim() }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="Nhãn (VD: Astra Pro)"
            value={themeZipUploadLabel}
            onChange={(e) => setThemeZipUploadLabel(e.target.value)}
          />
          <Upload.Dragger
            accept=".zip"
            maxCount={1}
            fileList={themeZipUploadFileList}
            beforeUpload={(f) => {
              if (!f.name.toLowerCase().endsWith('.zip')) {
                message.error('Chỉ chấp nhận file .zip');
                return Upload.LIST_IGNORE;
              }
              setThemeZipUploadLabel((prev) => (prev.trim() ? prev : f.name.replace(/\.zip$/i, '')));
              return false;
            }}
            onChange={(info) => setThemeZipUploadFileList(info.fileList.slice(-1))}
          >
            <p className="ant-upload-text">Kéo thả hoặc bấm để chọn file .zip</p>
          </Upload.Dragger>
        </Space>
      </Modal>

      <Modal
        title="Tải mu-plugin mới lên thư viện"
        open={muPluginUploadOpen}
        onCancel={() => {
          setMuPluginUploadOpen(false);
          setMuPluginUploadLabel('');
          setMuPluginUploadFileList([]);
        }}
        onOk={handleMuPluginUpload}
        confirmLoading={muPluginUploading}
        okButtonProps={{ disabled: !muPluginUploadFile || !muPluginUploadLabel.trim() }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="File .php này sẽ tự chạy trên mọi request ngay khi triển khai - chỉ upload mã bạn tin tưởng."
          />
          <Input
            placeholder="Nhãn (VD: Force SSL admin)"
            value={muPluginUploadLabel}
            onChange={(e) => setMuPluginUploadLabel(e.target.value)}
          />
          <Upload.Dragger
            accept=".php"
            maxCount={1}
            fileList={muPluginUploadFileList}
            beforeUpload={(f) => {
              if (!f.name.toLowerCase().endsWith('.php')) {
                message.error('Chỉ chấp nhận file .php');
                return Upload.LIST_IGNORE;
              }
              setMuPluginUploadLabel((prev) => (prev.trim() ? prev : f.name.replace(/\.php$/i, '')));
              return false;
            }}
            onChange={(info) => setMuPluginUploadFileList(info.fileList.slice(-1))}
          >
            <p className="ant-upload-text">Kéo thả hoặc bấm để chọn file .php</p>
          </Upload.Dragger>
        </Space>
      </Modal>
    </PageContainer>
  );
};

export default PluginManager;
